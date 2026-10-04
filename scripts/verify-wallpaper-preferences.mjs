/** Real-browser regression for mask strength, legacy migration and the image library. Build build:shell:qa first.
 * Optional SHELL_QA_DIR selects an isolated QA build; the fixture never uses user data. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = resolve(root, process.env.SHELL_QA_DIR || '.data/renderer-builds/qa');
const output = join(root, '.data/wallpaper-library-preview');
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


try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  const forest = await readFile(join(root, 'apps/desktop/src/renderer/shell/assets/preferences/misty-forest-DEyvF5So.jpg'));
  const terracotta = await readFile(join(root, 'apps/desktop/src/renderer/shell/assets/preferences/terracotta-study-XmUFPwkJ.jpg'));
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?phase3-visual=workbench&wallpaper=true&theme=' + theme);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('welcome-greeting').waitFor();
    // The QA fixture has isolated in-memory storage: seed the old single-image
    // record to prove migration without interacting with any real user data.
    await page.evaluate(dataUrl => {
      const record = JSON.parse(localStorage.getItem('sync-think.preferences.appearance.v1'));
      delete record.customImageThemes;
      Object.assign(record, { customImageDataUrl: dataUrl, customImageName: '原来的图片', customImageBackground: '#82b658', customImageAccent: '#368ccc' });
      localStorage.setItem('sync-think.preferences.appearance.v1', JSON.stringify(record));
    }, 'data:image/jpeg;base64,' + forest.toString('base64'));
    const openPreferences = async () => {
      await page.getByTestId('nav-settings').click();
      await page.getByRole('button', { name: '偏好', exact: true }).click();
      await page.getByRole('slider', { name: '遮罩强度' }).waitFor();
    };
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sync-think.preferences.appearance.v1')));
    await openPreferences();
    check(theme + ': legacy image retained', await page.getByRole('button', { name: '原来的图片图片主题', exact: true }).isVisible());
    await page.getByRole('radio', { name: '覆盖色', exact: true }).click();
    const slider = page.getByRole('slider', { name: '遮罩强度', exact: true });
    for (const value of [0, 25, 50, 100]) {
      await slider.fill(String(value));
      const record = await saved();
      check(theme + ': mask ' + value + ' persisted', record.imageOverlayOpacity === value);
      const presentation = await page.evaluate(() => {
        const style = document.documentElement.style;
        const content = document.querySelector('.shell-workspace-primary-content');
        return { overlay: style.getPropertyValue('--shell-wallpaper-overlay'), scrim: style.getPropertyValue('--shell-message-reading-scrim'), background: getComputedStyle(content).backgroundImage, emptyScrim: getComputedStyle(content, '::after').backgroundColor };
      });
      check(theme + ': mask ' + value + ' retains wallpaper', presentation.background.includes('url('));
      if (value === 0) {
        check(theme + ': zero removes global wash', presentation.overlay === 'linear-gradient(transparent, transparent)');
        check(theme + ': zero removes reading wash', presentation.scrim === 'transparent');
        check(theme + ': zero removes empty-page wash', presentation.emptyScrim === 'rgba(0, 0, 0, 0)' || /\/\s*0\)$/.test(presentation.emptyScrim));
      }
      if ([0, 50].includes(value)) {
        await page.getByRole('button', { name: '关闭设置', exact: true }).click();
        await page.screenshot({ path: join(output, theme + '-mask-' + value + '.png') });
        await openPreferences();
      }
    }
    await page.getByRole('button', { name: '恢复默认遮罩', exact: true }).click();
    await page.getByLabel('上传图片主题').setInputFiles([
      { name: '森林.jpg', mimeType: 'image/jpeg', buffer: forest },
      { name: '陶土.jpg', mimeType: 'image/jpeg', buffer: terracotta },
    ]);
    await page.getByRole('button', { name: '陶土图片主题', exact: true }).waitFor();
    let record = await saved();
    check(theme + ': uploading multiple images appends to legacy image', record.customImageThemes.length === 3);
    check(theme + ': image IDs are independent', new Set(record.customImageThemes.map(image => image.id)).size === 3);
    const selectedId = record.imageThemeId;
    const selectedUrl = record.customImageThemes.find(image => image.id === selectedId).dataUrl;
    check(theme + ': uploaded image applied', await page.evaluate(url => document.documentElement.style.getPropertyValue('--shell-wallpaper-image').includes(url), selectedUrl));
    const paletteBefore = await page.evaluate(() => document.documentElement.style.getPropertyValue('--color-page'));
    await page.getByRole('button', { name: '森林图片主题', exact: true }).click();
    check(theme + ': each image has its own palette', paletteBefore !== await page.evaluate(() => document.documentElement.style.getPropertyValue('--color-page')));
    await page.getByRole('button', { name: '陶土图片主题', exact: true }).click();
    const forestCard = page.locator('.settings-image-theme__card').filter({ has: page.getByRole('button', { name: '森林图片主题', exact: true }) });
    await forestCard.hover();
    await forestCard.getByRole('button', { name: '编辑图片主题', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑图片主题', exact: true });
    await editor.getByRole('textbox', { name: '名称', exact: true }).fill('山林');
    await editor.getByRole('button', { name: '图片焦点位置', exact: true }).click({ position: { x: 30, y: 40 } });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    record = await saved();
    check(theme + ': editing another image preserves selection', record.imageThemeId === selectedId);
    check(theme + ': focal point saved per image', record.customImageThemes.find(image => image.name === '山林').focalPoint.x !== 50);
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await openPreferences();
    check(theme + ': library survives settings reopening', await page.getByRole('button', { name: '山林图片主题', exact: true }).count() === 1);
    await page.getByRole('button', { name: '原来的图片图片主题', exact: true }).click();
    check(theme + ': original migrated image remains selectable', (await saved()).imageThemeId === 'custom-upload');
    await page.getByRole('button', { name: '陶土图片主题', exact: true }).click();
    await page.screenshot({ path: join(output, theme + '-settings-library.png') });
    const editedCard = page.locator('.settings-image-theme__card').filter({ has: page.getByRole('button', { name: '山林图片主题', exact: true }) });
    await editedCard.hover();
    await editedCard.getByRole('button', { name: '删除图片主题', exact: true }).click();
    await editedCard.getByRole('button', { name: '确认删除图片主题', exact: true }).click();
    check(theme + ': delete removes only one image', (await saved()).customImageThemes.length === 2);
    check(theme + ': deleting another image preserves active wallpaper', (await saved()).imageThemeId === selectedId);
    await slider.fill('0');
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.getByTestId('shell-sidebar').getByText('梳理组件与主题', { exact: true }).click();
    await page.getByText('清晰的界面，从一致性开始', { exact: true }).waitFor();
    const reading = await page.evaluate(() => ({
      scrim: getComputedStyle(document.querySelector('.shell-workspace-primary-content'), '::after').backgroundColor,
      blur: getComputedStyle(document.querySelector('[data-wallpaper-reading-blur-stack]')).display,
    }));
    check(theme + ': zero clears an existing conversation reading wash', reading.scrim === 'rgba(0, 0, 0, 0)' || /\/\s*0\)$/.test(reading.scrim));
    check(theme + ': overlay keeps the blur stack hidden', reading.blur === 'none');
    await page.screenshot({ path: join(output, theme + '-conversation-mask-0.png') });
    await openPreferences();
    await slider.fill('50');
    await page.setViewportSize({ width: 960, height: 760 });
    check(theme + ': slider fits compact settings', await slider.evaluate(element => { const r = element.getBoundingClientRect(); return r.x >= 0 && r.right <= window.innerWidth; }));
    check(theme + ': no horizontal settings overflow', await page.locator('.settings-preferences__scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await page.screenshot({ path: join(output, theme + '-compact-library.png') });
    check(theme + ': no runtime errors', errors.length === 0);
    await page.close();
  }
  await writeFile(join(output, 'verification.json'), JSON.stringify({ count: checks.length, checks }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, screenshots: output }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
