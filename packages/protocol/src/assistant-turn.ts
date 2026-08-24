/**
 * One user-visible assistant turn, kept in the exact order emitted by the
 * provider/kernel. The renderer treats this as the source of truth instead of
 * reconstructing order from separately aggregated text/tool fields.
 */
export type AssistantTurnSegment =
  | {
      id: string;
      sequence: number;
      kind: 'thinking';
      text: string;
      status: 'streaming' | 'completed';
      startedAt?: string;
      completedAt?: string;
    }
  | {
      id: string;
      sequence: number;
      kind: 'text';
      phase: 'commentary' | 'final_answer';
      text: string;
      status: 'streaming' | 'completed';
      startedAt?: string;
      completedAt?: string;
    }
  | {
      id: string;
      sequence: number;
      kind: 'tool';
      toolCallId: string;
      name: string;
      displayName?: string;
      inputSummary?: string;
      argumentsJson?: string;
      output?: string;
      isError?: boolean;
      /**
       * Ephemeral live output. Runtime only places these fields on transient
       * snapshots; durable tool events keep the final output in `output`.
       */
      progressLine?: string;
      progressBytes?: number;
      progressAt?: string;
      status: 'running' | 'completed' | 'failed';
      startedAt?: string;
      completedAt?: string;
    }
  | {
      id: string;
      sequence: number;
      kind: 'status';
      statusType: 'retry' | 'model_switch' | 'connection' | 'compaction' | 'other';
      label: string;
      detail?: string;
      durationMs?: number;
      occurredAt?: string;
    };

/**
 * A later tool boundary makes all preceding assistant text execution
 * commentary, even when a provider labeled each text item as a final answer.
 */
export function normalizeAssistantTurnPhases(
  timeline: readonly AssistantTurnSegment[],
): AssistantTurnSegment[] {
  const lastToolSequence = timeline.reduce(
    (latest, segment) => (segment.kind === 'tool' ? Math.max(latest, segment.sequence) : latest),
    Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(lastToolSequence)) return [...timeline];
  return timeline.map((segment) =>
    segment.kind === 'text' &&
    segment.phase === 'final_answer' &&
    segment.sequence < lastToolSequence
      ? { ...segment, phase: 'commentary' }
      : { ...segment },
  );
}
