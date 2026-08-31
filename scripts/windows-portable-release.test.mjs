import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  assertSafeReleaseOutput,
  assertWindowsUpdaterBootstrapConfig,
  collectForbiddenReleaseFiles,
  createCriticalFileManifest,
  createWindowsUpdaterBootstrapConfig,
  createPnpmDeployInvocation,
  isIgnorableWindowsPnpmBinShimFailure,
  normalizeWindowsPublisherName,
  normalizeWindowsReleaseVersion,
  pruneProductionBinDirectories,
  resolveWindowsUpdaterBootstrapConfiguration,
  verifyWindowsPortableLayout,
} from './windows-portable-release.mjs';

test('release output must be a child of apps/desktop/release', () => {
  const root = resolve('D:/workspace/sync-think');
  const releaseRoot = join(root, 'apps', 'desktop', 'release');

  assert.equal(
    assertSafeReleaseOutput(root, join(releaseRoot, 'win-unpacked')),
    join(releaseRoot, 'win-unpacked'),
  );
  assert.throws(() => assertSafeReleaseOutput(root, releaseRoot), /release\.output_unsafe/);
  assert.throws(
    () => assertSafeReleaseOutput(root, join(root, 'apps', 'desktop', 'dist')),
    /release\.output_unsafe/,
  );
  assert.throws(
    () => assertSafeReleaseOutput(root, join(releaseRoot, '..', '..', 'dist')),
    /release\.output_unsafe/,
  );
});

test('updater bootstrap config contains only the local cache identity', () => {
  const config = createWindowsUpdaterBootstrapConfig();
  assert.equal(config, 'updaterCacheDirName: sync-think-updater\n');
  assert.equal(/token|authorization|provider|url/i.test(config), false);
});

test('release updater bootstrap pins the exact publisher while unsigned fixtures ignore residual env', () => {
  const publisherName = 'CN=SYNC-THINK Release, O=SYNC-THINK, C=CN';
  const release = resolveWindowsUpdaterBootstrapConfiguration(
    { signingMode: 'release', publisherName },
    {},
  );
  assert.equal(
    createWindowsUpdaterBootstrapConfig(release),
    [
      'updaterCacheDirName: sync-think-updater',
      `publisherName: ${JSON.stringify(publisherName)}`,
      '',
    ].join('\n'),
  );
  const unsigned = resolveWindowsUpdaterBootstrapConfiguration(
    { signingMode: 'unsigned-fixture' },
    { SYNC_THINK_WINDOWS_PUBLISHER_NAME: 'CN=SHOULD NOT LEAK' },
  );
  assert.deepEqual(unsigned, { signingMode: 'unsigned-fixture', publisherName: null });
  assert.equal(
    createWindowsUpdaterBootstrapConfig(unsigned),
    'updaterCacheDirName: sync-think-updater\n',
  );
});

test('release updater bootstrap rejects missing, malformed and injected publisher names', () => {
  assert.throws(
    () => resolveWindowsUpdaterBootstrapConfiguration({ signingMode: 'release' }, {}),
    /release\.publisher_name_missing/,
  );
  for (const value of [
    '',
    'SYNC-THINK Release',
    'CN=Publisher\nprovider: generic',
    'CN=Publisher\r\nauthorization: TOKEN',
    'CN=' + 'A'.repeat(1025),
  ]) {
    assert.throws(() => normalizeWindowsPublisherName(value), /release\.publisher_name_/);
  }
});

test('updater bootstrap verifier is byte-exact and rejects extra provider material', () => {
  const configuration = resolveWindowsUpdaterBootstrapConfiguration(
    {
      signingMode: 'release',
      publisherName: 'CN=SYNC-THINK Release, O=SYNC-THINK, C=CN',
    },
    {},
  );
  const expected = createWindowsUpdaterBootstrapConfig(configuration);
  assert.deepEqual(assertWindowsUpdaterBootstrapConfig(expected, configuration), configuration);
  for (const contents of [
    'updaterCacheDirName: sync-think-updater\n',
    expected + 'provider: generic\n',
    expected.replace('sync-think-updater', 'other-updater'),
    expected + 'authorization: TOKEN\n',
  ]) {
    assert.throws(
      () => assertWindowsUpdaterBootstrapConfig(contents, configuration),
      /release\.updater_config_mismatch/,
    );
  }
});

