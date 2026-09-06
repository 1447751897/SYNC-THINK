import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_INSTALLER_DIR = join(
  WORKSPACE_ROOT,
  'apps',
  'desktop',
  'release',
  'installer',
);
const DEFAULT_PUBLIC_DIR = join(WORKSPACE_ROOT, 'apps', 'desktop', 'release', 'public');
const TEMPLATE_DIR = join(WORKSPACE_ROOT, 'docs', 'operations', 'beta-public');

function formatBytes(bytes) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB (${bytes} bytes)`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB (${bytes} bytes)`;
  return `${bytes} bytes`;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

export async function assembleBetaPublicPage({
  workspaceRoot = WORKSPACE_ROOT,
  installerDir = DEFAULT_INSTALLER_DIR,
  publicDir = DEFAULT_PUBLIC_DIR,
  version,
} = {}) {
  const packageJson = JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8'));
  const resolvedVersion = String(version ?? packageJson.version);
  const filename = `SYNC-THINK-Setup-${resolvedVersion}-x64.exe`;
  const installerPath = join(installerDir, filename);
  const bytes = (await stat(installerPath)).size;
  const digest = await sha256File(installerPath);
  const template = await readFile(join(TEMPLATE_DIR, 'index.template.html'), 'utf8');
  const html = template
    .replaceAll('{{VERSION}}', resolvedVersion)
    .replaceAll('{{FILENAME}}', filename)
    .replaceAll('{{SHA256}}', digest)
    .replaceAll('{{BYTES_LABEL}}', formatBytes(bytes));

  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'index.html'), html, 'utf8');
  await copyFile(join(TEMPLATE_DIR, 'BETA-TESTER-GUIDE.md'), join(publicDir, 'BETA-TESTER-GUIDE.md'));
  await copyFile(installerPath, join(publicDir, filename));

  return {
    publicDir,
    filename,
    version: resolvedVersion,
    bytes,
    sha256: digest,
    indexPath: join(publicDir, 'index.html'),
  };
}

async function main() {
  const result = await assembleBetaPublicPage();
  console.log('[beta-public] assembled');
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
