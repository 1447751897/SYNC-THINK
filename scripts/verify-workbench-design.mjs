/** Real-shell visual regression. Build with build:shell:qa first.
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE when the Playwright-managed browser is not installed.
 * Uses the existing playwright-core dependency; no user bridge, data or model calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const installed = (await readdir(join(root, 'node_modules/.pnpm'))).find(name => name.startsWith('playwright-core@'));
assert(installed, 'Install workspace dependencies first');
const { chromium } = require(join(root, 'node_modules/.pnpm', installed, 'node_modules/playwright-core'));
const base = join(root, '.data/renderer-builds/qa');
const output = join(root, '.data/workbench-design-preview');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(base, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    const content = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const results = [];
function check(name, condition, detail = '') { assert(condition, name + (detail ? ': ' + detail : '')); results.push(name); }
async function inside(page, selector) {
  const box = await page.locator(selector).filter({ visible: true }).first().boundingBox();
  const size = page.viewportSize();
  return box && box.width > 0 && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 2 && box.y + box.height <= size.height + 2;
}
async function shot(page, name) { await page.screenshot({ path: join(output, name + '.png') }); }
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?phase3-visual=workbench&theme=' + theme);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('welcome-greeting').waitFor();
    check(theme + ': document-wide design scope', await page.evaluate(() => document.documentElement.dataset.shellDesign === 'agent'));
    check(theme + ': sidebar width', Math.round((await page.getByTestId('shell-sidebar').boundingBox()).width) === 260);
    check(theme + ': home composer fits', await inside(page, '[data-testid="empty-compose"]'));
    await shot(page, theme + '-home');
    await page.getByTitle('切换模型，思考强度：自动').click();
    await page.locator('.shell-model-picker').waitFor();
    check(theme + ': model portal fits', await inside(page, '.shell-model-picker'));
    await shot(page, theme + '-model-menu');
    await page.keyboard.press('Escape');
    await page.getByText('梳理组件与主题', { exact: true }).click();
    await page.locator('.shell-user-bubble').waitFor();
    check(theme + ': real message and answer render', await page.locator('.shell-response__content').count() > 0);
    check(theme + ': composer and approval stack aligned', await page.evaluate(() => {
      const a = document.querySelector('.shell-composer-approval-stack').getBoundingClientRect();
      const b = document.querySelector('.shell-newmax-composer-frame').getBoundingClientRect();
      return Math.abs(a.width - b.width) < 2 && Math.abs(a.x - b.x) < 2;
    }));
    await page.locator('.shell-chat-message-scroller').evaluate(e => { e.scrollTop = 0; });
    await shot(page, theme + '-chat');
    await page.getByTestId('shell-sidebar').getByText('梳理组件与主题', { exact: true }).click({ button: 'right' });
    await page.locator('.shell-context-menu').waitFor();
    check(theme + ': context menu portal fits', await inside(page, '.shell-context-menu'));
    await shot(page, theme + '-context-menu');
    await page.getByRole('menuitem', { name: '重命名对话', exact: true }).click();
    await page.locator('.st-modal-in').waitFor();
    check(theme + ': rename dialog fits', await inside(page, '.st-modal-in'));
    await shot(page, theme + '-dialog');
    await page.locator('.st-modal-in').getByRole('button', { name: '取消', exact: true }).click();
    await page.getByTestId('topbar-toggle-right-workbench').click();
    await page.locator('.shell-workbench--right').getByText('Composer.tsx', { exact: true }).first().waitFor();
    check(theme + ': right workbench fits', await inside(page, '.shell-workbench--right'));
    await shot(page, theme + '-chat-panels');
    await page.locator('.shell-workbench--right').getByText('Composer.tsx', { exact: true }).first().click();
    await page.locator('.shell-workbench--right [data-testid="file-pane-save"]').waitFor();
    await shot(page, theme + '-file-preview');
    await page.setViewportSize({ width: 960, height: 760 });
    await page.waitForTimeout(300);
    check(theme + ': compact workbench toolbar fits', await inside(page, '.shell-workbench--right .shell-workbench__tabbar'));
    check(theme + ': compact file list remains reachable', await inside(page, '.shell-workbench--right .shell-workbench__files'));
    check(theme + ': compact approval details remain reachable', await inside(page, '.shell-plan-card__composer-details-toggle'));
    await shot(page, theme + '-compact');
    await page.getByTestId('topbar-toggle-right-workbench').click();
    await page.getByTestId('sidebar-toggle').click();
    await page.waitForTimeout(600);
    check(theme + ': sidebar collapse works', await page.getByTestId('shell-sidebar').getAttribute('data-collapsed') === 'true');
    await page.setViewportSize({ width: 768, height: 720 });
    check(theme + ': collapsed narrow composer fits', await inside(page, '.shell-newmax-composer-frame'));
    await shot(page, theme + '-narrow');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByTestId('topbar-open-sidebar').click();
    await page.getByTestId('topbar-toggle-bottom-workbench').click();
    check(theme + ': bottom workbench fits', await inside(page, '.shell-workbench--bottom'));
    await shot(page, theme + '-bottom-panel');
    await page.getByTestId('topbar-toggle-bottom-workbench').click();
    await page.getByTestId('nav-settings').click();
    await page.locator('.settings-page').waitFor();
    check(theme + ': settings surface fits', await inside(page, '.settings-page'));
    await shot(page, theme + '-settings');
    check(theme + ': no runtime errors', errors.length === 0, errors.join('; '));
    await page.close();
  }
  for (const [name, query] of [['named-theme', '&palette=azure'], ['wallpaper', '&wallpaper=true']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(origin + '/?phase3-visual=workbench' + query);
    await page.waitForLoadState('networkidle');
    check(name + ': user palette preserved', await page.evaluate(() => !document.documentElement.style.getPropertyValue('--color-page').includes('--wb-default-')));
    check(name + ': composer fits', await inside(page, '[data-testid="empty-compose"]'));
    await shot(page, name); await page.close();
  }
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks: results.length, results }, null, 2));
  console.log(JSON.stringify({ checks: results.length, screenshots: output }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
