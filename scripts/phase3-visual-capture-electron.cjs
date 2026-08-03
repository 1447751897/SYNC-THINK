'use strict';

const { createHash } = require('node:crypto');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { app, BrowserWindow } = require('electron');

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error('phase3.visual.argument_missing:' + name);
  return process.argv[index + 1];
}

async function waitForFixture(window, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await window.webContents.executeJavaScript(
      "Boolean(document.querySelector('[data-phase3-ready=\"true\"]'))",
      true,
    );
    if (ready) {
      await window.webContents.executeJavaScript(
        "document.fonts ? document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))) : Promise.resolve()",
        true,
      );
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error('phase3.visual.fixture_timeout');
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
    const image = await window.webContents.capturePage();
    const png = image.toPNG();
    if (png.length < 10000) throw new Error('phase3.visual.capture_too_small:' + visualCase.id);
    if (consoleErrors.length > 0) {
      throw new Error('phase3.visual.console_error:' + visualCase.id + ':' + consoleErrors.join(' | '));
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
