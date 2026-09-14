import { spawn } from 'node:child_process';
import type { SecureStoreBackend } from '../types.js';

const HANDLE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SERVICE = 'com.syncthink.desktop';

export interface KeychainCommandRunner {
  (args: string[], input?: string): Promise<{ code: number | null; stdout: string; stderr: string }>;
}

function defaultRunner(args: string[], input?: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export class MacKeychainBackend implements SecureStoreBackend {
  readonly name = 'macos-keychain';

  constructor(
    private readonly runner: KeychainCommandRunner = defaultRunner,
    private readonly service = SERVICE,
  ) {}

  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'darwin' && this.runner === defaultRunner) return false;
    try {
      const handle = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      await this.store(handle, 'sync-think-probe');
      await this.remove(handle);
      return true;
    } catch {
      return false;
    }
  }

  async store(handle: string, plaintext: string): Promise<void> {
    this.assertHandle(handle);
    const result = await this.runner(
      ['add-generic-password', '-U', '-a', handle, '-s', this.service, '-w', plaintext],
    );
    if (result.code !== 0) throw this.error('store', result);
  }

  async retrieve(handle: string): Promise<string> {
    this.assertHandle(handle);
    const result = await this.runner(
      ['find-generic-password', '-a', handle, '-s', this.service, '-w'],
    );
    if (result.code !== 0) {
      if (/could not be found|SecKeychainSearchCopyNext/i.test(result.stderr)) {
        throw Object.assign(new Error('secret not found'), { code: 'SECRET_NOT_FOUND' });
      }
      throw this.error('retrieve', result);
    }
    return result.stdout.trimEnd();
  }

  async remove(handle: string): Promise<void> {
    this.assertHandle(handle);
    const result = await this.runner(
      ['delete-generic-password', '-a', handle, '-s', this.service],
    );
    if (result.code !== 0 && !/could not be found|SecKeychainSearchCopyNext/i.test(result.stderr)) {
      throw this.error('remove', result);
    }
  }

  private assertHandle(handle: string): void {
    if (!HANDLE_PATTERN.test(handle)) throw new Error('invalid storeHandle');
  }

  private error(operation: string, result: { stderr: string }): Error {
    const detail = result.stderr.trim().slice(0, 512);
    return new Error(`macOS Keychain ${operation} failed${detail ? `: ${detail}` : ''}`);
  }
}
