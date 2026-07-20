import { describe, expect, it } from 'vitest';
import { serializeComposeFiles } from '../src/renderer/compose-attachment-sources.js';

describe('compose attachment source serialization', () => {
  it('converts clipboard and dropped files into context-bridge-safe byte records', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'screen.png', {
      type: 'image/png',
    });

    const [source] = await serializeComposeFiles([file]);

    expect(source).toMatchObject({ name: 'screen.png', mimeType: 'image/png' });
    expect(source?.bytes).toBeInstanceOf(Uint8Array);
    expect([...source!.bytes]).toEqual([1, 2, 3, 4]);
  });

  it('rejects oversized files before they cross the Electron bridge', async () => {
    const file = {
      name: 'huge.png',
      type: 'image/png',
      size: 20 * 1024 * 1024 + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as File;

    await expect(serializeComposeFiles([file])).rejects.toThrow('20 MB');
  });
});
