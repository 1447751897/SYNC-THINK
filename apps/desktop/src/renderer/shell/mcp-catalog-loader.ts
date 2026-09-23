import type {
  ListMcpServersPayload,
  ListMcpServersResponse,
} from '@sync-think/protocol';

export const MCP_CATALOG_LIMIT = 100;

export interface McpCatalogSource {
  listMcpServers?(payload?: ListMcpServersPayload): Promise<ListMcpServersResponse>;
}

export interface McpCatalogLoadOptions {
  refresh?: boolean;
}

interface McpCatalogEntry {
  response?: ListMcpServersResponse;
  inFlight?: Promise<ListMcpServersResponse>;
}

let generation = 0;
let cacheBySource = new WeakMap<object, McpCatalogEntry>();

export function loadMcpCatalog(
  source: McpCatalogSource,
  options: McpCatalogLoadOptions = {},
): Promise<ListMcpServersResponse> {
  if (!source.listMcpServers) return Promise.reject(new Error('MCP 目录服务尚未就绪'));

  const current = cacheBySource.get(source as object);
  if (current?.inFlight) return current.inFlight;
  if (!options.refresh && current?.response) return Promise.resolve(current.response);

  const requestGeneration = generation;
  const entry: McpCatalogEntry = {};
  const request = source.listMcpServers({ limit: MCP_CATALOG_LIMIT }).then(
    (response) => {
      if (requestGeneration !== generation) return loadMcpCatalog(source, options);
      entry.response = response;
      entry.inFlight = undefined;
      return response;
    },
    (cause: unknown) => {
      if (requestGeneration !== generation) return loadMcpCatalog(source, options);
      if (cacheBySource.get(source as object) === entry) {
        cacheBySource.delete(source as object);
      }
      throw cause;
    },
  );
  entry.inFlight = request;
  cacheBySource.set(source as object, entry);
  return request;
}

export function invalidateMcpCatalog(): void {
  generation += 1;
  cacheBySource = new WeakMap<object, McpCatalogEntry>();
}
