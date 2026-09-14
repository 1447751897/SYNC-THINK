import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  TerminalProcessWorker,
  type TerminalAction,
  type TerminalWorker,
  type TerminalProcessWorkerOptions,
} from '@sync-think/workers';

export interface CommandSessionScope {
  threadId: string;
  workspaceRoot: string;
}

export interface CommandSessionStart extends TerminalAction {
  waitMs?: number;
  timeoutMs?: number;
  background?: boolean;
}

export type CommandSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';

export interface CommandSessionSummary {
  sessionId: string;
  command: string;
  args: string[];
  cwd: string;
  status: CommandSessionStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  error?: string;
  code?: string;
}

export interface CommandSessionResult extends CommandSessionSummary {
  kind: 'command_session';
  ok: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  elapsedMs: number;
}

interface Session {
  scopeKey: string;
  runId: string;
  callId: string;
  summary: CommandSessionSummary;
  controller: AbortController;
  completion: Promise<void>;
  stdout: string;
  stderr: string;
  truncated: boolean;
  reading: boolean;
  waiters: Set<() => void>;
}

const OUTPUT_LIMIT_CHARS = 64 * 1024;
const MAX_RUNNING_SESSIONS = 32;
const MAX_THREAD_SESSIONS = 8;
const MAX_RETAINED_SESSIONS = 128;

function scopeKey(scope: CommandSessionScope): string {
  if (!scope.threadId || !scope.workspaceRoot) throw new Error('Command session scope is required');
  const root = resolve(scope.workspaceRoot);
  return JSON.stringify([scope.threadId, process.platform === 'win32' ? root.toLowerCase() : root]);
}

function waitBudget(value: number | undefined, fallback: number): number {
  const budget = value ?? fallback;
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 30_000) {
    throw new Error('waitMs must be an integer from 0 to 30000');
  }
  return budget;
}

function cancelled(): Error {
  const error = new Error('Command wait cancelled');
  error.name = 'AbortError';
  return error;
}

/** Runtime owns processes; reads only wait for a slice of their lifetime. */
export class CommandSessionStore {
  private readonly sessions = new Map<string, Session>();
  private closed = false;

  constructor(
    private readonly createWorker: (options: TerminalProcessWorkerOptions) => TerminalWorker = (
      options,
    ) => new TerminalProcessWorker(options),
  ) {}

  async start(
    scope: CommandSessionScope,
    input: CommandSessionStart,
    owner: { runId: string; callId: string; signal?: AbortSignal },
  ): Promise<CommandSessionResult> {
    if (this.closed) throw new Error('Command sessions are stopped');
    if (owner.signal?.aborted) throw cancelled();
    const key = scopeKey(scope);
    const waitMs = waitBudget(input.waitMs, input.background ? 0 : 10_000);
    if (
      input.timeoutMs !== undefined &&
      (!Number.isSafeInteger(input.timeoutMs) ||
        input.timeoutMs < 1 ||
        input.timeoutMs > 2_147_483_647)
    ) {
      throw new Error('timeoutMs must be a positive integer up to 2147483647');
    }
    const existing = [...this.sessions.values()].find(
      (session) =>
        session.scopeKey === key &&
        session.runId === owner.runId &&
        session.callId === owner.callId,
    );
    if (existing) return this.read(scope, existing.summary.sessionId, waitMs, owner.signal);
    const running = [...this.sessions.values()].filter(
      (session) => session.summary.status === 'running',
    );
    if (
      running.length >= MAX_RUNNING_SESSIONS ||
      running.filter((session) => session.scopeKey === key).length >= MAX_THREAD_SESSIONS
    ) {
      throw new Error('Command session capacity reached; stop an existing command first');
    }
    const sessionId = randomUUID();
    const session: Session = {
      scopeKey: key,
      runId: owner.runId,
      callId: owner.callId,
      summary: {
        sessionId,
        command: input.command,
        args: [...(input.args ?? [])],
        cwd: input.cwd ?? '.',
        status: 'running',
        startedAt: new Date().toISOString(),
      },
      controller: new AbortController(),
      completion: Promise.resolve(),
      stdout: '',
      stderr: '',
      truncated: false,
      reading: false,
      waiters: new Set(),
    };
    this.sessions.set(sessionId, session);
    const onAbort = () => session.controller.abort();
    owner.signal?.addEventListener('abort', onAbort, { once: true });
    session.completion = this.consume(session, scope, input).finally(() => {
      owner.signal?.removeEventListener('abort', onAbort);
      for (const waiter of session.waiters) waiter();
      this.prune();
    });
    return this.read(scope, sessionId, waitMs, owner.signal);
  }