test('portable layout verifier enforces the selected updater publisher policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-release-publisher-'));
  const publisherName = 'CN=SYNC-THINK Release, O=SYNC-THINK, C=CN';
  const configuration = resolveWindowsUpdaterBootstrapConfiguration(
    { signingMode: 'release', publisherName },
    {},
  );
  await mkdir(join(root, 'resources'), { recursive: true });
  await writeFile(
    join(root, 'resources', 'app-update.yml'),
    createWindowsUpdaterBootstrapConfig(configuration),
  );
  const exact = await verifyWindowsPortableLayout(root, {
    probeNode: false,
    signingMode: 'release',
    publisherName,
    environment: {},
  });
  assert.equal(exact.errors.includes('release.updater_config_mismatch'), false);
  assert.equal(exact.errors.includes('release.publisher_name_missing'), false);

  await writeFile(
    join(root, 'resources', 'app-update.yml'),
    createWindowsUpdaterBootstrapConfig({ publisherName: null }),
  );
  const stale = await verifyWindowsPortableLayout(root, {
    probeNode: false,
    signingMode: 'release',
    publisherName,
    environment: {},
  });
  assert.ok(stale.errors.includes('release.updater_config_mismatch'));
});

test('portable release version accepts semver and rejects malformed overrides', () => {
  assert.equal(normalizeWindowsReleaseVersion('0.0.2-smoke'), '0.0.2-smoke');
  assert.equal(normalizeWindowsReleaseVersion('1.2.3+build.4'), '1.2.3+build.4');
  assert.throws(() => normalizeWindowsReleaseVersion('1.2'), /release\.version_invalid/);
  assert.throws(() => normalizeWindowsReleaseVersion('01.2.3'), /release\.version_invalid/);
});

test('portable deploy uses modern injected workspace packages in the controlled release tree', () => {
  const root = resolve('D:/workspace/sync-think');
  const releaseRoot = join(root, 'apps', 'desktop', 'release');
  const desktopTarget = join(releaseRoot, 'win-unpacked', 'resources', 'app');
  const runtimeTarget = join(releaseRoot, 'win-unpacked', 'resources', 'runtime');
  const desktopInvocation = createPnpmDeployInvocation(root, '@sync-think/desktop', desktopTarget);
  const runtimeInvocation = createPnpmDeployInvocation(root, '@sync-think/runtime', runtimeTarget);

  for (const [invocation, packageName, target] of [
    [desktopInvocation, '@sync-think/desktop', desktopTarget],
    [runtimeInvocation, '@sync-think/runtime', runtimeTarget],
  ]) {
    assert.equal(invocation.cwd, root);
    assert.ok(invocation.args.includes('--config.node-linker=hoisted'));
    assert.ok(invocation.args.includes('--config.inject-workspace-packages=true'));
    assert.equal(invocation.args.includes('--legacy'), false);
    assert.deepEqual(invocation.args.slice(-4), [packageName, 'deploy', '--prod', target]);
  }

  assert.throws(
    () => createPnpmDeployInvocation(root, '@sync-think/runtime', releaseRoot),
    /release\.output_unsafe/,
  );
  assert.throws(
    () =>
      createPnpmDeployInvocation(
        root,
        '@sync-think/runtime',
        join(root, 'apps', 'runtime', 'apps', 'desktop', 'release', 'win-unpacked'),
      ),
    /release\.output_unsafe/,
  );
  assert.throws(
    () => createPnpmDeployInvocation(root, '@sync-think/runtime', join(root, '..', 'outside')),
    /release\.output_unsafe/,
  );
  assert.throws(
    () => createPnpmDeployInvocation(root, '@sync-think/unknown', desktopTarget),
    /release\.deploy_package_unsupported/,
  );
});

test('portable deploy ignores only a Windows pnpm PowerShell shim EPERM inside its target', () => {
  const target = resolve('D:/workspace/sync-think/apps/desktop/release/deploy/runtime');
  const prefix = 'Deployment with a shared lockfile has failed.\n';
  assert.equal(
    isIgnorableWindowsPnpmBinShimFailure(
      prefix +
        "EPERM EPERM: operation not permitted, open '" +
        join(target, 'node_modules', '.bin', 'semver.ps1') +
        "'",
      target,
      'win32',
    ),
    true,
  );
  for (const stderr of [
    prefix +
      "EPERM: operation not permitted, open '" +
      resolve('D:/outside/node_modules/.bin/semver.ps1') +
      "'",
    prefix +
      "EPERM: operation not permitted, open '" +
      join(target, 'node_modules', '.bin', 'semver.cmd') +
      "'",
    prefix + "EPERM: operation not permitted, open '" + join(target, 'package.json') + "'",
    "EPERM: operation not permitted, open '" +
      join(target, 'node_modules', '.bin', 'semver.ps1') +
      "'",
  ]) {
    assert.equal(isIgnorableWindowsPnpmBinShimFailure(stderr, target, 'win32'), false);
  }
  assert.equal(
    isIgnorableWindowsPnpmBinShimFailure(
      prefix +
        "EPERM: operation not permitted, open '" +
        join(target, 'node_modules', '.bin', 'semver.ps1') +
        "'",
      target,
      'linux',
    ),
    false,
  );
});

