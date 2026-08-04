import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE_ROOT = resolve(SCRIPT_DIR, '..');
const RELEASE_ROOT_PARTS = ['apps', 'desktop', 'release'];
const WORKSPACE_PACKAGE_PARTS = new Map([
  ['@sync-think/desktop', ['apps', 'desktop']],
  ['@sync-think/runtime', ['apps', 'runtime']],
]);
const OWNED_PRUNE_NAMES = ['.turbo', 'src', 'tests', 'scripts', 'release'];
const RECURSIVE_REMOVE_OPTIONS = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100,
});
const WINDOWS_BRAND_ICON_PATH = join(
  DEFAULT_WORKSPACE_ROOT,
  'apps',
  'desktop',
  'build',
  'icon.ico',
);

export const DEFAULT_WINDOWS_RELEASE_DIR = join(
  DEFAULT_WORKSPACE_ROOT,
  ...RELEASE_ROOT_PARTS,
  'win-unpacked',
);

export const WINDOWS_UPDATER_CACHE_DIR_NAME = 'sync-think-updater';
export const WINDOWS_UPDATER_SIGNING_MODES = Object.freeze(['release', 'unsigned-fixture']);

export function normalizeWindowsPublisherName(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error('release.publisher_name_missing');
  if (
    normalized.length > 1024 ||
    [...normalized].some((character) => character.charCodeAt(0) <= 0x1f) ||
    !/(?:^|,\s*)CN\s*=/i.test(normalized)
  ) {
    throw new Error('release.publisher_name_invalid');
  }
  return normalized;
}

export function resolveWindowsUpdaterBootstrapConfiguration(
  options = {},
  environment = process.env,
) {
  const signingMode = String(
    options.signingMode ?? environment.SYNC_THINK_WINDOWS_SIGNING_MODE ?? 'release',
  )
    .trim()
    .toLowerCase();
  if (!WINDOWS_UPDATER_SIGNING_MODES.includes(signingMode)) {
    throw new Error('release.signing_mode_invalid');
  }
  if (signingMode === 'unsigned-fixture') {
    return { signingMode, publisherName: null };
  }
  return {
    signingMode,
    publisherName: normalizeWindowsPublisherName(
      options.publisherName ?? environment.SYNC_THINK_WINDOWS_PUBLISHER_NAME,
    ),
  };
}

export function createWindowsUpdaterBootstrapConfig(configuration = { publisherName: null }) {
  const lines = [`updaterCacheDirName: ${WINDOWS_UPDATER_CACHE_DIR_NAME}`];
  if (configuration.publisherName !== null) {
    lines.push(`publisherName: ${JSON.stringify(configuration.publisherName)}`);
  }
  return lines.join('\n') + '\n';
}

export function assertWindowsUpdaterBootstrapConfig(contents, configuration) {
  if (contents !== createWindowsUpdaterBootstrapConfig(configuration)) {
    throw new Error('release.updater_config_mismatch');
  }
  return configuration;
}

const REQUIRED_LAYOUT_FILES = [
  ['SYNC-THINK.exe', 'release.desktop_executable_missing'],
  ['resources/app/package.json', 'release.desktop_package_missing'],
  ['resources/app-update.yml', 'release.updater_config_missing'],
  ['resources/app/build/icon.ico', 'release.desktop_brand_icon_missing'],
  ['resources/app/build/icon.png', 'release.desktop_brand_preview_missing'],
  ['resources/app/dist/main/index.js', 'release.desktop_main_missing'],
  ['resources/app/dist/preload/index.cjs', 'release.desktop_preload_missing'],
  ['resources/app/dist/renderer/index.html', 'release.desktop_renderer_missing'],
  ['resources/app/dist/renderer-shell/index.html', 'release.desktop_shell_missing'],
  ['resources/runtime/main.js', 'release.runtime_entry_missing'],
  ['resources/runtime/dist/main.js', 'release.runtime_main_missing'],
  ['resources/node/node.exe', 'release.node_binary_missing'],
];

function normalizedPath(path) {
  return resolve(path).replaceAll('/', sep).toLowerCase();
}

function isWithin(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

export function isIgnorableWindowsPnpmBinShimFailure(
  stderr,
  targetDir,
  platform = process.platform,
) {
  if (
    platform !== 'win32' ||
    !/Deployment with a shared lockfile has failed/i.test(String(stderr))
  ) {
    return false;
  }
  const matches = String(stderr).matchAll(
    /EPERM[^\r\n]{0,200}?operation not permitted,\s*open\s+'([^'\r\n]+)'/gi,
  );
  for (const match of matches) {
    const candidate = match[1];
    if (
      candidate &&
      /[\\/]node_modules[\\/]\.bin[\\/][^\\/]+\.ps1$/i.test(candidate) &&
      isWithin(targetDir, candidate)
    ) {
      return true;
    }
  }
  return false;
}

