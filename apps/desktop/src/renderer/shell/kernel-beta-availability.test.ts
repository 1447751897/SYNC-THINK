import { describe, expect, it } from 'vitest';
import {
  hasUsableModelProvider,
  isKernelInstallOffered,
  visibleManagedKernelItems,
} from './kernel-beta-availability.js';

describe('kernel beta availability', () => {
  it('offers Codex and Claude Code but not Pi', () => {
    expect(isKernelInstallOffered('codex')).toBe(true);
    expect(isKernelInstallOffered('claude-code')).toBe(true);
    expect(isKernelInstallOffered('pi')).toBe(false);
    expect(
      visibleManagedKernelItems([
        { kernelId: 'codex' },
        { kernelId: 'claude-code' },
        { kernelId: 'pi' },
      ]).map((item) => item.kernelId),
    ).toEqual(['codex', 'claude-code']);
  });

  it('treats an enabled provider with a stored secret as usable', () => {
    expect(
      hasUsableModelProvider([
        { enabled: true, credentials: [{ hasSecret: true }], models: [] },
      ]),
    ).toBe(true);
    expect(hasUsableModelProvider([{ enabled: true, credentials: [], models: [{}] }])).toBe(true);
    expect(
      hasUsableModelProvider([
        { enabled: false, credentials: [{ hasSecret: true }], models: [{}] },
        { enabled: true, credentials: [{ hasSecret: false }], models: [] },
      ]),
    ).toBe(false);
  });
});
