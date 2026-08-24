// Smoke via raw page-level CDP: reload the user's window, wait for the shell,
// and verify the new bundle renders (composer ready, no plan card, no hint).
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const wsRequire = createRequire(join(repo, 'package.json'));
const WebSocket = wsRequire('D:/projects/SYNC-THINK/node_modules/.pnpm/ws@8.21.0/node_modules/ws');

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (!page) {
  console.log('FAIL  no page target');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.reload', { ignoreCache: true });

  // Wait for the compose input to exist in the new bundle.
  let composerReady = false;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const evalResult = await send('Runtime.evaluate', {
      expression: `!!(document.querySelector('[data-testid="empty-compose-input"], [data-testid="compose-input"]'))`,
      returnByValue: true,
    });
    if (evalResult?.result?.value === true) {
      composerReady = true;
      break;
    }
  }
  record('app alive after reload (composer ready)', composerReady);

  const probe = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      card: document.querySelectorAll('[data-testid="plan-approval-card"]').length,
      hint: document.querySelectorAll('[data-testid="plan-act-hint"]').length,
      modeStrip: document.querySelectorAll('[data-testid="plan-approval-card"]').length
    })`,
    returnByValue: true,
  });
  const counts = JSON.parse(probe?.result?.value ?? '{}');
  record('no plan card without a draft plan', counts.card === 0, `card=${counts.card}`);
  record('no plan-act hint while disabled', counts.hint === 0, `hint=${counts.hint}`);
} finally {
  ws.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed > 0 ? 1 : 0);
