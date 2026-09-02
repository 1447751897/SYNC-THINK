/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { loadExcalidrawVendor } from './excalidraw-vendor-loader.js';

afterEach(() => {
  document.querySelectorAll('[data-sync-think-excalidraw], [data-sync-think-excalidraw-style]').forEach(
    (element) => element.remove(),
  );
  Reflect.deleteProperty(window, 'SyncThinkExcalidraw');
});

describe('Excalidraw vendor loader', () => {
  it('loads the copied vendor stylesheet before resolving the lazy editor bundle', async () => {
    const loading = loadExcalidrawVendor();
    const script = document.querySelector<HTMLScriptElement>('script[data-sync-think-excalidraw]');
    const stylesheet = document.querySelector<HTMLLinkElement>(
      'link[data-sync-think-excalidraw-style]',
    );
    expect(script).toBeTruthy();
    expect(stylesheet?.rel).toBe('stylesheet');
    expect(stylesheet?.href).toContain('/excalidraw-vendor.css');

    window.SyncThinkExcalidraw = {
      mountExcalidraw: () => ({
        update: () => undefined,
        getCurrentDocument: () => ({ elements: [], appState: {}, files: {} }),
        exportPng: async () => new Blob(),
        exportSvg: async () => new Blob(),
        focus: () => undefined,
        getRoot: () => document.createElement('div'),
        getApi: () => null,
        onReady: () => () => undefined,
        dispose: () => undefined,
      }),
    };
    script?.dispatchEvent(new Event('load'));
    await expect(loading).resolves.toBe(window.SyncThinkExcalidraw);
  });
});
