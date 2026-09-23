import type {
  ListSkillsPayload,
  ListSkillsResponse,
} from '@sync-think/protocol';

export const SKILL_CATALOG_LIMIT = 500;

export interface SkillCatalogSource {
  listSkills?(payload?: ListSkillsPayload): Promise<ListSkillsResponse>;
}

export interface SkillCatalogLoadOptions {
  workspaceId?: string;
  refresh?: boolean;
}

interface SkillCatalogEntry {
  response?: ListSkillsResponse;
  inFlight?: Promise<ListSkillsResponse>;
}

let generation = 0;
let cacheBySource = new WeakMap<object, Map<string, SkillCatalogEntry>>();

function scopeKey(workspaceId?: string): string {
  return workspaceId ? `workspace:${workspaceId}` : 'global';
}

function requestPayload(workspaceId?: string): ListSkillsPayload {
  return workspaceId
    ? { limit: SKILL_CATALOG_LIMIT, workspaceId }
    : { limit: SKILL_CATALOG_LIMIT };
}

function sourceCache(source: SkillCatalogSource): Map<string, SkillCatalogEntry> {
  const key = source as object;
  const existing = cacheBySource.get(key);
  if (existing) return existing;
  const created = new Map<string, SkillCatalogEntry>();
  cacheBySource.set(key, created);
  return created;
}

export function loadSkillCatalog(
  source: SkillCatalogSource,
  options: SkillCatalogLoadOptions = {},
): Promise<ListSkillsResponse> {
  if (!source.listSkills) return Promise.reject(new Error('Skill 目录服务尚未就绪'));

  const key = scopeKey(options.workspaceId);
  const cache = sourceCache(source);
  const current = cache.get(key);
  if (current?.inFlight) return current.inFlight;
  if (!options.refresh && current?.response) return Promise.resolve(current.response);

  const requestGeneration = generation;
  const entry: SkillCatalogEntry = {};
  const request = source.listSkills(requestPayload(options.workspaceId)).then(
    (response) => {
      if (requestGeneration !== generation) {
        return loadSkillCatalog(source, options);
      }
      entry.response = response;
      entry.inFlight = undefined;
      return response;
    },
    (cause: unknown) => {
      if (requestGeneration !== generation) {
        return loadSkillCatalog(source, options);
      }
      if (cache.get(key) === entry) cache.delete(key);
      throw cause;
    },
  );
  entry.inFlight = request;
  cache.set(key, entry);
  return request;
}

export function invalidateSkillCatalog(): void {
  generation += 1;
  cacheBySource = new WeakMap<object, Map<string, SkillCatalogEntry>>();
}
