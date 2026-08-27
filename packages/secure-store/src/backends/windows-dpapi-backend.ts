import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecureStoreBackend } from '../types.js';

const STORE_HANDLE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
// PowerShell startup plus CurrentUser DPAPI regularly crosses 10 seconds on a
// busy Windows desktop. Keep a bounded timeout, but leave enough headroom for
// concurrent build/test and background Runtime load.
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_INPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const DPAPI_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Reflection.Assembly]::LoadWithPartialName('System.Security') | Out-Null
$operation = [Environment]::GetEnvironmentVariable('SYNC_THINK_DPAPI_OPERATION', 'Process')
$encoded = [Console]::In.ReadToEnd().Trim()
$inputBytes = [Convert]::FromBase64String($encoded)
if ($operation -eq 'protect') {
  $outputBytes = [Security.Cryptography.ProtectedData]::Protect(
    $inputBytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
} elseif ($operation -eq 'unprotect') {
  $outputBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $inputBytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
} else {
  throw 'Unsupported DPAPI operation'
}
[Console]::Out.Write([Convert]::ToBase64String($outputBytes))
`;

export interface DpapiBridge {
  protect(plaintext: Buffer): Promise<string>;
  unprotect(ciphertext: string): Promise<Buffer>;
}

export interface PowerShellDpapiBridgeOptions {
  executable?: string;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

function runPowerShellDpapi(
  operation: 'protect' | 'unprotect',
  input: Buffer,
  options: Required<PowerShellDpapiBridgeOptions>,
): Promise<Buffer> {
  if (input.byteLength > options.maxInputBytes) {
    return Promise.reject(new Error('DPAPI input exceeds the configured limit'));
  }

  return new Promise<Buffer>((resolve, reject) => {
    const encodedScript = Buffer.from(DPAPI_SCRIPT, 'utf16le').toString('base64');
    const child = spawn(
      options.executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedScript,
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SYNC_THINK_DPAPI_OPERATION: operation,
        },
      },
    );

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (error?: Error, result?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result ?? Buffer.alloc(0));
    };

    const failForOutputLimit = () => {
      child.kill();
      finish(new Error('DPAPI helper output exceeds the configured limit'));
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > options.maxOutputBytes) {
        failForOutputLimit();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > options.maxOutputBytes) {
        failForOutputLimit();
        return;
      }
      stderr.push(chunk);
    });
    child.once('error', (error) =>
      finish(new Error(`DPAPI helper could not start: ${error.message}`)),
    );
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 512);
        finish(new Error(`DPAPI helper failed${detail ? `: ${detail}` : ''}`));
        return;
      }
      const encoded = Buffer.concat(stdout).toString('ascii').trim();
      finish(undefined, Buffer.from(encoded, 'base64'));
    });

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('DPAPI helper timed out'));
    }, options.timeoutMs);
    timer.unref();

    child.stdin.once('error', (error) =>
      finish(new Error(`DPAPI helper input failed: ${error.message}`)),
    );
    child.stdin.end(input.toString('base64'));
  });
}

export function createPowerShellDpapiBridge(
  input: PowerShellDpapiBridgeOptions = {},
): DpapiBridge {
  const options: Required<PowerShellDpapiBridgeOptions> = {
    executable: input.executable ?? 'powershell.exe',
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxInputBytes: input.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  };
  return {
    async protect(plaintext) {
      return (await runPowerShellDpapi('protect', plaintext, options)).toString('base64');
    },
    async unprotect(ciphertext) {
      return runPowerShellDpapi('unprotect', Buffer.from(ciphertext, 'base64'), options);
    },
  };
}

export interface WindowsDpapiBackendOptions {
  vaultDirectory: string;
  bridge?: DpapiBridge;
  legacyBackend?: SecureStoreBackend;
}

export class WindowsDpapiBackend implements SecureStoreBackend {
  readonly name = 'windows-dpapi';
  private readonly bridge: DpapiBridge;

  constructor(private readonly options: WindowsDpapiBackendOptions) {
    this.bridge = options.bridge ?? createPowerShellDpapiBridge();
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'win32' && !this.options.bridge) return false;
    try {
      const probe = randomBytes(32);
      const ciphertext = await this.bridge.protect(probe);
      return (await this.bridge.unprotect(ciphertext)).equals(probe);
    } catch {
      return false;
    }
  }

  async store(handle: string, plaintext: string): Promise<void> {
    const path = this.vaultPath(handle);
    const ciphertext = await this.bridge.protect(Buffer.from(plaintext, 'utf8'));
    await mkdir(this.options.vaultDirectory, { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporaryPath, ciphertext, { encoding: 'ascii', mode: 0o600, flag: 'wx' });
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async retrieve(handle: string): Promise<string> {
    try {
      const ciphertext = await readFile(this.vaultPath(handle), 'ascii');
      return (await this.bridge.unprotect(ciphertext.trim())).toString('utf8');
    } catch (error) {
      if (!this.isMissingFile(error)) throw error;
    }

    if (!this.options.legacyBackend) {
      throw Object.assign(new Error('secret not found'), { code: 'SECRET_NOT_FOUND' });
    }
    const plaintext = await this.options.legacyBackend.retrieve(handle);
    await this.store(handle, plaintext);
    await this.options.legacyBackend.remove(handle);
    return plaintext;
  }

  async remove(handle: string): Promise<void> {
    await rm(this.vaultPath(handle), { force: true });
    if (this.options.legacyBackend) await this.options.legacyBackend.remove(handle);
  }

  private vaultPath(handle: string): string {
    if (!STORE_HANDLE_PATTERN.test(handle)) throw new Error('invalid storeHandle');
    return join(this.options.vaultDirectory, `${handle}.dpapi`);
  }

  private isMissingFile(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
  }
}
