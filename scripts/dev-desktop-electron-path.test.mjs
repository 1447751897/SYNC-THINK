import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDevDesktopElectron } from './dev-desktop-electron-path.mjs';

const scratch = resolve(dirname(fileURLToPath(import.meta.url)), '../.data/dev-electron-tests');
const roots = [];
function fixture() {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'runtime-'));
  roots.push(root);
  const packagePath = join(root, 'package', 'electron.exe');
  mkdirSync(dirname(packagePath), { recursive: true });
  writeFileSync(packagePath, 'fixture');
  return { root, packagePath, env: { LOCALAPPDATA: root }, platform: 'win32', electronVersion: '33.4.11' };
}
function cached(root, name, complete = true) {
  const directory = join(root, 'SYNC-THINK', 'dev-runtime', name);
  for (const file of complete
    ? ['electron.exe', 'icudtl.dat', 'v8_context_snapshot.bin', 'resources/default_app.asar']
    : ['electron.exe']) {
    const path = join(directory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'fixture');
  }
  return join(directory, 'electron.exe');
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = resolve(root);
    const child = relative(scratch, target);
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Cleanup target outside fixture root');
    rmSync(target, { recursive: true, force: true });
  }
});

test('Windows prefers an existing complete same-version development runtime', () => {
  const f = fixture();
  const path = cached(f.root, 'electron-33.4.11-20261004');
  assert.deepEqual(resolveDevDesktopElectron(f), { path, source: 'local-cache' });
});
test('chooses the newest complete copy and skips incomplete copies', () => {
  const f = fixture();
  cached(f.root, 'electron-33.4.11-20261001');
  const path = cached(f.root, 'electron-33.4.11-20261004');
  cached(f.root, 'electron-33.4.11-20261005', false);
  assert.deepEqual(resolveDevDesktopElectron(f), { path, source: 'local-cache' });
});
test('never chooses a different version or prerelease', () => {
  const f = fixture();
  cached(f.root, 'electron-34.0.0-20261004');
  cached(f.root, 'electron-33.4.11-beta-20261004');
  assert.deepEqual(resolveDevDesktopElectron(f), { path: f.packagePath, source: 'package' });
});
test('does not choose the Windows cache on another platform', () => {
  const f = fixture();
  cached(f.root, 'electron-33.4.11-20261004');
  assert.deepEqual(resolveDevDesktopElectron({ ...f, platform: 'linux' }), { path: f.packagePath, source: 'package' });
});
test('an explicit executable override wins', () => {
  const f = fixture();
  const path = cached(f.root, 'electron-33.4.11-20261004');
  assert.deepEqual(resolveDevDesktopElectron({ ...f, env: { ...f.env, SYNC_THINK_DEV_ELECTRON_PATH: ' ' + path + ' ' } }), { path, source: 'override' });
});
test('rejects nonexistent or relative explicit overrides rather than silently ignoring them', () => {
  const f = fixture();
  for (const path of [join(f.root, 'missing.exe'), './electron.exe']) {
    assert.throws(() => resolveDevDesktopElectron({ ...f, env: { SYNC_THINK_DEV_ELECTRON_PATH: path } }), /existing absolute executable/);
  }
});
test('uses the package binary when there is no cached runtime', () => {
  const f = fixture();
  assert.deepEqual(resolveDevDesktopElectron(f), { path: f.packagePath, source: 'package' });
});
test('reports no runtime when both the cache and package executable are missing', () => {
  const f = fixture();
  assert.equal(resolveDevDesktopElectron({ ...f, packagePath: undefined }), undefined);
});
