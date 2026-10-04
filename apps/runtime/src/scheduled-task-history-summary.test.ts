import type { MessageId, ThreadId } from '@sync-think/shared';
import { MIGRATIONS, openDatabaseAsync, SqliteMessageStore } from '@sync-think/storage';
import { describe, expect, it } from 'vitest';
import { selectScheduledTaskHistorySummary } from './scheduled-task-history-summary.js';

describe('selectScheduledTaskHistorySummary', () => {
  it('selects the second scheduled round from a chronological MessageStore page', () => {
    // listMessages selects the newest page in SQL, then returns that page oldest first.
    const messages = [
      {
        role: 'assistant',
        runId: 'R5MF1XZQGY6H02F8GYEW0D551T',
        sequence: 0,
        blocks: [{ type: 'text', text: '12 + 8 + 5 = 25' }],
      },
      {
        role: 'assistant',
        runId: 'F3ER1XZDR1AEVPN9EBFMH0X7HC',
        sequence: 1,
        blocks: [
          { type: 'reasoning', text: 'This is not the answer' },
          { type: 'text', text: 'SECOND-ROUND：30+5=35' },
        ],
      },
    ];
    const originalOrder = messages.map((message) => message.runId);

    expect(selectScheduledTaskHistorySummary(messages)).toBe('SECOND-ROUND：30+5=35');
    expect(messages.map((message) => message.runId)).toEqual(originalOrder);
  });

  it.each([
    { messageCount: 25, firstSequence: 1, pageLength: 25, hasMore: false },
    { messageCount: 105, firstSequence: 56, pageLength: 50, hasMore: true },
  ])(
    'summarizes the latest first page with $messageCount persisted messages',
    async ({ messageCount, firstSequence, pageLength, hasMore }) => {
      const connection = await openDatabaseAsync({ path: ':memory:' });
      try {
        connection.raw.exec(MIGRATIONS[0]!.sql);
        const threadId = 'summary-pagination-thread' as ThreadId;
        connection.raw
          .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
          .run(threadId, 'summary-pagination-task', '2026-10-02T00:00:00.000Z');
        const store = new SqliteMessageStore(connection.raw);
        for (let sequence = 1; sequence <= messageCount; sequence++) {
          store.append({
            id: ('summary-message-' + sequence) as MessageId,
            threadId,
            role: 'assistant',
            sequence,
            blocks: [
              {
                type: 'text',
                text: sequence === messageCount ? 'SECOND-ROUND：30+5=35' : 'earlier result',
              },
            ],
            createdAt: '2026-10-02T00:00:00.000Z',
          });
        }

        // Match finalizeScheduledTaskRun: no cursor/offset, explicitly limit 50.
        const page = store.listMessages(threadId, { limit: 50 });
        expect(page.messages).toHaveLength(pageLength);
        expect(page.messages[0].sequence).toBe(firstSequence);
        expect(page.messages.at(-1)!.sequence).toBe(messageCount);
        expect(page.hasMore).toBe(hasMore);
        expect(selectScheduledTaskHistorySummary(page.messages)).toBe('SECOND-ROUND：30+5=35');
        if (hasMore) {
          expect(page.nextCursor).toBe(56);
          const olderPage = store.listMessages(threadId, {
            limit: 50,
            beforeSequence: page.nextCursor,
          });
          expect(olderPage.messages[0].sequence).toBe(6);
          expect(olderPage.messages.at(-1)!.sequence).toBe(55);
          expect(selectScheduledTaskHistorySummary(olderPage.messages)).toBe('earlier result');
        }
      } finally {
        connection.raw.close();
      }
    },
  );

  it('binds summaries to this run instead of another later reply', () => {
    const messages = [
      { role: 'assistant', runId: 'current', blocks: [{ type: 'text', text: 'current result' }] },
      { role: 'assistant', runId: 'other', blocks: [{ type: 'text', text: 'other result' }] },
    ];
    expect(selectScheduledTaskHistorySummary(messages, 'current')).toBe('current result');
  });

  it('does not recycle an older successful summary when this run has no answer', () => {
    const messages = [
      { role: 'assistant', runId: 'old', blocks: [{ type: 'text', text: 'old success' }] },
      { role: 'assistant', blocks: [{ type: 'text', text: 'legacy unbound result' }] },
      { role: 'assistant', runId: 'current', blocks: [{ type: 'reasoning', text: 'no answer' }] },
    ];
    expect(selectScheduledTaskHistorySummary(messages, 'current')).toBeUndefined();
  });

  it('selects the newest non-empty assistant message', () => {
    expect(
      selectScheduledTaskHistorySummary([
        { role: 'assistant', blocks: [{ type: 'text', text: 'older result' }] },
        { role: 'assistant', blocks: [{ type: 'text', text: '  latest result  ' }] },
        { role: 'assistant', blocks: [{ type: 'text', text: '   ' }] },
        { role: 'user', blocks: [{ type: 'text', text: 'latest user prompt' }] },
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
