import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { wrapUninstallerExec } from './windows-builder-uninstaller.cjs';

const file = resolve('apps/desktop/release/fixture/SYNC-THINK-Setup-1.0.0-x64.exe');
const options = { env: { __COMPAT_LAYER: 'RunAsInvoker' } };

test('the exact Windows uninstaller-build invocation uses readonly extraction', async () => {
  let observed;
  const wrapped = wrapUninstallerExec(() => assert.fail('the build stub must not execute'), async (...args) => { observed = args; }, 'win32');
  await wrapped(file, [], options);
  assert.deepEqual(observed, [file, join(resolve('apps/desktop/release/fixture'), 'SYNC-THINK-Setup-1.0.0-x64.__uninstaller.exe')]);
});

test('ordinary executables, arguments and non-Windows hosts keep their original execution path', async () => {
  for (const [platform, args, opts, path] of [
    ['win32', ['/S'], options, file], ['win32', [], {}, file],
    ['linux', [], options, file], ['win32', [], options, 'relative.exe'],
    ['win32', [], options, file + '.txt'],
  ]) {
    const receiver = {};
    const wrapped = wrapUninstallerExec(function (...actual) { assert.equal(this, receiver); assert.deepEqual(actual, [path, args, opts, true]); return 'original'; }, () => assert.fail('unexpected extraction'), platform);
    assert.equal(await wrapped.call(receiver, path, args, opts, true), 'original');
  }
});

test('a malformed uninstaller remains a failed build, not a silent fallback', async () => {
  const wrapped = wrapUninstallerExec(() => assert.fail('unexpected execution'), async () => { throw new Error('invalid NSIS payload'); }, 'win32');
  await assert.rejects(wrapped(file, [], options), /invalid NSIS payload/);
});
