import type { MessageNavigationEntry } from '@sync-think/shared';
import type { ConversationListNavigationResponse } from '@sync-think/protocol';
import {
  historyRangeGaps,
  mergeHistoryRanges,
  type HistoryRange,
} from './conversation-history-pages.js';

export interface NavigationDirectorySnapshot {
  entries: readonly MessageNavigationEntry[];
  loading: boolean;
  complete: boolean;
  error: boolean;
}

export const EMPTY_NAVIGATION_DIRECTORY: NavigationDirectorySnapshot = {
  entries: [],
  loading: false,
  complete: false,
  error: false,
};

export class ConversationNavigationLoader {
  private readonly entries = new Map<string, MessageNavigationEntry>();
  private ranges: HistoryRange[] = [];
  private pending?: Promise<void>;
  private refreshAgain = false;
  private disposed = false;
  private complete = false;
  private lastPublishedAt = 0;

  constructor(
    private readonly options: {
      load(beforeSequence?: number): Promise<ConversationListNavigationResponse>;
      onChange(snapshot: NavigationDirectorySnapshot): void;
    },
  ) {}

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) {
      this.refreshAgain = true;
      return this.pending;
    }
    this.pending = this.scan().finally(() => {
      this.pending = undefined;
      if (this.refreshAgain && !this.disposed) {
        this.refreshAgain = false;
        void this.refresh();
      }
    });
    return this.pending;
  }

  dispose(): void {
    this.disposed = true;
    this.refreshAgain = false;
    this.entries.clear();
    this.ranges = [];
  }

  private publish(loading: boolean, error = false): void {
    if (this.disposed) return;
    this.lastPublishedAt = performance.now();
    this.options.onChange({
      entries: [...this.entries.values()].sort((left, right) => left.sequence - right.sequence),
      loading,
      complete: this.complete,
      error,
    });
  }

  private async scan(): Promise<void> {
    this.publish(true);
    const visited = new Set<number | undefined>();
    let cursor: number | undefined;
    try {
      while (!this.disposed) {
        if (visited.has(cursor)) throw new Error('navigation.repeated_cursor');
        visited.add(cursor);
        const page = await this.options.load(cursor);
        if (this.disposed) return;
        if (
          !Array.isArray(page.entries) ||
          page.entries.length > 500 ||
          typeof page.hasMore !== 'boolean'
        )
          throw new Error('navigation.invalid_page');
        for (const entry of page.entries) {
          if (
            !entry ||
            typeof entry.id !== 'string' ||
            typeof entry.text !== 'string' ||
            !Number.isSafeInteger(entry.sequence) ||
            entry.sequence < 0 ||
            (cursor !== undefined && entry.sequence >= cursor)
          )
            throw new Error('navigation.invalid_entry');
        }
        const sequences = page.entries.map((entry) => entry.sequence);
        if (page.hasMore && (!sequences.length || page.nextCursor !== Math.min(...sequences)))
          throw new Error('navigation.invalid_cursor');
        if (cursor === undefined && !page.hasMore && !page.entries.length) {
          this.entries.clear();
          this.ranges = [];
          this.complete = true;
          break;
        }
        const firstPage = this.entries.size === 0;
        for (const entry of page.entries) this.entries.set(entry.id, entry);
        this.ranges = mergeHistoryRanges(this.ranges, { sequences, hasMore: page.hasMore }, cursor);
        const gap = historyRangeGaps(this.ranges).at(-1);
        cursor =
          gap?.beforeSequence ?? (this.ranges[0]?.start > 0 ? this.ranges[0].start : undefined);
        this.complete = cursor === undefined;
        if (this.complete) break;
        if (firstPage || performance.now() - this.lastPublishedAt >= 100) this.publish(true);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      this.publish(false);
    } catch {
      this.publish(false, true);
    }
  }
}
