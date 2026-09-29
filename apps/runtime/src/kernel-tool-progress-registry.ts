import type { AssistantTurnSegment } from '@sync-think/protocol';

export const MAX_TOOL_PROGRESS_BYTES = 32 * 1024;
export const MAX_TOOL_PROGRESS_LINES = 400;

export interface KernelToolProgress {
  output: string;
  truncated: boolean;
  line: string;
  bytes: number;
  at: string;
}

/** Ephemeral external-kernel output, scoped by run and tool call. */
export class KernelToolProgressRegistry {
  private readonly progressByRun = new Map<string, Map<string, KernelToolProgress>>();

  append(
    runId: string,
    toolCallId: string,
    output: string,
    at: string,
    options?: { outputBytes?: number; truncated?: boolean; isNotice?: boolean },
  ): KernelToolProgress {
    let byTool = this.progressByRun.get(runId);
    if (!byTool) {
      byTool = new Map();
      this.progressByRun.set(runId, byTool);
    }
    const previous = byTool.get(toolCallId);
    const combined = Buffer.from(
      (previous?.output ?? '') + (options?.isNotice ? '' : output),
      'utf8',
    );
    let start = Math.max(0, combined.length - MAX_TOOL_PROGRESS_BYTES);
    // Start at a UTF-8 codepoint boundary when dropping old output.
    while (start < combined.length && (combined[start]! & 0xc0) === 0x80) start += 1;
    const bounded = combined.subarray(start).toString('utf8');
    const lines = bounded.split('\n');
    const droppedLines = Math.max(0, lines.length - MAX_TOOL_PROGRESS_LINES);
    const tail = droppedLines ? lines.slice(droppedLines).join('\n') : bounded;
    const line = options?.isNotice
      ? output.trim()
      : (tail
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean)
          .at(-1) ??
        previous?.line ??
        '');
    const progress: KernelToolProgress = {
      line,
      output: tail,
      truncated: Boolean(
        previous?.truncated || options?.truncated || start > 0 || droppedLines > 0,
      ),
      bytes:
        (previous?.bytes ?? 0) +
        (options?.isNotice ? 0 : (options?.outputBytes ?? Buffer.byteLength(output, 'utf8'))),
      at,
    };
    byTool.set(toolCallId, progress);
    return { ...progress };
  }

  completeTool(runId: string, toolCallId: string): boolean {
    const byTool = this.progressByRun.get(runId);
    if (!byTool?.delete(toolCallId)) return false;
    if (byTool.size === 0) this.progressByRun.delete(runId);
    return true;
  }

  deleteRun(runId: string): boolean {
    return this.progressByRun.delete(runId);
  }

  projectTimeline(
    runId: string,
    timeline: readonly AssistantTurnSegment[] | undefined,
  ): AssistantTurnSegment[] | undefined {
    if (!timeline?.length) return undefined;
    const byTool = this.progressByRun.get(runId);
    return timeline.map((segment) => {
      if (segment.kind !== 'tool' || segment.status !== 'running' || !byTool) {
        return { ...segment };
      }
      const progress = byTool.get(segment.toolCallId);
      return progress
        ? {
            ...segment,
            progressLine: progress.line,
            progressOutput: progress.output,
            progressTruncated: progress.truncated,
            progressBytes: progress.bytes,
            progressAt: progress.at,
          }
        : { ...segment };
    });
  }
}

/** Transient log tails must never trigger repeated durable timeline writes. */
export function withoutKernelToolProgress(segment: AssistantTurnSegment): AssistantTurnSegment {
  if (segment.kind !== 'tool') return segment;
  const { progressLine, progressOutput, progressTruncated, progressBytes, progressAt, ...durable } =
    segment;
  return durable;
}
