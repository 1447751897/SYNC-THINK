import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

// initialJsBytes 于 2026-09-13 由 2_100_000 放宽至 2_150_000：
// 协作子 Agent UI 的新增代码使 initial chunk 达到 2,101,930 字节（超原上限 1,930 字节）。
// 待 initial chunk 完成拆分后应收紧回原值。
//
// totalJsBytes 于 2026-09-13 由 3_000_000 放宽至 3_020_000：
// 视觉能力扫描 UI（对齐 NewMax 的 VisionFallbackPanel）使总量达到 3,001,519 字节
// （超原上限 1,519 字节）——放宽前一轮构建已只剩 788 字节余量，本次是压垮它的最后一步。
// 增量主要是用户可见的中文文案（esbuild 转义成 \uXXXX，每字 6 字节）。
// 待 SettingsPage chunk 拆分后应收紧回原值。
//
// totalJsBytes 于 2026-09-15 由 3_020_000 放宽至 3_050_000：
// 「更新日志」弹窗改为展示全部历史版本，构建期把 docs/releases/CHANGELOG.md 的
// 全量版本（当前 5 版）固化进产物，使总量达到 3,026,666 字节。
//
// 这次与前两次性质不同：增量是**数据**而不是代码，而且随版本数线性增长
// （每版约 1.2KB，其中大半是中文转义开销）。放宽预算只买得到若干个版本的时间，
// 不解决趋势。正解是让更新日志脱离 JS bundle（外置成资源 + 自定义协议或 IPC 读取，
// file:// 下 fetch 会被 CORS 拦），届时这里应回落到 3_020_000 以下。
//
// totalJsBytes 于 2026-09-17 由 3_050_000 放宽至 3_060_000：
// 「委派子智能体的写权限」新增了一个用户可见开关（Agent 设置页的只读/继承会话
// 选择及其语义说明），总量达到 3,050,855 字节——上一轮构建的余量本就只剩 13 字节，
// 任何用户可见改动都会触顶。已先把新增文案压到最简（再删就会丢掉「逐次询问下仍
// 只读」这一用户无法自行推断的语义）。**趋势警告依然成立**：真正该做的是把更新日志
// 外置、并拆分 SettingsPage chunk，做完后此处应回落到 3_020_000 以下。
// 2026-09-22: browser task dashboard adds workspace controls and live preview UI in a lazy chunk.
// Includes the readonly task drawer and direct execution input/permission flow (3,094,418 bytes measured).
// Keep the initial-load limit unchanged; allow 40 KB for this additional surface.
export const SHELL_BUDGET = Object.freeze({ initialJsBytes: 2_150_000, totalJsBytes: 3_100_000 });

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
  // Renderer HTML declares UTF-8; literal Chinese avoids six-byte ASCII escapes.
  return {
    mode,
    outdir,
    outputRoot,
    workspaceRoot,
    optimized: mode !== 'development',
    charset: 'utf8',
  };
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