export function assertSafeReleaseOutput(workspaceRoot, outputDir) {
  if (!isAbsolute(workspaceRoot) || !isAbsolute(outputDir)) {
    throw new Error('release.output_unsafe');
  }
  const releaseRoot = resolve(workspaceRoot, ...RELEASE_ROOT_PARTS);
  const resolvedOutput = resolve(outputDir);
  const rel = relative(releaseRoot, resolvedOutput);
  if (
    normalizedPath(resolvedOutput) === normalizedPath(releaseRoot) ||
    rel === '' ||
    rel.startsWith('..' + sep) ||
    rel === '..' ||
    isAbsolute(rel)
  ) {
    throw new Error('release.output_unsafe');
  }
  return resolvedOutput;
}

async function isNonEmptyFile(path) {
  try {
    const value = await stat(path);
    return value.isFile() && value.size > 0;
  } catch {
    return false;
  }
}

function toPortableRelative(root, path) {
  return relative(root, path).replaceAll('\\', '/');
}

async function walk(root, visitor, current = root) {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    await visitor(absolute, entry);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await walk(root, visitor, absolute);
    }
  }
}

function isOwnedSourceTree(relativePath) {
  const parts = relativePath.split('/');
  const leaf = parts.at(-1);
  if (!leaf || !OWNED_PRUNE_NAMES.includes(leaf)) return false;
  if (parts.length === 3 && parts[0] === 'resources' && ['app', 'runtime'].includes(parts[1])) {
    return true;
  }
  const modulesIndex = parts.lastIndexOf('node_modules');
  return (
    modulesIndex >= 0 &&
    parts[modulesIndex + 1] === '@sync-think' &&
    parts.length === modulesIndex + 4
  );
}

function isBuildOnlyPayload(relativePath, entry) {
  const parts = relativePath.toLowerCase().split('/');
  if (parts[0] !== 'resources' || !['app', 'runtime'].includes(parts[1])) return false;
  const modulesIndex = parts.lastIndexOf('node_modules');
  if (modulesIndex < 0) return false;
  const packageParts = parts.slice(modulesIndex + 1);
  if (parts[1] === 'app' && entry.isDirectory()) {
    return (
      (packageParts.length === 2 &&
        packageParts[0] === '@tailwindcss' &&
        packageParts[1] === 'cli') ||
      (packageParts.length === 1 && packageParts[0] === 'tailwindcss')
    );
  }
  return entry.isFile() && packageParts.includes('.bin');
}

export async function collectForbiddenReleaseFiles(releaseDir) {
  const found = new Set();
  await walk(releaseDir, async (absolute, entry) => {
    const rel = toPortableRelative(releaseDir, absolute);
    const name = entry.name.toLowerCase();
    if (entry.isDirectory() && isOwnedSourceTree(rel)) found.add(rel);
    if (isBuildOnlyPayload(rel, entry)) found.add(rel);
    if (
      entry.isFile() &&
      (name === '.env' || name.startsWith('.env.') || name.endsWith('.db') || name.includes('.db-'))
    ) {
      found.add(rel);
    }
  });
  return [...found].sort();
}

