/** Regression for sidebar-owned chat actions and the simplified header. Build build:shell:qa first.
 * Optional SHELL_QA_DIR selects an isolated QA build; the fixture never uses user data. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = resolve(root, process.env.SHELL_QA_DIR || '.data/renderer-builds/qa');
const output = join(root, '.data/pane-header-actions-preview');
await mkdir(output, { recursive: true });
const installed = (await readdir(join(root, 'node_modules/.pnpm')))
  .find(name => name.startsWith('playwright-core@'));
assert(installed, 'Install workspace dependencies first');
const { chromium } = createRequire(import.meta.url)(
  join(root, 'node_modules/.pnpm', installed, 'node_modules/playwright-core'),
);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(base, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    const content = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
const checks = [];
function check(name, result) { assert(result, name); checks.push(name); }
async function receivesPointer(locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return !!hit && element.contains(hit);
  });
}

try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  for (const theme of ['light', 'dark']) {
    for (const wallpaper of [false, true]) {
      const label = theme + '-' + (wallpaper ? 'wallpaper' : 'plain');
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/?phase3-visual=workbench&theme=' + theme + '&wallpaper=' + wallpaper);
      await page.waitForLoadState('networkidle');
      await page.getByTestId('welcome-greeting').waitFor();
      await page.getByTestId('shell-sidebar').getByText('梳理组件与主题', { exact: true }).click();
      await page.getByText('清晰的界面，从一致性开始', { exact: true }).waitFor();
      const sidebar = page.getByTestId('shell-sidebar');
      for (const width of [1440, 960]) {
        await page.setViewportSize({ width, height: 960 });
        check(label + '-' + width + ': duplicate plus omitted', await page.getByRole('button', { name: '新建资源', exact: true }).count() === 0);
        check(label + '-' + width + ': duplicate more omitted', await page.getByRole('button', { name: '窗格更多操作', exact: true }).count() === 0);
        check(label + '-' + width + ': no empty tab strip', await page.getByTestId('conversation-tabs').count() === 0);
        const newChat = sidebar.getByTestId('nav-new-chat');
        check(label + '-' + width + ': sidebar new chat receives pointer', await receivesPointer(newChat));
        await newChat.click();
        await page.getByTestId('welcome-greeting').waitFor();
        check(label + '-' + width + ': sidebar opens new draft', await page.getByTestId('chat-breadcrumb').innerText() === '新对话');
        await sidebar.getByText('梳理组件与主题', { exact: true }).click();
        await page.getByText('清晰的界面，从一致性开始', { exact: true }).waitFor();
        check(label + '-' + width + ': sidebar switches conversation', (await page.getByTestId('chat-breadcrumb').innerText()).includes('梳理组件与主题'));
        const row = sidebar.locator('.st-conv-row').filter({ hasText: '梳理组件与主题' });
        await row.hover();
        const more = row.locator('[data-testid^="conversation-menu-trigger-"]');
        await more.click();
        await page.getByRole('menuitem', { name: '重命名对话', exact: true }).waitFor();
        check(label + '-' + width + ': sidebar management menu works', await page.getByRole('menuitem', { name: '重命名对话', exact: true }).isVisible());
        await page.keyboard.press('Escape');
        await page.screenshot({ path: join(output, label + '-' + width + '-sidebar-actions.png') });
      }
      await page.getByTestId('topbar-toggle-right-workbench').click();
      await page.locator('.shell-workbench--right').getByText('Composer.tsx', { exact: true }).first().waitFor();
      check(label + ': right workbench toggle preserved', await page.locator('.shell-workbench--right').isVisible());
      check(label + ': no runtime errors', errors.length === 0);
      await page.close();
    }
  }
  await writeFile(join(output, 'verification.json'), JSON.stringify({ count: checks.length, checks }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, screenshots: output }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
