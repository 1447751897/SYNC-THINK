import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readFailedComposeDrafts,
  rememberFailedComposeDraft,
  subscribeFailedComposeDrafts,
  takeFailedComposeDrafts,
} from './failed-compose-drafts.js';

afterEach(() => {
  takeFailedComposeDrafts('scope-a');
  takeFailedComposeDrafts('scope-b');
});

describe('window-lifetime failed compose drafts', () => {
  it('keeps stable snapshots, notifies only the matching scope and releases consumed drafts', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFailedComposeDrafts('scope-a', listener);
    const empty = readFailedComposeDrafts('scope-a');
    expect(readFailedComposeDrafts('scope-a')).toBe(empty);
    rememberFailedComposeDraft('scope-b', { text: 'other', attachments: [] });
    expect(listener).not.toHaveBeenCalled();
    rememberFailedComposeDraft('scope-a', { text: 'original', attachments: [] });
    const saved = readFailedComposeDrafts('scope-a');
    expect(readFailedComposeDrafts('scope-a')).toBe(saved);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takeFailedComposeDrafts('scope-a')[0]?.text).toBe('original');
    expect(readFailedComposeDrafts('scope-a')).toBe(empty);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    rememberFailedComposeDraft('scope-a', { text: 'later', attachments: [] });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('owns a readonly attachment snapshot and retains multiple failed drafts in order', () => {
    const attachment = { path: 'fixture.txt', name: 'fixture.txt', kind: 'file' as const };
    rememberFailedComposeDraft('scope-a', { text: 'first', attachments: [attachment] });
    attachment.name = 'edited.txt';
    rememberFailedComposeDraft('scope-a', { text: 'second', attachments: [] });
    expect(readFailedComposeDrafts('scope-a').map((draft) => draft.text)).toEqual([
      'first',
      'second',
    ]);
    expect(readFailedComposeDrafts('scope-a')[0]?.attachments[0]?.name).toBe('fixture.txt');
    expect(Object.isFrozen(readFailedComposeDrafts('scope-a'))).toBe(true);
    expect(Object.isFrozen(readFailedComposeDrafts('scope-a')[0]?.attachments[0])).toBe(true);
  });
});
