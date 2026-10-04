import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rendererBuildIsCurrent, rendererSourceFingerprint, stampRendererAssetUrls } from './renderer-build-freshness.mjs';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'renderer-freshness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'out'));
  writeFileSync(join(root, 'src/entry.tsx'), 'before');
  for (const file of ['index.html', 'shell.js', 'shell.css']) writeFileSync(join(root, 'out', file), 'fixture');
  const inputs = ['src']; const out = join(root, 'out');
  const writeManifest = (patch = {}) => writeFileSync(join(out, 'build-manifest.json'), JSON.stringify({schemaVersion:1,mode:'production',devSourceFingerprint:rendererSourceFingerprint(root,inputs),shell:{files:[]},...patch}));
  writeManifest(); return { root, inputs, out, writeManifest, current: () => rendererBuildIsCurrent(root,out,'production',inputs) };
}
test('unchanged production renderer is current', t => { assert.equal(fixture(t).current(),true); });
test('changed contents with unchanged mtime trigger a rebuild', t => {
  const f=fixture(t),path=join(f.root,'src/entry.tsx'),date=new Date('2020-01-01');
  utimesSync(path,date,date);assert.equal(f.current(),true);writeFileSync(path,'after');utimesSync(path,date,date);assert.equal(f.current(),false);
});
test('new and deleted source inputs trigger a rebuild', t => {
  const f=fixture(t);writeFileSync(join(f.root,'src/search.tsx'),'new');assert.equal(f.current(),false);f.writeManifest();assert.equal(f.current(),true);rmSync(join(f.root,'src/search.tsx'));assert.equal(f.current(),false);
});
test('test-only edits do not rebuild the renderer', t => { const f=fixture(t);writeFileSync(join(f.root,'src/search.test.tsx'),'test');assert.equal(f.current(),true); });
test('legacy or wrong-mode manifest rebuilds', t => { const f=fixture(t);f.writeManifest({devSourceFingerprint:undefined});assert.equal(f.current(),false);f.writeManifest({mode:'qa'});assert.equal(f.current(),false); });
test('missing main or lazy output rebuilds', t => { const f=fixture(t);f.writeManifest({shell:{files:[{path:'chunks/search.js'}]}});assert.equal(f.current(),false);f.writeManifest();rmSync(join(f.out,'shell.js'));assert.equal(f.current(),false); });
test('corrupt manifest rebuilds instead of preventing startup', t => { const f=fixture(t);writeFileSync(join(f.out,'build-manifest.json'),'{');assert.equal(f.current(),false); });
test('manifest output paths must remain in the renderer directory', t => { const f=fixture(t);f.writeManifest({shell:{files:[{path:'../src/entry.tsx'}]}});assert.equal(f.current(),false); });

test('fixed renderer assets share a content-based cache revision', () => {
  const html = '<link href="./shell.css"><script src="./shell-chunks.js"></script><script type="module" src="./shell.js"></script>';
  const stamped = stampRendererAssetUrls(html, 'a'.repeat(64));
  for (const asset of ['shell.css', 'shell-chunks.js', 'shell.js'])
    assert.ok(stamped.includes(asset + '?build=' + 'a'.repeat(20)));
  assert.equal(stampRendererAssetUrls(html, 'a'.repeat(64)), stamped);
  assert.notEqual(stampRendererAssetUrls(html, 'b'.repeat(64)), stamped);
});
test('renderer asset stamping leaves hashed chunks and external resources intact', () => {
  const html = "<script src=\"https://example.com/shell.js\"></script><script src=\"./chunks/SettingsPage-HASH.js\"></script><script src='./shell.js'></script>";
  const stamped = stampRendererAssetUrls(html, 'c'.repeat(64));
  assert.ok(stamped.includes('https://example.com/shell.js'));
  assert.ok(stamped.includes('./chunks/SettingsPage-HASH.js'));
  assert.ok(stamped.includes('./shell.js?build=' + 'c'.repeat(20)));
});
test('renderer build revisions reject arbitrary query or path input', () => {
  assert.throws(() => stampRendererAssetUrls('<script src="./shell.js"></script>', '../other?x=1'), /invalid_build_revision/);
});

test('the shared local-page protocol contract invalidates the production renderer', t => {
  const { root } = fixture(t);
  const contract = join(root, 'apps/desktop/src/local-web-page-contract.ts');
  mkdirSync(join(root, 'apps/desktop/src'), { recursive: true });
  writeFileSync(contract, "export const LOCAL_WEB_PAGE_SCHEME = 'before';");
  const before = rendererSourceFingerprint(root);
  writeFileSync(contract, "export const LOCAL_WEB_PAGE_SCHEME = 'after';");
  assert.notEqual(rendererSourceFingerprint(root), before);
});
