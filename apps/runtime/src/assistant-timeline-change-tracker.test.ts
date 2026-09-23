import { describe, expect, it } from 'vitest';
import { AssistantTimelineChangeTracker } from './assistant-timeline-change-tracker.js';

function candidate(id: string, fingerprint: string) {
  return { id, fingerprint, value: { id, fingerprint } };
}

describe('assistant timeline change tracker', () => {
  it('selects uncommitted and changed segments after a successful commit', () => {
    const tracker = new AssistantTimelineChangeTracker();
    const initial = [candidate('a', 'a1'), candidate('b', 'b1')];

    expect(tracker.selectChanged('run-a', initial)).toEqual(initial);
    tracker.commit('run-a', initial);

    expect(tracker.selectChanged('run-a', initial)).toEqual([]);
    expect(tracker.selectChanged('run-a', [candidate('a', 'a2'), candidate('b', 'b1')])).toEqual([
      candidate('a', 'a2'),
    ]);
  });

  it('does not suppress candidates that were selected but not committed', () => {
    const tracker = new AssistantTimelineChangeTracker();
    const pending = [candidate('a', 'a1')];

    expect(tracker.selectChanged('run-a', pending)).toEqual(pending);
    expect(tracker.selectChanged('run-a', pending)).toEqual(pending);
  });

  it('supports forced writes without changing committed fingerprints', () => {
    const tracker = new AssistantTimelineChangeTracker();
    const initial = [candidate('a', 'a1')];
    tracker.commit('run-a', initial);

    const forced = [candidate('a', 'a2')];
    expect(tracker.selectChanged('run-a', forced, true)).toEqual(forced);
    expect(tracker.selectChanged('run-a', initial)).toEqual([]);
  });

  it('isolates runs and releases one run without disturbing another', () => {
    const tracker = new AssistantTimelineChangeTracker();
    const entry = [candidate('a', 'a1')];
    tracker.commit('run-a', entry);
    tracker.commit('run-b', entry);

    tracker.deleteRun('run-a');

    expect(tracker.selectChanged('run-a', entry)).toEqual(entry);
    expect(tracker.selectChanged('run-b', entry)).toEqual([]);
  });
});
