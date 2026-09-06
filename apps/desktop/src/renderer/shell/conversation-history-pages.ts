export interface HistoryRange {
  start: number;
  end: number;
}

export interface HistoryRangeGap {
  afterSequence: number;
  beforeSequence: number;
}

export function mergeHistoryRanges(
  ranges: readonly HistoryRange[],
  page: { sequences: readonly number[]; hasMore: boolean },
  beforeSequence?: number,
): HistoryRange[] {
  const sequences = page.sequences.filter(
    (sequence) => Number.isSafeInteger(sequence) && sequence >= 0,
  );
  if (!sequences.length && (page.hasMore || beforeSequence === undefined)) return [...ranges];
  const start = page.hasMore ? Math.min(...sequences) : 0;
  const end = beforeSequence ?? Math.max(...sequences);
  const ordered = [...ranges, { start, end }].sort((left, right) => left.start - right.start);
  const merged: HistoryRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1)
      previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function historyRangeGaps(ranges: readonly HistoryRange[]): HistoryRangeGap[] {
  return ranges
    .slice(1)
    .flatMap((range, index) =>
      range.start > ranges[index].end + 1
        ? [{ afterSequence: ranges[index].end, beforeSequence: range.start }]
        : [],
    );
}

export function mergeHistoryPageMessages<Message extends { id: string; sequence?: number }>(
  previous: readonly Message[],
  incoming: readonly Message[],
  page: { sequences: readonly number[]; hasMore: boolean; latest: boolean },
): Message[] {
  const sequences = page.sequences.filter(
    (sequence) => Number.isSafeInteger(sequence) && sequence >= 0,
  );
  const first = Math.min(...sequences);
  const last = Math.max(...sequences);
  const retained = previous.filter((message) => {
    if (page.latest && !page.hasMore) return false;
    if (message.sequence === undefined || !sequences.length) return true;
    return message.sequence < first || (!page.latest && message.sequence > last);
  });
  const byId = new Map(retained.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()];
}
