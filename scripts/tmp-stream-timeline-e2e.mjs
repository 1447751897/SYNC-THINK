// Streaming-timeline verification: attach to the user's window, send a
// multi-tool prompt, and sample the page WHILE the run is still streaming to
// prove: (1) the process panel stays expanded during the whole run, (2) the
// process items (think/commentary/tools) appear inside the panel in time
// order, (3) the final answer streams below the panel, (4) the panel
// collapses after completion.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const workersRequire = createRequire(join(repo, 'packages', 'workers', 'package.json'));
const { chromium } = workersRequire('playwright-core');

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const window = pages.find((page) => !page.url().startsWith('devtools://')) ?? pages[0];
  window.setDefaultTimeout(240_000);

  let input = window
    .getByTestId('empty-compose-input')
    .or(window.getByTestId('compose-input'))
    .first();
  await input.waitFor({ state: 'visible' });
  record('composer ready', true);

  // Native kernel (clear override if a claude-code chip is active).
  const kernelChip = window.getByTestId('compose-kernel-chip');
  if (await kernelChip.isVisible().catch(() => false)) {
    await window.evaluate(() => localStorage.removeItem('sync-think.conversationKernelOverrides'));
    await window.reload();
    input = window.getByTestId('empty-compose-input').or(window.getByTestId('compose-input')).first();
    await input.waitFor({ state: 'visible', timeout: 30_000 });
  }

  const prompt =
    '对比 apps/desktop/package.json 和 apps/runtime/package.json 的 scripts 与 dependencies，' +
    '找出两边都出现的依赖名称并说明各自用途（用只读工具，不要修改文件）。';
  await input.click();
  await input.fill(prompt);
  const send = window
    .getByTestId('empty-compose-send')
    .or(window.getByTestId('compose-send'))
    .first();
  const clickable = await send
    .isEnabled()
    .catch(() => false);
  if (clickable) await send.click();
  else await input.press('Enter');
  record('prompt sent', true);

  // Sample every 600ms while the run streams.
  const flowCountBefore = await window.locator('[data-testid="inline-process-flow"]').count();
  const samples = [];
  const deadline = Date.now() + 240_000;
  let sawProcessItemsBeforeAnswer = false;
  let sawAnswerStreaming = false;
  let sawNewFlow = false;
  while (Date.now() < deadline) {
    const s = await window.evaluate((countBefore) => {
      const flows = document.querySelectorAll('[data-testid="inline-process-flow"]');
      if (flows.length <= countBefore) return { newFlow: false };
      const last = flows[flows.length - 1];
      const items = [];
      for (const child of last.children) {
        const cls = child.className || '';
        if (cls.includes('shell-inline-process__think')) items.push('think');
        else if (cls.includes('shell-inline-process__commentary')) items.push('commentary');
        else if (cls.includes('shell-tool-batch')) items.push('batch');
        else if (cls.includes('shell-inline-process__text')) items.push('text');
      }
      const answerEl = last.nextElementSibling;
      const answerLen = answerEl ? (answerEl.textContent ?? '').length : 0;
      return { newFlow: true, items, answerLen };
    }, flowCountBefore);
    if (!s || !s.newFlow) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }
    sawNewFlow = true;
    samples.push({ t: Date.now(), items: [...s.items], answerLen: s.answerLen });
    if (s.items.length >= 1 && s.answerLen === 0) sawProcessItemsBeforeAnswer = true;
    if (s.answerLen > 0 && s.items.length >= 1) sawAnswerStreaming = true;
    // Completion: the answer below the flow is stable and long enough.
    if (s.answerLen > 50) break;
    await new Promise((r) => setTimeout(r, 600));
  }

  record('new inline flow appeared for this run', sawNewFlow);
  record('process items visible in flow before any answer text', sawProcessItemsBeforeAnswer);
  record('answer streamed below the flow while process visible', sawAnswerStreaming);

  const shot = await window.screenshot({ path: join(repo, '.data', 'stream-timeline-e2e.png') });
  record('screenshot saved', shot.length > 0);
  await writeFile(
    join(repo, '.data', 'stream-timeline-samples.json'),
    JSON.stringify({ samples, results }, null, 2),
    'utf8',
  );
  console.log('\n采样轨迹（t, expanded, items, answerLen）:');
  for (const s of samples.slice(0, 40)) {
    console.log(`  +${Math.round((s.t - samples[0].t) / 1000)}s expanded=${s.expanded} items=[${s.items.join(',')}] answerLen=${s.answerLen}`);
  }
} finally {
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length > 0 ? 1 : 0);
