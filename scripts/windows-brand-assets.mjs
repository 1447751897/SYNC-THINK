import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
export const DEFAULT_WORKSPACE_ROOT = resolve(SCRIPT_DIR, '..');
export const DEFAULT_WINDOWS_BRAND_DIR = join(
  DEFAULT_WORKSPACE_ROOT,
  'apps',
  'desktop',
  'build',
);
export const WINDOWS_ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function createWindowsBrandSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">SYNC-THINK</title>
  <desc id="desc">SYNC-THINK continuum ST monogram</desc>
  <rect width="512" height="512" rx="112" fill="#141816"/>
  <rect x="42" y="42" width="428" height="428" rx="84" fill="none" stroke="#29b982" stroke-width="12"/>
  <path d="M144 128 C260 128 252 384 368 384" fill="none" stroke="#29b982" stroke-width="18" stroke-linecap="round" opacity="0.72"/>
  <circle cx="124" cy="128" r="22" fill="#29b982"/>
  <circle cx="388" cy="384" r="22" fill="#29b982"/>
  <text x="256" y="305" text-anchor="middle" font-family="Segoe UI Variable Display, Segoe UI, Arial, sans-serif" font-size="176" font-weight="750" letter-spacing="-10" fill="#edf1ed">ST</text>
</svg>
`;
}

export function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('brand.png_invalid');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export function createWindowsIco(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('brand.ico_entries_missing');
  const normalized = entries.map(({ size, png }) => {
    const dimensions = readPngDimensions(png);
    if (dimensions.width !== size || dimensions.height !== size) {
      throw new Error('brand.ico_png_size_mismatch');
    }
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error('brand.ico_size_invalid');
    return { size, png };
  });
  const headerSize = 6 + normalized.length * 16;
  const output = Buffer.alloc(headerSize + normalized.reduce((sum, entry) => sum + entry.png.length, 0));
  output.writeUInt16LE(0, 0);
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(normalized.length, 4);
  let offset = headerSize;
  normalized.forEach((entry, index) => {
    const entryOffset = 6 + index * 16;
    output.writeUInt8(entry.size === 256 ? 0 : entry.size, entryOffset);
    output.writeUInt8(entry.size === 256 ? 0 : entry.size, entryOffset + 1);
    output.writeUInt8(0, entryOffset + 2);
    output.writeUInt8(0, entryOffset + 3);
    output.writeUInt16LE(1, entryOffset + 4);
    output.writeUInt16LE(32, entryOffset + 6);
    output.writeUInt32LE(entry.png.length, entryOffset + 8);
    output.writeUInt32LE(offset, entryOffset + 12);
    entry.png.copy(output, offset);
    offset += entry.png.length;
  });
  return output;
}

export function inspectWindowsIco(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('brand.ico_invalid');
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error('brand.ico_invalid');
  }
  const count = buffer.readUInt16LE(4);
  if (count < 1 || buffer.length < 6 + count * 16) throw new Error('brand.ico_invalid');
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = buffer.readUInt8(entryOffset) || 256;
    const height = buffer.readUInt8(entryOffset + 1) || 256;
    const bytes = buffer.readUInt32LE(entryOffset + 8);
    const offset = buffer.readUInt32LE(entryOffset + 12);
    if (width !== height || bytes < 24 || offset < 6 + count * 16 || offset + bytes > buffer.length) {
      throw new Error('brand.ico_invalid');
    }
    const png = buffer.subarray(offset, offset + bytes);
    const dimensions = readPngDimensions(png);
    if (dimensions.width !== width || dimensions.height !== height) throw new Error('brand.ico_invalid');
    entries.push({ size: width, bytes, offset });
  }
  return { count, entries };
}

export async function verifyWindowsBrandAssets(outputDir = DEFAULT_WINDOWS_BRAND_DIR) {
  const paths = {
    svg: join(outputDir, 'icon.svg'),
    png: join(outputDir, 'icon.png'),
    ico: join(outputDir, 'icon.ico'),
  };
  const errors = [];
  let png;
  let ico;
  try {
    const svg = await readFile(paths.svg, 'utf8');
    if (svg !== createWindowsBrandSvg()) errors.push('brand.svg_stale');
  } catch {
    errors.push('brand.svg_missing');
  }
  try {
    png = await readFile(paths.png);
    const dimensions = readPngDimensions(png);
    if (dimensions.width !== 512 || dimensions.height !== 512) errors.push('brand.png_size_invalid');
  } catch {
    errors.push('brand.png_invalid');
  }
  try {
    ico = await readFile(paths.ico);
    const summary = inspectWindowsIco(ico);
    const sizes = summary.entries.map((entry) => entry.size);
    if (JSON.stringify(sizes) !== JSON.stringify(WINDOWS_ICON_SIZES)) {
      errors.push('brand.ico_sizes_invalid');
    }
  } catch {
    errors.push('brand.ico_invalid');
  }
  return {
    ok: errors.length === 0,
    errors,
    paths,
    sha256: {
      png: png ? createHash('sha256').update(png).digest('hex') : null,
      ico: ico ? createHash('sha256').update(ico).digest('hex') : null,
    },
  };
}

function electronExecutable(workspaceRoot) {
  const requireFromDesktop = createRequire(join(workspaceRoot, 'apps', 'desktop', 'package.json'));
  return requireFromDesktop('electron');
}

async function renderPngSet(outputDir) {
  const { app, BrowserWindow } = await import('electron');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  await app.whenReady();
  const svg = await readFile(join(outputDir, 'icon.svg'), 'utf8');
  const window = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    useContentSize: true,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  const document = `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;width:512px;height:512px;overflow:hidden;background:transparent}img{display:block;width:512px;height:512px}</style><img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(document));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
  const captured = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  for (const size of [...WINDOWS_ICON_SIZES, 512]) {
    const png = captured.resize({ width: size, height: size, quality: 'best' }).toPNG();
    await writeFile(join(outputDir, `.icon-${size}.png`), png);
  }
  window.destroy();
  app.exit(0);
}

