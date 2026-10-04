export interface ScheduledTaskSummaryBlock {
  type: string;
  text?: string;
}

export interface ScheduledTaskSummaryMessage {
  role: string;
  runId?: string;
  blocks: readonly ScheduledTaskSummaryBlock[];
}

/** Messages are ordered oldest first within each MessageStore.listMessages page. */
export function selectScheduledTaskHistorySummary(
  messages: readonly ScheduledTaskSummaryMessage[],
  runId?: string,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== 'assistant' || (runId !== undefined && message.runId !== runId)) continue;
    const text = message.blocks
      .filter((block) => block.type === 'text' && block.text?.trim())
      .map((block) => block.text!.trim())
      .join('\n')
      .trim();
    if (text) return text;
  }
  return undefined;
}
