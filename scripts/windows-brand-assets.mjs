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
  // Neutral infinity mark: dark rounded tile + brand-green frame + neutral ∞.
  // The infinity path is reused from docs/design-explorations/logo-infinity-b-neutral.svg
  // (rendered on the dark tile so the neutral tone stays visible in the taskbar/dock).
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">SYNC-THINK</title>
  <desc id="desc">SYNC-THINK continuum infinity mark</desc>
  <path d="M 461.00 256.00 C 461.00 257.79 460.93 259.58 460.79 261.36 C 460.65 263.14 460.44 264.92 460.16 266.68 C 459.88 268.45 459.53 270.20 459.12 271.94 C 458.70 273.67 458.22 275.39 457.67 277.08 C 457.13 278.77 456.51 280.45 455.84 282.08 C 455.17 283.72 454.43 285.34 453.64 286.92 C 452.85 288.50 451.99 290.04 451.09 291.55 C 450.18 293.06 449.22 294.53 448.21 295.96 C 447.20 297.39 446.14 298.78 445.03 300.13 C 443.93 301.47 442.77 302.78 441.58 304.03 C 440.39 305.29 439.15 306.50 437.89 307.66 C 436.62 308.82 435.31 309.93 433.97 311.00 C 432.64 312.06 431.26 313.07 429.87 314.04 C 428.47 315.00 427.05 315.92 425.60 316.78 C 424.16 317.64 422.69 318.46 421.20 319.22 C 419.72 319.98 418.21 320.70 416.69 321.36 C 415.18 322.02 413.64 322.64 412.10 323.20 C 410.56 323.77 409.00 324.28 407.44 324.75 C 405.88 325.22 404.32 325.64 402.75 326.02 C 401.18 326.40 399.60 326.73 398.03 327.01 C 396.45 327.30 394.88 327.54 393.31 327.74 C 391.73 327.94 390.16 328.10 388.60 328.22 C 387.03 328.33 385.47 328.41 383.91 328.45 C 382.35 328.49 380.80 328.49 379.26 328.45 C 377.72 328.42 376.19 328.34 374.66 328.24 C 373.14 328.13 371.62 327.99 370.12 327.82 C 368.61 327.65 367.12 327.44 365.64 327.21 C 364.16 326.97 362.69 326.70 361.23 326.41 C 359.77 326.12 358.33 325.80 356.89 325.45 C 355.46 325.10 354.04 324.73 352.64 324.33 C 351.23 323.94 349.84 323.51 348.46 323.07 C 347.08 322.63 345.72 322.16 344.37 321.67 C 343.02 321.18 341.68 320.67 340.36 320.15 C 339.04 319.62 337.73 319.07 336.43 318.51 C 335.14 317.94 333.86 317.36 332.59 316.76 C 331.32 316.16 330.07 315.55 328.83 314.92 C 327.59 314.29 326.36 313.65 325.15 312.99 C 323.94 312.33 322.73 311.66 321.55 310.97 C 320.36 310.29 319.18 309.59 318.02 308.88 C 316.86 308.17 315.71 307.45 314.57 306.72 C 313.43 305.99 312.31 305.25 311.19 304.50 C 310.08 303.75 308.97 302.99 307.88 302.23 C 306.79 301.46 305.71 300.68 304.63 299.90 C 303.56 299.11 302.50 298.32 301.45 297.52 C 300.40 296.72 299.36 295.91 298.32 295.10 C 297.29 294.29 296.27 293.47 295.25 292.65 C 294.24 291.82 293.23 290.99 292.23 290.16 C 291.24 289.32 290.25 288.48 289.26 287.63 C 288.28 286.79 287.30 285.94 286.34 285.09 C 285.37 284.23 284.40 283.37 283.45 282.51 C 282.49 281.65 281.54 280.79 280.60 279.92 C 279.65 279.05 278.72 278.18 277.78 277.31 C 276.85 276.43 275.92 275.56 274.99 274.68 C 274.07 273.80 273.15 272.92 272.23 272.03 C 271.32 271.15 270.40 270.26 269.49 269.38 C 268.58 268.49 267.68 267.60 266.77 266.71 C 265.87 265.82 264.97 264.93 264.07 264.04 C 263.17 263.15 262.27 262.26 261.37 261.36 C 260.47 260.47 259.58 259.58 258.68 258.68 C 257.79 257.79 256.89 256.89 256.00 256.00 C 255.11 255.11 254.21 254.21 253.32 253.32 C 252.42 252.42 251.53 251.53 250.63 250.64 C 249.73 249.74 248.83 248.85 247.93 247.96 C 247.03 247.07 246.13 246.18 245.23 245.29 C 244.32 244.40 243.42 243.51 242.51 242.62 C 241.60 241.74 240.68 240.85 239.77 239.97 C 238.85 239.08 237.93 238.20 237.01 237.32 C 236.08 236.44 235.15 235.57 234.22 234.69 C 233.28 233.82 232.35 232.95 231.40 232.08 C 230.46 231.21 229.51 230.35 228.55 229.49 C 227.60 228.63 226.63 227.77 225.66 226.91 C 224.70 226.06 223.72 225.21 222.74 224.37 C 221.75 223.52 220.76 222.68 219.77 221.84 C 218.77 221.01 217.76 220.18 216.75 219.35 C 215.73 218.53 214.71 217.71 213.68 216.90 C 212.64 216.09 211.60 215.28 210.55 214.48 C 209.50 213.68 208.44 212.89 207.37 212.10 C 206.29 211.32 205.21 210.54 204.12 209.77 C 203.03 209.01 201.92 208.25 200.81 207.50 C 199.69 206.75 198.57 206.01 197.43 205.28 C 196.29 204.55 195.14 203.83 193.98 203.12 C 192.82 202.41 191.64 201.71 190.45 201.03 C 189.27 200.34 188.06 199.67 186.85 199.01 C 185.64 198.35 184.41 197.71 183.17 197.08 C 181.93 196.45 180.68 195.84 179.41 195.24 C 178.14 194.64 176.86 194.06 175.57 193.49 C 174.27 192.93 172.96 192.38 171.64 191.85 C 170.32 191.33 168.98 190.82 167.63 190.33 C 166.28 189.84 164.92 189.37 163.54 188.93 C 162.16 188.49 160.77 188.06 159.36 187.67 C 157.96 187.27 156.54 186.90 155.11 186.55 C 153.67 186.20 152.23 185.88 150.77 185.59 C 149.31 185.30 147.84 185.03 146.36 184.79 C 144.88 184.56 143.39 184.35 141.88 184.18 C 140.38 184.01 138.86 183.87 137.34 183.76 C 135.81 183.66 134.28 183.58 132.74 183.55 C 131.20 183.51 129.65 183.51 128.09 183.55 C 126.53 183.59 124.97 183.67 123.40 183.78 C 121.84 183.90 120.27 184.06 118.69 184.26 C 117.12 184.46 115.55 184.70 113.97 184.99 C 112.40 185.27 110.82 185.60 109.25 185.98 C 107.68 186.36 106.12 186.78 104.56 187.25 C 103.00 187.72 101.44 188.23 99.90 188.80 C 98.36 189.36 96.82 189.98 95.31 190.64 C 93.79 191.30 92.28 192.02 90.80 192.78 C 89.31 193.54 87.84 194.36 86.40 195.22 C 84.95 196.08 83.53 197.00 82.13 197.96 C 80.74 198.93 79.36 199.94 78.03 201.00 C 76.69 202.07 75.38 203.18 74.11 204.34 C 72.85 205.50 71.61 206.71 70.42 207.97 C 69.23 209.22 68.07 210.53 66.97 211.87 C 65.86 213.22 64.80 214.61 63.79 216.04 C 62.78 217.47 61.82 218.94 60.91 220.45 C 60.01 221.96 59.15 223.50 58.36 225.08 C 57.57 226.66 56.83 228.28 56.16 229.92 C 55.49 231.55 54.87 233.23 54.33 234.92 C 53.78 236.61 53.30 238.33 52.88 240.06 C 52.47 241.80 52.12 243.55 51.84 245.32 C 51.56 247.08 51.35 248.86 51.21 250.64 C 51.07 252.42 51.00 254.21 51.00 256.00 C 51.00 257.79 51.07 259.58 51.21 261.36 C 51.35 263.14 51.56 264.92 51.84 266.68 C 52.12 268.45 52.47 270.20 52.88 271.94 C 53.30 273.67 53.78 275.39 54.33 277.08 C 54.87 278.77 55.49 280.45 56.16 282.08 C 56.83 283.72 57.57 285.34 58.36 286.92 C 59.15 288.50 60.01 290.04 60.91 291.55 C 61.82 293.06 62.78 294.53 63.79 295.96 C 64.80 297.39 65.86 298.78 66.97 300.13 C 68.07 301.47 69.23 302.78 70.42 304.03 C 71.61 305.29 72.85 306.50 74.11 307.66 C 75.38 308.82 76.69 309.93 78.03 311.00 C 79.36 312.06 80.74 313.07 82.13 314.04 C 83.53 315.00 84.95 315.92 86.40 316.78 C 87.84 317.64 89.31 318.46 90.80 319.22 C 92.28 319.98 93.79 320.70 95.31 321.36 C 96.82 322.02 98.36 322.64 99.90 323.20 C 101.44 323.77 103.00 324.28 104.56 324.75 C 106.12 325.22 107.68 325.64 109.25 326.02 C 110.82 326.40 112.40 326.73 113.97 327.01 C 115.55 327.30 117.12 327.54 118.69 327.74 C 120.27 327.94 121.84 328.10 123.40 328.22 C 124.97 328.33 126.53 328.41 128.09 328.45 C 129.65 328.49 131.20 328.49 132.74 328.45 C 134.28 328.42 135.81 328.34 137.34 328.24 C 138.86 328.13 140.38 327.99 141.88 327.82 C 143.39 327.65 144.88 327.44 146.36 327.21 C 147.84 326.97 149.31 326.70 150.77 326.41 C 152.23 326.12 153.67 325.80 155.11 325.45 C 156.54 325.10 157.96 324.73 159.36 324.33 C 160.77 323.94 162.16 323.51 163.54 323.07 C 164.92 322.63 166.28 322.16 167.63 321.67 C 168.98 321.18 170.32 320.67 171.64 320.15 C 172.96 319.62 174.27 319.07 175.57 318.51 C 176.86 317.94 178.14 317.36 179.41 316.76 C 180.68 316.16 181.93 315.55 183.17 314.92 C 184.41 314.29 185.64 313.65 186.85 312.99 C 188.06 312.33 189.27 311.66 190.45 310.97 C 191.64 310.29 192.82 309.59 193.98 308.88 C 195.14 308.17 196.29 307.45 197.43 306.72 C 198.57 305.99 199.69 305.25 200.81 304.50 C 201.92 303.75 203.03 302.99 204.12 302.23 C 205.21 301.46 206.29 300.68 207.37 299.90 C 208.44 299.11 209.50 298.32 210.55 297.52 C 211.60 296.72 212.64 295.91 213.68 295.10 C 214.71 294.29 215.73 293.47 216.75 292.65 C 217.76 291.82 218.77 290.99 219.77 290.16 C 220.76 289.32 221.75 288.48 222.74 287.63 C 223.72 286.79 224.70 285.94 225.66 285.09 C 226.63 284.23 227.60 283.37 228.55 282.51 C 229.51 281.65 230.46 280.79 231.40 279.92 C 232.35 279.05 233.28 278.18 234.22 277.31 C 235.15 276.43 236.08 275.56 237.01 274.68 C 237.93 273.80 238.85 272.92 239.77 272.03 C 240.68 271.15 241.60 270.26 242.51 269.38 C 243.42 268.49 244.32 267.60 245.23 266.71 C 246.13 265.82 247.03 264.93 247.93 264.04 C 248.83 263.15 249.73 262.26 250.63 261.36 C 251.53 260.47 252.42 259.58 253.32 258.68 C 254.21 257.79 255.11 256.89 256.00 256.00 C 256.89 255.11 257.79 254.21 258.68 253.32 C 259.58 252.42 260.47 251.53 261.37 250.64 C 262.27 249.74 263.17 248.85 264.07 247.96 C 264.97 247.07 265.87 246.18 266.77 245.29 C 267.68 244.40 268.58 243.51 269.49 242.62 C 270.40 241.74 271.32 240.85 272.23 239.97 C 273.15 239.08 274.07 238.20 274.99 237.32 C 275.92 236.44 276.85 235.57 277.78 234.69 C 278.72 233.82 279.65 232.95 280.60 232.08 C 281.54 231.21 282.49 230.35 283.45 229.49 C 284.40 228.63 285.37 227.77 286.34 226.91 C 287.30 226.06 288.28 225.21 289.26 224.37 C 290.25 223.52 291.24 222.68 292.23 221.84 C 293.23 221.01 294.24 220.18 295.25 219.35 C 296.27 218.53 297.29 217.71 298.32 216.90 C 299.36 216.09 300.40 215.28 301.45 214.48 C 302.50 213.68 303.56 212.89 304.63 212.10 C 305.71 211.32 306.79 210.54 307.88 209.77 C 308.97 209.01 310.08 208.25 311.19 207.50 C 312.31 206.75 313.43 206.01 314.57 205.28 C 315.71 204.55 316.86 203.83 318.02 203.12 C 319.18 202.41 320.36 201.71 321.55 201.03 C 322.73 200.34 323.94 199.67 325.15 199.01 C 326.36 198.35 327.59 197.71 328.83 197.08 C 330.07 196.45 331.32 195.84 332.59 195.24 C 333.86 194.64 335.14 194.06 336.43 193.49 C 337.73 192.93 339.04 192.38 340.36 191.85 C 341.68 191.33 343.02 190.82 344.37 190.33 C 345.72 189.84 347.08 189.37 348.46 188.93 C 349.84 188.49 351.23 188.06 352.64 187.67 C 354.04 187.27 355.46 186.90 356.89 186.55 C 358.33 186.20 359.77 185.88 361.23 185.59 C 362.69 185.30 364.16 185.03 365.64 184.79 C 367.12 184.56 368.61 184.35 370.12 184.18 C 371.62 184.01 373.14 183.87 374.66 183.76 C 376.19 183.66 377.72 183.58 379.26 183.55 C 380.80 183.51 382.35 183.51 383.91 183.55 C 385.47 183.59 387.03 183.67 388.60 183.78 C 390.16 183.90 391.73 184.06 393.31 184.26 C 394.88 184.46 396.45 184.70 398.03 184.99 C 399.60 185.27 401.18 185.60 402.75 185.98 C 404.32 186.36 405.88 186.78 407.44 187.25 C 409.00 187.72 410.56 188.23 412.10 188.80 C 413.64 189.36 415.18 189.98 416.69 190.64 C 418.21 191.30 419.72 192.02 421.20 192.78 C 422.69 193.54 424.16 194.36 425.60 195.22 C 427.05 196.08 428.47 197.00 429.87 197.96 C 431.26 198.93 432.64 199.94 433.97 201.00 C 435.31 202.07 436.62 203.18 437.89 204.34 C 439.15 205.50 440.39 206.71 441.58 207.97 C 442.77 209.22 443.93 210.53 445.03 211.87 C 446.14 213.22 447.20 214.61 448.21 216.04 C 449.22 217.47 450.18 218.94 451.09 220.45 C 451.99 221.96 452.85 223.50 453.64 225.08 C 454.43 226.66 455.17 228.28 455.84 229.92 C 456.51 231.55 457.13 233.23 457.67 234.92 C 458.22 236.61 458.70 238.33 459.12 240.06 C 459.53 241.80 459.88 243.55 460.16 245.32 C 460.44 247.08 460.65 248.86 460.79 250.64 C 460.93 252.42 461.00 254.21 461.00 256.00 Z" fill="none" stroke="#FFFFFF" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
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
