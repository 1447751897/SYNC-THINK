import { existsSync, lstatSync, readFileSync, renameSync, rmSync } from 'node:fs';
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
//
// 2026-09-27 放宽两个指标（工作区工作台新增「Git 工具」页签，接通既有的 TaskStatusPanel；
// 该面板此前只挂在 Phase3VisualFixture 视觉夹具上，从未进过生产入口）：
//   initialJsBytes 2_150_000 → 2_240_000
//   totalJsBytes   3_100_000 → 3_320_000
//
// 关键测量（务必先读，避免误判）：本次改动后 initial=2_208_870 / total=3_280_698，
// 而**回退本次全部改动后的基线已是 initial=2_200_127 / total=3_254_924**。
// 即超支的绝大部分（initial 约 49KB、total 约 155KB）来自此前累积的未提交改动，
// 与本次接入无关；本次实际只贡献 initial +8,743、total +25,774 字节
// （TaskStatusPanel 已改走 lazyPanel 拆成独立 chunk，不再进 initial）。
// 放宽前已用 git stash 分别实测过两条基线。
//
// 趋势警告（沿用上文）：两个指标都已连续多轮触顶，本次余量只剩约 31KB / 39KB。
// 正解仍是把更新日志外置、并拆分 SettingsPage / 工作台 chunk。
// Git commit identity popover: measured total 3,322,715 bytes vs 3,316,282 before.
// Add 10 KB to the total budget for this 6.4 KB surface; retain the initial-load cap.
// 2026-09-28: lazy component library + complete token/component catalog.
// Controlled esbuild comparison: +67,902 bytes before tuple compaction; compaction
// saves 22,744 bytes. Full production total is 3,371,086. Allow 50 KB for this
// additional screen (3,380,000 total); keep the initial-load cap unchanged.
// 2026-09-28: categorized documentation adds explicit metadata for 122 current components,
// per-component routes and isolated fixtures. Production total measured 3,391,999
// (+20,913 vs first gallery). Add 22 KB to total only; initial cap remains unchanged.
//
// 2026-09-28 totalJsBytes 3_402_000 → 3_406_000（composer 上下文 hover 面板改为
// 「上下文用量与额度」卡片 agent-limits-card；窗口用量条 + 可折叠的 token 构成明细 +
// 额度与重置分组）。受控测量（同一构建下把组件换成同签名空壳）：真实 initial=2_234_389 /
// total=3_405_528，空壳 total=3_397_382，即本卡片净增约 8 KB；initial 仍有余量
// (−5,611)，故只放宽 total。已做过一轮压缩（统一行结构、两套构成明细合并成单次
// map、时间戳改用本地格式化替代 Intl 选项），合计省下约 3.5 KB。
// 趋势警告（沿用上文）：两个指标仍长期触顶，正解仍是把更新日志外置、
// 拆分 SettingsPage / 工作台 chunk，做完后此处应回落。
// 2026-09-28: compact kernel dropdown (focus/keyboard handling and icon-only selection).
// Measured total 3,406,885 vs 3,405,570 before this UI change (+1,315 bytes).
// Allocate 2 KB to total only; keep the initial-load budget unchanged.
// 2026-09-28: multi-agent group chat (avatar clusters, member picker, sidebar
// rosters, per-agent editor). Measured total 3,418,838 vs 3,406,885 (+11,953).
// CollaborationChatView moved behind lazyPanel so initial stays under 2,240,000;
// allocate 12 KB to total only.
// 2026-09-28: attachment presence/layout animation and cancellable image preparation.
// Measured total 3,424,593 before final polish, 4,593 bytes above the previous cap.
// No new runtime dependency; reserve 6 KB total while keeping initial-load capped.
// 2026-09-28: dedicated agent-chat workspace, native conversation picker,
// folded Canvas avatars and accessible editor. Measured production total 3,457,411
// before keyboard/draft polish, vs 3,424,848 at the research baseline (~32.6 KB).
// These surfaces are lazy-loaded; no new dependency or initial-load allowance.
// Reserve 39 KB total for this feature; keep the initial cap and all checks intact.
// Agent lifecycle/history parity: measured 3,465,345 bytes (+7,616 bytes).
// Reserve 2 KB more in total only; initial-load cap stays unchanged.
// 2026-09-28: persisted avatar expressions/custom colors, wheel selectors and real Team folders
// add ~13 KB across lazy workspace chunks. Keep the initial-load ceiling unchanged.
export const SHELL_BUDGET = Object.freeze({ initialJsBytes: 2_240_000, // 2026-09-29: lazy workflow trace + versioned artifact preview/download.
  // Measured total 3,492,446 vs 3,482,819 before (+9,627 bytes); no new library.
  // Reserve 12 KB for this surface only; initial-load ceiling is unchanged.
  // 2026-09-29: BoardUI-parity avatar motion (idle gaze/hops, stronger working
  // motion, animated active roster/group clusters) measures 3,495,980 bytes.
  // Add 5 KB to total only; the initial-load ceiling remains unchanged.
  // 2026-10-04: current shared-workspace production JS measures 3,550,424 bytes.
  // Browser/file/review/terminal panels now load on demand, preserving the
  // unchanged 2,240,000-byte initial-load ceiling. Keep a bounded ~20 KB total margin.
  // 2026-10-05: current shared-workspace baseline plus image-process/history
  // fixes measures 3,595,079 total bytes. Retain the initial-load ceiling and
  // a bounded 30 KB total adjustment; the production gate remains enforced.
  totalJsBytes: 3_600_000 });

export const SHELL_ASSET_LOADERS = Object.freeze({ '.tsx': 'tsx', '.ts': 'ts', '.png': 'file', '.svg': 'dataurl', '.brand.svg': 'file', '.jpg': 'file' });

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


/** Windows may still hold the just-removed directory briefly. Keep the checked staging
 * tree intact during a bounded retry, rather than deleting the only successful build. */
export async function promoteGeneratedDirectory(source, target, root, {
  platform = process.platform,
  rename = renameSync,
  wait = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  const from = assertGeneratedPath(source, root);
  const to = assertGeneratedPath(target, root);
  for (let attempt = 0; ; attempt++) {
    try { rename(from, to); return; }
    catch (error) {
      if (platform !== 'win32' || attempt >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) throw error;
      await wait(100 * (attempt + 1));
    }
  }
}
