import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListMcpServersResponse, McpServerSummary } from '@sync-think/protocol';
import { invalidateMcpCatalog, loadMcpCatalog } from './mcp-catalog-loader.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function response(id: string): ListMcpServersResponse {
  return { servers: [{ mcpServerId: id } as McpServerSummary] };
}

beforeEach(() => {
  invalidateMcpCatalog();
});

describe('MCP catalog loader', () => {
  it('deduplicates in-flight reads and reuses the successful snapshot', async () => {
    const pending = deferred<ListMcpServersResponse>();
    const source = { listMcpServers: vi.fn().mockReturnValue(pending.promise) };

    const first = loadMcpCatalog(source);
    const second = loadMcpCatalog(source);
    expect(first).toBe(second);
    expect(source.listMcpServers).toHaveBeenCalledOnce();
    expect(source.listMcpServers).toHaveBeenCalledWith({ limit: 100 });

    pending.resolve(response('mcp-a'));
    await expect(first).resolves.toEqual(response('mcp-a'));
    await expect(loadMcpCatalog(source)).resolves.toEqual(response('mcp-a'));
    expect(source.listMcpServers).toHaveBeenCalledOnce();
  });

  it('keeps caches isolated by Runtime bridge identity', async () => {
    const first = { listMcpServers: vi.fn().mockResolvedValue(response('mcp-a')) };
    const second = { listMcpServers: vi.fn().mockResolvedValue(response('mcp-b')) };

    await expect(loadMcpCatalog(first)).resolves.toEqual(response('mcp-a'));
    await expect(loadMcpCatalog(second)).resolves.toEqual(response('mcp-b'));
    expect(first.listMcpServers).toHaveBeenCalledOnce();
    expect(second.listMcpServers).toHaveBeenCalledOnce();
  });

  it('does not cache failures', async () => {
    const source = {
      listMcpServers: vi
        .fn()
        .mockRejectedValueOnce(new Error('catalog unavailable'))
        .mockResolvedValueOnce(response('recovered')),
    };

    await expect(loadMcpCatalog(source)).rejects.toThrow('catalog unavailable');
    await expect(loadMcpCatalog(source)).resolves.toEqual(response('recovered'));
    expect(source.listMcpServers).toHaveBeenCalledTimes(2);
  });

  it('re-reads an invalidated in-flight request', async () => {
    const stale = deferred<ListMcpServersResponse>();
    const source = {
      listMcpServers: vi
        .fn()
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce(response('current')),
    };

    const request = loadMcpCatalog(source);
    invalidateMcpCatalog();
    stale.resolve(response('stale'));

    await expect(request).resolves.toEqual(response('current'));
    expect(source.listMcpServers).toHaveBeenCalledTimes(2);
  });

  it('forces one shared refresh for concurrent consumers', async () => {
    const pending = deferred<ListMcpServersResponse>();
    const source = { listMcpServers: vi.fn().mockReturnValue(pending.promise) };

    const first = loadMcpCatalog(source, { refresh: true });
    const second = loadMcpCatalog(source, { refresh: true });
    expect(first).toBe(second);
    expect(source.listMcpServers).toHaveBeenCalledOnce();

    pending.resolve(response('fresh'));
    await expect(first).resolves.toEqual(response('fresh'));
  });
});
