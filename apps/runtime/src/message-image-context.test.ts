import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveHistoricalMessageImageDataUrl } from './message-image-context.js';

const MAX_CONTEXT_IMAGE_BYTES = 12 * 1024 * 1024;

let testDirectory: string;

beforeEach(() => {
  testDirectory = mkdtempSync(join(process.cwd(), '.tmp-message-image-context-'));
});

afterEach(() => {
  rmSync(testDirectory, { recursive: true, force: true });
});

describe('resolveHistoricalMessageImageDataUrl', () => {
  it('reads a basename from the configured directory and returns an image data URL', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    writeFileSync(join(testDirectory, 'message.png'), bytes);

    expect(
      resolveHistoricalMessageImageDataUrl('message.png', 'image/png', testDirectory),
    ).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
  });

  it('rejects traversal and non-basename storage references with Windows path forms', () => {
    mkdirSync(join(testDirectory, 'nested'));
    writeFileSync(join(testDirectory, 'nested', 'message.png'), Buffer.from('nested'));
    writeFileSync(join(testDirectory, 'safe..png'), Buffer.from('dots'));

    const unsafeReferences = [
      '..',
      '../message.png',
      '..\\message.png',
      'nested/message.png',
      'nested\\message.png',
      resolve(testDirectory, 'message.png'),
      'C:\\message.png',
      '\\\\server\\share\\message.png',
      'safe..png',
    ];

    for (const storageRef of unsafeReferences) {
      expect(
        resolveHistoricalMessageImageDataUrl(storageRef, 'image/png', testDirectory),
        storageRef,
      ).toBeUndefined();
    }
  });

  it('does not allow a sibling directory with the same Windows path prefix', () => {
    const siblingDirectory = `${testDirectory}-outside`;
    mkdirSync(siblingDirectory);
    writeFileSync(join(siblingDirectory, 'outside.png'), Buffer.from('outside'));

    try {
      expect(
        resolveHistoricalMessageImageDataUrl(
          join('..', `${testDirectory.split(/[\\/]/).at(-1)}-outside`, 'outside.png'),
          'image/png',
          testDirectory,
        ),
      ).toBeUndefined();
    } finally {
      rmSync(siblingDirectory, { recursive: true, force: true });
    }
  });

  it('rejects files larger than the 12 MiB context limit', () => {
    const oversizedFile = join(testDirectory, 'oversized.png');
    writeFileSync(oversizedFile, Buffer.from([0]));
    truncateSync(oversizedFile, MAX_CONTEXT_IMAGE_BYTES + 1);

    expect(
      resolveHistoricalMessageImageDataUrl('oversized.png', 'image/png', testDirectory),
    ).toBeUndefined();
  });

  it('rejects non-image MIME types', () => {
    writeFileSync(join(testDirectory, 'message.bin'), Buffer.from('not-an-image'));

    expect(
      resolveHistoricalMessageImageDataUrl('message.bin', 'application/octet-stream', testDirectory),
    ).toBeUndefined();
    expect(
      resolveHistoricalMessageImageDataUrl('message.bin', 'text/plain', testDirectory),
    ).toBeUndefined();
  });
});
