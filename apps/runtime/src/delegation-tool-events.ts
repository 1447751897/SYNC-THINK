import type { AssistantTurnSegment, DelegatedAgentToolEvent } from '@sync-think/protocol';

/**
 * Bounded tool-event log for one delegated child.
 *
 * Used by both paths on purpose. The durable result must stay parseable — a
 * child can call dozens of tools, and the old unbounded 12 KB-per-output log
 * produced an 86 KB result that tripped the kernel's MCP tool-result limit and
 * came back as a `<persisted-output>` envelope the desktop cannot parse (which
 * is why the Agent card vanished the moment a delegation finished). The live
 * transient projection shares the budget so one frame cannot grow to hundreds
 * of kilobytes either. Arguments and output use separate budgets: a large first
 * output must never consume the command/input rows of every later tool call.
 */
const DELEGATED_TOOL_EVENT_BUDGET = 12_000;
const DELEGATED_TOOL_ARGUMENT_BUDGET = 8_000;
const DELEGATED_TOOL_OUTPUT_BUDGET = DELEGATED_TOOL_EVENT_BUDGET - DELEGATED_TOOL_ARGUMENT_BUDGET;
/** Upper bound on returned tool rows; the rest is reported as an omitted count. */
const DELEGATED_TOOL_EVENT_LIMIT = 80;

export function delegatedToolEventsFromTimeline(
  timeline: readonly AssistantTurnSegment[] | undefined,
): DelegatedAgentToolEvent[] {
  const segments = (timeline ?? []).filter(
    (segment): segment is Extract<AssistantTurnSegment, { kind: 'tool' }> =>
      segment.kind === 'tool',
  );
  const events: DelegatedAgentToolEvent[] = [];
  const selected = segments.slice(0, DELEGATED_TOOL_EVENT_LIMIT);
  let argumentBudget = DELEGATED_TOOL_ARGUMENT_BUDGET;
  let outputBudget = DELEGATED_TOOL_OUTPUT_BUDGET;
  const omitted = Math.max(0, segments.length - DELEGATED_TOOL_EVENT_LIMIT);
  for (const [index, segment] of selected.entries()) {
    const remainingRows = selected.length - index;
    const args = segment.argumentsJson ?? '{}';
    const output = segment.output;
    // Fair shares reserve space for every remaining row. Short inputs return
    // unused space to later rows, while a huge command cannot hide its siblings.
    const argumentShare = Math.min(args.length, Math.floor(argumentBudget / remainingRows));
    const renderedArgs = args.slice(0, argumentShare);
    argumentBudget -= renderedArgs.length;
    const outputShare = output
      ? Math.min(output.length, Math.floor(outputBudget / remainingRows))
      : 0;
    const renderedOutput = output?.slice(0, outputShare);
    outputBudget -= renderedOutput?.length ?? 0;
    const argumentsTruncated = renderedArgs.length < args.length;
    const outputTruncated = output !== undefined && renderedOutput?.length !== output.length;
    events.push({
      toolName: segment.name,
      arguments: renderedArgs,
      status: segment.status,
      ...(renderedOutput !== undefined ? { output: renderedOutput } : {}),
      ...(argumentsTruncated || outputTruncated
        ? {
            truncated: true,
            ...(argumentsTruncated
              ? { argumentsTruncated: true, argumentsCharacters: args.length }
              : {}),
            ...(outputTruncated ? { outputTruncated: true, outputCharacters: output.length } : {}),
          }
        : {}),
      ...(segment.startedAt ? { startedAt: segment.startedAt } : {}),
      ...(segment.completedAt ? { completedAt: segment.completedAt } : {}),
    });
  }
  if (omitted > 0) {
    // Tell the card why its log stops early instead of silently looking complete.
    events.push({
      toolName: `…另有 ${omitted} 项工具调用超出显示上限`,
      arguments: '{}',
      status: 'completed',
      omitted: true,
    });
  }
  return events;
}
