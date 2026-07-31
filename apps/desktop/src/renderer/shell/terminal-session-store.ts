import type {
  CancelProjectTerminalPayload,
  CancelProjectTerminalResult,
  ProjectTerminalEvent,
  StartProjectTerminalPayload,
  StartProjectTerminalResult,
} from '../../workspace-tools-contract.js';

const MAX_OUTPUT_CHARACTERS = 256 * 1024;
const MAX_HISTORY_ENTRIES = 100;

export type TerminalSessionStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export interface TerminalOutputChunk {
  id: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

export interface TerminalSessionSnapshot {
  terminalId: string;
  cwd: string;
  status: TerminalSessionStatus;
  chunks: readonly TerminalOutputChunk[];
  history: readonly string[];
  activeCommandId?: string;
  error?: string;
  clearRevision: number;
}

export interface ProjectTerminalBridge {
  startProjectTerminal(payload: StartProjectTerminalPayload): Promise<StartProjectTerminalResult>;
  cancelProjectTerminal(payload: CancelProjectTerminalPayload): Promise<CancelProjectTerminalResult>;
  subscribeProjectTerminal(listener: (event: ProjectTerminalEvent) => void): () => void;
}

type SessionListener = () => void;

function promptText(cwd: string, commandLine: string): string {
  const location = cwd ? `/${cwd}` : '/';
  return `\r\n\u001b[90m${location} > ${commandLine}\u001b[0m\r\n`;
}

function trimChunks(chunks: readonly TerminalOutputChunk[]): TerminalOutputChunk[] {
  let keptCharacters = 0;
  const kept: TerminalOutputChunk[] = [];
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]!;
    if (keptCharacters + chunk.text.length > MAX_OUTPUT_CHARACTERS) {
      if (kept.length === 0) {
        kept.push({ ...chunk, text: chunk.text.slice(-MAX_OUTPUT_CHARACTERS) });
      }
      break;
    }
    keptCharacters += chunk.text.length;
    kept.push(chunk);
  }
  return kept.reverse();
}

export class TerminalSessionStore {
  private readonly sessions = new Map<string, TerminalSessionSnapshot>();
  private readonly listeners = new Map<string, Set<SessionListener>>();
  private readonly finishedCommands = new Map<string, Set<string>>();
  private readonly pendingStarts = new Map<string, Promise<StartProjectTerminalResult>>();
  private nextChunkId = 0;
  private readonly unsubscribeBridge: () => void;

  constructor(private readonly bridge: ProjectTerminalBridge) {
    this.unsubscribeBridge = bridge.subscribeProjectTerminal((event) => this.handleEvent(event));
  }

  ensureSession(terminalId: string, cwd = ''): TerminalSessionSnapshot {
    const id = terminalId.trim();
    if (!id) throw new Error('Terminal id is required');
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const snapshot: TerminalSessionSnapshot = {
      terminalId: id,
      cwd,
      status: 'idle',
      chunks: [],
      history: [],
      clearRevision: 0,
    };
    this.sessions.set(id, snapshot);
    return snapshot;
  }

  getSnapshot(terminalId: string): TerminalSessionSnapshot {
    return this.ensureSession(terminalId);
  }

  subscribe(terminalId: string, listener: SessionListener): () => void {
    this.ensureSession(terminalId);
    const listeners = this.listeners.get(terminalId) ?? new Set<SessionListener>();
    listeners.add(listener);
    this.listeners.set(terminalId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(terminalId);
    };
  }

