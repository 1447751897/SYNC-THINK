/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  parseProviderIcon,
  readProviderIcon,
  saveProviderIcon,
  MAX_PROVIDER_ICON_LENGTH,
} from './provider-icons.js';
import { ProviderIdentityMark } from './ProviderIdentityMark.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('provider display preferences', () => {
  it('persists per provider ID and restores automatic icons without changing another provider', () => {
    saveProviderIcon('custom-a', { kind: 'brand', brandId: 'openai' });
    saveProviderIcon('custom-b', { kind: 'brand', brandId: 'deepseek' });
    expect(readProviderIcon('custom-a')).toEqual({ kind: 'brand', brandId: 'openai' });
    saveProviderIcon('custom-a');
    expect(readProviderIcon('custom-a')).toBeUndefined();
    expect(readProviderIcon('custom-b')).toEqual({ kind: 'brand', brandId: 'deepseek' });
  });
  it('rejects malformed, inherited, oversized, and remote-image preferences', () => {
    for (const value of [
      'null',
      '{}',
      'oops',
      JSON.stringify({ kind: 'brand', brandId: '__proto__' }),
      JSON.stringify({ kind: 'brand', brandId: 'constructor' }),
      JSON.stringify({ kind: 'image', dataUrl: 'https://example.com/a.png' }),
      JSON.stringify({ kind: 'image', dataUrl: 'data:image/svg+xml;base64,AAAA' }),
      'a'.repeat(MAX_PROVIDER_ICON_LENGTH + 1),
    ]) {
      expect(parseProviderIcon(value)).toBeUndefined();
    }
  });
  it('updates mounted marks immediately while keeping same-name providers independent', () => {
    render(
      <>
        <ProviderIdentityMark providerId="a" name="Custom" />
        <ProviderIdentityMark providerId="b" name="Custom" />
      </>,
    );
    expect(screen.getAllByRole('img', { name: 'Custom' })).toHaveLength(2);
    act(() => saveProviderIcon('a', { kind: 'image', dataUrl: 'data:image/png;base64,AAAA' }));
    expect(document.querySelectorAll('img[src="data:image/png;base64,AAAA"]')).toHaveLength(1);
    act(() => saveProviderIcon('a'));
    expect(document.querySelector('img[src="data:image/png;base64,AAAA"]')).toBeNull();
  });
  it('surfaces storage failure so the editor does not report false success', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveProviderIcon('custom', { kind: 'brand', brandId: 'openai' })).toThrow('quota');
    expect(readProviderIcon('custom')).toBeUndefined();
  });
});
