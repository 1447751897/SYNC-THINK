import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  cpSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import {
  SHELL_BUDGET,
  assertGeneratedPath,
  assertShellBudget,
  removeGeneratedDirectory,
  shellBuildOptions,
  summarizeShellBuild,
} from './shell-build-config.mjs';
import {
  CHANGELOG_DEFAULT_PATH,
  parseChangelog,
  renderChangelogReleaseNotes,
} from '../../../scripts/changelog.mjs';

const require = createRequire(import.meta.url);
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const shellSrc = join(desktopRoot, 'src/renderer/shell');
const options = shellBuildOptions(process.argv.slice(2), desktopRoot);
const { mode, optimized, outdir, outputRoot } = options;
mkdirSync(dirname(outdir), { recursive: true });
const staging = mkdtempSync(outdir + '.build-');

/**
 * 全部历史版本的更新日志，随 shell 产物一起固化。
 *
 * 更新源只在「有可安装版本」时携带 releaseNotes，而且只带当前发布的那一版，
 * 所以光靠更新源，用户永远只看得到「即将升到的那版」或「刚装上的那版」。
 * docs/releases/CHANGELOG.md 本来就是这份文案的唯一事实来源，构建期把它整个
 * 解析一遍随包带走，弹窗在任何阶段（已是最新 / 待更新 / 通道未配置）都能翻历史。
 *
 * 顺序沿用 CHANGELOG 自身的倒序（新 → 旧）。单版渲染失败只跳过该版并告警：
 * 日志取不全不该让整个构建失败，最坏情况是弹窗少一个版本。
 */
function resolveReleaseHistory() {
  let markdown;
  try {
    markdown = readFileSync(join(desktopRoot, '..', '..', CHANGELOG_DEFAULT_PATH), 'utf8');
  } catch (error) {
    console.warn(`[build-shell] 更新日志不可用：${error.message}`);
    return [];
  }
  let entries;
  try {
    ({ entries } = parseChangelog(markdown));
  } catch (error) {
    console.warn(`[build-shell] 更新日志解析失败：${error.message}`);
    return [];
  }
  const history = [];
  for (const entry of entries) {
    try {
      history.push({
        version: entry.version,
        date: entry.date,
        notes: renderChangelogReleaseNotes(entry),
      });
    } catch (error) {
      console.warn(`[build-shell] 跳过 ${entry.version} 的更新日志：${error.message}`);
    }
  }
  console.log(`[build-shell] 更新日志已固化 ${history.length} 个版本`);
  return history;
}
const releaseHistory = resolveReleaseHistory();

try {
  const shared = {
    absWorkingDir: desktopRoot,
    bundle: true,
    platform: 'browser',
    minify: optimized,
    charset: options.charset,
    sourcemap: !optimized,
    target: 'chrome120',
    define: {
      'process.env.NODE_ENV': JSON.stringify(optimized ? 'production' : 'development'),
      // 双 stringify：内层得到 JSON 文本，外层把它变成产物里合法的字符串字面量，
      // 于是运行时的 __SYNC_THINK_RELEASE_HISTORY__ 是一个 JSON 字符串，
      // 渲染层 JSON.parse 之后再逐项校验（typeof 守卫兜住测试环境没有注入的情况）。
      __SYNC_THINK_RELEASE_HISTORY__: JSON.stringify(JSON.stringify(releaseHistory)),
    },
    legalComments: 'external',
  };
  const shell = await esbuild.build({
    ...shared,
    entryPoints: { shell: join(shellSrc, mode === 'qa' ? 'qa-entry.tsx' : 'shell-entry.tsx') },
    outdir: staging,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    metafile: true,
    jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'file' },
    assetNames: 'assets/[name]-[hash]',
  });
  const summary = summarizeShellBuild(shell.metafile, desktopRoot, staging);
  const chunkMap = Object.fromEntries(
    summary.files
      .filter((file) => file.entryPoint && !file.initial)
      .map((file) => [basename(file.entryPoint, '.tsx'), './' + file.path]),
  );
  const chunkBootstrap = `window.__syncThinkShellChunks=Object.freeze(${JSON.stringify(chunkMap)});\n`;
  writeFileSync(join(staging, 'shell-chunks.js'), chunkBootstrap);
  const bootstrapBytes = Buffer.byteLength(chunkBootstrap);
  const bootstrapGzipBytes = gzipSync(chunkBootstrap).byteLength;
  summary.files.push({
    path: 'shell-chunks.js',
    bytes: bootstrapBytes,
    gzipBytes: bootstrapGzipBytes,
    initial: true,
    imports: [],
  });
  summary.initialJsBytes += bootstrapBytes;
  summary.initialGzipBytes += bootstrapGzipBytes;
  summary.totalJsBytes += bootstrapBytes;
  if (mode === 'production') {
    if (summary.inputs.some((input) => /(?:^|[\\/])agentation(?:@[^\\/]+)?[\\/]/i.test(input))) {
      throw new Error('shell.build.forbidden_production_input:agentation');
    }
    assertShellBudget(summary);
    if (
      summary.inputs.some((input) =>
        /(?:Phase3VisualFixture|qa-entry|highlight\.js\/lib\/index)\./.test(input),
      )
    ) {
      throw new Error('shell.build.forbidden_production_input');
    }
  }

  for (const [entry, outfile] of [
    ['xterm-vendor.ts', 'xterm-vendor.js'],
    ['mermaid-vendor.ts', 'mermaid-vendor.js'],
    ['excalidraw-vendor.tsx', 'excalidraw-vendor.js'],
  ]) {
    await esbuild.build({
      ...shared,
      entryPoints: [join(shellSrc, entry)],
      outfile: join(staging, outfile),
      format: 'iife',
      conditions: ['production'],
      jsx: 'automatic',
      loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
    });
  }

  const excalidrawEntry = require.resolve('@excalidraw/excalidraw');
  copyFileSync(join(dirname(excalidrawEntry), 'index.css'), join(staging, 'excalidraw-vendor.css'));
  const cliPkgJson = require.resolve('@tailwindcss/cli/package.json');
  const cliPkg = require(cliPkgJson);
  const tailwindCli = join(dirname(cliPkgJson), cliPkg.bin?.tailwindcss ?? cliPkg.bin);
  execFileSync(
    process.execPath,
    [
      tailwindCli,
      '-i',
      join(shellSrc, 'shell.css'),
      '-o',
      join(staging, 'shell.css'),
      '--cwd',
      shellSrc,
      ...(optimized ? ['--minify'] : []),
    ],
    { stdio: 'inherit' },
  );
  copyFileSync(join(shellSrc, 'index.html'), join(staging, 'index.html'));
  cpSync(join(shellSrc, 'assets/fonts/files'), join(staging, 'files'), { recursive: true });
  writeFileSync(
    join(staging, 'build-manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        mode,
        shell: summary,
        budget: SHELL_BUDGET,
      },
      null,
      2,
    ) + '\n',
  );
  assertGeneratedPath(staging, outputRoot);
  removeGeneratedDirectory(outdir, outputRoot);
  renameSync(staging, outdir);
  console.log(
    `[desktop] ${mode} shell built at ${outdir}; initial JS ${summary.initialJsBytes} bytes, total JS ${summary.totalJsBytes} bytes`,
  );
} finally {
  removeGeneratedDirectory(staging, outputRoot);
}