export async function createCriticalFileManifest(releaseDir, relativePaths) {
  const records = [];
  for (const path of [...new Set(relativePaths)].sort()) {
    const absolute = resolve(releaseDir, path);
    const rel = relative(resolve(releaseDir), absolute);
    if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
      throw new Error('release.manifest_path_unsafe');
    }
    const content = await readFile(absolute);
    records.push({
      path: rel.replaceAll('\\', '/'),
      bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  }
  return records;
}

async function findFilesByBasename(root, basenames) {
  const matches = [];
  const wanted = new Set(basenames.map((name) => name.toLowerCase()));
  await walk(root, async (absolute, entry) => {
    if (entry.isFile() && wanted.has(entry.name.toLowerCase())) {
      matches.push(toPortableRelative(root, absolute));
    }
  });
  return matches.sort();
}

function probeNode20(nodePath) {
  const result = spawnSync(nodePath, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const version = result.stdout.trim();
  return version.startsWith('20.') ? version : null;
}

export async function verifyWindowsPortableLayout(releaseDir, options = {}) {
  const errors = [];
  const root = resolve(releaseDir);
  let updaterConfiguration = null;
  try {
    updaterConfiguration = resolveWindowsUpdaterBootstrapConfiguration(
      {
        signingMode: options.signingMode,
        publisherName: options.publisherName,
      },
      options.environment ?? process.env,
    );
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'release.updater_config_invalid');
  }
  for (const [path, code] of REQUIRED_LAYOUT_FILES) {
    if (!(await isNonEmptyFile(join(root, path)))) errors.push(code);
  }
  const updaterConfigPath = join(root, 'resources', 'app-update.yml');
  if (updaterConfiguration && (await isNonEmptyFile(updaterConfigPath))) {
    try {
      assertWindowsUpdaterBootstrapConfig(
        await readFile(updaterConfigPath, 'utf8'),
        updaterConfiguration,
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'release.updater_config_invalid');
    }
  }

  const runtimeModules = join(root, 'resources', 'runtime', 'node_modules');
  const nativeAddons = await findFilesByBasename(runtimeModules, [
    'better_sqlite3.node',
    'koffi.node',
  ]);
  if (!nativeAddons.some((path) => path.endsWith('/better_sqlite3.node'))) {
    errors.push('release.sqlite_native_addon_missing');
  }
  if (!nativeAddons.some((path) => path.endsWith('/koffi.node'))) {
    errors.push('release.koffi_native_addon_missing');
  }

  let nodeVersion = null;
  const nodePath = join(root, 'resources', 'node', 'node.exe');
  if (options.probeNode !== false && (await isNonEmptyFile(nodePath))) {
    nodeVersion = probeNode20(nodePath);
    if (!nodeVersion) errors.push('release.node20_probe_failed');
  }

  const forbiddenFiles = await collectForbiddenReleaseFiles(root);
  if (forbiddenFiles.length > 0) errors.push('release.forbidden_payload_present');

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    forbiddenFiles,
    nativeAddons,
    nodeVersion,
  };
}

export function normalizeWindowsReleaseVersion(value) {
  const version = String(value ?? '').trim();
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      version,
    )
  ) {
    throw new Error('release.version_invalid');
  }
  return version;
}

async function readWorkspaceNodeVersion(workspaceRoot) {
  const yaml = await readFile(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8');
  const match = /^useNodeVersion:\s*([^\s#]+)\s*$/m.exec(yaml);
  if (!match?.[1]) throw new Error('release.node_version_missing');
  return match[1];
}

async function resolveManagedNodeBinary(workspaceRoot) {
  const version = await readWorkspaceNodeVersion(workspaceRoot);
  const candidates = [
    process.env.SYNC_THINK_RELEASE_NODE_BIN,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'pnpm', 'nodejs', version, 'node.exe')
      : undefined,
    process.env.PNPM_HOME ? join(process.env.PNPM_HOME, 'nodejs', version, 'node.exe') : undefined,
    process.execPath,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate) && probeNode20(candidate)) return { path: candidate, version };
  }
  throw new Error('release.node20_binary_missing');
}

function pnpmCommand(args) {
  const execPath = process.env.npm_execpath;
  if (execPath && existsSync(execPath)) {
    return { command: process.execPath, args: [execPath, ...args] };
  }
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', ...args],
    };
  }
  return { command: 'pnpm', args };
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    let stderr = '';
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['inherit', 'inherit', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      stderr = (stderr + chunk.toString('utf8')).slice(-256 * 1024);
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else if (
        options.binShimRoot &&
        isIgnorableWindowsPnpmBinShimFailure(stderr, options.binShimRoot)
      ) {
        console.warn(
          '[release] ignored pnpm Windows PowerShell bin-shim EPERM; production bin shims will be pruned',
        );
        resolvePromise();
      } else
        rejectPromise(
          new Error(
            'release.command_failed:' +
              command +
              ':code=' +
              String(code) +
              ':signal=' +
              String(signal),
          ),
        );
    });
  });
}

export function createPnpmDeployInvocation(workspaceRoot, packageName, targetDir) {
  if (!WORKSPACE_PACKAGE_PARTS.has(packageName)) {
    throw new Error('release.deploy_package_unsupported');
  }
  const resolvedTarget = assertSafeReleaseOutput(workspaceRoot, targetDir);
  return {
    ...pnpmCommand([
      '--config.node-linker=hoisted',
      '--config.inject-workspace-packages=true',
      '--filter',
      packageName,
      'deploy',
      '--prod',
      resolvedTarget,
    ]),
    cwd: resolve(workspaceRoot),
  };
}

