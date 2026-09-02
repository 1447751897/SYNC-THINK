import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WINDOWS_ICON_SIZES,
  createWindowsBrandSvg,
  createWindowsIco,
  inspectWindowsIco,
  readPngDimensions,
  verifyWindowsBrandAssets,
} from './windows-brand-assets.mjs';

function pngHeader(size) {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(size, 16);
  buffer.writeUInt32BE(size, 20);
  return buffer;
}

test('brand SVG uses the approved continuum palette and stable infinity identity', () => {
  const svg = createWindowsBrandSvg();
  assert.match(svg, /SYNC-THINK continuum infinity mark/);
  assert.match(svg, /#FFFFFF/);
  // Transparent tile: no dark rounded <rect> background, no brand frame, no ST text.
  assert.doesNotMatch(svg, /fill="#141816"/);
  assert.ok(!(svg.match(/<rect/g) ?? []).length, 'svg must be transparent (no rect tile)');
  assert.doesNotMatch(svg, />ST<\/text>/);
});

test('ICO encoder preserves the complete Windows multi-resolution icon set', () => {
  const ico = createWindowsIco(WINDOWS_ICON_SIZES.map((size) => ({ size, png: pngHeader(size) })));
  const summary = inspectWindowsIco(ico);
  assert.equal(summary.count, WINDOWS_ICON_SIZES.length);
  assert.deepEqual(
    summary.entries.map((entry) => entry.size),
    WINDOWS_ICON_SIZES,
  );
});

test('PNG and ICO validators reject stale dimensions and malformed payloads', () => {
  assert.deepEqual(readPngDimensions(pngHeader(512)), { width: 512, height: 512 });
  assert.throws(() => readPngDimensions(Buffer.from('not-png')), /brand\.png_invalid/);
  assert.throws(
    () => createWindowsIco([{ size: 32, png: pngHeader(16) }]),
    /brand\.ico_png_size_mismatch/,
  );
  assert.throws(() => inspectWindowsIco(Buffer.from('not-ico')), /brand\.ico_invalid/);
});

test('committed Windows brand assets are current and reproducible', async () => {
  const result = await verifyWindowsBrandAssets();
  assert.equal(result.ok, true, result.errors.join(','));
  assert.match(result.sha256.png ?? '', /^[a-f0-9]{64}$/);
  assert.match(result.sha256.ico ?? '', /^[a-f0-9]{64}$/);
  const png = await readFile(result.paths.png);
  assert.deepEqual(readPngDimensions(png), { width: 512, height: 512 });
});
