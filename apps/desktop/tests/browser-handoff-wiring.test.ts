import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('browser handoff desktop wiring', () => {
  it('bridges list, continue, and cancel through strict main-process handlers', () => {
    expect(mainSource).toContain("ipcMain.handle('runtime:browser-handoff-list-waiting'");
    expect(mainSource).toContain("'browser.handoff.listWaiting'");
    expect(mainSource).toContain("ipcMain.handle('runtime:browser-handoff-continue'");
    expect(mainSource).toContain("'browser.handoff.continue'");
    expect(mainSource).toContain("ipcMain.handle('runtime:browser-handoff-cancel'");
    expect(mainSource).toContain("'browser.handoff.cancel'");
    expect(mainSource).toContain('parseListWaitingBrowserHandoffsPayload(value)');
    expect(mainSource).toContain('parseContinueBrowserHandoffPayload(value)');
    expect(mainSource).toContain('parseCancelBrowserHandoffPayload(value)');
  });

  it('exposes typed handoff methods without renderer access to internal browser ownership data', () => {
    expect(preloadSource).toContain('listWaitingBrowserHandoffs:');
    expect(preloadSource).toContain('continueBrowserHandoff:');
    expect(preloadSource).toContain('cancelBrowserHandoff:');
    expect(globalSource).toContain('listWaitingBrowserHandoffs(');
    expect(globalSource).toContain('continueBrowserHandoff(');
    expect(globalSource).toContain('cancelBrowserHandoff(');
    expect(globalSource).not.toContain('inspectBrowserHandoff');
  });
});
