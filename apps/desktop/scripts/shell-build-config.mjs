import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

export const SHELL_BUDGET = Object.freeze({ initialJsBytes: 2_100_000, totalJsBytes: 3_000_000 });

export function shellBuildOptions(args, desktopRoot) {
  let mode = 'production';
  let output;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || (option !== '--mode' && option !== '--outdir')) {
      throw new Error('shell.build.invalid_arguments');
    }
    if (option === '--mode') mode = value;
    else output = value;
  }
  if (!['production', 'development', 'qa'].includes(mode))
    throw new Error('shell.build.invalid_mode');
  const workspaceRoot = resolve(desktopRoot, '../..');
  const scratchRoot = resolve(workspaceRoot, '.data/renderer-builds');
  const outputRoot = output || mode !== 'production' ? scratchRoot : resolve(desktopRoot, 'dist');
  const outdir = output
    ? resolve(workspaceRoot, output)
    : mode === 'production'
      ? resolve(outputRoot, 'renderer-shell')
      : resolve(outputRoot, mode);
  assertGeneratedPath(outdir, outputRoot);
  return { mode, outdir, outputRoot, workspaceRoot, optimized: mode !== 'development' };
}

export function assertGeneratedPath(target, root) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const child = relative(resolvedRoot, resolvedTarget);
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('shell.build.output_outside_generated_directory');
  }
  let current = resolvedRoot;
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error('shell.build.output_symlink');
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  current = resolvedRoot;
  for (const part of child.split(sep)) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error('shell.build.output_symlink');
    }
  }
  return resolvedTarget;
}

export function removeGeneratedDirectory(target, root) {
  const checked = assertGeneratedPath(target, root);
  if (existsSync(checked) && !lstatSync(checked).isDirectory()) {
    throw new Error('shell.build.output_not_directory');
  }
  rmSync(checked, { recursive: true, force: true, maxRetries: 3 });
}

export function summarizeShellBuild(metafile, workingDirectory, outdir) {
  const outputs = new Map(
    Object.entries(metafile.outputs).map(([file, detail]) => [
      resolve(workingDirectory, file),
      detail,
    ]),
  );
  const initial = new Set();
  const visit = (file) => {
    if (initial.has(file)) return;
    const detail = outputs.get(file);
    if (!detail) throw new Error('shell.build.missing_chunk:' + file);
    initial.add(file);
    for (const dependency of detail.imports) {
      if (!dependency.external && dependency.kind !== 'dynamic-import') {
        visit(resolve(workingDirectory, dependency.path));
      }
    }
  };
  visit(resolve(outdir, 'shell.js'));
  const files = [...outputs]
    .filter(([file]) => file.endsWith('.js'))
    .map(([file, detail]) => ({
      path: relative(outdir, file).replaceAll('\\', '/'),
      bytes: detail.bytes,
      gzipBytes: gzipSync(readFileSync(file)).byteLength,
      initial: initial.has(file),
      entryPoint: detail.entryPoint,
      imports: detail.imports
        .filter((item) => !item.external)
        .map((item) => ({
          path: relative(outdir, resolve(workingDirectory, item.path)).replaceAll('\\', '/'),
          dynamic: item.kind === 'dynamic-import',
        })),
    }));
  return {
    initialJsBytes: files
      .filter((file) => file.initial)
      .reduce((total, file) => total + file.bytes, 0),
    initialGzipBytes: files
      .filter((file) => file.initial)
      .reduce((total, file) => total + file.gzipBytes, 0),
    totalJsBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
    inputs: Object.keys(metafile.inputs),
  };
}

export function assertShellBudget(summary) {
  for (const [metric, maximum] of Object.entries(SHELL_BUDGET)) {
    if (!Number.isFinite(summary[metric]) || summary[metric] > maximum) {
      throw new Error(`shell.build.budget_exceeded:${metric}:${summary[metric]}/${maximum}`);
    }
  }
}

export function assertProductionShellBuild(outdir) {
  const manifest = JSON.parse(readFileSync(resolve(outdir, 'build-manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.mode !== 'production') {
    throw new Error('shell.build.production_required');
  }
  assertShellBudget(manifest.shell);
  return manifest;
}
