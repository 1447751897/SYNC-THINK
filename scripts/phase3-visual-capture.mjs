import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_WORKSPACE_ROOT = resolve(dirname(SCRIPT_PATH), '..');

export const PHASE3_VISUAL_MATRIX = Object.freeze([
  { id: 'welcome-light', fixture: 'welcome', theme: 'light', scale: 1, width: 1280, height: 800 },
  { id: 'welcome-dark', fixture: 'welcome', theme: 'dark', scale: 1, width: 1280, height: 800 },
  {
    id: 'composer-slash-open-dark',
    fixture: 'composer-slash-open',
    theme: 'dark',
    scale: 1,
    width: 986,
    height: 560,
  },
  {
    id: 'trace-open-light',
    fixture: 'long-trace-open',
    theme: 'light',
    scale: 1,
    width: 1280,
    height: 900,
  },
  {
    id: 'trace-open-dark',
    fixture: 'long-trace-open',
    theme: 'dark',
    scale: 1,
    width: 1280,
    height: 900,
  },
  {
    id: 'trace-closed-dark',
    fixture: 'long-trace-closed',
    theme: 'dark',
    scale: 1,
    width: 1280,
    height: 900,
  },
  {
    id: 'connection-code-light',
    fixture: 'connection-and-code',
    theme: 'light',
    scale: 1,
    width: 1280,
    height: 800,
  },
  {
    id: 'streaming-follow-dark',
    fixture: 'streaming-follow',
    theme: 'dark',
    scale: 1,
    width: 1280,
    height: 800,
  },
  {
    id: 'diagnostics-light',
    fixture: 'diagnostics',
    theme: 'light',
    scale: 1,
    width: 1280,
    height: 800,
  },
  {
    id: 'diagnostics-dark-125',
    fixture: 'diagnostics',
    theme: 'dark',
    scale: 1.25,
    width: 1280,
    height: 800,
  },
  {
    id: 'inline-process-light',
    fixture: 'inline-process-hierarchy',
    theme: 'light',
    scale: 1,
    width: 1280,
    height: 800,
  },
  {
    id: 'inline-process-dark',
    fixture: 'inline-process-hierarchy',
    theme: 'dark',
    scale: 1,
    width: 1280,
    height: 800,
  },
  {
    id: 'inline-process-compact-dark',
    fixture: 'inline-process-hierarchy',
    theme: 'dark',
    scale: 1,
    width: 760,
    height: 640,
  },
  {
    id: 'task-status-light',
    fixture: 'task-status-panel',
    theme: 'light',
    scale: 1,
    width: 1440,
    height: 900,
  },
  {
    id: 'task-status-dark',
    fixture: 'task-status-panel',
    theme: 'dark',
    scale: 1,
    width: 1440,
    height: 900,
  },
  {
    id: 'task-status-wallpaper-switch',
    fixture: 'task-status-panel',
    state: 'wallpaper-switch',
    theme: 'dark',
    scale: 1,
    width: 1440,
    height: 900,
  },
  {
    id: 'task-status-compact-dark',
    fixture: 'task-status-panel',
    state: 'manual-open',
    theme: 'dark',
    scale: 1,
    width: 760,
    height: 640,
  },
  {
    id: 'welcome-compact-125',
    fixture: 'welcome',
    theme: 'light',
    scale: 1.25,
    width: 760,
    height: 640,
  },
  {
    id: 'workspace-file-light',
    fixture: 'workspace-file',
    theme: 'light',
    scale: 1,
    width: 1280,
    height: 800,
  },
  {
    id: 'workspace-file-dark',
    fixture: 'workspace-file',
    theme: 'dark',
    scale: 1,
    width: 1280,
    height: 800,
  },
  {
    id: 'workspace-file-source-light',
    fixture: 'workspace-file',
    state: 'source-copied',
    theme: 'light',
    scale: 1,
    width: 1280,
    height: 800,
  },
  {
    id: 'workspace-file-compact',
    fixture: 'workspace-file',
    theme: 'light',
    scale: 1,
    width: 760,
    height: 640,
  },
  {
    id: 'workspace-file-reference-tall',
    fixture: 'workspace-file',
    theme: 'dark',
    scale: 1,
    width: 735,
    height: 1014,
  },
]);

export function parsePhase3VisualArgs(argv) {
  const options = { outputDir: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--output-dir') {
      options.outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error('phase3.visual.unknown_argument:' + value);
  }
  return options;
}

