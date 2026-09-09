import { spawn } from 'node:child_process';
import { mkdir, copyFile, cp, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(workspace, 'apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
const esbuild = require('esbuild');
const output = join(workspace, '.sync-think/qa/chat-embeds-' + new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const common = { absWorkingDir: desktop, bundle: true, target: 'chrome120', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [join(desktop, 'node_modules')], logLevel: 'warning' };
await esbuild.build({ ...common, entryPoints: [join(workspace, 'scripts/fixtures/chat-embeds-entry.tsx')], outfile: join(output, 'fixture.js'), platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.svg': 'dataurl', '.png': 'dataurl' } });
await esbuild.build({ ...common, entryPoints: [join(desktop, 'src/renderer/shell/mermaid-vendor.ts')], outfile: join(output, 'mermaid-vendor.js'), platform: 'browser', format: 'iife' });
await esbuild.build({ ...common, entryPoints: [join(desktop, 'src/preload/visualization.ts')], outfile: join(output, 'visualization.cjs'), platform: 'node', format: 'cjs', external: ['electron'] });
const tailwindPackage = require('@tailwindcss/cli/package.json');
const tailwindCli = join(dirname(require.resolve('@tailwindcss/cli/package.json')), tailwindPackage.bin.tailwindcss);
async function run(binary, args, options = {}) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(binary, args, { cwd: workspace, stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error('child_exit=' + code)));
  });
}
await run(process.execPath, [tailwindCli, '-i', join(desktop, 'src/renderer/shell/shell.css'), '-o', join(output, 'shell.css'), '--cwd', join(desktop, 'src/renderer/shell'), '--minify']);
await cp(join(desktop, 'src/renderer/shell/assets/fonts/files'), join(output, 'files'), { recursive: true });
await copyFile(join(workspace, 'scripts/fixtures/chat-embeds-electron.cjs'), join(output, 'driver.cjs'));
await writeFile(join(output, 'index.html'), (await readFile(join(desktop, 'src/renderer/shell/index.html'), 'utf8')).replace('./shell.js', './fixture.js'));
console.log('CHAT_EMBEDS_OUTPUT=' + output);
const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
delete environment.ELECTRON_RUN_AS_NODE;
await run(require('electron'), [join(output, 'driver.cjs'), '--output', output, ...(process.argv.includes('--baseline') ? ['--baseline'] : [])], { env: environment });
