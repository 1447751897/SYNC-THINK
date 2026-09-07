import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertSafeReleaseOutput,
  verifyWindowsPortableLayout,
} from './windows-portable-release.mjs';
import { prepareDirectExtractionScript } from './windows-installer-extraction.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productName = 'SYNC-THINK-PerfTest';
const root = join(workspaceRoot, '.data/installer-performance');
const destination = join(root, 'application');
const results = [];

async function run(command, args, options = {}) {
  const started = performance.now();
  const code = await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
      windowsHide: true,
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (exitCode, signal) =>
      signal ? reject(new Error('benchmark.signal:' + signal)) : resolvePromise(exitCode),
    );
  });
  assert.equal(code, 0, 'benchmark.command_failed:' + command);
  return { exitCode: code, seconds: Number(((performance.now() - started) / 1000).toFixed(3)) };
}

async function hash(path) {
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(path)) checksum.update(chunk);
  return checksum.digest('hex');
}

async function inventory(directory, relative = '') {
  const records = [];
  for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) records.push(...(await inventory(directory, path)));
    else if (entry.isFile())
      records.push({ path, bytes: (await stat(join(directory, path))).size });
    else throw new Error('benchmark.unexpected_link:' + path);
  }
  return records;
}

async function record(value) {
  results.push(value);
  await writeFile(
    join(root, 'results.json'),
    JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2) + '\n',
  );
  console.log('[installer-performance] ' + JSON.stringify(value));
}

