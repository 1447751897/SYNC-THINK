import { describe, expect, it } from 'vitest';

import {
  resolveDevelopmentUserDataPath,
  resolveInitialWindowSize,
  shouldDisableDevelopmentHardwareAcceleration,
} from '../src/main/window-size.js';

describe('resolveInitialWindowSize', () => {
  it('keeps the production window at the product default', () => {
    expect(
      resolveInitialWindowSize({
        packaged: true,
        width: '1280',
        height: '720',
      }),
    ).toEqual({ width: 1440, height: 900 });
  });

  it('accepts the approved compact QA viewport in development', () => {
    expect(
      resolveInitialWindowSize({
        packaged: false,
        width: '1280',
        height: '720',
      }),
    ).toEqual({ width: 1280, height: 720 });
  });

  it('falls back when a development dimension is malformed or outside the safe range', () => {
    expect(
      resolveInitialWindowSize({
        packaged: false,
        width: '1279',
        height: '720px',
      }),
    ).toEqual({ width: 1440, height: 900 });
  });
});

describe('resolveDevelopmentUserDataPath', () => {
  it('accepts an absolute development-only QA directory', () => {
    expect(
      resolveDevelopmentUserDataPath(false, 'D:\\projects\\SYNC-THINK\\.tmp-runtime-qa\\desktop'),
    ).toBe('D:\\projects\\SYNC-THINK\\.tmp-runtime-qa\\desktop');
  });

  it('rejects packaged and relative paths', () => {
    expect(resolveDevelopmentUserDataPath(true, 'D:\\qa')).toBeNull();
    expect(resolveDevelopmentUserDataPath(false, '.tmp-runtime-qa/desktop')).toBeNull();
  });
});

describe('shouldDisableDevelopmentHardwareAcceleration', () => {
  it('only enables the QA fallback for an unpackaged build with an explicit flag', () => {
    expect(shouldDisableDevelopmentHardwareAcceleration(false, '1')).toBe(true);
    expect(shouldDisableDevelopmentHardwareAcceleration(false, 'true')).toBe(false);
    expect(shouldDisableDevelopmentHardwareAcceleration(true, '1')).toBe(false);
  });
});
