import { describe, expect, it } from 'vitest';
import type { AssistantTurnSegment } from '@sync-think/protocol/assistant-turn';
import { delegatedToolEventsFromTimeline } from './delegation-tool-events.js';

function toolSegment(
  index: number,
  input: { argumentsJson?: string; output?: string } = {},
): AssistantTurnSegment {
  return {
    id: `tool-run-${index}`,
    sequence: index,
    kind: 'tool',
    toolCallId: `toolu_${index}`,
    name: `tool_${index}`,
    ...(input.argumentsJson !== undefined ? { argumentsJson: input.argumentsJson } : {}),
    ...(input.output !== undefined ? { output: input.output } : {}),
    status: 'completed',
  };
}

/**
 * The parent receives this log as a tool result. It used to be unbounded (12 KB
 * per output), which produced an 86 KB payload, tripped the kernel's MCP
 * tool-result limit, and came back as a `<persisted-output>` envelope the
 * desktop cannot parse — so the Agent card disappeared the moment a delegation
 * finished. The bound is what keeps the payload parseable.
 */
describe('delegatedToolEventsFromTimeline', () => {
  it('keeps a short log verbatim', () => {
    const events = delegatedToolEventsFromTimeline([
      toolSegment(0, { argumentsJson: '{"path":"a"}', output: 'one' }),
      toolSegment(1, { output: 'two' }),
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ toolName: 'tool_0', output: 'one' });
    expect(events[0]?.truncated).toBeUndefined();
  });

  it('bounds a long log so the result stays parseable', () => {
    const huge = 'x'.repeat(20_000);
    const events = delegatedToolEventsFromTimeline(
      Array.from({ length: 40 }, (_, index) =>
        toolSegment(index, { argumentsJson: '{"path":"p"}', output: huge }),
      ),
    );

    const serialized = JSON.stringify(events);
    // Well under any plausible MCP tool-result limit, and still valid JSON.
    expect(serialized.length).toBeLessThan(20_000);
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(events[0]?.truncated).toBe(true);
    expect(events[0]?.outputCharacters).toBe(20_000);
    // A large early output does not erase later commands/inputs.
    expect(events).toHaveLength(40);
    expect(events.every((event) => event.arguments === '{"path":"p"}')).toBe(true);
    expect(events.every((event) => event.outputTruncated === true)).toBe(true);
    expect(events.some((event) => event.omitted)).toBe(false);
  });

  it('caps the row count even when outputs are small', () => {
    const events = delegatedToolEventsFromTimeline(
      Array.from({ length: 120 }, (_, index) => toolSegment(index, { output: 'ok' })),
    );

    expect(events.filter((event) => !event.omitted)).toHaveLength(80);
    expect(events.at(-1)).toMatchObject({ omitted: true });
    expect(events.at(-1)?.toolName).toContain('40');
    expect(events.at(-1)?.toolName).toContain('超出显示上限');
  });
});
