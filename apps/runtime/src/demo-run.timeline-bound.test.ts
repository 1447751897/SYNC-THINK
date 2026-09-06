import { describe, expect, it } from 'vitest';
import type { AssistantTurnSegment } from '@sync-think/protocol';
import { MAX_ASSISTANT_TIMELINE_SEGMENTS, boundAssistantTimeline } from './demo-run.js';

function thinking(sequence: number): AssistantTurnSegment {
  return {
    id: `think-${sequence}`,
    sequence,
    kind: 'thinking',
    text: `思考 ${sequence}`,
    status: 'completed',
  };
}

function tool(sequence: number): AssistantTurnSegment {
  return {
    id: `tool-${sequence}`,
    sequence,
    kind: 'tool',
    toolCallId: `call-${sequence}`,
    name: 'command_execution',
    argumentsJson: '{}',
    status: 'completed',
  };
}

describe('boundAssistantTimeline', () => {
  it('keeps early thinking when later command executions overflow the live window', () => {
    const earlyThinking = [thinking(0), thinking(1), thinking(2)];
    const commands = Array.from({ length: MAX_ASSISTANT_TIMELINE_SEGMENTS + 40 }, (_, index) =>
      tool(index + 3),
    );
    const bounded = boundAssistantTimeline([...earlyThinking, ...commands]);

    expect(
      bounded.filter((segment) => segment.kind === 'thinking').map((segment) => segment.id),
    ).toEqual(['think-0', 'think-1', 'think-2']);
    expect(bounded.filter((segment) => segment.kind === 'tool')).toHaveLength(
      MAX_ASSISTANT_TIMELINE_SEGMENTS,
    );
    expect(bounded.some((segment) => segment.id === 'tool-3')).toBe(false);
    expect(bounded.at(-1)?.id).toBe(`tool-${MAX_ASSISTANT_TIMELINE_SEGMENTS + 42}`);
  });
});
