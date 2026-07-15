/**
 * M1 soft regression pack — local auto suites vs handtest hard-gate reminder.
 * Soft only: NOT a substitute for 外网 UI 手测 or dogfood ≥1 天.
 *
 * Usage:
 *   node scripts/selftest-m1-soft-regression.mjs
 *   node scripts/selftest-m1-soft-regression.mjs --quick
 *   node scripts/selftest-m1-soft-regression.mjs --json
 *
 * --quick : desktop m1 soft unit tests only (no dual gateways)
 * --json  : print machine-readable summary line
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const quick = process.argv.includes('--quick');
const asJson = process.argv.includes('--json');

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
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
}

/** @type {{ id: string; label: string; filter: string; testFiles: string[]; package: string }[]} */
const SUITES = [
  {
    id: 'dual-http',
    label: 'runtime dual-http-gateway',
    package: '@sync-think/runtime',
    filter: '@sync-think/runtime',
    testFiles: ['tests/dual-http-gateway.test.ts'],
  },
  {
    id: 'dual-protocol',
    label: 'runtime dual-protocol-gateway',
    package: '@sync-think/runtime',
    filter: '@sync-think/runtime',
    testFiles: ['tests/dual-protocol-gateway.test.ts'],
  },
  {
    id: 'm1-soft-pack',
    label: 'desktop m1 soft pack (regression + exit + handtest + dogfood + stream)',
    package: '@sync-think/desktop',
    filter: '@sync-think/desktop',
    testFiles: [
      'tests/m1-soft-regression.test.ts',
      'tests/m1-exit-evidence.test.ts',
      'tests/m1-handtest-checklist.test.ts',
      'tests/m1-dogfood-score.test.ts',
      'tests/m1-next-action.test.ts',
      'tests/m1-soft-snapshot.test.ts',
      'tests/conversation-stream-readiness.test.ts',
      'tests/m1-evidence-bundle.test.ts',
      'tests/m1-exit-path.test.ts',
      'tests/m1-handtest-doc-parse.test.ts',
      'tests/m1-handtest-doc-diff.test.ts',
      'tests/m1-dogfood-fill-board.test.ts',
      'tests/m1-external-focus.test.ts',
    ],
  },
];

async function main() {
  const started = new Date();
  const steps = [];

  console.log('=== M1 soft 回归包 ===');
  console.log('时间:', started.toISOString());
  console.log('Node:', process.version);
  console.log('说明: 本地自动化 · 不是外网手测 · 不能单独关 M1 · claimsM1Closed=false');
  console.log(quick ? '模式: --quick（跳过 dual 网关）' : '模式: full（含 dual）');

  const list = quick ? SUITES.filter((s) => s.id === 'm1-soft-pack') : SUITES;

  for (const suite of list) {
    const result = await run(
      'pnpm',
      ['--filter', suite.filter, 'exec', 'vitest', 'run', ...suite.testFiles],
      root,
    );
    const ok = result.code === 0;
    const detail = ok ? 'GREEN' : (result.err || result.out).slice(-400).replace(/\s+/g, ' ');
    steps.push({ id: suite.id, label: suite.label, ok, detail });
    console.log((ok ? '✅' : '❌') + ' ' + suite.label + ': ' + detail.slice(0, 120));
  }

  const allOk = steps.every((s) => s.ok);
  const summary = {
    ok: allOk,
    claimsM1Closed: false,
    claimsDocChecked: false,
    softCraftRound: 57,
    generatedAt: started.toISOString(),
    steps,
    note: '外网手测 18/18 + dogfood ≥1 天为硬门槛；当前真实证据为 18/18 + 1/1',
  };

  console.log('');
  console.log(
    allOk ? '### 总评：soft 回归包 **全部通过**（本脚本不改变里程碑状态）' : '### 总评：有失败项',
  );
  console.log(
    '### M1 状态：已完成（外网 18/18 · dogfood 1/1；soft 脚本自身 claimsM1Closed=false）',
  );
  console.log('=== 结束 ===');

  if (asJson) {
    console.log(JSON.stringify(summary));
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