async function deployWorkspacePackage(workspaceRoot, packageName, targetDir) {
  const invocation = createPnpmDeployInvocation(workspaceRoot, packageName, targetDir);
  await runCommand(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    binShimRoot: targetDir,
  });
  await ensureReadable(join(targetDir, 'package.json'), 'release.deploy_incomplete');
}

async function pruneOwnedPayload(packageRoot) {
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  } catch {
    return;
  }
  if (typeof packageJson.name !== 'string' || !packageJson.name.startsWith('@sync-think/')) return;
  for (const name of OWNED_PRUNE_NAMES) {
    await rm(join(packageRoot, name), { recursive: true, force: true });
  }
  for (const name of ['tsconfig.json', 'tsconfig.tsbuildinfo', 'drizzle.config.ts']) {
    await rm(join(packageRoot, name), { force: true });
  }
}

async function pruneAllOwnedPackages(root) {
  await pruneOwnedPayload(root);
  const packageRoots = [];
  await walk(root, async (absolute, entry) => {
    if (entry.isFile() && entry.name === 'package.json') packageRoots.push(dirname(absolute));
  });
  for (const packageRoot of packageRoots) await pruneOwnedPayload(packageRoot);
}

export async function pruneProductionBinDirectories(root) {
  const directories = [];
  await walk(root, async (absolute, entry) => {
    if (
      entry.isDirectory() &&
      entry.name.toLowerCase() === '.bin' &&
      basename(dirname(absolute)).toLowerCase() === 'node_modules'
    ) {
      directories.push(absolute);
    }
  });
  directories.sort((left, right) => right.length - left.length);
  for (const directory of directories) {
    await rm(directory, RECURSIVE_REMOVE_OPTIONS);
  }
  return directories.map((directory) => toPortableRelative(root, directory)).sort();
}

async function ensureReadable(path, code) {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(code);
  }
}

export async function applyWindowsExecutableBranding(executablePath, iconPath) {
  const executableBuffer = await readFile(executablePath);
  const iconBuffer = await readFile(iconPath);
  const executable = NtExecutable.from(executableBuffer);
  const resources = NtExecutableResource.from(executable);
  const iconFile = Data.IconFile.from(iconBuffer);
  Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    0x0409,
    iconFile.icons.map((icon) => icon.data),
  );
  resources.outputResource(executable);
  await writeFile(executablePath, Buffer.from(executable.generate()));

  const brandedBuffer = await readFile(executablePath);
  const brandedExecutable = NtExecutable.from(brandedBuffer);
  const brandedResources = NtExecutableResource.from(brandedExecutable);
  const groups = Resource.IconGroupEntry.fromEntries(brandedResources.entries);
  if (groups.length === 0 || groups[0].icons.length < iconFile.icons.length) {
    throw new Error('release.desktop_brand_icon_missing');
  }
  return {
    iconCount: groups[0].icons.length,
    sizes: groups[0].icons.map((icon) => `${icon.width}x${icon.height}`),
  };
}

