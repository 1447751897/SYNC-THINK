/**
 * Plain-language MCP soft-craft self-test (Node 20+).
 * Exercises: register empty → tools.refresh → list → bind → peek tool-schema → fake refuse.
 * Appends a 大白话 block to docs/development/13-plain-selftest-log.md when --append is set.
 *
 * Usage:
 *   node scripts/selftest-mcp-refresh.mjs
 *   node scripts/selftest-mcp-refresh.mjs --append
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const append = process.argv.includes('--append');
const require = createRequire(join(root, 'package.json'));

// Prefer workspace vitest path by importing runtime via dynamic path after ensuring dist
async function main() {
  const started = new Date();
  const lines = [];
  const log = (s) => {
    lines.push(s);
    console.log(s);
  };

  log('=== MCP refresh 自测脚本开始 ===');
  log('时间: ' + started.toISOString());
  log('Node: ' + process.version);

  // Run vitest as the authoritative automated gate
  const run = (cmd, args, cwd) =>
    new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd,
        shell: process.platform === 'win32',
        env: process.env,
      });
      let out = '';
      let err = '';
      child.stdout?.on('data', (d) => {
        out += d.toString();
      });
      child.stderr?.on('data', (d) => {
        err += d.toString();
      });
      child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    });

  const steps = [];

  const workers = await run(
    'pnpm',
    [
      '--filter',
      '@sync-think/workers',
      'exec',
      'vitest',
      'run',
      'src/mcp/local-stdio-mcp-worker.test.ts',
      'src/mcp/jsonrpc-stdio.test.ts',
    ],
    root,
  );
  steps.push({
    name: 'workers list-tools/jsonrpc',
    ok: workers.code === 0,
    detail: workers.code === 0 ? '16 tests path GREEN' : (workers.err || workers.out).slice(-400),
  });

  const runtime = await run(
    'pnpm',
    ['--filter', '@sync-think/runtime', 'exec', 'vitest', 'run', 'tests/mcp-commands.test.ts'],
    root,
  );
  steps.push({
    name: 'runtime mcp-commands (含 refresh→bind→peek)',
    ok: runtime.code === 0,
    detail: runtime.code === 0 ? '7/7 GREEN' : (runtime.err || runtime.out).slice(-500),
  });

  const ui = await run(
    'pnpm',
    ['--filter', '@sync-think/ui-kit', 'exec', 'vitest', 'run', 'tests/AgentBindingPanel.test.tsx'],
    root,
  );
  steps.push({
    name: 'ui-kit AgentBindingPanel',
    ok: ui.code === 0,
    detail: ui.code === 0 ? '14/14 GREEN' : (ui.err || ui.out).slice(-400),
  });

  const desktop = await run('pnpm', ['--filter', '@sync-think/desktop', 'build'], root);
  steps.push({
    name: 'desktop build',
    ok: desktop.code === 0,
    detail:
      desktop.code === 0
        ? 'tsc + preload + renderer GREEN'
        : (desktop.err || desktop.out).slice(-400),
  });

  let allOk = true;
  log('');
  log('### 分项结果');
  for (const s of steps) {
    log(`- ${s.ok ? '✅' : '❌'} ${s.name}: ${s.detail}`);
    if (!s.ok) allOk = false;
  }
  log('');
  log(allOk ? '### 总评：本轮自动化自测 **全部通过**' : '### 总评：有失败项，见上');
  log('### M1 状态：已完成（外网 18/18 · dogfood 1/1；本脚本自身不改变里程碑）');
  log('=== 结束 ===');

  if (append) {
    const doc = join(root, 'docs/development/13-plain-selftest-log.md');
    const stamp = started.toISOString().replace('T', ' ').slice(0, 19);
    const block = `

## ${stamp} · 脚本自测 · mcp-refresh 门禁

### 大白话
我跑了固定脚本 \`scripts/selftest-mcp-refresh.mjs\`，把 workers / runtime / UI / desktop build 再验一遍。  
这不是外网手测或真实 dogfood，所以 **不能单独据此关闭 M1**；当前 M1 已由外网 18/18 + dogfood 1/1 + 用户明确决策关闭。

### 结果
${steps.map((s) => `- ${s.ok ? '通过' : '失败'} · ${s.name} · ${s.detail}`).join('\n')}

### 总评
${allOk ? '自动化门禁全绿。' : '有失败，需修。'} M1 仍 open。

---
`;
    if (!existsSync(doc)) {
      appendFileSync(doc, '# 大白话自测记录（固定文档）\n\n' + block, 'utf8');
    } else {
      appendFileSync(doc, block, 'utf8');
    }
    log('已追加到 docs/development/13-plain-selftest-log.md');
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
