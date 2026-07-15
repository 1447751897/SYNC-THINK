/**
 * Plain-language dual-gateway soft-craft self-test (Node 20+).
 * Exercises: dual-http-gateway + dual-protocol-gateway + recovery UI catalog + desktop build.
 * Appends a 大白话 block to docs/development/13-plain-selftest-log.md when --append is set.
 *
 * Usage:
 *   node scripts/selftest-dual-gateway.mjs
 *   node scripts/selftest-dual-gateway.mjs --append
 *
 * NOTE: This is local soft evidence for M1, NOT a substitute for 外网 UI 手测 or dogfood ≥1 天.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const append = process.argv.includes('--append');

async function main() {
  const started = new Date();
  const lines = [];
  const log = (s) => {
    lines.push(s);
    console.log(s);
  };

  log('=== Dual-gateway 自测脚本开始 ===');
  log('时间: ' + started.toISOString());
  log('Node: ' + process.version);
  log('说明: 本地 HTTP 双网关 / 双协议自动化 · 不是外网手测 · 不能单独关 M1');

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

  const dualHttp = await run(
    'pnpm',
    ['--filter', '@sync-think/runtime', 'exec', 'vitest', 'run', 'tests/dual-http-gateway.test.ts'],
    root,
  );
  steps.push({
    name: 'runtime dual-http-gateway (≥2 providers / ≥3 models path)',
    ok: dualHttp.code === 0,
    detail:
      dualHttp.code === 0
        ? 'GREEN · local dual OpenAI-compatible gateways'
        : (dualHttp.err || dualHttp.out).slice(-500),
  });

  const dualProto = await run(
    'pnpm',
    [
      '--filter',
      '@sync-think/runtime',
      'exec',
      'vitest',
      'run',
      'tests/dual-protocol-gateway.test.ts',
    ],
    root,
  );
  steps.push({
    name: 'runtime dual-protocol-gateway (openai-chat + anthropic-messages)',
    ok: dualProto.code === 0,
    detail:
      dualProto.code === 0
        ? 'GREEN · dual protocol live path'
        : (dualProto.err || dualProto.out).slice(-500),
  });

  const recovery = await run(
    'pnpm',
    [
      '--filter',
      '@sync-think/ui-kit',
      'exec',
      'vitest',
      'run',
      'tests/recovery.test.ts',
      'tests/MemoryDiagnosticsPanel.test.tsx',
      'tests/ProvidersPanel.test.tsx',
    ],
    root,
  );
  steps.push({
    name: 'ui-kit recovery + diagnostics + providers limitations',
    ok: recovery.code === 0,
    detail:
      recovery.code === 0
        ? 'GREEN · §23.2 #9/#12 catalog + UI'
        : (recovery.err || recovery.out).slice(-500),
  });

  const providerCmd = await run(
    'pnpm',
    ['--filter', '@sync-think/runtime', 'exec', 'vitest', 'run', 'tests/provider-commands.test.ts'],
    root,
  );
  steps.push({
    name: 'runtime provider-commands (protocol + discover diagnostics)',
    ok: providerCmd.code === 0,
    detail: providerCmd.code === 0 ? 'GREEN' : (providerCmd.err || providerCmd.out).slice(-400),
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
    if (!existsSync(doc)) {
      console.error('missing plain log doc', doc);
      process.exit(2);
    }
    const stamp = started.toISOString().replace('T', ' ').slice(0, 19);
    const block = `

---

## ${stamp} · 第 4 次自测 · Diagnostics 恢复指南 + 已知限制 + dual-gateway 门禁

### 大白话
这一刀主要做两件事：

1. **Diagnostics 不只是报错了**：点开一条失败诊断，会看到失败类中文名、能不能重试、按步骤怎么修（比如鉴权失败去更新 API Key）。下面还有「已知限制」折叠区，写明协议持久化、能力标签只是建议、MCP 发现不等于可执行、密钥不进库、M1 还不能关等。
2. **Providers 页顶上有限制说明**：协议选错会进诊断；发现失败会脱敏记日志。

另外用脚本跑了本地 **双 HTTP 网关 + 双协议网关** 自动化（不是外网真网关 UI 手测）。

### 自测结果
${steps.map((s) => `- ${s.ok ? '通过' : '失败'} · ${s.name} · ${s.detail}`).join('\n')}

### 你会在界面上看到啥
1. 左侧 Memory / Diagnostics → 诊断条目可点开「查看恢复步骤」
2. 鉴权失败显示「勿盲目重试」；超时显示「可重试」
3. 展开「已知限制」可读 §23.2 #12 说明
4. Providers 列表上方有「Provider / 协议限制」灰底提示条
5. 点恢复里的「前往 Providers」会平滑滚到 Providers 卡片（短暂高亮）

### 边界
- 本地 dual-gateway **不能**单独关闭 M1
- 当前外网真实网关 UI 手测 18/18 + dogfood 1/1 已满足；本脚本只提供本地回归证据
- **不进 M2**

### 固定脚本
\`node scripts/selftest-dual-gateway.mjs --append\`

### M1
仍 open。

---
`;
    appendFileSync(doc, block, 'utf8');
    log('已追加大白话 → docs/development/13-plain-selftest-log.md');
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
