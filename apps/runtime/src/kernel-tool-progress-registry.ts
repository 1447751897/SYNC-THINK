import type { AssistantTurnSegment } from '@sync-think/protocol';

export interface KernelToolProgress {
  line: string;
  bytes: number;
  at: string;
}

/** Ephemeral external-kernel output, scoped by run and tool call. */
export class KernelToolProgressRegistry {
  private readonly progressByRun = new Map<string, Map<string, KernelToolProgress>>();

  append(runId: string, toolCallId: string, output: string, at: string): KernelToolProgress {
    let byTool = this.progressByRun.get(runId);
    if (!byTool) {
      byTool = new Map();
      this.progressByRun.set(runId, byTool);
    }
    const previous = byTool.get(toolCallId);
    const line =
      output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .at(-1) ??
      previous?.line ??
      '';
    const progress = {
      line,
      bytes: (previous?.bytes ?? 0) + Buffer.byteLength(output, 'utf8'),
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
            progressBytes: progress.bytes,
            progressAt: progress.at,
          }
        : { ...segment };
    });
  }
}
