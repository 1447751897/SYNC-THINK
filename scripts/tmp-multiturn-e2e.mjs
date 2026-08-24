// Multi-turn inline-process E2E: drive a real prompt that forces SEVERAL
// tool calls, then capture the actual inline sequence
// (思考 → 摘要 → 工具 → 思考 → 工具 → … → 最终回答) rendered by the flow.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = join(repo, 'apps', 'desktop');
const workersRequire = createRequire(join(repo, 'packages', 'workers', 'package.json'));
const { _electron } = workersRequire('playwright-core');
const electronPath = join(desktopDir, 'node_modules', 'electron', 'dist', 'electron.exe');

// Isolated user data dir: lets the test instance coexist with the user's
// open window (separate single-instance lock + Chromium cache) and starts
// with a clean profile (default native kernel, no stale overrides).
const e2eUserData = join(repo, '.data', 'e2e-userdata');
await import('node:fs/promises').then((fs) => fs.rm(e2eUserData, { recursive: true, force: true }));

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const app = await _electron.launch({
  executablePath: electronPath,
  args: ['.', `--user-data-dir=${e2eUserData}`],
  cwd: desktopDir,
  env: { ...process.env, SYNC_THINK_INSTALL_ID: 'dev-0001', SYNC_THINK_DEV_NO_TOKEN: '1' },
  timeout: 60000,
});