export function validatePhase3VisualManifest(manifest, matrix = PHASE3_VISUAL_MATRIX) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 1) errors.push('manifest.schema_invalid');
  if (!Array.isArray(manifest?.captures)) errors.push('manifest.captures_missing');
  const captures = Array.isArray(manifest?.captures) ? manifest.captures : [];
  const expectedIds = new Set(matrix.map((item) => item.id));
  const actualIds = new Set();
  for (const capture of captures) {
    if (!capture || typeof capture !== 'object') {
      errors.push('capture.invalid');
      continue;
    }
    if (!expectedIds.has(capture.id)) errors.push('capture.id_unexpected:' + capture.id);
    if (actualIds.has(capture.id)) errors.push('capture.id_duplicate:' + capture.id);
    actualIds.add(capture.id);
    if (!Number.isInteger(capture.width) || capture.width < 640)
      errors.push('capture.width_invalid:' + capture.id);
    if (!Number.isInteger(capture.height) || capture.height < 560)
      errors.push('capture.height_invalid:' + capture.id);
    if (!Number.isInteger(capture.bytes) || capture.bytes < 10000)
      errors.push('capture.bytes_invalid:' + capture.id);
    if (!/^[a-f0-9]{64}$/.test(capture.sha256 ?? ''))
      errors.push('capture.sha256_invalid:' + capture.id);
    if (typeof capture.file !== 'string' || !capture.file.endsWith('.png'))
      errors.push('capture.file_invalid:' + capture.id);
  }
  for (const expected of expectedIds) {
    if (!actualIds.has(expected)) errors.push('capture.missing:' + expected);
  }
  if (captures.length !== matrix.length) errors.push('capture.count_invalid');
  return { ok: errors.length === 0, errors };
}

function electronExecutable(workspaceRoot) {
  const requireFromDesktop = createRequire(join(workspaceRoot, 'apps', 'desktop', 'package.json'));
  return requireFromDesktop('electron');
}

function assertOutputPath(workspaceRoot, outputDir) {
  const dataRoot = resolve(workspaceRoot, '.data');
  const relativePath = relative(dataRoot, outputDir);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('phase3.visual.output_must_be_inside_data');
  }
}

export async function capturePhase3VisualEvidence(options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT);
  const outputDir = resolve(
    options.outputDir ?? join(workspaceRoot, '.data', 'phase3-visual', 'current'),
  );
  assertOutputPath(workspaceRoot, outputDir);
  const htmlPath = join(workspaceRoot, 'apps', 'desktop', 'dist', 'renderer-shell', 'index.html');
  if (!existsSync(htmlPath)) throw new Error('phase3.visual.shell_build_missing:' + htmlPath);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const requestPath = join(outputDir, 'capture-request.json');
  const manifestPath = join(outputDir, 'manifest.json');
  await writeFile(
    requestPath,
    JSON.stringify(
      { schemaVersion: 1, htmlPath, outputDir, manifestPath, cases: PHASE3_VISUAL_MATRIX },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const electron = electronExecutable(workspaceRoot);
  const driver = join(workspaceRoot, 'scripts', 'phase3-visual-capture-electron.cjs');
  const child = spawnSync(electron, [driver, '--request', requestPath], {
    cwd: workspaceRoot,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (child.status !== 0) {
    throw new Error(
      'phase3.visual.capture_failed:code=' +
        String(child.status) +
        ':stdout=' +
        child.stdout +
        ':stderr=' +
        child.stderr,
    );
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const validation = validatePhase3VisualManifest(manifest);
  if (!validation.ok)
    throw new Error('phase3.visual.manifest_invalid:' + validation.errors.join(','));

  for (const capture of manifest.captures) {
    const bytes = await readFile(join(outputDir, capture.file));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== capture.sha256) throw new Error('phase3.visual.hash_mismatch:' + capture.id);
  }
  return { outputDir, manifestPath, manifest };
}

async function main() {
  const options = parsePhase3VisualArgs(process.argv.slice(2));
  const result = await capturePhase3VisualEvidence({ outputDir: options.outputDir });
  process.stdout.write(
    'PHASE3_VISUAL_MANIFEST=' +
      JSON.stringify({
        status: 'passed',
        outputDir: result.outputDir,
        manifestPath: result.manifestPath,
        captureCount: result.manifest.captures.length,
        ids: result.manifest.captures.map((capture) => capture.id),
      }) +
      '\n',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
    process.exitCode = 1;
  });
}
