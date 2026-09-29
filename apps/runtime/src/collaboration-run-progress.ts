import { normalizeAssistantTurnPhases } from '@sync-think/protocol';
import type { DemoRunState } from './demo-run.js';
import type { CollaborationProgress } from './collaboration-chat-service.js';

/** Unknown provider text is provisional, never a final answer or a reasoning transcript. */
export function projectCollaborationRunProgress(run: Pick<DemoRunState,
  'assistantTimeline' | 'assistantText' | 'commentaryText' | 'legacyPendingText'
>): CollaborationProgress {
  const timeline = normalizeAssistantTurnPhases(run.assistantTimeline ?? []);
  const text = timeline.filter(segment => segment.kind === 'text');
  const output = text.length
    ? text.filter(segment => segment.phase === 'final_answer').map(segment => segment.text).join('')
    : run.assistantText;
  const commentary = text.length
    ? text.filter(segment => segment.phase === 'commentary').map(segment => segment.text).join('')
    : run.commentaryText;
  const tools: NonNullable<CollaborationProgress['tools']> = timeline.flatMap(segment => segment.kind === 'tool' ? [{
    id: segment.toolCallId, name: segment.displayName ?? segment.name,
    arguments: '', // Keep tool payloads in the full execution trace, not in every chat refresh.
    status: segment.status === 'running' ? 'running' as const : segment.status === 'failed' || segment.isError ? 'failed' as const : 'succeeded' as const,
  }] : []);
  const tail = timeline.at(-1);
  const phase = tools.some(tool => tool.status === 'running') ? 'working'
    : run.legacyPendingText || tail?.kind === 'thinking' ? 'thinking'
      : tail?.kind === 'text' && tail.phase === 'commentary' ? 'working'
        : output ? 'answering' : 'thinking';
  return { output, commentary, phase, tools, status: 'running' };
}

/** Throttle token bursts but always publish the final pending update; phase changes are immediate. */
export class CollaborationProgressPublisher {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: CollaborationProgress;
  private last?: CollaborationProgress;
  private lastAt = 0;
  constructor(private readonly publish: (progress: CollaborationProgress) => void) {}

  update(progress: CollaborationProgress): void {
    this.pending = progress;
    if (!this.last || progress.phase !== this.last.phase || Date.now() - this.lastAt >= 120) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), Math.max(1, 120 - (Date.now() - this.lastAt)));
      this.timer.unref?.();
    }
  }

  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    const next = this.pending; this.pending = undefined;
    if (!next || JSON.stringify(next) === JSON.stringify(this.last)) return;
    this.last = next; this.lastAt = Date.now(); this.publish(next);
  }

  dispose(): void { clearTimeout(this.timer); this.timer = undefined; this.pending = undefined; }
}
