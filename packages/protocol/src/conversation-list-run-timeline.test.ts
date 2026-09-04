import { describe, expect, it } from 'vitest';
import { req, type ConversationListRunTimelineResponse } from './commands.js';

describe('conversation.listRunTimeline protocol', () => {
  it('builds a paginated request and carries ordered assistant segments', () => {
    expect(
      req(
        'conversation.listRunTimeline',
        { runId: 'run-1', cursor: 'cursor-1', limit: 64 },
        'request-1',
      ),
    ).toEqual({
      type: 'conversation.listRunTimeline',
      payload: { runId: 'run-1', cursor: 'cursor-1', limit: 64 },
      requestId: 'request-1',
    });

    const response: ConversationListRunTimelineResponse = {
      segments: [
        {
          id: 'think-1',
          sequence: 0,
          kind: 'thinking',
          text: 'Inspecting files',
          status: 'completed',
        },
      ],
      totalSegments: 1,
    };
    expect(response.totalSegments).toBe(1);
  });
});
