/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { installPreviewRuntime } from './runtime.js';
const descriptors = Object.fromEntries(
  ['localStorage', 'sessionStorage', 'syncThink', 'open'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(window, key),
  ]),
);
afterEach(() => {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(window, key, descriptor);
    else Reflect.deleteProperty(window, key);
  }
});
describe('offline exhibition runtime', () => {
  it('isolates storage and native bridge writes from the host', async () => {
    const original = window.localStorage;
    original.setItem('production-preference', 'unchanged');
    const { storage, settings } = installPreviewRuntime();
    storage.setItem('production-preference', 'demo-only');
    expect(original.getItem('production-preference')).toBe('unchanged');
    const api = window.syncThink!.runtime;
    await api.setSetting({ key: 'theme', value: 'dark' });
    expect(settings.get('theme')).toBe('dark');
    expect(
      (await api.listConversationMessages({ conversationId: 'demo' } as never)).messages,
    ).toHaveLength(2);
    expect(window.open('https://example.test')).toBeNull();
  });
  it('supplies working native-shaped terminal and file subscriptions without native IO', async () => {
    installPreviewRuntime();
    expect(await window.syncThink!.terminal!.exists('demo')).toBe(true);
    expect(await window.syncThink!.terminal!.getBuffer('demo')).toContain('24 tests passed');
    const watch = window.syncThink!.runtime.watchProjectFile({} as never, () => {});
    await expect(watch.ready).resolves.toBeUndefined();
    await expect(watch.unsubscribe()).resolves.toBeUndefined();
  });
});
