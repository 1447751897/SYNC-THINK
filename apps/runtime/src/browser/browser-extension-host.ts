import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { SqliteAppSettingStore } from '@sync-think/storage';

/** NewMax-compatible loopback bridge contract. */
export const BROWSER_EXTENSION_PROTOCOL_VERSION = 1;
export const BROWSER_EXTENSION_HOST = '127.0.0.1';
export const BROWSER_EXTENSION_PORT = 17373;
export const BROWSER_EXTENSION_PATH = '/browser-extension/v1';
export const BROWSER_EXTENSION_URL = `ws://${BROWSER_EXTENSION_HOST}:${BROWSER_EXTENSION_PORT}${BROWSER_EXTENSION_PATH}`;
export const BROWSER_EXTENSION_BUNDLED_VERSION = '1.1.4';
export const BROWSER_EXTENSION_SETTING_KEY = 'browser-extension.pairing';
export const BROWSER_EXTENSION_PAIRING_FILE = 'newmax-pairing.json';

export const BROWSER_EXTENSION_CONNECTION_STATES = [
  'disabled',
  'connecting',
  'connected',
  'disconnected',
  'version-mismatch',
  'authentication-failed',
  'protocol-mismatch',
] as const;

export type BrowserExtensionConnectionState = (typeof BROWSER_EXTENSION_CONNECTION_STATES)[number];

export interface BrowserExtensionConnectionInfo {
  readonly bundledVersion: string;
  readonly url: string;
  readonly token: string;
}

export interface BrowserExtensionStatus {
  readonly state: BrowserExtensionConnectionState;
  readonly hostAvailable: boolean;
  readonly connected: boolean;
  readonly installedVersion: string | null;
  readonly versionMismatch: boolean;
  readonly busy: boolean;
  readonly lastErrorCode: string | null;
  readonly connectionInfo: BrowserExtensionConnectionInfo | null;
}

export interface BrowserExtensionOpenFolderResult {
  readonly success: boolean;
  readonly path?: string | null;
  readonly message?: string;
}

export interface BrowserExtensionHostOptions {
  readonly appSettingStore?: SqliteAppSettingStore;
  readonly extensionDirectory?: string;
  readonly bundledVersion?: string;
  readonly port?: number;
  readonly host?: string;
  readonly url?: string;
}

/**
 * Runtime-facing seam for the NewMax-compatible extension bridge.
 *
 * Keeping this contract separate from the concrete WebSocket host lets the
 * pipe/runtime layer be exercised with an in-memory host and keeps alternate
 * embedding hosts from depending on the host's private state.
 */
export interface BrowserExtensionHostLike {
  status(): BrowserExtensionStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<BrowserExtensionStatus>;
  resetPairing(): Promise<BrowserExtensionStatus>;
  openFolder(): Promise<BrowserExtensionOpenFolderResult>;
}