  async startCommand(payload: StartProjectTerminalPayload): Promise<StartProjectTerminalResult> {
    const commandLine = payload.commandLine.trim();
    if (!commandLine) throw new Error('Terminal command is required');
    const current = this.ensureSession(payload.terminalId, payload.cwd);
    if (
      this.pendingStarts.has(payload.terminalId) ||
      current.status === 'starting' ||
      current.status === 'running' ||
      current.status === 'stopping'
    ) {
      throw new Error('Terminal session is already running a command');
    }
    const history = [...current.history, commandLine].slice(-MAX_HISTORY_ENTRIES);
    this.update(payload.terminalId, {
      ...current,
      cwd: payload.cwd,
      status: 'starting',
      history,
      chunks: this.appendChunk(current.chunks, 'system', promptText(payload.cwd, commandLine)),
      error: undefined,
      activeCommandId: undefined,
    });
    let pending: Promise<StartProjectTerminalResult> | undefined;
    try {
      pending = this.bridge.startProjectTerminal({ ...payload, commandLine });
      this.pendingStarts.set(payload.terminalId, pending);
      const result = await pending;
      const latest = this.getSnapshot(payload.terminalId);
      if (this.finishedCommands.get(payload.terminalId)?.has(result.commandId)) return result;
      this.update(payload.terminalId, {
        ...latest,
        cwd: result.cwd,
        status: result.state === 'running' ? 'running' : 'idle',
        activeCommandId: result.state === 'running' ? result.commandId : undefined,
        error: undefined,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '命令启动失败';
      const latest = this.getSnapshot(payload.terminalId);
      this.update(payload.terminalId, {
        ...latest,
        status: 'error',
        activeCommandId: undefined,
        error: message,
        chunks: this.appendChunk(
          latest.chunks,
          'system',
          `\u001b[31m命令启动失败：${message}\u001b[0m\r\n`,
        ),
      });
      throw error;
    } finally {
      if (pending && this.pendingStarts.get(payload.terminalId) === pending) {
        this.pendingStarts.delete(payload.terminalId);
      }
    }
  }

  async cancelCommand(terminalId: string): Promise<boolean> {
    const current = this.getSnapshot(terminalId);
    if (!current.activeCommandId || (current.status !== 'running' && current.status !== 'stopping')) {
      return false;
    }
    this.update(terminalId, { ...current, status: 'stopping' });
    try {
      const result = await this.bridge.cancelProjectTerminal({
        terminalId,
        commandId: current.activeCommandId,
      });
      if (!result.cancelled) {
        const latest = this.getSnapshot(terminalId);
        if (latest.activeCommandId === current.activeCommandId) {
          this.update(terminalId, { ...latest, status: 'running' });
        }
      }
      return result.cancelled;
    } catch (error) {
      const latest = this.getSnapshot(terminalId);
      if (latest.activeCommandId === current.activeCommandId) {
        this.update(terminalId, {
          ...latest,
          status: 'running',
          error: error instanceof Error ? error.message : '停止命令失败',
        });
      }
      throw error;
    }
  }

  clear(terminalId: string): void {
    const current = this.getSnapshot(terminalId);
    this.update(terminalId, {
      ...current,
      chunks: [],
      error: undefined,
      clearRevision: current.clearRevision + 1,
    });
  }

  async disposeSession(terminalId: string): Promise<void> {
    await this.pendingStarts.get(terminalId)?.catch(() => undefined);
    const current = this.sessions.get(terminalId);
    if (current?.activeCommandId) await this.cancelCommand(terminalId).catch(() => undefined);
    this.sessions.delete(terminalId);
    this.listeners.delete(terminalId);
    this.finishedCommands.delete(terminalId);
    this.pendingStarts.delete(terminalId);
  }

  destroy(): void {
    this.unsubscribeBridge();
    this.sessions.clear();
    this.listeners.clear();
    this.finishedCommands.clear();
    this.pendingStarts.clear();
  }

  private appendChunk(
    chunks: readonly TerminalOutputChunk[],
    stream: TerminalOutputChunk['stream'],
    text: string,
  ): TerminalOutputChunk[] {
    if (!text) return [...chunks];
    this.nextChunkId += 1;
    return trimChunks([...chunks, { id: this.nextChunkId, stream, text }]);
  }

  private finishCommand(terminalId: string, commandId: string): void {
    const finished = this.finishedCommands.get(terminalId) ?? new Set<string>();
    finished.add(commandId);
    if (finished.size > 20) finished.delete(finished.values().next().value as string);
    this.finishedCommands.set(terminalId, finished);
  }

  private handleEvent(event: ProjectTerminalEvent): void {
    const current = this.sessions.get(event.terminalId);
    if (!current) return;
    if (current.activeCommandId && current.activeCommandId !== event.commandId) return;
    if (!current.activeCommandId && current.status !== 'starting') return;
    if (event.type === 'stdout' || event.type === 'stderr') {
      this.update(event.terminalId, {
        ...current,
        status: 'running',
        activeCommandId: event.commandId,
        chunks: this.appendChunk(current.chunks, event.type, event.text),
      });
      return;
    }
    this.finishCommand(event.terminalId, event.commandId);
    if (event.type === 'completed') {
      const suffix = event.truncated
        ? '\r\n\u001b[33m输出已达到上限，后续内容未保留。\u001b[0m\r\n'
        : event.exitCode && event.exitCode !== 0
          ? `\r\n\u001b[33m进程退出码 ${event.exitCode}\u001b[0m\r\n`
          : '';
      this.update(event.terminalId, {
        ...current,
        cwd: event.cwd,
        status: 'idle',
        activeCommandId: undefined,
        error: undefined,
        chunks: suffix ? this.appendChunk(current.chunks, 'system', suffix) : current.chunks,
      });
      return;
    }
    if (event.type === 'cancelled') {
      this.update(event.terminalId, {
        ...current,
        cwd: event.cwd,
        status: 'idle',
        activeCommandId: undefined,
        error: undefined,
        chunks: this.appendChunk(
          current.chunks,
          'system',
          '\r\n\u001b[33m命令已停止。\u001b[0m\r\n',
        ),
      });
      return;
    }
    if (event.type !== 'failed') return;
    this.update(event.terminalId, {
      ...current,
      cwd: event.cwd,
      status: 'error',
      activeCommandId: undefined,
      error: event.message,
      chunks: this.appendChunk(
        current.chunks,
        'system',
        `\r\n\u001b[31m${event.message}\u001b[0m\r\n`,
      ),
    });
  }

  private update(terminalId: string, snapshot: TerminalSessionSnapshot): void {
    this.sessions.set(terminalId, snapshot);
    for (const listener of this.listeners.get(terminalId) ?? []) listener();
  }
}

export function createTerminalSessionStore(bridge: ProjectTerminalBridge): TerminalSessionStore {
  return new TerminalSessionStore(bridge);
}

let sharedStore: TerminalSessionStore | undefined;

export function getTerminalSessionStore(): TerminalSessionStore {
  if (sharedStore) return sharedStore;
  const bridge = window.syncThink?.runtime;
  if (
    !bridge?.startProjectTerminal ||
    !bridge.cancelProjectTerminal ||
    !bridge.subscribeProjectTerminal
  ) {
    throw new Error('Terminal bridge is unavailable');
  }
  sharedStore = createTerminalSessionStore(bridge);
  return sharedStore;
}

export async function disposeTerminalSession(terminalId: string): Promise<void> {
  if (!sharedStore) return;
  await sharedStore.disposeSession(terminalId);
}

export function resetTerminalSessionStoreForTests(): void {
  sharedStore?.destroy();
  sharedStore = undefined;
}
