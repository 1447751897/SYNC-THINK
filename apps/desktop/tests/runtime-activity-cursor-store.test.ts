import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileRuntimeActivityCursorStore } from '../src/main/runtime-activity-cursor-store.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function cursorPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-activity-cursor-'));
  roots.push(root);
  return join(root, 'nested', 'cursor.json');
}

describe('FileRuntimeActivityCursorStore', () => {
  it('reads the legacy numeric cursor format', () => {
    const path = cursorPath();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ cursor: 41 }), 'utf8');

    expect(new FileRuntimeActivityCursorStore(path).load()).toEqual({
      sequence: 41,
      eventId: '',
    });
  });

  it('persists a monotonic tuple cursor across instances', () => {
    const path = cursorPath();
    const first = new FileRuntimeActivityCursorStore(path);
    expect(first.load()).toEqual({ sequence: 0, eventId: '' });
    first.save({ sequence: 41, eventId: 'event-b' });
    first.save({ sequence: 41, eventId: 'event-a' });
    first.save({ sequence: 17, eventId: 'event-z' });

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      sequence: 41,
      eventId: 'event-b',
    });
    expect(new FileRuntimeActivityCursorStore(path).load()).toEqual({
      sequence: 41,
      eventId: 'event-b',
    });
  });

  it('resets a persisted cursor after Runtime history rolls back', () => {
    const path = cursorPath();
    const store = new FileRuntimeActivityCursorStore(path);
    store.save({ sequence: 41, eventId: 'event-b' });

    store.reset();

    expect(store.load()).toEqual({ sequence: 0, eventId: '' });
    expect(new FileRuntimeActivityCursorStore(path).load()).toEqual({
      sequence: 0,
      eventId: '',
    });
  });

  it('advances within the same sequence by event id', () => {
    const path = cursorPath();
    const store = new FileRuntimeActivityCursorStore(path);
    store.save({ sequence: 7, eventId: 'event-a' });
    store.save({ sequence: 7, eventId: 'event-b' });

    expect(store.load()).toEqual({ sequence: 7, eventId: 'event-b' });
  });

  it('falls back to the zero tuple for malformed persisted data', () => {
    const path = cursorPath();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ sequence: -1, eventId: 4 }), 'utf8');
    expect(new FileRuntimeActivityCursorStore(path).load()).toEqual({
      sequence: 0,
      eventId: '',
    });
  });
});
