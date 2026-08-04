import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  UPDATE_FEED_INSTALLER_FIXTURE_PREPARE_COMMAND,
  verifyUpdateFeedInstallerFixture,
} from './selftest-windows-update-feed-e2e.mjs';

const installerDir = resolve('D:/fixtures/sync-think/installer');
const installerPath = resolve(installerDir, 'SYNC-THINK-Setup-0.0.1-x64.exe');

function options(overrides = {}) {
  return {
    installerDir,
    installerPath,
    accessFile: async () => undefined,
    ...overrides,
  };
}

test('update feed preflight reports a stable preparation command for a missing installer', async () => {
  await assert.rejects(
    verifyUpdateFeedInstallerFixture(
      options({
        accessFile: async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        },
        verifyInstallerLayout: async () => {
          throw new Error('verifier must not run');
        },
      }),
    ),
    (error) => {
      assert.match(error.message, /^update-feed\.installer_fixture_missing:/);
      assert.match(error.message, new RegExp(UPDATE_FEED_INSTALLER_FIXTURE_PREPARE_COMMAND));
      assert.match(error.message, /SYNC-THINK-Setup-0\.0\.1-x64\.exe/);
      return true;
    },
  );
});

test('update feed preflight rejects a legacy installer manifest', async () => {
  await assert.rejects(
    verifyUpdateFeedInstallerFixture(
      options({
        verifyInstallerLayout: async () => ({
          ok: false,
          errors: ['installer.manifest_schema_invalid'],
          manifest: { schemaVersion: 2 },
        }),
      }),
    ),
    /update-feed\.installer_fixture_invalid:errors=installer\.manifest_schema_invalid/,
  );
});

test('update feed preflight accepts only a current explicit unsigned fixture', async () => {
  let call = null;
  const verification = {
    ok: true,
    errors: [],
    manifest: { schemaVersion: 3, signing: { mode: 'unsigned-fixture' } },
  };
  const result = await verifyUpdateFeedInstallerFixture(
    options({
      verifyInstallerLayout: async (receivedDir, receivedOptions) => {
        call = { receivedDir, receivedOptions };
        return verification;
      },
    }),
  );

  assert.deepEqual(call, {
    receivedDir: installerDir,
    receivedOptions: { allowUnsignedFixture: true, requireCurrentManifest: true },
  });
  assert.equal(result.installerPath, installerPath);
  assert.equal(result.verification, verification);
});

test('update feed preflight rejects a tampered current fixture', async () => {
  await assert.rejects(
    verifyUpdateFeedInstallerFixture(
      options({
        verifyInstallerLayout: async () => ({
          ok: false,
          errors: ['installer.manifest_digest_mismatch'],
          manifest: { schemaVersion: 3, signing: { mode: 'unsigned-fixture' } },
        }),
      }),
    ),
    /update-feed\.installer_fixture_invalid:errors=installer\.manifest_digest_mismatch/,
  );
});