async function main() {
  assert.equal(process.platform, 'win32');
  const inputIndex = process.argv.indexOf('--prepackaged');
  assert.ok(inputIndex > 0 && process.argv[inputIndex + 1], '--prepackaged is required');
  const portable = assertSafeReleaseOutput(workspaceRoot, resolve(process.argv[inputIndex + 1]));
  const verification = await verifyWindowsPortableLayout(portable, {
    signingMode: 'unsigned-fixture',
    environment: {},
  });
  assert.equal(verification.ok, true, JSON.stringify(verification.errors));
  await mkdir(root, { recursive: true });
  await assert.rejects(stat(destination), { code: 'ENOENT' });
  const resumeDirect = process.argv.includes('--resume-direct');
  if (resumeDirect) {
    const previous = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
    assert.ok(
      previous.results.some(
        (value) => value.mode === 'baseline' && value.phase === 'verify-overlay',
      ),
    );
    assert.ok(
      !previous.results.some((value) => value.mode === 'direct' && value.phase === 'clean'),
    );
    results.push(...previous.results);
  } else {
    await assert.rejects(stat(join(root, 'results.json')), { code: 'ENOENT' });
  }
  const config = JSON.parse(
    await readFile(join(workspaceRoot, 'apps/desktop/electron-builder.json'), 'utf8'),
  );
  const version = JSON.parse(
    await readFile(join(portable, 'resources/app/package.json'), 'utf8'),
  ).version;
  const testExecutable = join(portable, productName + '.exe');
  await assert.rejects(stat(testExecutable), { code: 'ENOENT' });
  await rename(join(portable, 'SYNC-THINK.exe'), testExecutable);
  const artifacts = [];
  try {
    const files = await inventory(portable);
    const expectedHashes = new Map();
    for (const file of files) expectedHashes.set(file.path, await hash(join(portable, file.path)));
    const payloadRecord = {
      phase: 'payload',
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      version,
    };
    if (resumeDirect) {
      assert.deepEqual(
        payloadRecord,
        results.find((value) => value.phase === 'payload'),
      );
      const artifact = join(
        workspaceRoot,
        'apps/desktop/release/installer-perf-direct',
        productName + '-Setup-' + version + '-x64.exe',
      );
      assert.equal(
        await hash(artifact),
        results.find((value) => value.mode === 'direct' && value.phase === 'build')?.sha256,
      );
      artifacts.push({ mode: 'direct', artifact });
    } else await record(payloadRecord);
    for (const mode of resumeDirect ? [] : ['baseline', 'direct']) {
      const output = join(workspaceRoot, 'apps/desktop/release', 'installer-perf-' + mode);
      await mkdir(output, { recursive: true });
      const include =
        mode === 'direct'
          ? await prepareDirectExtractionScript(
              workspaceRoot,
              output,
              join(workspaceRoot, 'apps/desktop/build/installer.nsh'),
            )
          : join(workspaceRoot, 'apps/desktop/build/installer.nsh');
      const fixture = {
        ...config,
        appId: 'com.syncthink.installperf',
        productName,
        extraMetadata: { name: 'sync-think-perftest', version },
        directories: { ...config.directories, output },
        win: { ...config.win, executableName: productName, signExecutable: false },
        nsis: {
          ...config.nsis,
          guid: 'd42e5091-0ec7-4aa2-901f-4e8600d50d94',
          include,
          createDesktopShortcut: false,
          createStartMenuShortcut: false,
          runAfterFinish: false,
          allowElevation: false,
          shortcutName: productName,
        },
      };
      const configPath = join(root, mode + '.json');
      await writeFile(configPath, JSON.stringify(fixture, null, 2));
      const built = await run(
        process.execPath,
        [
          join(workspaceRoot, 'node_modules/electron-builder/out/cli/cli.js'),
          '--projectDir',
          workspaceRoot,
          '--config',
          configPath,
          '--win',
          'nsis',
          '--x64',
          '--prepackaged',
          portable,
        ],
        { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } },
      );
      const artifact = join(output, productName + '-Setup-' + version + '-x64.exe');
      artifacts.push({ mode, artifact });
      await record({
        phase: 'build',
        mode,
        ...built,
        artifactBytes: (await stat(artifact)).size,
        sha256: await hash(artifact),
      });
    }
    for (const { mode, artifact } of artifacts) {
      for (const phase of ['clean', 'overlay']) {
        const installed = await run(artifact, ['/S', '/currentuser', '/D=' + destination]);
        await record({ phase, mode, ...installed });
        for (const file of files)
          assert.equal(
            await hash(join(destination, file.path)),
            expectedHashes.get(file.path),
            'benchmark.payload_mismatch:' + file.path,
          );
        const archive = join(
          process.env.LOCALAPPDATA,
          'sync-think-perftest-updater/recovery/installers',
          version,
          'installer.exe',
        );
        assert.equal(await hash(archive), await hash(artifact), 'benchmark.recovery_mismatch');
        await record({
          phase: 'verify-' + phase,
          mode,
          matchedFiles: files.length,
          recoveryMatches: true,
        });
      }
      const nativeCheck = await run(join(destination, 'resources/node/node.exe'), [
        '--input-type=module',
        '-e',
        'import { createRequire } from "node:module"; const require = createRequire(' +
          JSON.stringify(join(destination, 'resources/runtime/package.json')) +
          '); const Database = require("better-sqlite3"); const database = new Database(":memory:"); if (database.prepare("SELECT 1 AS ok").get().ok !== 1) throw new Error("sqlite failed"); database.close(); const kernel = require("koffi").load("kernel32.dll"); if (kernel.func("uint32_t GetCurrentProcessId()")() <= 0) throw new Error("koffi failed"); console.log("SQLite and Koffi native checks passed");',
      ]);
      await record({ phase: 'native-check', mode, ...nativeCheck });
      const uninstaller = join(destination, 'Uninstall ' + productName + '.exe');
      const uninstalled = await run(uninstaller, ['/S', '/currentuser', '_?=' + destination]);
      await assert.rejects(stat(join(destination, productName + '.exe')), { code: 'ENOENT' });
      await record({ phase: 'uninstall', mode, ...uninstalled });
      await rm(uninstaller, { force: true });
      await rmdir(destination).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  } finally {
    await rename(testExecutable, join(portable, 'SYNC-THINK.exe'));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
