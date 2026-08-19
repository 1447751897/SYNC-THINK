import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const desktopRoot = join(__dirname, '..');

describe('desktop renderer build assets', () => {
  // Builds the shell (esbuild ×3 + Tailwind over ~475KB of CSS) on top of a full
  // tsc, so this one needs far more than the 15s suite default.
  it('emits loadable renderer HTML, JS, and CSS assets for Electron', () => {
    execFileSync(
      process.execPath,
      [join(desktopRoot, '../../node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
      {
        cwd: desktopRoot,
        stdio: 'pipe',
      },
    );
    execFileSync(process.execPath, ['scripts/build-preload.mjs'], {
      cwd: desktopRoot,
      stdio: 'pipe',
    });
    execFileSync(process.execPath, ['scripts/build-shell.mjs'], {
      cwd: desktopRoot,
      stdio: 'pipe',
    });

    const htmlPath = join(desktopRoot, 'dist/renderer-shell/index.html');
    const jsPath = join(desktopRoot, 'dist/renderer-shell/shell.js');
    const cssPath = join(desktopRoot, 'dist/renderer-shell/shell.css');
    const mainPath = join(desktopRoot, 'dist/main/index.js');
    const runtimeSessionPath = join(desktopRoot, 'dist/main/runtime-session.js');
    const bridgeContractPath = join(desktopRoot, 'dist/runtime-bridge-contract.d.ts');
    const preloadPath = join(desktopRoot, 'dist/preload/index.cjs');
    const preloadSourcePath = join(desktopRoot, 'src/preload/index.ts');
    const rendererGlobalPath = join(desktopRoot, 'src/renderer/global.d.ts');
    const rendererSourcePath = join(desktopRoot, 'src/renderer/shell/ShellApp.tsx');
    const runtimeConnectionSourcePath = join(desktopRoot, 'src/renderer/runtime-connection.ts');
    const runtimeViewStateSourcePath = join(desktopRoot, 'src/renderer/runtime-view-state.ts');

    expect(existsSync(htmlPath)).toBe(true);
    expect(existsSync(jsPath)).toBe(true);
    expect(existsSync(cssPath)).toBe(true);
    expect(existsSync(preloadPath)).toBe(true);
    expect(existsSync(runtimeSessionPath)).toBe(true);
    expect(existsSync(bridgeContractPath)).toBe(true);

    const html = readFileSync(htmlPath, 'utf8');
    expect(html).toContain('./shell.js');
    expect(html).toContain('./shell.css');
    expect(html).not.toContain('shell-entry.tsx');
    // TODO: the shell's CSP relies on `default-src 'self'` and does not spell out
    // `object-src 'none'` / `base-uri 'none'` the way the deleted legacy renderer
    // did. base-uri does NOT fall back to default-src, so that one is a real
    // (pre-existing) gap — hardening it is a security change, not a token change.
    expect(html).toContain("default-src 'self'");
    expect(html).not.toContain('unsafe-eval');

    const main = readFileSync(mainPath, 'utf8');
    const runtimeSession = readFileSync(runtimeSessionPath, 'utf8');
    const bridgeContract = readFileSync(bridgeContractPath, 'utf8');
    const preload = readFileSync(preloadPath, 'utf8');
    const preloadSource = readFileSync(preloadSourcePath, 'utf8');
    const rendererGlobal = readFileSync(rendererGlobalPath, 'utf8');
    const rendererSource = readFileSync(rendererSourcePath, 'utf8');
    const runtimeConnectionSource = readFileSync(runtimeConnectionSourcePath, 'utf8');
    const runtimeViewStateSource = readFileSync(runtimeViewStateSourcePath, 'utf8');
    expect(main).toContain("path.join(__dirname, '../preload/index.cjs')");
    expect(main).toContain("path.join(__dirname, '../renderer-shell/index.html')");
    expect(main).toContain('installNavigationGuards');
    expect(main).toContain('assertTrustedRendererIpcSource');
    expect(main).toContain('isTrustedRendererUrl');
    expect(main).toContain('sendRuntimeEventToRenderer');
    expect(main).not.toContain('for (const window of BrowserWindow.getAllWindows())');
    expect(main).toContain('!app.isPackaged && devServerUrl');
    expect(main).toContain('handleRendererLoadFailure');
    expect(main).toContain('.catch(handleDesktopStartupFailure)');
    expect(main).toContain('safeStorage.encryptString');
    expect(main).toContain('safeStorage.decryptString');
    expect(main).not.toContain('secure-store:');
    expect(preload).not.toContain('secureStore');
    expect(preload).not.toContain('secure-store:');
    expect(preload).toContain('runtime:connect');
    expect(preload).toContain('runtime:event');
    expect(runtimeSession).toContain('activityCursorStore.load()');
    expect(runtimeSession).toContain('ACTIVITY_EVENT_CATEGORIES');
    expect(runtimeSession).toContain('snapshot:');
    expect(bridgeContract).toContain('interface RuntimeConnectResult');
    expect(bridgeContract).toContain('type RuntimeConnectOutcome');
    expect(bridgeContract).toContain('retryable: boolean');
    expect(bridgeContract).toContain('snapshot: readonly Event[]');
    expect(preloadSource).toContain('Promise<RuntimeConnectOutcome>');
    expect(rendererGlobal).toContain('connect(): Promise<RuntimeConnectOutcome>');
    expect(rendererGlobal).not.toContain('Promise<unknown>');
    expect(rendererGlobal).not.toContain('NodeJS.');
    // The shell delegates retry/cancel bookkeeping to runtime-connection.ts, and
    // ShellApp.test.tsx covers the behaviour by actually mounting the component.
    // What still needs a source-level guard is the ordering: the event
    // subscription must be installed BEFORE connect() so the snapshot/live-event
    // handover has no gap.
    expect(rendererSource).toContain('startRuntimeConnection');
    expect(rendererSource.indexOf('api.onEvent?.(')).toBeGreaterThan(-1);
    expect(rendererSource.indexOf('api.onEvent?.(')).toBeLessThan(
      rendererSource.indexOf('startRuntimeConnection({'),
    );
    expect(runtimeViewStateSource).toContain('mergeEventHistory');
    expect(runtimeViewStateSource).toContain('projectM0EventHistory');
    expect(runtimeViewStateSource).toContain('result.snapshot');
    expect(runtimeConnectionSource).toContain('if (!active) return');
    expect(runtimeConnectionSource).toContain('active = false');
    expect(runtimeConnectionSource).toContain('error.retryable');
  }, 120_000);
});
