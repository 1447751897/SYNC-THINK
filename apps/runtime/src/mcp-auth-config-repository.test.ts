import { describe, expect, it, vi } from 'vitest';
import { McpAuthConfigRepository, type McpAuthSettingStore } from './mcp-auth-config-repository.js';

function settings(value?: unknown): McpAuthSettingStore & {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  let current = value;
  return {
    get: vi.fn(() => (current === undefined ? undefined : { value: current })),
    set: vi.fn((_key: string, next: unknown) => {
      current = next;
    }),
  };
}

describe('McpAuthConfigRepository', () => {
  it('reads and caches normalized plaintext config', () => {
    const store = settings({ key: ' secret ', storeHandle: 'legacy', authScheme: ' api-key ' });
    const repository = new McpAuthConfigRepository(store);

    expect(repository.get(' server-1 ')).toEqual({ key: 'secret', authScheme: 'api-key' });
    expect(repository.get('server-1')).toEqual({ key: 'secret', authScheme: 'api-key' });
    expect(store.get).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledWith('mcp.auth.server-1');
  });

  it('reads legacy handles with the default scheme', () => {
    const repository = new McpAuthConfigRepository(settings({ storeHandle: ' legacy-handle ' }));

    expect(repository.get('server-1')).toEqual({
      storeHandle: 'legacy-handle',
      authScheme: 'bearer',
    });
  });

  it('ignores malformed and empty persisted records', () => {
    expect(new McpAuthConfigRepository(settings([])).get('server-1')).toBeUndefined();
    expect(
      new McpAuthConfigRepository(settings({ key: ' ', storeHandle: '' })).get('server-1'),
    ).toBeUndefined();
    expect(new McpAuthConfigRepository(settings({ key: 'secret' })).get(' ')).toBeUndefined();
  });

  it('preserves existing config when no replacement key is supplied', () => {
    const store = settings({ key: 'existing', authScheme: 'api-key' });
    const repository = new McpAuthConfigRepository(store);

    expect(repository.savePlaintext('server-1', ' ', 'bearer')).toEqual({
      configured: true,
      authScheme: 'api-key',
    });
    expect(store.set).not.toHaveBeenCalled();
  });

  it('saves normalized plaintext config and drops the legacy handle', () => {
    const store = settings({ storeHandle: 'legacy', authScheme: 'bearer' });
    const repository = new McpAuthConfigRepository(store);

    expect(repository.savePlaintext(' server-1 ', ' new-secret ', ' api-key ')).toEqual({
      configured: true,
      authScheme: 'api-key',
    });
    expect(store.set).toHaveBeenCalledWith('mcp.auth.server-1', {
      key: 'new-secret',
      authScheme: 'api-key',
    });
    expect(repository.get('server-1')).toEqual({ key: 'new-secret', authScheme: 'api-key' });
  });

  it('keeps a promoted legacy key in memory when persistence fails', () => {
    const store = settings({ storeHandle: 'legacy', authScheme: 'bearer' });
    store.set.mockImplementation(() => {
      throw new Error('disk unavailable');
    });
    const repository = new McpAuthConfigRepository(store);

    repository.promoteLegacy('server-1', ' recovered ', 'api-key');

    expect(repository.get('server-1')).toEqual({ key: 'recovered', authScheme: 'api-key' });
  });

  it('clears persisted and cached configuration', () => {
    const store = settings({ key: 'existing', authScheme: 'bearer' });
    const repository = new McpAuthConfigRepository(store);
    repository.get('server-1');

    repository.clear('server-1');

    expect(store.set).toHaveBeenCalledWith('mcp.auth.server-1', {
      key: '',
      authScheme: '',
    });
    expect(repository.get('server-1')).toBeUndefined();
    expect(store.get).toHaveBeenCalledTimes(2);
  });

  it('retains cached config when clearing persistence fails', () => {
    const store = settings({ key: 'existing', authScheme: 'bearer' });
    const repository = new McpAuthConfigRepository(store);
    repository.get('server-1');
    store.set.mockImplementation(() => {
      throw new Error('disk unavailable');
    });

    expect(() => repository.clear('server-1')).toThrow('disk unavailable');
    expect(repository.get('server-1')).toEqual({ key: 'existing', authScheme: 'bearer' });
  });
});