export async function stageWindowsPortableRelease(options = {}) {
  if (process.platform !== 'win32') throw new Error('release.windows_only');
  const workspaceRoot = resolve(options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT);
  const outputDir = assertSafeReleaseOutput(
    workspaceRoot,
    resolve(options.outputDir ?? join(workspaceRoot, ...RELEASE_ROOT_PARTS, 'win-unpacked')),
  );
  const electronDist = join(workspaceRoot, 'apps', 'desktop', 'node_modules', 'electron', 'dist');
  const brandIconPath =
    workspaceRoot === DEFAULT_WORKSPACE_ROOT
      ? WINDOWS_BRAND_ICON_PATH
      : join(workspaceRoot, 'apps', 'desktop', 'build', 'icon.ico');
  await ensureReadable(join(electronDist, 'electron.exe'), 'release.electron_distribution_missing');
  await ensureReadable(brandIconPath, 'release.desktop_brand_icon_missing');
  const managedNode = await resolveManagedNodeBinary(workspaceRoot);
  const updaterConfiguration = resolveWindowsUpdaterBootstrapConfiguration(
    {
      signingMode: options.signingMode,
      publisherName: options.publisherName,
    },
    options.environment ?? process.env,
  );

  await rm(outputDir, RECURSIVE_REMOVE_OPTIONS);
  await mkdir(dirname(outputDir), { recursive: true });
  await cp(electronDist, outputDir, { recursive: true, force: true });
  await rename(join(outputDir, 'electron.exe'), join(outputDir, 'SYNC-THINK.exe'));
  await applyWindowsExecutableBranding(join(outputDir, 'SYNC-THINK.exe'), brandIconPath);

  const rootPackage = JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8'));
  const releaseVersion = normalizeWindowsReleaseVersion(options.version ?? rootPackage.version);
  const appDir = join(outputDir, 'resources', 'app');
  const runtimeDir = join(outputDir, 'resources', 'runtime');
  const deployRoot = assertSafeReleaseOutput(
    workspaceRoot,
    outputDir + '.deploy-' + process.pid + '-' + randomUUID(),
  );
  const stagedAppDir = join(deployRoot, 'app');
  const stagedRuntimeDir = join(deployRoot, 'runtime');
  try {
    await deployWorkspacePackage(workspaceRoot, '@sync-think/desktop', stagedAppDir);
    await pruneAllOwnedPackages(stagedAppDir);
    await pruneProductionBinDirectories(stagedAppDir);
    await deployWorkspacePackage(workspaceRoot, '@sync-think/runtime', stagedRuntimeDir);
    await pruneAllOwnedPackages(stagedRuntimeDir);
    await pruneProductionBinDirectories(stagedRuntimeDir);
    await rename(stagedAppDir, appDir);
    await rename(stagedRuntimeDir, runtimeDir);
  } finally {
    await rm(deployRoot, RECURSIVE_REMOVE_OPTIONS);
  }
  const packagedApp = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  packagedApp.version = releaseVersion;
  await writeFile(
    join(appDir, 'package.json'),
    JSON.stringify(packagedApp, null, 2) + '\n',
    'utf8',
  );

  await writeFile(
    join(outputDir, 'resources', 'app-update.yml'),
    createWindowsUpdaterBootstrapConfig(updaterConfiguration),
    'utf8',
  );
  await writeFile(join(runtimeDir, 'main.js'), "import './dist/main.js';\n", 'utf8');
  const nodeDir = join(outputDir, 'resources', 'node');
  await mkdir(nodeDir, { recursive: true });
  await cp(managedNode.path, join(nodeDir, 'node.exe'));

  const verification = await verifyWindowsPortableLayout(outputDir, {
    signingMode: updaterConfiguration.signingMode,
    publisherName: updaterConfiguration.publisherName,
    environment: {},
  });
  if (!verification.ok) {
    throw new Error(
      'release.layout_invalid:' +
        JSON.stringify({
          errors: verification.errors,
          forbiddenFiles: verification.forbiddenFiles,
        }),
    );
  }

  const criticalPaths = [
    ...REQUIRED_LAYOUT_FILES.map(([path]) => path),
    ...verification.nativeAddons.map((path) => 'resources/runtime/node_modules/' + path),
  ];
  const manifest = {
    schemaVersion: 1,
    productName: 'SYNC-THINK',
    version: releaseVersion,
    platform: 'win32',
    arch: process.arch,
    runtimeNodeVersion: verification.nodeVersion,
    files: await createCriticalFileManifest(outputDir, criticalPaths),
  };
  await writeFile(
    join(outputDir, 'release-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
  return { outputDir, manifest, verification };
}

function readArgument(args, name) {
  const index = args.findIndex((value) => value === name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((value) => value.startsWith(name + '='));
  return inline ? inline.slice(name.length + 1) : undefined;
}

function readOutputArgument(args) {
  const index = args.findIndex((value) => value === '--out');
  if (index >= 0 && args[index + 1]) return resolve(args[index + 1]);
  const inline = args.find((value) => value.startsWith('--out='));
  return inline ? resolve(inline.slice('--out='.length)) : undefined;
}

async function main() {
  const [command = 'verify', ...args] = process.argv.slice(2);
  const outputDir = readOutputArgument(args) ?? DEFAULT_WINDOWS_RELEASE_DIR;
  if (command === 'stage') {
    const result = await stageWindowsPortableRelease({
      outputDir,
      version: readArgument(args, '--version'),
      signingMode: readArgument(args, '--signing-mode'),
      publisherName: readArgument(args, '--publisher-name'),
    });
    console.log('[release] portable Windows layout ready');
    console.log(
      JSON.stringify(
        {
          outputDir: result.outputDir,
          version: result.manifest.version,
          runtimeNodeVersion: result.manifest.runtimeNodeVersion,
          criticalFiles: result.manifest.files.length,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'verify') {
    const result = await verifyWindowsPortableLayout(outputDir, {
      signingMode: readArgument(args, '--signing-mode'),
      publisherName: readArgument(args, '--publisher-name'),
    });
    console.log(JSON.stringify({ outputDir, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  throw new Error('release.command_unknown:' + command);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error('[release]', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
