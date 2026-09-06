import type { RunProcessView } from '@sync-think/protocol';

export interface RunProcessLoadFailure {
  kind: 'connection' | 'busy' | 'unavailable' | 'invalid' | 'unknown';
  attempts: number;
  retrying: boolean;
}

export interface RunProcessLoadRequest {
  runId: string;
  priority: number;
}

interface LoadEntry extends RunProcessLoadRequest {
  attempts: number;
  state: 'queued' | 'running' | 'waiting' | 'failed' | 'loaded';
  timer?: ReturnType<typeof setTimeout>;
}

interface LoaderOptions {
  load(runId: string): Promise<RunProcessView | null | undefined>;
  onLoad(context: string, process: RunProcessView): void;
  onFailure(context: string, runId: string, failure?: RunProcessLoadFailure): void;
}

function classifyFailure(error: unknown): RunProcessLoadFailure['kind'] {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const description = `${code} ${message}`.toLowerCase();
  if (
    /frame.{0,40}(?:size|large|limit)|not.found|unauthori|forbidden|auth.failed/.test(description)
  )
    return 'unavailable';
  if (/malformed|invalid.response|history.unexpected-result/.test(description)) return 'invalid';
  if (/sqlite_busy|database is locked|queue.{0,30}(?:full|limit)|busy|overload/.test(description))
    return 'busy';
  if (
    /timed?\s*out|timeout|not connected|disconnect|reconnect|econn|epipe|ehostunreach|enetunreach|(?:socket|connection).{0,30}(?:closed|unavailable)|history\.(?:closed|worker-exit|worker-failed)/.test(
      description,
    )
  )
    return 'connection';
  if (description.includes('unavailable')) return 'unavailable';
  return 'unknown';
}

export class RunProcessHistoryRequestPool {
  private readonly inFlight = new Set<string | object>();
  private readonly consumers = new Map<object, { drain: () => void; priority: number }>();

  attach(owner: object, drain: () => void, priority = 0): void {
    this.consumers.set(owner, { drain, priority });
  }

  detach(owner: object): void {
    this.consumers.delete(owner);
  }

  get hasCapacity(): boolean {
    return this.inFlight.size < 3;
  }

  has(runId: string): boolean {
    return this.inFlight.has(runId);
  }

  start(runId: string | object): void {
    this.inFlight.add(runId);
  }

  finish(runId: string | object): void {
    this.inFlight.delete(runId);
    for (const consumer of [...this.consumers.values()].sort(
      (left, right) => right.priority - left.priority,
    ))
      consumer.drain();
  }
}

export class RunProcessHistoryLoader {
  private context: string | undefined;
  private generation = 0;
  private readonly entries = new Map<string, LoadEntry>();
  constructor(
    private readonly options: LoaderOptions,
    private readonly pool = new RunProcessHistoryRequestPool(),
  ) {}

  setRequests(
    context: string,
    requests: readonly RunProcessLoadRequest[],
    available: ReadonlySet<string> = new Set(),
  ): void {
    if (this.context !== context) {
      this.suspend();
      this.context = context;
      this.pool.attach(this, () => this.drain());
    }
    const priorities = new Map<string, number>();
    for (const request of requests) {
      priorities.set(
        request.runId,
        Math.min(priorities.get(request.runId) ?? Infinity, request.priority),
      );
    }
    for (const [runId, entry] of this.entries) {
      if (priorities.has(runId)) continue;
      this.clearTimer(entry);
      this.entries.delete(runId);
      this.options.onFailure(context, runId, undefined);
    }
    for (const [runId, priority] of priorities) {
      const entry = this.entries.get(runId) ?? {
        runId,
        priority,
        attempts: 0,
        state: 'queued' as const,
      };
      entry.priority = priority;
      this.entries.set(runId, entry);
      if (available.has(runId)) this.accept(runId);
    }
    this.drain();
  }

  accept(runId: string): void {
    const entry = this.entries.get(runId);
    if (!entry || entry.state === 'loaded') return;
    this.clearTimer(entry);
    entry.state = 'loaded';
    if (this.context) this.options.onFailure(this.context, runId, undefined);
  }

  invalidate(runId: string): void {
    const entry = this.entries.get(runId);
    if (!entry) return;
    this.clearTimer(entry);
    this.entries.set(runId, { runId, priority: entry.priority, attempts: 0, state: 'queued' });
    if (this.context) this.options.onFailure(this.context, runId, undefined);
    this.drain();
  }

  retry(runId: string): void {
    const entry = this.entries.get(runId);
    if (!entry || (entry.state !== 'failed' && entry.state !== 'waiting')) return;
    this.clearTimer(entry);
    entry.state = 'queued';
    entry.attempts = 0;
    entry.priority = -1;
    if (this.context) this.options.onFailure(this.context, runId, undefined);
    this.drain();
  }

  suspend(): void {
    this.generation += 1;
    for (const entry of this.entries.values()) this.clearTimer(entry);
    this.entries.clear();
    this.context = undefined;
    this.pool.detach(this);
  }

  private clearTimer(entry: LoadEntry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private drain(): void {
    while (this.context && this.pool.hasCapacity) {
      let next: LoadEntry | undefined;
      for (const entry of this.entries.values()) {
        if (entry.state !== 'queued' || this.pool.has(entry.runId)) continue;
        if (!next || entry.priority < next.priority) next = entry;
      }
      if (!next) return;
      next.state = 'running';
      next.attempts += 1;
      this.pool.start(next.runId);
      void this.load(this.context, next, this.generation);
    }
  }

  private isCurrent(entry: LoadEntry, generation: number): boolean {
    return (
      this.generation === generation &&
      this.entries.get(entry.runId) === entry &&
      entry.state === 'running'
    );
  }

  private async load(context: string, entry: LoadEntry, generation: number): Promise<void> {
    try {
      const process = await this.options.load(entry.runId);
      if (!this.isCurrent(entry, generation)) return;
      if (!process || String(process.runId) !== entry.runId) throw new Error('Invalid response');
      entry.state = 'loaded';
      this.options.onFailure(context, entry.runId, undefined);
      this.options.onLoad(context, process);
    } catch (error) {
      if (!this.isCurrent(entry, generation)) return;
      const kind = classifyFailure(error);
      const retrying = (kind === 'connection' || kind === 'busy') && entry.attempts < 3;
      entry.state = retrying ? 'waiting' : 'failed';
      this.options.onFailure(context, entry.runId, { kind, attempts: entry.attempts, retrying });
      if (retrying) {
        entry.timer = setTimeout(
          () => {
            entry.timer = undefined;
            if (this.generation !== generation || this.entries.get(entry.runId) !== entry) return;
            entry.state = 'queued';
            this.drain();
          },
          500 * 2 ** (entry.attempts - 1),
        );
      }
    } finally {
      this.pool.finish(entry.runId);
    }
  }
}
