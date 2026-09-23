import { describe, expect, it } from 'vitest';
import { selectScheduledTaskHistorySummary } from './scheduled-task-history-summary.js';

describe('selectScheduledTaskHistorySummary', () => {
  it('selects the newest non-empty assistant message', () => {
    expect(
      selectScheduledTaskHistorySummary([
        { role: 'user', blocks: [{ type: 'text', text: 'latest user prompt' }] },
        { role: 'assistant', blocks: [{ type: 'text', text: '   ' }] },
        { role: 'assistant', blocks: [{ type: 'text', text: '  latest result  ' }] },
        { role: 'assistant', blocks: [{ type: 'text', text: 'older result' }] },
      ]),
    ).toBe('latest result');
  });

  it('joins trimmed text blocks and ignores non-text content', () => {
    expect(
      selectScheduledTaskHistorySummary([
        {
          role: 'assistant',
          blocks: [
            { type: 'text', text: ' first ' },
            { type: 'image' },
            { type: 'text', text: 'second' },
          ],
        },
      ]),
    ).toBe('first\nsecond');
  });

  it('leaves the 200 character persistence limit to the Store', () => {
    const text = 'x'.repeat(240);
    expect(
      selectScheduledTaskHistorySummary([{ role: 'assistant', blocks: [{ type: 'text', text }] }]),
    ).toBe(text);
  });

  it('returns undefined when no assistant text is available', () => {
    expect(
      selectScheduledTaskHistorySummary([
        { role: 'user', blocks: [{ type: 'text', text: 'prompt' }] },
        { role: 'assistant', blocks: [{ type: 'image' }] },
      ]),
    ).toBeUndefined();
  });
});
