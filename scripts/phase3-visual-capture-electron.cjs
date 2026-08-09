'use strict';

const { createHash } = require('node:crypto');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { app, BrowserWindow } = require('electron');

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1])
    throw new Error('phase3.visual.argument_missing:' + name);
  return process.argv[index + 1];
}

async function waitForFixture(window, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await window.webContents.executeJavaScript(
      'Boolean(document.querySelector(\'[data-phase3-ready="true"]\'))',
      true,
    );
    if (ready) {
      await window.webContents.executeJavaScript(
        'document.fonts ? document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))) : Promise.resolve()',
        true,
      );
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error('phase3.visual.fixture_timeout');
}

async function verifyTargetedFixture(window, visualCase) {
  if (visualCase.fixture === 'long-trace-open') {
    const result = await window.webContents.executeJavaScript(
      `(() => {
        const timeline = document.querySelector('[data-testid="execution-timeline"]');
        const items = timeline
          ? [...timeline.querySelectorAll(
              '[data-testid="execution-commentary-item"], [data-testid="execution-tools-item"]',
            )]
          : [];
        return {
          itemTypes: items.map((node) => node.getAttribute('data-testid')),
          visible: items.every((node) => node.getBoundingClientRect().height > 0),
          commentaryTexts: items
            .filter((node) => node.getAttribute('data-testid') === 'execution-commentary-item')
            .map((node) => node.textContent?.trim() ?? ''),
          hasStepTimes: items.some((node) => node.querySelector('time')),
          toolDisclosureStates: items
            .filter((node) => node.getAttribute('data-testid') === 'execution-tools-item')
            .map((node) => node.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')),
        };
      })()`,
      true,
    );
    const expectedTypes = [
      'execution-commentary-item',
      'execution-tools-item',
      'execution-commentary-item',
      'execution-tools-item',
    ];
    if (
      JSON.stringify(result.itemTypes) !== JSON.stringify(expectedTypes) ||
      !result.visible ||
      result.commentaryTexts.length !== 2 ||
      !result.commentaryTexts.every((text) => text.length > 0) ||
      result.hasStepTimes ||
      result.toolDisclosureStates.length !== 2 ||
      !result.toolDisclosureStates.every((state) => state === 'false')
    ) {
      throw new Error(
        'phase3.visual.execution_timeline_invalid:' + visualCase.id + ':' + JSON.stringify(result),
      );
    }
  }

  if (visualCase.fixture === 'long-trace-closed') {
    const result = await window.webContents.executeJavaScript(
      `(() => ({
        toggleExpanded: document
          .querySelector('.shell-process-group__toggle')
          ?.getAttribute('aria-expanded'),
        hasTimeline: Boolean(document.querySelector('[data-testid="execution-timeline"]')),
      }))()`,
      true,
    );
    if (result.toggleExpanded !== 'false' || result.hasTimeline) {
      throw new Error(
        'phase3.visual.execution_timeline_closed_invalid:' +
          visualCase.id +
          ':' +
          JSON.stringify(result),
      );
    }
  }

  if (visualCase.fixture === 'connection-and-code') {
    const result = await window.webContents.executeJavaScript(
      `(() => {
        const statuses = [...document.querySelectorAll('.shell-run-connection-status')];
        const code = document.querySelector('.shell-md-code');
        const viewport = document.querySelector('.shell-md-code__viewport');
        const content = document.querySelector('.shell-md-code__pre');
        return {
          statusTexts: statuses.map((node) => node.textContent?.trim()),
          statusVisible: statuses.every((node) => node.getBoundingClientRect().height > 0),
          codeClass: code?.className ?? '',
          codeVisibleHeight: viewport?.getBoundingClientRect().height ?? 0,
          codeContentHeight: content?.getBoundingClientRect().height ?? 0,
          hasEndMarker: Boolean(content?.textContent?.includes('SHORT_TEXT_BLOCK_END')),
        };
      })()`,
      true,
    );
    if (
      result.statusTexts.length !== 2 ||
      !result.statusVisible ||
      !result.statusTexts.includes('正在重新连接 4/5') ||
      !result.statusTexts.includes('正在切换备用模型：luna → gpt-5.6-sol') ||
      result.codeClass.includes('is-expandable') ||
      !result.hasEndMarker ||
      result.codeVisibleHeight + 1 < result.codeContentHeight
    ) {
      throw new Error(
        'phase3.visual.connection_code_invalid:' + visualCase.id + ':' + JSON.stringify(result),
      );
    }
  }

  if (visualCase.fixture === 'streaming-follow') {
    const startedAt = Date.now();
    let result;
    while (Date.now() - startedAt < 5000) {
      result = await window.webContents.executeJavaScript(
        `(() => {
          const fixture = document.querySelector('[data-phase3-streaming-follow]');
          const body = document.querySelector('.shell-process-group__body');
          return {
            ready: fixture?.getAttribute('data-phase3-streaming-follow') === 'ready',
            hasLatest: Boolean(body?.textContent?.includes('STREAMING_FOLLOW_LATEST')),
            distanceFromBottom: body
              ? Math.max(0, body.scrollHeight - body.scrollTop - body.clientHeight)
              : null,
          };
        })()`,
        true,
      );
      if (result.ready && result.hasLatest && result.distanceFromBottom <= 2) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    if (!result?.ready || !result.hasLatest || result.distanceFromBottom > 2) {
      throw new Error(
        'phase3.visual.streaming_follow_invalid:' + visualCase.id + ':' + JSON.stringify(result),
      );
    }
  }
}

async function captureCase(request, visualCase) {
  const consoleErrors = [];
  const window = new BrowserWindow({
    show: false,
    width: visualCase.width,
    height: visualCase.height,
    useContentSize: true,
    frame: false,
    backgroundColor: visualCase.theme === 'dark' ? '#0d0d0c' : '#f2eee6',
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) consoleErrors.push(message);
  });

  try {
    await window.loadFile(request.htmlPath, {
      query: {
        'phase3-visual': visualCase.fixture,
        theme: visualCase.theme,
      },
    });
    window.webContents.setZoomFactor(visualCase.scale);
    await waitForFixture(window);
    await verifyTargetedFixture(window, visualCase);
    const image = await window.webContents.capturePage();
    const png = image.toPNG();
    if (png.length < 10000) throw new Error('phase3.visual.capture_too_small:' + visualCase.id);
    if (consoleErrors.length > 0) {
      throw new Error(
        'phase3.visual.console_error:' + visualCase.id + ':' + consoleErrors.join(' | '),
      );
    }
    const file = visualCase.id + '.png';
    await writeFile(join(request.outputDir, file), png);
    const size = image.getSize();
    return {
      ...visualCase,
      file,
      width: size.width,
      height: size.height,
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function main() {
  const requestPath = readArgument('--request');
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  if (request.schemaVersion !== 1 || !Array.isArray(request.cases)) {
    throw new Error('phase3.visual.request_invalid');
  }
  // Keep one BrowserWindow alive while individual capture windows are destroyed.
  // On Windows an all-hidden-window gap can end the Electron process before the
  // async loop writes its manifest.
  const keeper = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: { backgroundThrottling: false },
  });
  const captures = [];
  try {
    for (const visualCase of request.cases) {
      captures.push(await captureCase(request, visualCase));
    }
  } finally {
    if (!keeper.isDestroyed()) keeper.destroy();
  }
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    captureEngine: 'electron.capturePage',
    captures,
  };
  await writeFile(request.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
    app.exit(1);
  }
});
