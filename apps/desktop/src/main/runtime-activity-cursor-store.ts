import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventReplayCursor } from '@sync-think/protocol';
import type { RuntimeActivityCursorStore } from './runtime-session.js';

interface LegacyPersistedRuntimeActivityCursor {
  cursor: number;
}

function isValidSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseCursor(value: unknown): EventReplayCursor | null {
  if (!value || typeof value !== 'object') return null;
  const persisted = value as Partial<EventReplayCursor & LegacyPersistedRuntimeActivityCursor>;
  if (isValidSequence(persisted.sequence) && typeof persisted.eventId === 'string') {
    return { sequence: persisted.sequence, eventId: persisted.eventId };
  }
  if (isValidSequence(persisted.cursor)) {
    return { sequence: persisted.cursor, eventId: '' };
  }
  return null;
}

function compareCursors(left: EventReplayCursor, right: EventReplayCursor): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  if (left.eventId === right.eventId) return 0;
  return left.eventId < right.eventId ? -1 : 1;
}

export class FileRuntimeActivityCursorStore implements RuntimeActivityCursorStore {
  private loaded = false;
  private cursor: EventReplayCursor = { sequence: 0, eventId: '' };

  constructor(private readonly filePath: string) {}

  load(): EventReplayCursor {
    if (!this.loaded) {
      this.loaded = true;
      try {
        this.cursor = parseCursor(JSON.parse(readFileSync(this.filePath, 'utf8'))) ?? this.cursor;
      } catch {
        this.cursor = { sequence: 0, eventId: '' };
      }
    }
    return { ...this.cursor };
  }

  save(cursor: EventReplayCursor): void {
    const next = parseCursor(cursor);
    if (!next) return;
    const current = this.load();
    if (compareCursors(next, current) <= 0) return;
    this.persist(next);
  }

  reset(): void {
    this.persist({ sequence: 0, eventId: '' });
  }

  private persist(cursor: EventReplayCursor): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    const serialized = JSON.stringify(cursor);
    writeFileSync(temporaryPath, serialized, 'utf8');
    try {
      renameSync(temporaryPath, this.filePath);
    } catch {
      writeFileSync(this.filePath, serialized, 'utf8');
      rmSync(temporaryPath, { force: true });
    }
    this.cursor = cursor;
  }
}
