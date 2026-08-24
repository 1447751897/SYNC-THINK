// Inline-process UI E2E: launch the built desktop, drive a real prompt that
// triggers reasoning + tool calls, then assert the DSH-style inline view
// (think row / intermediate text / tool cards / final answer) in the DOM.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = join(repo, 'apps', 'desktop');
const workersRequire = createRequire(join(repo, 'packages', 'workers', 'package.json'));
const { _electron } = workersRequire('playwright-core');
const electronPath = join(desktopDir, 'node_modules', 'electron', 'dist', 'electron.exe');

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const app = await _electron.launch({
  executablePath: electronPath,
  args: ['.'],
  cwd: desktopDir,
  env: {
    ...process.env,
    SYNC_THINK_INSTALL_ID: 'dev-0001',
    SYNC_THINK_DEV_NO_TOKEN: '1',
  },
  timeout: 60000,
});

try {
  const window = await app.firstWindow();
  window.setDefaultTimeout(180_000);

  // 1. Wait for the composer (empty state or in-conversation state).
  const input = window
    .getByTestId('empty-compose-input')
    .or(window.getByTestId('compose-input'))
    .first();
  await input.waitFor({ state: 'visible' });
  record('composer ready', true);

  // 2. Type a prompt that forces a tool loop.
  const prompt = '看一下这个项目的顶层目录结构，列出主要目录和文件（用只读工具，不要修改任何文件）。';
  await input.click();
  await input.fill(prompt);
  const send = window
    .getByTestId('empty-compose-send')
    .or(window.getByTestId('compose-send'))
    .first();
  if (await send.isVisible().catch(() => false)) await send.click();
  else await input.press('Enter');
  record('prompt sent', true, prompt.slice(0, 30) + '…');

  // 3. Watch for the inline process flow (latest message flow).
  const flow = window.getByTestId('inline-process-flow').last();
  await flow.waitFor({ state: 'attached', timeout: 180_000 });
  record('inline process flow appears', true);

  // 4. Think row appears (collapsed summary = first line).
  const thinkRow = flow.getByTestId('inline-process-reasoning').first();
  const thinkSummary = flow.getByTestId('think-row-summary').first();
  await thinkSummary.waitFor({ state: 'visible', timeout: 120_000 });
  const summaryText = await thinkSummary.textContent();
  record('think row with first-line summary', Boolean(summaryText?.trim()), summaryText?.slice(0, 40));

  // 5. Expand the think row and confirm the full body.
  await flow.getByTestId('think-row-toggle').first().click();
  const thinkBody = flow.getByTestId('think-row-body').first();
  await thinkBody.waitFor({ state: 'visible', timeout: 10_000 });
  const bodyLen = (await thinkBody.textContent())?.length ?? 0;
  record('think row expands to full reasoning', bodyLen > 0, `${bodyLen} chars`);

  // 6. Tool cards appear with a status.
  const toolCard = flow.getByTestId('inline-process-tool').first();
  await toolCard.waitFor({ state: 'visible', timeout: 120_000 });
  const toolText = (await toolCard.textContent()) ?? '';
  record('tool card visible', toolText.includes('完成') || toolText.includes('执行中') || toolText.includes('失败'), toolText.slice(0, 40));

  // 7. Expand the tool card to see arguments/result.
  await toolCard.locator('button').first().click();
  const resultPre = flow.getByTestId('inline-process-tool-result').first();
  const resultText = (await resultPre.textContent().catch(() => null)) ?? '';
  record('tool card expands with result', resultText.length > 0, `${resultText.length} chars`);

  // 8. Final answer lands after the process.
  await window
    .locator('[data-testid="inline-process-flow"]')
    .last()
    .locator('xpath=following-sibling::*[1]')
    .waitFor({ state: 'attached', timeout: 180_000 });
  const pageText = await window.locator('body').innerText();
  const flowIndex = pageText.lastIndexOf('思考');
  const tail = pageText.slice(flowIndex === -1 ? 0 : flowIndex);
  const hasAnswer = /项目|目录|结构|SYNC|packages|apps|文件/.test(tail);
  record('final answer present after process', hasAnswer, tail.slice(-160).replaceAll('\n', ' '));

  // 9. The legacy panel is collapsed by default (its toggle exists).
  const processToggle = window.getByRole('button', { name: /过程/ }).first();
  const panelOpen = await processToggle.getAttribute('aria-expanded').catch(() => null);
  record('legacy panel collapsed by default', panelOpen !== 'true', `aria-expanded=${panelOpen}`);

  // Screenshot for the user.
  const shot = await window.screenshot({ path: join(repo, '.data', 'inline-process-e2e.png') });
  record('screenshot saved', shot.length > 0, join(repo, '.data', 'inline-process-e2e.png'));

  await writeFile(
    join(repo, '.data', 'inline-process-e2e-results.json'),
    JSON.stringify(results, null, 2),
    'utf8',
  );
} finally {
  await app.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length > 0 ? 1 : 0);
