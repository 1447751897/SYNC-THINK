'use strict';

const { app, BrowserWindow, nativeImage, webContents } = require('electron');
const { writeFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const output = process.argv[process.argv.indexOf('--output') + 1];
const baseline = process.argv.includes('--baseline');
const observations = [];
const errors = [];
const assertions = [];
let window;

app.setPath('userData', join(output, 'user-data'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const evaluate = (code) => window.webContents.executeJavaScript(code, true);
function check(name, passed, detail) {
  assertions.push({ name, passed: Boolean(passed), detail });
  console.log((passed ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
}
async function waitFor(code, milliseconds = 8000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    if (await evaluate(code)) return true;
    await delay(50);
  }
  return false;
}
async function snapshot(id) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = await window.webContents.capturePage();
  await writeFile(join(output, id + '.png'), image.toPNG());
}
async function set(sample, theme = 'light', width = 1120, height = 850) {
  window.setContentSize(width, height);
  await evaluate('window.chatEmbedQA.set(' + JSON.stringify(sample) + ',' + JSON.stringify(theme) + ')');
  await delay(600);
  await waitFor('!document.querySelector(".shell-mermaid__loader")', 5000);
  await waitFor('[...document.querySelectorAll("webview")].every(node => getComputedStyle(node).opacity === "1")', 5000);
}
async function measure() {
  return evaluate(`(() => {
    const bounds = (node) => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
    return {
      html: [...document.querySelectorAll('iframe, webview')].map(node => ({ ...bounds(node), tag: node.tagName, opacity: getComputedStyle(node).opacity, id: node.getWebContentsId?.(), sourceHasHandlers: /onclick=|<script[ >]/i.test(node.getAttribute('srcdoc') ?? '') })),
      mermaid: [...document.querySelectorAll('.shell-mermaid__canvas')].map(node => ({ ...bounds(node), svg: Boolean(node.shadowRoot?.querySelector('svg')), text: node.shadowRoot?.textContent?.slice(-300) ?? '' })),
      alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
      horizontalOverflow: document.querySelector('.shell-chat-message-scroller').scrollWidth > innerWidth,
      sourceCount: document.querySelectorAll('.shell-md-code').length,
    };
  })()`);
}
async function guest(index = 0) {
  const id = await evaluate('[...document.querySelectorAll("webview")][' + index + ']?.getWebContentsId()');
  return id ? webContents.fromId(id) : null;
}
async function run() {
  await mkdir(output, { recursive: true });
  window = new BrowserWindow({ show: false, width: 1120, height: 850, useContentSize: true, frame: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true, backgroundThrottling: false } });
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    delete preferences.preload;
    Object.assign(preferences, { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true });
    if (/^sync-think-visualization-[a-z0-9-]{1,96}$/i.test(params.partition) && /^data:text\/html(;|,)/i.test(params.src)) preferences.preload = join(output, 'visualization.cjs');
    else event.preventDefault();
  });
  await window.loadFile(join(output, 'index.html'));
  if (!await waitFor('Boolean(window.chatEmbedQA)')) throw new Error('fixture did not mount');

  for (const sample of ['unfinishedHtml', 'unfinishedMermaid', 'streaming', 'mixed', 'multiple']) {
    await set(sample);
    const result = await measure();
    observations.push({ sample, result });
    const correctCounts = sample === 'unfinishedHtml' ? result.html.length === 1 : sample === 'unfinishedMermaid' ? result.mermaid.filter(item => item.svg).length === 1 : result.html.length >= 1 && result.mermaid.filter(item => item.svg).length >= 1;
    check(sample + ': embed counts', correctCounts, result);
    await snapshot(sample + '-light-wide');
  }
  for (const [sample, theme, width] of [['mixed', 'dark', 560], ['multiple', 'light', 560], ['mermaid', 'dark', 1120], ['sequence', 'light', 560], ['wideDiagram', 'dark', 560], ['short', 'light', 560], ['long', 'dark', 1120]]) {
    await set(sample, theme, width);
    const result = await measure();
    observations.push({ sample, theme, width, result });
    check(sample + ':' + theme + ':' + width + ': visible', result.alerts.length === 0 && !result.horizontalOverflow && result.html.every(item => item.opacity === '1' && item.height > 0) && result.mermaid.every(item => item.svg), result);
    await snapshot(sample + '-' + theme + '-' + width);
  }

  await set('streaming');
  await evaluate('window.__qaOriginalHtml = document.querySelector("iframe, webview"); window.__qaOriginalMermaid = document.querySelector(".shell-mermaid__canvas"); window.chatEmbedQA.append(" More prose arrives.")');
  await delay(350);
  const appendStable = await evaluate('Boolean(window.__qaOriginalHtml && window.__qaOriginalHtml === document.querySelector("iframe, webview") && window.__qaOriginalMermaid === document.querySelector(".shell-mermaid__canvas"))');
  check('Appending prose preserves existing rich blocks', appendStable);
  await evaluate('window.chatEmbedQA.finish()');
  await delay(350);
  const finalStable = await evaluate('Boolean(window.__qaOriginalHtml && window.__qaOriginalHtml === document.querySelector("iframe, webview") && window.__qaOriginalMermaid === document.querySelector(".shell-mermaid__canvas"))');
  check('Completing stream preserves existing rich blocks', finalStable);

  await set('inlineStreaming');
  const streamingGuest = await guest();
  if (streamingGuest) {
    await streamingGuest.executeJavaScript('document.getElementById("counter").click()');
    await evaluate('window.chatEmbedQA.append(" More prose arrives."); window.chatEmbedQA.finish()');
    await delay(600);
    const finalizedGuest = await guest();
    const result = finalizedGuest && { sameGuest: streamingGuest.id === finalizedGuest.id, counter: await finalizedGuest.executeJavaScript('document.getElementById("counter").textContent') };
    check('Inline visualization keeps state through stream completion', result?.sameGuest && result.counter === '1', result);
  } else check('Inline visualization keeps state through stream completion', false, { guestMissing: true });

  await set('html');
  const fencedHtml = (await measure()).html[0];
  check('Fenced HTML uses sanitized fixed-height iframe', fencedHtml?.tag === 'IFRAME' && fencedHtml.height === 420 && !fencedHtml.sourceHasHandlers, fencedHtml);
  await set('inline');
  let htmlGuest = await guest();
  check('Inline visualization preload isolation', await htmlGuest.executeJavaScript('typeof require === "undefined" && typeof process === "undefined"'));
  const initialHeight = (await measure()).html[0]?.height;
  await snapshot('inline-interactive-preview');
  await htmlGuest.executeJavaScript('document.getElementById("counter").click(); document.getElementById("grow").click()');
  await delay(300);
  const grownHeight = (await measure()).html[0]?.height;
  check('Inline visualization grows after interaction', grownHeight > initialHeight + 350, { initialHeight, grownHeight });
  await snapshot('inline-interactive-expanded');
  await htmlGuest.executeJavaScript('document.getElementById("shrink").click()');
  await delay(300);
  const shrunkHeight = (await measure()).html[0]?.height;
  check('Inline visualization shrinks after interaction', shrunkHeight < grownHeight - 350, { shrunkHeight, grownHeight });

  await set('wideDiagram', 'dark', 560);
  const exported = await evaluate('window.chatEmbedQA.exportPng()');
  if (exported?.png) {
    const buffer = Buffer.from(exported.png);
    await writeFile(join(output, 'mermaid-export.png'), buffer);
    await writeFile(join(output, 'mermaid-export.svg'), exported.svg.svg);
    const image = nativeImage.createFromBuffer(buffer);
    const pixels = image.toBitmap();
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 16) colors.add(pixels.subarray(index, index + 4).toString('hex'));
    check('Mermaid PNG export is nonblank', !image.isEmpty() && buffer.length > 1000 && colors.size > 20, { bytes: buffer.length, size: image.getSize(), sampledColors: colors.size });
  } else check('Mermaid PNG export is nonblank', false, { exported: Boolean(exported) });
  await evaluate('document.querySelector(".shell-mermaid__canvas").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }))');
  await delay(200);
  const inlineMenu = await evaluate('[...document.querySelectorAll("[role=menuitem]")].map(node => node.textContent)');
  check('Mermaid inline context menu has image actions', inlineMenu.some(text => text.includes('复制图片')) && inlineMenu.some(text => text.includes('下载 PNG')) && inlineMenu.some(text => text.includes('放大查看')), inlineMenu);
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await delay(100);
  await evaluate('document.querySelector(".shell-mermaid__canvas").click()');
  await delay(300);
  const zoom = await evaluate(`(() => {
    const image = document.querySelector('.shell-mermaid-lightbox__canvas img');
    const canvas = document.querySelector('.shell-mermaid-lightbox__canvas');
    const imageRect = image?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    return { imageWidth: imageRect?.width, imageHeight: imageRect?.height, canvasWidth: canvasRect?.width, canvasHeight: canvasRect?.height, complete: image?.complete, naturalWidth: image?.naturalWidth };
  })()`);
  check('Mermaid zoom initially fits available canvas', zoom.complete && zoom.naturalWidth > 0 && zoom.imageWidth <= zoom.canvasWidth + 1 && zoom.imageHeight <= zoom.canvasHeight + 1, zoom);
  await snapshot('mermaid-zoom-dark-narrow');
  const readPercent = () => evaluate('Number(document.querySelector(".shell-mermaid-lightbox__percent")?.textContent.replace("%", ""))');
  const initialPercent = await readPercent();
  await evaluate('document.querySelector("button[aria-label=放大]")?.click()');
  await delay(100);
  const enlargedPercent = await readPercent();
  check('Mermaid plus enlarges diagram', enlargedPercent > initialPercent, { initialPercent, enlargedPercent });
  await evaluate('document.querySelector("button[aria-label=缩小]")?.click()');
  await delay(100);
  const decreasedPercent = await readPercent();
  check('Mermaid minus reduces diagram', decreasedPercent < enlargedPercent, { enlargedPercent, decreasedPercent });
  await evaluate('document.querySelector(".shell-mermaid-lightbox__canvas").dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100, clientX: 200, clientY: 200 }))');
  await delay(100);
  const wheelPercent = await readPercent();
  check('Mermaid Ctrl-wheel enlarges diagram', wheelPercent > decreasedPercent, { decreasedPercent, wheelPercent });
  await evaluate('document.querySelector("button[aria-label=适应宽度]")?.click()');
  await delay(100);
  const fitWidth = await evaluate('(() => { const image = document.querySelector(".shell-mermaid-lightbox__canvas img"); const canvas = document.querySelector(".shell-mermaid-lightbox__canvas"); return { image: image.getBoundingClientRect().width, canvas: canvas.getBoundingClientRect().width }; })()');
  check('Mermaid fit width is bounded by canvas', fitWidth.image <= fitWidth.canvas && fitWidth.image >= fitWidth.canvas - 120, fitWidth);
  await evaluate('document.querySelector(".shell-mermaid-lightbox__canvas").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 150, clientY: 150 }))');
  await delay(200);
  const zoomMenu = await evaluate('[...document.querySelectorAll("[role=menuitem]")].map(node => node.textContent)');
  check('Mermaid zoom context menu has image actions', zoomMenu.some(text => text.includes('复制图片')) && zoomMenu.some(text => text.includes('下载 PNG')) && !zoomMenu.some(text => text.includes('放大查看')), zoomMenu);
  await snapshot('mermaid-zoom-context-menu');
  check('No renderer console errors', errors.length === 0, errors);
  await writeFile(join(output, 'report.json'), JSON.stringify({ baseline, assertions, observations, errors }, null, 2));
  console.log('CHAT_EMBEDS_REPORT=' + join(output, 'report.json'));
  window.destroy();
  app.exit(baseline || assertions.every(item => item.passed) ? 0 : 1);
}

app.whenReady().then(run).catch(async (error) => {
  console.error(error.stack || error);
  await writeFile(join(output, 'failure.txt'), String(error.stack || error));
  app.exit(1);
});
