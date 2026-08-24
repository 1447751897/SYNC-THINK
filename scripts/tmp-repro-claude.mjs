// Reproduce the claude-code kernel call exactly (stdin stream-json protocol)
// to isolate why SYNC-THINK's spawn fails with "issue with the selected model"
// while the plain CLI invocation succeeds.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const args = [
  '--print',
  '--output-format',
  'stream-json',
  '--verbose',
  '--input-format',
  'stream-json',
  '--include-partial-messages',
  '--permission-prompt-tool',
  'stdio',
  '--permission-mode',
  'bypassPermissions',
  '--session-id',
  randomUUID(),
  '--model',
  'deepseek-v4-flash',
  '--setting-sources=',
  '--strict-mcp-config',
  '--mcp-config',
  'D:/projects/SYNC-THINK/.data/e2e-mcp-config.json',
];

const env = {
  ...process.env,
  ANTHROPIC_BASE_URL: 'https://api.deepseek.com',
  ANTHROPIC_API_KEY: 'sk-fake-key-for-probe',
  ANTHROPIC_AUTH_TOKEN: 'sk-fake-key-for-probe',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};

const child = spawn('claude', args, { cwd: 'D:/projects/SYNC-THINK', env, stdio: ['pipe', 'pipe', 'pipe'] });

let out = '';
child.stdout.on('data', (c) => {
  out += c.toString();
});
let err = '';
child.stderr.on('data', (c) => {
  err += c.toString();
});

child.stdin.write(
  JSON.stringify({
    type: 'control_request',
    request_id: `init-${randomUUID()}`,
    request: { subtype: 'initialize', appendSystemPrompt: 'You are SYNC-THINK.' },
  }) + '\n',
);
setTimeout(() => {
  child.stdin.write(
    JSON.stringify({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      parent_tool_use_id: null,
    }) + '\n',
  );
}, 50);

const timer = setTimeout(() => {
  console.log('=== TIMEOUT after 25s, killing ===');
  child.kill('SIGKILL');
}, 25000);

child.on('close', (code) => {
  clearTimeout(timer);
  console.log('exit code:', code);
  console.log('--- stdout (first 2000 chars) ---');
  console.log(out.slice(0, 2000));
  console.log('--- stderr (first 2000 chars) ---');
  console.log(err.slice(0, 2000));
});