test('desktop build-only Tailwind packages stay outside production dependencies', async () => {
  const desktopPackage = JSON.parse(
    await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'),
  );
  for (const packageName of ['@tailwindcss/cli', 'tailwindcss']) {
    assert.equal(desktopPackage.dependencies?.[packageName], undefined);
    assert.equal(typeof desktopPackage.devDependencies?.[packageName], 'string');
  }
});

test('production deploy pruning removes package-manager bin shims and keeps runtime modules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-release-bin-prune-'));
  const rootBin = join(root, 'node_modules', '.bin');
  const nestedBin = join(root, 'node_modules', '.pnpm', 'semver@7.7.2', 'node_modules', '.bin');
  const runtimeModule = join(root, 'node_modules', 'semver', 'index.js');
  await mkdir(rootBin, { recursive: true });
  await mkdir(nestedBin, { recursive: true });
  await mkdir(join(root, 'node_modules', 'semver'), { recursive: true });
  await writeFile(join(rootBin, 'semver.ps1'), 'shim');
  await writeFile(join(nestedBin, 'semver.cmd'), 'shim');
  await writeFile(runtimeModule, 'export {};');

  await pruneProductionBinDirectories(root);

  await assert.rejects(access(rootBin), { code: 'ENOENT' });
  await assert.rejects(access(nestedBin), { code: 'ENOENT' });
  await access(runtimeModule);
});

test('forbidden release scan rejects secrets, databases, source trees, tests and build tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-release-scan-'));
  await mkdir(join(root, 'resources', 'app', 'src'), { recursive: true });
  await mkdir(join(root, 'resources', 'runtime', 'tests'), { recursive: true });
  await mkdir(join(root, 'resources', 'app', 'release'), { recursive: true });
  await mkdir(join(root, 'resources', 'app', 'node_modules', '@tailwindcss', 'cli'), {
    recursive: true,
  });
  await mkdir(join(root, 'resources', 'app', 'node_modules', 'tailwindcss'), { recursive: true });
  await mkdir(join(root, 'resources', 'app', 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(root, 'resources', 'runtime', 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(root, 'resources', 'app', '.env.production'), 'TOKEN=secret');
  await writeFile(join(root, 'resources', 'runtime', 'sync-think.db'), 'sqlite');
  await writeFile(
    join(root, 'resources', 'app', 'node_modules', '.bin', 'tailwindcss.ps1'),
    'shim',
  );
  await writeFile(join(root, 'resources', 'runtime', 'node_modules', '.bin', 'semver.ps1'), 'shim');

  const forbidden = await collectForbiddenReleaseFiles(root);
  assert.deepEqual(
    forbidden.map((item) => item.replaceAll('\\', '/')),
    [
      'resources/app/.env.production',
      'resources/app/node_modules/.bin/tailwindcss.ps1',
      'resources/app/node_modules/@tailwindcss/cli',
      'resources/app/node_modules/tailwindcss',
      'resources/app/release',
      'resources/app/src',
      'resources/runtime/node_modules/.bin/semver.ps1',
      'resources/runtime/sync-think.db',
      'resources/runtime/tests',
    ],
  );
});

test('critical file manifest is stable, relative and content-addressed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-release-manifest-'));
  await mkdir(join(root, 'resources', 'runtime'), { recursive: true });
  await writeFile(join(root, 'SYNC-THINK.exe'), 'desktop');
  await writeFile(join(root, 'resources', 'runtime', 'main.js'), 'runtime');

  const manifest = await createCriticalFileManifest(root, [
    'resources/runtime/main.js',
    'SYNC-THINK.exe',
  ]);

  assert.deepEqual(
    manifest.map(({ path }) => path),
    ['SYNC-THINK.exe', 'resources/runtime/main.js'],
  );
  assert.equal(manifest[0]?.bytes, 7);
  assert.match(manifest[0]?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(manifest).includes(root), false);
});

test('portable layout verifier reports missing critical resources without throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-release-layout-'));
  const result = await verifyWindowsPortableLayout(root, { probeNode: false });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('release.desktop_executable_missing'));
  assert.ok(result.errors.includes('release.updater_config_missing'));
  assert.ok(result.errors.includes('release.runtime_entry_missing'));
  assert.ok(result.errors.includes('release.platform_mcp_server_missing'));
  assert.ok(result.errors.includes('release.npm_cli_missing'));
  assert.ok(result.errors.includes('release.node_binary_missing'));
  assert.deepEqual(result.forbiddenFiles, []);
});
