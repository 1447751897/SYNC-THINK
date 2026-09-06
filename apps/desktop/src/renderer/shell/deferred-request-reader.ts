import { conversationReadRequestPool } from './conversation-read-request-pool.js';
import type { RunProcessHistoryRequestPool } from './run-process-history-loader.js';

interface PendingContentRead<Payload, Response> {
  payload: Payload;
  signal?: AbortSignal;
  resolve(response: Response): void;
  reject(error: unknown): void;
  abort(): void;
}

export class DeferredRequestReader<Payload, Response> {
  private readonly queue: PendingContentRead<Payload, Response>[] = [];

  constructor(
    private readonly load: (payload: Payload) => Promise<Response>,
    private readonly validate: (payload: Payload, response: Response) => void,
    private readonly pool: RunProcessHistoryRequestPool = conversationReadRequestPool,
    private readonly maxPending = 16,
  ) {}

  read(payload: Payload, signal?: AbortSignal): Promise<Response> {
    if (signal?.aborted) return Promise.reject(new Error('content.cancelled'));
    if (this.queue.length >= this.maxPending) return Promise.reject(new Error('content.busy'));
    return new Promise((resolve, reject) => {
      const entry: PendingContentRead<Payload, Response> = {
        payload,
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          signal?.removeEventListener('abort', entry.abort);
          reject(new Error('content.cancelled'));
          if (!this.queue.length) this.pool.detach(this);
        },
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry);
      this.pool.attach(this, () => this.drain(), 100);
      this.drain();
    });
  }

  private drain(): void {
    while (this.queue.length && this.pool.hasCapacity) {
      const entry = this.queue.shift()!;
      if (entry.signal?.aborted) {
        entry.abort();
        continue;
      }
      this.pool.start(entry);
      void Promise.resolve()
        .then(() => this.load(entry.payload))
        .then((response) => {
          this.validate(entry.payload, response);
          if (!entry.signal?.aborted) entry.resolve(response);
        })
        .catch(entry.reject)
        .finally(() => {
          entry.signal?.removeEventListener('abort', entry.abort);
          this.pool.finish(entry);
        });
    }
    if (!this.queue.length) this.pool.detach(this);
  }
}
