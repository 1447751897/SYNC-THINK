import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Pi kernel install wiring', () => {
  it('keeps the fixed install command behind trusted Main IPC', () => {
    const handlerStart = mainSource.indexOf("ipcMain.handle('desktop:kernel-install'");
    expect(handlerStart).toBeGreaterThan(-1);
    const nextHandler = mainSource.indexOf('ipcMain.handle(', handlerStart + 1);
    const handlerSource = mainSource.slice(
      handlerStart,
      nextHandler === -1 ? mainSource.length : nextHandler,
    );

    expect(handlerSource).toContain('assertRuntimeIpcSource(event)');
    expect(handlerSource).toContain("value !== 'pi'");
    expect(mainSource).toContain("['i', '-g', 'pi']");
    expect(mainSource).toContain('shell: false');
    expect(mainSource).not.toContain('spawn(executable, value');
  });

  it('exposes only a typed kernel id, not a command line', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('desktop:kernel-install', kernelId)");
    expect(globalSource).toMatch(/installKernel\(\s*kernelId: string/);
    expect(preloadSource).not.toContain('installKernel: (command');
    expect(globalSource).not.toMatch(/installKernel\(\s*command/);
  });
});
