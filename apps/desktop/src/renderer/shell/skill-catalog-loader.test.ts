import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListSkillsResponse, SkillVersionSummary } from '@sync-think/protocol';
import { invalidateSkillCatalog, loadSkillCatalog } from './skill-catalog-loader.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function response(id: string): ListSkillsResponse {
  return { skills: [{ skillVersionId: id } as SkillVersionSummary] };
}

beforeEach(() => {
  invalidateSkillCatalog();
});

describe('skill catalog loader', () => {
  it('deduplicates in-flight requests and reuses a successful scope snapshot', async () => {
    const pending = deferred<ListSkillsResponse>();
    const source = { listSkills: vi.fn().mockReturnValue(pending.promise) };

    const first = loadSkillCatalog(source, { workspaceId: 'workspace-a' });
    const second = loadSkillCatalog(source, { workspaceId: 'workspace-a' });
    expect(first).toBe(second);
    expect(source.listSkills).toHaveBeenCalledTimes(1);
    expect(source.listSkills).toHaveBeenCalledWith({ limit: 500, workspaceId: 'workspace-a' });

    pending.resolve(response('skill-a'));
    await expect(first).resolves.toEqual(response('skill-a'));
    await expect(loadSkillCatalog(source, { workspaceId: 'workspace-a' })).resolves.toEqual(
      response('skill-a'),
    );
    expect(source.listSkills).toHaveBeenCalledTimes(1);
  });

  it('keeps global and workspace catalogs isolated', async () => {
    const source = {
      listSkills: vi
        .fn()
        .mockResolvedValueOnce(response('global-skill'))
        .mockResolvedValueOnce(response('workspace-skill')),
    };

    await loadSkillCatalog(source);
    await loadSkillCatalog(source, { workspaceId: 'workspace-a' });

    expect(source.listSkills).toHaveBeenNthCalledWith(1, { limit: 500 });
    expect(source.listSkills).toHaveBeenNthCalledWith(2, {
      limit: 500,
      workspaceId: 'workspace-a',
    });
  });

  it('does not cache failures', async () => {
    const source = {
      listSkills: vi
        .fn()
        .mockRejectedValueOnce(new Error('catalog unavailable'))
        .mockResolvedValueOnce(response('recovered')),
    };

    await expect(loadSkillCatalog(source)).rejects.toThrow('catalog unavailable');
    await expect(loadSkillCatalog(source)).resolves.toEqual(response('recovered'));
    expect(source.listSkills).toHaveBeenCalledTimes(2);
  });

  it('re-reads stale in-flight requests after invalidation', async () => {
    const stale = deferred<ListSkillsResponse>();
    const source = {
      listSkills: vi
        .fn()
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce(response('current')),
    };

    const request = loadSkillCatalog(source);
    invalidateSkillCatalog();
    stale.resolve(response('stale'));

    await expect(request).resolves.toEqual(response('current'));
    expect(source.listSkills).toHaveBeenCalledTimes(2);
  });

  it('re-reads when an invalidated in-flight request fails', async () => {
    const stale = deferred<ListSkillsResponse>();
    const source = {
      listSkills: vi
        .fn()
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce(response('current')),
    };

    const request = loadSkillCatalog(source);
    invalidateSkillCatalog();
    stale.reject(new Error('stale transport failure'));

    await expect(request).resolves.toEqual(response('current'));
    expect(source.listSkills).toHaveBeenCalledTimes(2);
  });

  it('forces one shared refresh when requested by concurrent consumers', async () => {
    const pending = deferred<ListSkillsResponse>();
    const source = { listSkills: vi.fn().mockReturnValue(pending.promise) };

    const first = loadSkillCatalog(source, { refresh: true });
    const second = loadSkillCatalog(source, { refresh: true });
    expect(first).toBe(second);
    expect(source.listSkills).toHaveBeenCalledTimes(1);

    pending.resolve(response('fresh'));
    await expect(first).resolves.toEqual(response('fresh'));
  });
});
