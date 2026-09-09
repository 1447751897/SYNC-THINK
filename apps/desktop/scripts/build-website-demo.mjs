import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shell = path.join(desktopRoot, 'src/renderer/shell');
const require = createRequire(import.meta.url);

export async function buildWebsiteDemo(output) {
  const assets = path.join(output, 'assets');
  await mkdir(assets, { recursive: true });
  const result = await build({
    absWorkingDir: desktopRoot,
    entryPoints: { 'chat-app': path.join(shell, 'WebsiteChatDemo.tsx') },
    outdir: assets,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    splitting: true,
    chunkNames: 'chat-chunks/[name]-[hash]',
    target: 'chrome120',
    jsx: 'automatic',
    minify: true,
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'file' },
    legalComments: 'external',
    metafile: true,
    plugins: [
      {
        name: 'workspace-source-exports',
        setup(builder) {
          builder.onResolve(
            { filter: /^@sync-think\/(shared|protocol|ui-kit)(\/.*)?$/ },
            async ({ path: specifier }) => {
              const [, packageName, ...subpath] = specifier.split('/');
              const packageRoot = path.resolve(desktopRoot, '../../packages', packageName);
              const metadata = JSON.parse(
                await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
              );
              const exported = metadata.exports[subpath.length ? `./${subpath.join('/')}` : '.'];
              const target = typeof exported === 'string' ? exported : exported?.default;
              if (!target?.startsWith('./dist/') || !target.endsWith('.js'))
                throw new Error(`Unsupported browser source export: ${specifier}`);
              return {
                path: path.join(
                  packageRoot,
                  target.replace('./dist/', './src/').replace(/\.js$/, '.ts'),
                ),
              };
            },
          );
        },
      },
    ],
  });
  const inputs = Object.keys(result.metafile.inputs);
  if (
    inputs.some((input) =>
      /(?:Phase3VisualFixture|qa-entry|shell-entry|ShellApp|ChatView)\.tsx$/.test(input),
    )
  ) {
    throw new Error('Website demo must not bundle the desktop application or QA runtime');
  }
  const javascriptBytes = Object.entries(result.metafile.outputs)
    .filter(([name]) => name.endsWith('.js'))
    .reduce((total, [, item]) => total + item.bytes, 0);
  if (javascriptBytes > 3 * 1024 * 1024)
    throw new Error('Website ChatApp JS exceeds the 3 MiB budget');
  const cliPath = require.resolve('@tailwindcss/cli/package.json');
  const cli = require(cliPath);
  execFileSync(
    process.execPath,
    [
      path.join(path.dirname(cliPath), cli.bin?.tailwindcss ?? cli.bin),
      '-i',
      path.join(shell, 'shell.css'),
      '-o',
      path.join(assets, 'chat-shell.css'),
      '--cwd',
      shell,
      '--minify',
    ],
    { stdio: 'inherit' },
  );
  await cp(path.join(shell, 'assets/fonts/files'), path.join(assets, 'files'), { recursive: true });
  for (const license of [
    'LICENSE-inter.txt',
    'LICENSE-noto-sans-sc.txt',
    'LICENSE-noto-serif-sc.txt',
  ]) {
    await cp(path.join(shell, 'assets/fonts', license), path.join(assets, license));
  }
  await cp(path.join(shell, 'website-demo.css'), path.join(assets, 'chat-app.css'));
  await writeFile(
    path.join(output, 'demo-build-manifest.json'),
    JSON.stringify(
      {
        javascriptBytes,
        components: inputs
          .filter((input) => input.includes('renderer/shell/') && input.endsWith('.tsx'))
          .map((input) => path.basename(input))
          .sort(),
      },
      null,
      2,
    ),
  );
  const css = await readFile(path.join(assets, 'chat-shell.css'), 'utf8');
  if (!css.includes('.shell-composer-task-panel'))
    throw new Error('Desktop task panel CSS missing from demo');
  console.log(
    `Website ChatApp: shared desktop components, ${Math.round(javascriptBytes / 1024)} KiB JavaScript`,
  );
}