try {
  const window = await app.firstWindow();
  window.setDefaultTimeout(240_000);

  let input = window
    .getByTestId('empty-compose-input')
    .or(window.getByTestId('compose-input'))
    .first();
  await input.waitFor({ state: 'visible' });
  record('composer ready', true);

  // A task that NEEDS several tool calls (compare two files → at least two reads).
  const prompt =
    '对比 apps/desktop/package.json 和 apps/runtime/package.json 的 scripts 与 dependencies，' +
    '找出两边都出现的依赖名称并说明各自用途（用只读工具，不要修改文件）。';

  // Ensure the conversation runs on the native kernel (a previous manual switch
  // to claude-code would otherwise fail the deepseek model at the CLI). Clear
  // the per-conversation kernel override from localStorage and reload.
  const kernelChip = window.getByTestId('compose-kernel-chip');
  if (await kernelChip.isVisible().catch(() => false)) {
    await window.evaluate(() => {
      localStorage.removeItem('sync-think.conversationKernelOverrides');
      localStorage.removeItem('conversation-kernel');
    });
    await window.reload();
    const reloadedInput = window
      .getByTestId('empty-compose-input')
      .or(window.getByTestId('compose-input'))
      .first();
    await reloadedInput.waitFor({ state: 'visible', timeout: 30_000 });
    input = reloadedInput;
    record('kernel override cleared (native default)', true);
  }

  await input.click();
  await input.fill(prompt);
  const send = window
    .getByTestId('empty-compose-send')
    .or(window.getByTestId('compose-send'))
    .first();
  if (await send.isVisible().catch(() => false)) await send.click();
  else await input.press('Enter');
  record('prompt sent', true, '对比两个 package.json（多轮工具任务）');

  // Wait for the NEW process panel: the panel count must grow past the pre-send count.
  const panelCountBefore = await window.locator('[data-testid="process-panel"]').count();
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const count = await window.locator('[data-testid="process-panel"]').count();
    if (count > panelCountBefore) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const panel = window.getByTestId('process-panel').last();
  await panel.waitFor({ state: 'attached', timeout: 240_000 });
  // The outer panel is collapsed by default; expand it to inspect the process.
  const toggle = panel.getByTestId('process-panel-toggle');
  await toggle.click().catch(() => {});

  let sequence = [];
  let stableRounds = 0;
  let lastSnapshot = '';
  while (Date.now() < deadline) {
    // Idempotently expand every tool batch that exists right now so the
    // individual cards are rendered before the snapshot is taken.
    const batchToggles = panel.getByTestId('tool-batch-toggle');
    const batchCount = await batchToggles.count().catch(() => 0);
    for (let i = 0; i < batchCount; i += 1) {
      const expanded = await batchToggles
        .nth(i)
        .getAttribute('aria-expanded')
        .catch(() => 'false');
      if (expanded !== 'true') await batchToggles.nth(i).click().catch(() => {});
    }
    const snapshot = await window.evaluate(() => {
      const panels = document.querySelectorAll('[data-testid="process-panel"]');
      const last = panels[panels.length - 1];
      if (!last) return null;
      const items = [];
      const walk = (root) => {
        for (const child of root.children) {
          const cls = child.className || '';
          if (cls.includes('shell-process-panel__body')) {
            walk(child);
            continue;
          }
          if (cls.includes('shell-inline-process__think')) {
            const summary = child.querySelector('[data-testid="think-row-summary"]');
            items.push({ kind: 'think', text: (summary?.textContent ?? '').slice(0, 34) });
          } else if (cls.includes('shell-inline-process__text')) {
            items.push({ kind: 'text', text: (child.textContent ?? '').slice(0, 34) });
          } else if (cls.includes('shell-inline-process__commentary')) {
            items.push({ kind: 'commentary', text: (child.textContent ?? '').slice(0, 34) });
          } else if (cls.includes('shell-tool-batch')) {
            const title = child.querySelector('.shell-tool-batch__title');
            const tools = child.querySelectorAll('[data-testid="inline-process-tool"]');
            items.push({
              kind: 'batch',
              text: `${(title?.textContent ?? '').trim()} (${tools.length} 卡片)`,
            });
            // individual cards inside the batch
            for (const tool of tools) {
              const name = tool.querySelector('.shell-inline-process__tool-name');
              const status = tool.querySelector('.shell-inline-process__tool-status');
              items.push({
                kind: 'tool',
                text: `${(name?.textContent ?? '').trim()}(${(status?.textContent ?? '').trim()})`,
              });
            }
          }
        }
      };
      walk(last);
      const answerEl = last.nextElementSibling;
      const answerText = answerEl ? (answerEl.textContent ?? '').trim() : '';
      return { items, answer: answerText.length > 0 };
    });
    if (snapshot) {
      const serialized = JSON.stringify(snapshot.items);
      if (serialized === lastSnapshot && snapshot.answer) {
        stableRounds += 1;
        if (stableRounds >= 2) {
          sequence = snapshot.items;
          break;
        }
      } else {
        stableRounds = 0;
        lastSnapshot = serialized;
        sequence = snapshot.items;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const kinds = sequence.map((item) => item.kind);
  const display = sequence
    .map((item) => (item.kind === 'batch' ? `[${item.text}]` : `${item.kind}:${item.text}`))
    .join('\n  ');
  record(
    'multi-turn sequence captured',
    kinds.length >= 2,
    display,
  );
  const toolKinds = kinds.filter((k) => k === 'tool');
  const thinkKinds = kinds.filter((k) => k === 'think');
  record(
    'think-then-tool order preserved',
    thinkKinds.length >= 1 && toolKinds.length >= 1 && kinds.indexOf('tool') > kinds.indexOf('think'),
    `think×${thinkKinds.length}, tool×${toolKinds.length}`,
  );
  record('multiple tool calls happened', toolKinds.length >= 2, `${toolKinds.length} tool cards`);
  record(
    're-think between tools (DSH loop)',
    kinds.indexOf('think') !== kinds.lastIndexOf('think'),
    kinds.indexOf('think') !== kinds.lastIndexOf('think') ? '出现第二个思考行' : '本轮模型未在工具之间再次思考',
  );
  record(
    'tool batch panel groups adjacent calls',
    sequence.some((item) => item.kind === 'batch'),
    sequence.filter((item) => item.kind === 'batch').length + ' 个批次面板',
  );

  // Final answer present after the flow.
  const pageText = await window.locator('body').innerText();
  const flowIndex = pageText.lastIndexOf('思考');
  const tail = pageText.slice(flowIndex === -1 ? 0 : flowIndex);
  const hasAnswer = /依赖|scripts|dependencies|包|package/.test(tail);
  record('final answer present after process', hasAnswer, tail.slice(-140).replaceAll('\n', ' '));

  const shot = await window.screenshot({ path: join(repo, '.data', 'inline-multiturn-e2e.png') });
  record('screenshot saved', shot.length > 0, join(repo, '.data', 'inline-multiturn-e2e.png'));

  await writeFile(
    join(repo, '.data', 'inline-multiturn-sequence.json'),
    JSON.stringify({ sequence, results }, null, 2),
    'utf8',
  );
  console.log('\n实际序列:');
  for (const item of sequence) console.log(`  ${item.kind.padEnd(10)} ${item.text}`);
} finally {
  await app.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length > 0 ? 1 : 0);
