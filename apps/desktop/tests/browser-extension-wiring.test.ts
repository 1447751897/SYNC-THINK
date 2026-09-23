import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/browser-extension-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

const extensionCommands = [
  ['status', 'runtime:browser-extension-status', 'browser.extension.status'],
  ['restart', 'runtime:browser-extension-restart', 'browser.extension.restart'],
  ['resetPairing', 'runtime:browser-extension-reset-pairing', 'browser.extension.resetPairing'],
  ['openFolder', 'runtime:browser-extension-open-folder', 'browser.extension.openFolder'],
] as const;

describe('browser extension desktop wiring', () => {
  it.each(extensionCommands)(
    'routes browserExtension.%s through %s to %s',
    (method, channel, command) => {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`host.requestBrowserExtension('${command}', {})`);
      expect(preloadSource).toMatch(
        new RegExp(
          `browserExtension:\\s*\\{[\\s\\S]+?${method}:\\s*\\(\\)\\s*=>[\\s\\S]+?'${channel}'`,
        ),
      );
      expect(globalSource).toContain(`${method}():`);
    },
  );

  it('registers the Browser Extension boundary from the Main composition root', () => {
    expect(mainSource).toContain('registerBrowserExtensionHandlers({');
    expect(mainSource).toContain('requestBrowserExtension:');
    expect(mainSource).not.toContain("request<BrowserExtensionStatus>('browser.extension");
  });
});
