import { describe, expect, it } from 'vitest';
import { ThreadVersionProjection } from './thread-version-projection.js';

describe('ThreadVersionProjection', () => {
  it('records and reads the exact current version', () => {
    const projection = new ThreadVersionProjection<string>();

    projection.record('thread-a', 3);

    expect(projection.current('thread-a')).toBe(3);
    expect(projection.current('missing')).toBeUndefined();
  });

  it('only advances when replaying versioned events', () => {
    const projection = new ThreadVersionProjection<string>();
    projection.record('thread-a', 5);

    projection.recordLatest('thread-a', 3);
    projection.recordLatest('thread-a', 7);

    expect(projection.current('thread-a')).toBe(7);
  });

  it('replaces the complete checkpoint projection atomically', () => {
    const projection = new ThreadVersionProjection<string>();
    projection.record('stale', 1);

    projection.replace([
      ['thread-a', 2],
      ['thread-b', 4],
    ]);

    expect(projection.entries()).toEqual([
      ['thread-a', 2],
      ['thread-b', 4],
    ]);
    expect(projection.current('stale')).toBeUndefined();
  });

  it('returns detached snapshots for projected transactions', () => {
    const projection = new ThreadVersionProjection<string>();
    projection.record('thread-a', 2);

    const snapshot = projection.snapshotWith('thread-b', 3);
    snapshot.set('thread-a', 9);

    expect(snapshot).toEqual(
      new Map([
        ['thread-a', 9],
        ['thread-b', 3],
      ]),
    );
    expect(projection.entries()).toEqual([['thread-a', 2]]);
  });

  it('exposes a readonly live view for persistence without copying', () => {
    const projection = new ThreadVersionProjection<string>();
    const view = projection.view();

    projection.record('thread-a', 1);

    expect(view.get('thread-a')).toBe(1);
  });
});