export async function generateWindowsBrandAssets(options = {}) {
  if (process.platform !== 'win32') throw new Error('brand.windows_only');
  const workspaceRoot = resolve(options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT);
  const outputDir = resolve(options.outputDir ?? join(workspaceRoot, 'apps', 'desktop', 'build'));
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'icon.svg'), createWindowsBrandSvg(), 'utf8');
  const electron = electronExecutable(workspaceRoot);
  const child = spawnSync(electron, [SCRIPT_PATH, 'render', outputDir], {
    cwd: workspaceRoot,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (child.status !== 0) {
    throw new Error(
      `brand.render_failed:code=${String(child.status)}:stdout=${child.stdout}:stderr=${child.stderr}`,
    );
  }
  const entries = [];
  for (const size of WINDOWS_ICON_SIZES) {
    entries.push({ size, png: await readFile(join(outputDir, `.icon-${size}.png`)) });
  }
  await writeFile(join(outputDir, 'icon.ico'), createWindowsIco(entries));
  await writeFile(join(outputDir, 'icon.png'), await readFile(join(outputDir, '.icon-512.png')));
  for (const size of [...WINDOWS_ICON_SIZES, 512]) {
    await rm(join(outputDir, `.icon-${size}.png`), { force: true });
  }
  const result = await verifyWindowsBrandAssets(outputDir);
  if (!result.ok) throw new Error('brand.assets_invalid:' + result.errors.join(','));
  return result;
}

async function main() {
  const command = process.argv[2] ?? 'generate';
  if (command === 'render' && process.versions.electron) {
    await renderPngSet(resolve(process.argv[3] ?? DEFAULT_WINDOWS_BRAND_DIR));
    return;
  }
  if (command === 'generate') {
    const result = await generateWindowsBrandAssets();
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'verify') {
    const result = await verifyWindowsBrandAssets();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  throw new Error('brand.command_invalid');
}

const isDirectExecution = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
