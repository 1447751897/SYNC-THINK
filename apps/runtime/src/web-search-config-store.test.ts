import { describe, expect, it, vi } from 'vitest';
import { WebSearchConfigStore } from './web-search-config-store.js';

function fixture() {
  const settings = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  let sequence = 0;
  const store = new WebSearchConfigStore(
    {
      get: (key) => (settings.has(key) ? { value: settings.get(key) } : undefined),
      set: (key, value) => {
        settings.set(key, value);
        return value;
      },
    },
    {
      storeSecret: vi.fn(async (value: string) => {
        const handle = `secret-${++sequence}`;
        secrets.set(handle, value);
        return handle;
      }),
      retrieveSecret: vi.fn(async (handle: string) => secrets.get(handle) ?? ''),
      removeSecret: vi.fn(async (handle: string) => secrets.delete(handle)),
    },
  );
  return { store, settings, secrets };
}

describe('WebSearchConfigStore', () => {
  it('keeps credentials out of summaries and resolves enabled providers by priority', async () => {
    const { store, settings } = fixture();
    await store.save({ providerId: 'tavily', enabled: true, apiKey: 'secret-value' });
    await store.save({ providerId: 'brave', enabled: true, apiKey: 'brave-value' });
    store.reorder({
      providerIds: [
        'brave',
        'tavily',
        'exa',
        'serpapi',
        'serper',
        'bing',
        'google',
        'firecrawl',
        'metaso',
        'doubao',
      ],
    });

    expect(JSON.stringify(store.list())).not.toContain('secret-value');
    expect(JSON.stringify(settings.get('web.search.providers'))).not.toContain('secret-value');
    expect(await store.resolveEnabled()).toEqual([
      { id: 'brave', apiKey: 'brave-value' },
      { id: 'tavily', apiKey: 'secret-value' },
    ]);
  });

  it('does not consider Google configured until its engine id is present', async () => {
    const { store } = fixture();
    await store.save({ providerId: 'google', enabled: true, apiKey: 'key' });
    expect(store.list().find((provider) => provider.id === 'google')?.configured).toBe(false);
    await store.save({ providerId: 'google', enabled: true, engineId: 'cx-1' });
    expect(store.list().find((provider) => provider.id === 'google')?.configured).toBe(true);

    await store.save({ providerId: 'google', enabled: false });
    await store.save({ providerId: 'google', enabled: true });
    expect(await store.resolveEnabled()).toEqual([
      { id: 'google', apiKey: 'key', engineId: 'cx-1' },
    ]);
  });

  it('preserves a custom endpoint when only the enabled state changes', async () => {
    const { store } = fixture();
    await store.save({
      providerId: 'tavily',
      enabled: true,
      apiKey: 'key',
      endpoint: 'https://search.example.test/v1',
    });

    await store.save({ providerId: 'tavily', enabled: false });
    await store.save({ providerId: 'tavily', enabled: true });

    expect(store.list().find((provider) => provider.id === 'tavily')?.endpoint).toBe(
      'https://search.example.test/v1',
    );
    expect(await store.resolveEnabled()).toEqual([
      {
        id: 'tavily',
        apiKey: 'key',
        endpoint: 'https://search.example.test/v1',
      },
    ]);
  });

  it('removes an old secret after rotating a credential', async () => {
    const { store, secrets } = fixture();
    await store.save({ providerId: 'tavily', enabled: true, apiKey: 'old' });
    await store.save({ providerId: 'tavily', enabled: true, apiKey: 'new' });
    expect([...secrets.values()]).toEqual(['new']);
  });
});
