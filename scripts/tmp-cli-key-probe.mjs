// Diagnostic: decrypt the DeepSeek credential (DPAPI, memory-only — never
// printed), then run the Claude CLI exactly like the claude-code kernel does,
// comparing model names against the DeepSeek anthropic-compatible endpoint.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const req = createRequire(join(process.cwd(), 'packages/storage/package.json'));
const Database = req('better-sqlite3');
const db = new Database('C:/Users/zhuzhenyu/AppData/Local/SYNC-THINK/sync-think.db', { readonly: true });

const refId = '8PSQM40S6Z1RPKA7PTHJ7SNNVN';
const ref = db.prepare(`SELECT store_handle FROM credential_ref WHERE id=?`).get(refId);
db.close();
if (!ref) {
  console.log('credential ref not found');
  process.exit(1);
}
const handle = ref.store_handle;
const vaultDir = 'C:/Users/zhuzhenyu/AppData/Local/SYNC-THINK/secure-store/dpapi-vault';
const ciphertext = readFileSync(join(vaultDir, `${handle}.dpapi`), 'ascii').trim();

// DPAPI unprotect via PowerShell (same script shape as the backend).
const dpapiScript = String.raw`
$ErrorActionPreference = 'Stop'
[Reflection.Assembly]::LoadWithPartialName('System.Security') | Out-Null
$encoded = [Console]::In.ReadToEnd().Trim()
$inputBytes = [Convert]::FromBase64String($encoded)
$outputBytes = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($outputBytes))
`;
const encodedScript = Buffer.from(dpapiScript, 'utf16le').toString('base64');
const dpapi = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript], {
  input: ciphertext,
  encoding: 'utf8',
  timeout: 15000,
});
if (dpapi.status !== 0) {
  console.log('DPAPI unprotect failed:', dpapi.stderr.slice(0, 200));
  process.exit(1);
}
const apiKey = Buffer.from(dpapi.stdout.trim(), 'base64').toString('utf8');
if (!apiKey) {
  console.log('empty key');
  process.exit(1);
}
console.log('credential decrypted (length', apiKey.length, ')');

function runCli(model, baseUrl) {
  return new Promise((resolve) => {
    const args = [
      '--print', '--verbose', '--output-format', 'stream-json', '--input-format', 'stream-json',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode',
      'bypassPermissions', '--session-id', randomUUID(), '--model', model, '--setting-sources=',
    ];
    const child = spawn('claude', args, {
      cwd: 'D:/projects/SYNC-THINK',
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_AUTH_TOKEN: apiKey,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ model, baseUrl, timedOut: true, out, err });
    }, 20000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ model, baseUrl, code, out, err });
    });
    child.stdin.write(JSON.stringify({
      type: 'control_request',
      request_id: `init-${randomUUID()}`,
      request: { subtype: 'initialize' },
    }) + '\n');
    setTimeout(() => {
      child.stdin.write(JSON.stringify({
        type: 'user',
        session_id: '',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        parent_tool_use_id: null,
      }) + '\n');
    }, 50);
  });
}

for (const [model, baseUrl] of [
  ['deepseek-v4-flash', 'https://api.deepseek.com'],
  ['deepseek-chat', 'https://api.deepseek.com'],
  ['deepseek-v4-flash', 'https://api.deepseek.com/anthropic'],
  ['deepseek-chat', 'https://api.deepseek.com/anthropic'],
]) {
  const result = await runCli(model, baseUrl);
  const interesting = result.out
    .split('\n')
    .filter((l) => /init|assistant|error|issue with|api_retry|terminal/.test(l))
    .slice(0, 4)
    .map((l) => l.slice(0, 260));
  console.log(`\n=== model=${model} baseUrl=${baseUrl} code=${result.code} timedOut=${result.timedOut} ===`);
  console.log(interesting.join('\n') || '(no matching lines)');
  if (result.err.trim()) console.log('stderr:', result.err.slice(0, 300));
}
