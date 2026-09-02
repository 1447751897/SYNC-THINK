import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const LOCAL_WEB_PAGE_SCHEME = 'newmax-local-web';

const HTML_FILE_EXTENSIONS = new Set(['.html', '.htm']);
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

interface LocalWebPageEntry {
  token: string;
  entryPath: string;
  rootPath: string;
}

const LOCAL_WEB_PAGE_STATE_VERSION = 1;
const MAX_PERSISTED_ENTRIES = 2_048;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;

export interface LocalWebPageRegistryOptions {
  /** Optional durable index. Omit in tests/ephemeral callers. */
  persistencePath?: string;
}

interface PersistedLocalWebPageState {
  schemaVersion: typeof LOCAL_WEB_PAGE_STATE_VERSION;
  entries: Array<Pick<LocalWebPageEntry, 'token' | 'entryPath'>>;
}

function isInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

/** Tokenizes one saved HTML entry and serves only its contained resources. */
export class LocalWebPageRegistry {
  private readonly byToken = new Map<string, LocalWebPageEntry>();
  private readonly tokenByEntryPath = new Map<string, string>();
  private readonly persistencePath?: string;
  private readonly ready: Promise<void>;
  private persistTail: Promise<void> = Promise.resolve();
  private temporarySequence = 0;

  constructor(options: LocalWebPageRegistryOptions = {}) {
    const persistencePath = options.persistencePath?.trim();
    this.persistencePath = persistencePath ? path.resolve(persistencePath) : undefined;
    this.ready = this.loadPersistedState();
  }

  async createUrl(filePath: string): Promise<string | null> {
    if (
      !path.isAbsolute(filePath) ||
      !HTML_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    ) {
      return null;
    }

    try {
      const entryPath = await fs.realpath(filePath);
      const stats = await fs.stat(entryPath);
      if (!stats.isFile()) return null;
      await this.ready;
      const existingToken = this.tokenByEntryPath.get(entryPath);
      const token = existingToken ?? randomUUID();
      if (!existingToken) {
        const entry: LocalWebPageEntry = {
          token,
          entryPath,
          rootPath: path.dirname(entryPath),
        };
        this.byToken.set(token, entry);
        this.tokenByEntryPath.set(entryPath, token);
        try {
          await this.persistState();
        } catch (error) {
          this.byToken.delete(token);
          this.tokenByEntryPath.delete(entryPath);
          throw error;
        }
      }
      const name = path.basename(entryPath) || 'index.html';
      return `${LOCAL_WEB_PAGE_SCHEME}://${token}/${encodeURIComponent(name)}`;
    } catch {
      return null;
    }
  }

  async handle(request: Request): Promise<Response> {
    try {
      await this.ready;
      const url = new URL(request.url);
      if (url.protocol !== `${LOCAL_WEB_PAGE_SCHEME}:`) return notFound();
      const entry = this.byToken.get(url.hostname);
      if (!entry) return notFound();

      const encodedPath = url.pathname.replace(/^\/+/, '');
      if (!encodedPath || encodedPath.includes('\\') || encodedPath.includes('\0')) {
        return notFound();
      }
      const relativePath = decodeURIComponent(encodedPath);
      if (!relativePath || relativePath.includes('\\') || relativePath.includes('\0')) {
        return notFound();
      }
      const candidatePath = path.resolve(entry.rootPath, relativePath);
      if (!isInside(entry.rootPath, candidatePath)) return notFound();

      const resolvedPath = await fs.realpath(candidatePath);
      if (!isInside(entry.rootPath, resolvedPath)) return notFound();
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) return notFound();
      const contentType = CONTENT_TYPES[path.extname(resolvedPath).toLowerCase()];
      if (!contentType) return notFound();
      const content = await fs.readFile(resolvedPath);
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return notFound();
    }
  }

  /** Exposed for startup/diagnostic callers that want to await index hydration. */
  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  private async loadPersistedState(): Promise<void> {
    if (!this.persistencePath) return;
    let raw: string;
    try {
      raw = await fs.readFile(this.persistencePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!isPersistedState(parsed)) return;
    const seenTokens = new Set<string>();
    const seenPaths = new Set<string>();
    for (const value of parsed.entries.slice(0, MAX_PERSISTED_ENTRIES)) {
      const entryPath = path.resolve(value.entryPath);
      if (
        !TOKEN_PATTERN.test(value.token) ||
        !path.isAbsolute(value.entryPath) ||
        !HTML_FILE_EXTENSIONS.has(path.extname(entryPath).toLowerCase()) ||
        seenTokens.has(value.token) ||
        seenPaths.has(entryPath)
      ) {
        continue;
      }
      seenTokens.add(value.token);
      seenPaths.add(entryPath);
      const entry: LocalWebPageEntry = {
        token: value.token,
        entryPath,
        rootPath: path.dirname(entryPath),
      };
      this.byToken.set(entry.token, entry);
      this.tokenByEntryPath.set(entry.entryPath, entry.token);
    }
  }

  private async persistState(): Promise<void> {
    if (!this.persistencePath) return;
    const operation = this.persistTail
      .catch(() => undefined)
      .then(async () => {
        const state: PersistedLocalWebPageState = {
          schemaVersion: LOCAL_WEB_PAGE_STATE_VERSION,
          entries: [...this.byToken.values()].slice(0, MAX_PERSISTED_ENTRIES).map((entry) => ({
            token: entry.token,
            entryPath: entry.entryPath,
          })),
        };
        await fs.mkdir(path.dirname(this.persistencePath!), { recursive: true });
        const temporary = `${this.persistencePath}.tmp-${process.pid}-${this.temporarySequence++}`;
        try {
          await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
          await fs.rename(temporary, this.persistencePath!);
        } finally {
          await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
      });
    this.persistTail = operation.catch(() => undefined);
    await operation;
  }
}

function isPersistedState(value: unknown): value is PersistedLocalWebPageState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== LOCAL_WEB_PAGE_STATE_VERSION || !Array.isArray(record.entries)) {
    return false;
  }
  return record.entries.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    return typeof item.token === 'string' && typeof item.entryPath === 'string';
  });
}

export interface LocalWebPageProtocolSession {
  protocol: {
    handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
  };
}

export function registerLocalWebPageProtocol(
  target: LocalWebPageProtocolSession,
  registry: LocalWebPageRegistry,
): void {
  target.protocol.handle(LOCAL_WEB_PAGE_SCHEME, (request) => registry.handle(request));
}
