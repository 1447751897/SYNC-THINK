import { expect, it } from 'vitest';
import { ContentSnapshotCache, type PreparedContent } from './content-snapshot-cache.js';
const snapshot = (text: string): PreparedContent => ({
  text,
  format: 'text',
  utf8Bytes: Buffer.byteLength(text),
  version: 'a'.repeat(64),
});
it('shares one prepared source within a database revision and refreshes LRU order', () => {
  const cache = new ContentSnapshotCache(2, 10000);
  const first = snapshot('first');
  cache.set('first', first, 'revision-a');
  cache.set('second', snapshot('second'), 'revision-a');
  expect(cache.get('first', 'revision-a')).toEqual(first);
  cache.set('third', snapshot('third'), 'revision-a');
  expect(cache.get('second', 'revision-a')).toBeUndefined();
  expect(cache.get('first', 'revision-a')).toEqual(first);
  expect(cache.size).toBe(2);
});
it('invalidates all old data on revision change and bounds string estimates', () => {
  const cache = new ContentSnapshotCache(8, 1024);
  cache.set('first', snapshot('a'.repeat(300)), 'revision-a');
  cache.set('large', snapshot('a'.repeat(1000)), 'revision-a');
  expect(cache.get('large', 'revision-a')).toBeUndefined();
  expect(cache.estimatedBytes).toBeLessThanOrEqual(1024);
  expect(cache.get('first', 'revision-b')).toBeUndefined();
  expect(cache.size).toBe(0);
  expect(cache.estimatedBytes).toBe(0);
});

it('owns retained strings without changing UTF-16 code units or recopying a cache hit', () => {
  const cache = new ContentSnapshotCache();
  const text = 'paired🙂unpaired\ud800-tail-\udc00';
  const input = snapshot(text);
  cache.set('source', input, 'revision');
  const prepared = cache.get('source', 'revision')!;
  expect(prepared.text).toBe(text);
  expect(prepared).not.toBe(input);
  expect(Object.isFrozen(prepared)).toBe(true);
  cache.set('source', prepared, 'revision');
  expect(cache.get('source', 'revision')).toBe(prepared);
});
