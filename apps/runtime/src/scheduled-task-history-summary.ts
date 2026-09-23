export interface ScheduledTaskSummaryBlock {
  type: string;
  text?: string;
}

export interface ScheduledTaskSummaryMessage {
  role: string;
  blocks: readonly ScheduledTaskSummaryBlock[];
}

/** Messages must be ordered newest first, matching MessageStore.listMessages. */
export function selectScheduledTaskHistorySummary(
  messages: readonly ScheduledTaskSummaryMessage[],
): string | undefined {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const text = message.blocks
      .filter((block) => block.type === 'text' && block.text?.trim())
      .map((block) => block.text!.trim())
      .join('\n')
      .trim();
    if (text) return text;
  }
  return undefined;
}