interface PairingSetting {
  schemaVersion: 1;
  id: string;
  token: string;
  url: string;
  enabled: true;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const REQUEST_TIMEOUT_MS = 30_000;

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function randomPairingId(): string {
  return randomBytes(32).toString('hex');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function jsonMessage(data: RawData): Record<string, unknown> | null {
  try {
    const text = typeof data === 'string' ? data : Buffer.from(data as Buffer).toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function closeReason(reason: Buffer | string | undefined): string {
  return typeof reason === 'string' ? reason : (reason?.toString('utf8') ?? '');
}

/**
 * Small WebSocket host matching the protocol spoken by NewMax's extension.
 * It intentionally owns no browser policy: callers can use request() for
 * extension-backed tabs/CDP while the Runtime remains the policy boundary.
 */
export class BrowserExtensionHost {
  private readonly appSettingStore?: SqliteAppSettingStore;
  private readonly extensionDirectory: string;
  private readonly bundledVersion: string;
  private readonly port: number;
  private readonly host: string;
  private readonly url: string;
  private server: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private clientReady = false;
  private installedVersion: string | null = null;
  private lastErrorCode: string | null = null;
  private state: BrowserExtensionConnectionState = 'disconnected';
  private token = '';
  private pairingId = '';
  private startPromise: Promise<void> | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  constructor(options: BrowserExtensionHostOptions = {}) {
    this.appSettingStore = options.appSettingStore;
    this.extensionDirectory = resolve(
      options.extensionDirectory ?? join(process.cwd(), 'chrome-extension'),
    );
    this.bundledVersion = options.bundledVersion ?? BROWSER_EXTENSION_BUNDLED_VERSION;
    this.port = options.port ?? BROWSER_EXTENSION_PORT;
    this.host = options.host ?? BROWSER_EXTENSION_HOST;
    this.url = options.url ?? `ws://${this.host}:${this.port}${BROWSER_EXTENSION_PATH}`;
    this.loadPairing();
  }

  private loadPairing(): void {
    const stored = this.appSettingStore?.get(BROWSER_EXTENSION_SETTING_KEY)?.value;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const record = stored as Record<string, unknown>;
      const token = stringValue(record.token);
      const id = stringValue(record.id);
      if (token && TOKEN_PATTERN.test(token)) this.token = token;
      if (id) this.pairingId = id;
    }
    if (!this.token) this.token = randomToken();
    if (!this.pairingId) this.pairingId = randomPairingId();
    this.persistPairing();
  }

  private pairing(): PairingSetting {
    return {
      schemaVersion: 1,
      id: this.pairingId,
      token: this.token,
      url: this.url,
      enabled: true,
    };
  }

  private persistPairing(): void {
    this.appSettingStore?.set(BROWSER_EXTENSION_SETTING_KEY, this.pairing());
    void this.writePairingFile();
  }

  private async writePairingFile(): Promise<void> {
    try {
      await mkdir(this.extensionDirectory, { recursive: true });
      await writeFile(
        join(this.extensionDirectory, BROWSER_EXTENSION_PAIRING_FILE),
        JSON.stringify(this.pairing()),
        'utf8',
      );
    } catch (error) {
      this.lastErrorCode = 'pairing-file-write-failed';
      console.warn(
        '[runtime] browser extension pairing file write failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  status(): BrowserExtensionStatus {
    const connected = this.clientReady && this.client?.readyState === 1;
    const versionMismatch =
      connected && this.installedVersion !== null && this.installedVersion !== this.bundledVersion;
    const state = versionMismatch ? 'version-mismatch' : connected ? 'connected' : this.state;
    return {
      state,
      hostAvailable: this.server !== null,
      connected,
      installedVersion: this.installedVersion,
      versionMismatch,
      busy: this.pending.size > 0,
      lastErrorCode: this.lastErrorCode,
      connectionInfo: {
        bundledVersion: this.bundledVersion,
        url: this.url,
        token: this.token,
      },
    };
  }

  async start(): Promise<void> {
    if (this.server) return;
    if (this.startPromise) return this.startPromise;
    this.state = 'connecting';
    this.lastErrorCode = null;
    this.startPromise = new Promise<void>((resolveStart, rejectStart) => {
      const server = new WebSocketServer({
        host: this.host,
        port: this.port,
        path: BROWSER_EXTENSION_PATH,
        clientTracking: true,
        maxPayload: 1 * 1024 * 1024,
      });
      const onError = (error: Error) => {
        this.lastErrorCode = 'host-start-failed';
        this.state = 'disconnected';
        if (!this.server) server.close();
        rejectStart(error);
      };
      server.once('error', onError);
      server.once('listening', () => {
        server.off('error', onError);
        this.server = server;
        this.state = 'disconnected';
        void this.writePairingFile();
        resolveStart();
      });
      server.on('connection', (socket) => this.handleConnection(socket));
      server.on('error', (error) => {
        this.lastErrorCode = 'host-error';
        console.warn('[runtime] browser extension host error', error.message);
      });
    }).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Browser extension host stopped'));
    }
    this.pending.clear();
    const client = this.client;
    this.client = null;
    this.clientReady = false;
    client?.close(1001, 'Host shutting down');
    const server = this.server;
    this.server = null;
    this.state = 'disconnected';
    if (!server) return;
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
  }

  async restart(): Promise<BrowserExtensionStatus> {
    await this.stop();
    try {
      await this.start();
    } catch {
      /* status exposes host-start-failed */
    }
    return this.status();
  }

  async resetPairing(): Promise<BrowserExtensionStatus> {
    this.token = randomToken();
    this.pairingId = randomPairingId();
    this.lastErrorCode = null;
    this.persistPairing();
    this.client?.close(1008, 'Authentication failed');
    this.client = null;
    this.clientReady = false;
    this.state = this.server ? 'disconnected' : 'disabled';
    return this.status();
  }

  async openFolder(): Promise<BrowserExtensionOpenFolderResult> {
    try {
      await mkdir(this.extensionDirectory, { recursive: true });
      await this.writePairingFile();
      const command =
        process.platform === 'win32'
          ? 'explorer.exe'
          : process.platform === 'darwin'
            ? 'open'
            : 'xdg-open';
      const child = spawn(command, [this.extensionDirectory], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      return await new Promise<BrowserExtensionOpenFolderResult>((resolveResult) => {
        child.once('spawn', () => {
          child.unref();
          resolveResult({ success: true, path: this.extensionDirectory });
        });
        child.once('error', (error) => {
          resolveResult({
            success: false,
            path: this.extensionDirectory,
            message: error instanceof Error ? error.message : 'extension folder open failed',
          });
        });
      });
    } catch (error) {
      return {
        success: false,
        path: this.extensionDirectory,
        message: error instanceof Error ? error.message : 'extension folder open failed',
      };
    }
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const client = this.client;
    if (!client || !this.clientReady || client.readyState !== 1) {
      throw new Error('Browser extension is not connected');
    }
    const id = this.nextRequestId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Browser extension request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      try {
        client.send(JSON.stringify({ type: 'request', id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectRequest(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleConnection(socket: WebSocket): void {
    // Keep a single active extension connection, matching NewMax's one host
    // pairing model. A fresh connection supersedes a stale service worker.
    this.client?.close(1000, 'Replaced by a newer extension connection');
    this.client = socket;
    this.clientReady = false;
    this.state = 'connecting';
    this.installedVersion = null;
    let authenticated = false;

    const reject = (code: 1002 | 1008, reason: string): void => {
      this.lastErrorCode = code === 1008 ? 'authentication-failed' : 'protocol-mismatch';
      this.state = code === 1008 ? 'authentication-failed' : 'protocol-mismatch';
      socket.close(code, reason);
    };

    socket.on('message', (data) => {
      const message = jsonMessage(data);
      if (!message) {
        socket.close(1003, 'Malformed host message');
        return;
      }
      const type = message.type;
      if (!authenticated) {
        if (type === 'pairing.request') {
          if (message.protocolVersion !== BROWSER_EXTENSION_PROTOCOL_VERSION) {
            reject(1002, 'Unsupported protocol version');
            return;
          }
          this.send(socket, {
            type: 'pairing.details',
            protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
            token: this.token,
            extensionVersion: this.bundledVersion,
          });
          return;
        }
        if (type !== 'hello') {
          reject(1008, 'Authentication failed');
          return;
        }
        if (message.protocolVersion !== BROWSER_EXTENSION_PROTOCOL_VERSION) {
          reject(1002, 'Unsupported protocol version');
          return;
        }
        const token = stringValue(message.token);
        if (!token || token !== this.token) {
          reject(1008, 'Authentication failed');
          return;
        }
        authenticated = true;
        this.clientReady = true;
        this.installedVersion = stringValue(message.extensionVersion);
        this.lastErrorCode = null;
        this.state = 'connected';
        this.send(socket, {
          type: 'ready',
          protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
          extensionVersion: this.bundledVersion,
        });
        return;
      }
      if (type === 'ping') {
        this.send(socket, { type: 'pong', timestamp: message.timestamp ?? Date.now() });
        return;
      }
      if (type === 'response' && Number.isInteger(message.id)) {
        const pending = this.pending.get(Number(message.id));
        if (!pending) return;
        this.pending.delete(Number(message.id));
        clearTimeout(pending.timer);
        if (message.error && typeof message.error === 'object') {
          const errorMessage =
            stringValue((message.error as Record<string, unknown>).message) ??
            'Browser extension request failed';
          pending.reject(new Error(errorMessage));
        } else {
          pending.resolve(message.result);
        }
      }
      // `event` messages are intentionally ignored by the generic host for
      // now; browser controllers can subscribe through request-level CDP
      // events without leaking an untyped event bus into Runtime.
    });
    socket.on('close', (code, reason) => {
      if (this.client !== socket) return;
      this.client = null;
      this.clientReady = false;
      const closeText = closeReason(reason);
      if (code === 1008 || closeText === 'Authentication failed') {
        this.state = 'authentication-failed';
        this.lastErrorCode = 'authentication-failed';
      } else if (code === 1002 || closeText === 'Unsupported protocol version') {
        this.state = 'protocol-mismatch';
        this.lastErrorCode = 'protocol-mismatch';
      } else {
        this.state = this.server ? 'disconnected' : 'disabled';
      }
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Browser extension disconnected'));
      }
      this.pending.clear();
    });
    socket.on('error', () => {
      if (this.client === socket) {
        this.state = 'disconnected';
        this.lastErrorCode = 'socket-error';
      }
    });
  }

  private send(socket: WebSocket, message: Record<string, unknown>): void {
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close(1011, 'Host send failed');
    }
  }
}

export function resolveBrowserExtensionDirectory(
  explicit?: string,
  cwd: string = process.cwd(),
): string {
  if (explicit?.trim()) return resolve(explicit);
  const candidates = [
    join(cwd, 'chrome-extension'),
    join(cwd, '.newmax', 'chrome-extension'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'chrome-extension'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}
