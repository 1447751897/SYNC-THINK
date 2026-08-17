import { describe, expect, it } from 'vitest';
import { normalizeAssistantTurnPhases, type AssistantTurnSegment } from './assistant-turn.js';

describe('normalizeAssistantTurnPhases', () => {
  it('moves text followed by a tool into commentary and keeps the terminal text final', () => {
    const timeline: AssistantTurnSegment[] = [
      {
        id: 'text-before-tool',
        sequence: 1,
        kind: 'text',
        phase: 'final_answer',
        text: '我先检查项目结构。',
        status: 'completed',
      },
      {
        id: 'tool-read',
        sequence: 2,
        kind: 'tool',
        toolCallId: 'tool-read',
        name: 'read_file',
        status: 'completed',
      },
      {
        id: 'text-after-tool',
        sequence: 3,
        kind: 'text',
        phase: 'final_answer',
        text: '项目检查完成。',
        status: 'completed',
      },
    ];

    const normalized = normalizeAssistantTurnPhases(timeline);

    expect(normalized[0]).toMatchObject({ kind: 'text', phase: 'commentary' });
    expect(normalized[2]).toMatchObject({ kind: 'text', phase: 'final_answer' });
  });
});
