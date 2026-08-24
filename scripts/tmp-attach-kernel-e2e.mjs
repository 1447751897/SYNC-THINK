// Attach to the user's window via CDP, switch the conversation to the
// claude-code kernel (deepseek-v4-flash model stays selected), send a prompt,
// and verify the run completes with the inline process UI. The window stays
// open afterwards.
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

  const input = window
    .getByTestId('empty-compose-input')
    .or(window.getByTestId('compose-input'))
    .first();
  await input.waitFor({ state: 'visible' });
  record('composer ready', true);

  // Open the model menu and pick the claude-code kernel.
  const modelTrigger = window.locator('[title^="切换模型"]').first();
  await modelTrigger.click();
  const ccOption = window.getByTestId('kernel-option-claude-code');
  await ccOption.waitFor({ state: 'visible', timeout: 10_000 });
  await ccOption.click();
  const chip = window.getByTestId('compose-kernel-chip');
  await chip.waitFor({ state: 'visible', timeout: 10_000 });
  record('claude-code kernel selected', true);

  const bodyText = await window.locator('body').innerText();
  record('composer model is deepseek-v4-flash', bodyText.includes('deepseek-v4-flash'));

  const prompt = '对比 apps/desktop/package.json 和 apps/runtime/package.json 的 scripts，列出两边共同拥有的脚本（只读，不要修改文件）。';
  await input.click();
  await input.fill(prompt);
  const send = window
    .getByTestId('empty-compose-send')
    .or(window.getByTestId('compose-send'))
    .first();
  if (await send.isVisible().catch(() => false)) await send.click();
  else await input.press('Enter');
  record('prompt sent (claude-code kernel)', true);

  // Wait for a NEW result: a new terminal row (fresh failure) or the panel +
  // answer actions. History rows are ignored by counting before the send.
  const terminalCountBefore = await window
    .locator('[data-testid^="assistant-terminal-"]')
    .count();
  const deadline = Date.now() + 240_000;
  let terminal = '';
  while (Date.now() < deadline) {
    const state = await window.evaluate((countBefore) => {
      const panels = document.querySelectorAll('[data-testid="process-panel"]');
      const last = panels[panels.length - 1];
      const terminalRows = document.querySelectorAll('[data-testid^="assistant-terminal-"]');
      const lastTerminal = terminalRows[terminalRows.length - 1];
      const text = document.body.innerText;
      return {
        panelCount: panels.length,
        terminal: terminalRows.length > countBefore && lastTerminal
          ? (lastTerminal.textContent ?? '')
          : '',
        hasAnswer: text.includes('复制') && text.includes('重新生成'),
      };
    }, terminalCountBefore);
    if (state.terminal) {
      terminal = state.terminal;
      break;
    }
    if (state.panelCount > 0 && state.hasAnswer) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (terminal) {
    record('run failed with terminal state', false, terminal.slice(0, 200));
  } else {
    record('claude-code run completed (no terminal error)', true);
  }

  // Expand the panel and capture the sequence.
  const panel = window.getByTestId('process-panel').last();
  let sequence = [];
  if (await panel.isVisible().catch(() => false)) {
    await panel.waitFor({ state: 'attached', timeout: 30_000 });
    const snapshot = await window.evaluate(() => {
      const panels = document.querySelectorAll('[data-testid="process-panel"]');
      const last = panels[panels.length - 1];
      if (!last) return [];
      const toggle = last.querySelector('[data-testid="process-panel-toggle"]');
      if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
      for (const batchToggle of last.querySelectorAll('[data-testid="tool-batch-toggle"]')) {
        if (batchToggle.getAttribute('aria-expanded') !== 'true') batchToggle.click();
      }
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
            items.push({ kind: 'think', text: (summary?.textContent ?? '').slice(0, 30) });
          } else if (cls.includes('shell-inline-process__commentary')) {
            items.push({ kind: 'commentary', text: (child.textContent ?? '').slice(0, 30) });
          } else if (cls.includes('shell-tool-batch')) {
            const title = child.querySelector('.shell-tool-batch__title');
            items.push({ kind: 'batch', text: (title?.textContent ?? '').trim() });
            for (const tool of child.querySelectorAll('[data-testid="inline-process-tool"]')) {
              const name = tool.querySelector('.shell-inline-process__tool-name');
              items.push({ kind: 'tool', text: (name?.textContent ?? '').trim() });
            }
          }
        }
      };
      walk(last);
      return items;
    });
    sequence = snapshot ?? [];
    record('claude-code process sequence captured', sequence.length > 0, sequence.map((s) => s.kind).join(' → '));
  } else {
    record('claude-code process sequence captured', false, 'no process panel rendered');
  }

  const shot = await window.screenshot({ path: join(repo, '.data', 'attach-kernel-e2e.png') });
  record('screenshot saved', shot.length > 0, join(repo, '.data', 'attach-kernel-e2e.png'));
  await writeFile(
    join(repo, '.data', 'attach-kernel-sequence.json'),
    JSON.stringify({ sequence, results }, null, 2),
    'utf8',
  );
  console.log('\n实际序列:');
  for (const item of sequence) console.log(`  ${item.kind.padEnd(10)} ${item.text}`);
} finally {
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length > 0 ? 1 : 0);