  async read(
    scope: CommandSessionScope,
    sessionId: string,
    waitMs = 30_000,
    signal?: AbortSignal,
  ): Promise<CommandSessionResult> {
    const budget = waitBudget(waitMs, 30_000);
    if (signal?.aborted) throw cancelled();
    const session = this.get(scope, sessionId);
    if (session.reading) throw new Error('Another read is already waiting on this command');
    session.reading = true;
    try {
      if (session.summary.status === 'running' && budget > 0) {
        await new Promise<void>((done, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            session.waiters.delete(finish);
          };
          const finish = () => {
            cleanup();
            done();
          };
          const abort = () => {
            cleanup();
            reject(cancelled());
          };
          const timer = setTimeout(finish, budget);
          signal?.addEventListener('abort', abort, { once: true });
          session.waiters.add(finish);
        });
      }
      const result = this.result(session);
      session.stdout = '';
      session.stderr = '';
      session.truncated = false;
      return result;
    } finally {
      session.reading = false;
      this.prune();
    }
  }

  list(scope: CommandSessionScope): CommandSessionSummary[] {
    const key = scopeKey(scope);
    return [...this.sessions.values()]
      .filter((session) => session.scopeKey === key)
      .map((session) => ({ ...session.summary, args: [...session.summary.args] }));
  }

  async stop(scope: CommandSessionScope, sessionId: string): Promise<CommandSessionResult> {
    const session = this.get(scope, sessionId);
    session.controller.abort();
    await session.completion;
    return this.result(session);
  }

  async stopAll(): Promise<void> {
    this.closed = true;
    const sessions = [...this.sessions.values()];
    for (const session of sessions) session.controller.abort();
    await Promise.all(sessions.map((session) => session.completion));
    this.sessions.clear();
  }

  private get(scope: CommandSessionScope, sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session || session.scopeKey !== scopeKey(scope)) {
      throw new Error(
        'Command session not found in this conversation; it may have ended when Runtime stopped',
      );
    }
    return session;
  }

  private result(session: Session): CommandSessionResult {
    return {
      kind: 'command_session',
      ok: session.summary.status === 'running' || session.summary.status === 'completed',
      ...session.summary,
      args: [...session.summary.args],
      stdout: session.stdout,
      stderr: session.stderr,
      truncated: session.truncated,
      elapsedMs: Math.max(
        0,
        Date.parse(session.summary.endedAt ?? new Date().toISOString()) -
          Date.parse(session.summary.startedAt),
      ),
    };
  }

  private async consume(
    session: Session,
    scope: CommandSessionScope,
    input: CommandSessionStart,
  ): Promise<void> {
    try {
      const worker = this.createWorker({
        timeoutMs: input.timeoutMs ?? null,
        streamAllOutput: true,
      });
      for await (const event of worker.exec(
        { workingDir: scope.workspaceRoot, action: input },
        {
          token: randomUUID(),
          allowedRoot: scope.workspaceRoot,
          allowedCommands: [input.command],
          timeoutMs: input.timeoutMs ?? 120_000,
          maxOutputBytes: 128 * 1024,
          signal: session.controller.signal,
        },
      )) {
        if (event.type === 'stdout' || event.type === 'stderr') {
          const text = session[event.type] + event.text;
          if (text.length > OUTPUT_LIMIT_CHARS) session.truncated = true;
          session[event.type] = text.slice(-OUTPUT_LIMIT_CHARS);
        } else if (event.type === 'completed') {
          session.summary.status = event.output.ok ? 'completed' : 'failed';
          if (typeof event.output.exitCode === 'number')
            session.summary.exitCode = event.output.exitCode;
          if (!event.output.ok) session.summary.error = event.output.message;
        } else if (event.type === 'failed') {
          session.summary.status =
            event.error.code === 'worker.aborted'
              ? 'cancelled'
              : event.failureClass === 'timeout'
                ? 'timed_out'
                : 'failed';
          session.summary.error = event.error.message;
          session.summary.code = event.error.code;
        }
      }
      if (session.summary.status === 'running') {
        session.summary.status = 'failed';
        session.summary.error = 'Command worker ended without a result';
      }
    } catch (error) {
      session.summary.status = 'failed';
      session.summary.error = error instanceof Error ? error.message : 'Command execution failed';
    } finally {
      session.summary.endedAt = new Date().toISOString();
    }
  }

  private prune(): void {
    for (const [id, session] of this.sessions) {
      if (this.sessions.size <= MAX_RETAINED_SESSIONS) break;
      if (session.summary.status !== 'running' && !session.reading) this.sessions.delete(id);
    }
  }
}

export function isRunningCommandResult(content: string): boolean {
  try {
    const result = JSON.parse(content) as CommandSessionResult;
    return (
      result?.kind === 'command_session' &&
      result.ok === true &&
      result.status === 'running' &&
      typeof result.sessionId === 'string'
    );
  } catch {
    return false;
  }
}
