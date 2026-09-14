import { describe, expect, it } from 'vitest';
import { createPlatformContext } from './platform.js';

describe('createPlatformContext', () => {
  it('enables core macOS capabilities but keeps Windows-only automation disabled', () => {
    expect(createPlatformContext('darwin', 'arm64')).toEqual({
      platform: 'darwin',
      arch: 'arm64',
      capabilities: {
        desktopAutomation: false,
        ocr: false,
        daemonAutostart: true,
        autoUpdate: true,
      },
    });
  });
});
