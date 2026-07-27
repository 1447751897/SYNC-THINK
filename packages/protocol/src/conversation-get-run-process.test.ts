import { describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame } from './framing.js';
import { req, type ConversationGetRunProcessResponse } from './commands.js';
import { DEFAULT_FEATURES } from './version.js';

describe('conversation.getRunProcess protocol', () => {
  it('registers the command and builds its typed request', () => {
    expect(DEFAULT_FEATURES).toContain('conversation.getRunProcess');
    expect(req('conversation.getRunProcess', { runId: 'run-1' }, 'request-1')).toEqual({
      type: 'conversation.getRunProcess',
      payload: { runId: 'run-1' },
      requestId: 'request-1',
    });
  });

  it('round-trips one already projected run process view', () => {
    const payload: ConversationGetRunProcessResponse = {
      process: {
        runId: 'run-1' as never,
        steps: [
          {
            id: 'call-1',
            label: 'Read ? src/main.ts',
            verb: 'Read',
            zh: '????',
            toolName: 'read_file',
            kind: 'read',
            status: 'done',
            path: 'src/main.ts',
            preview: 'export const ready = true;',
          },
        ],
        fileChanges: [],
        running: false,
        doneCount: 1,
        errorCount: 0,
      },
    };
    const encoded = encodeFrame({
      id: 'response-1',
      kind: 'response',
      type: 'conversation.getRunProcess',
      payload,
    });
    expect(decodeFrames(encoded).frames[0]?.payload).toEqual(payload);
  });
});
