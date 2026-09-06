import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatViewSource = readFileSync(
  new URL('../src/renderer/shell/ChatView.tsx', import.meta.url),
  'utf8',
);
const processBlockSource = readFileSync(
  new URL('../src/renderer/shell/ExecutionProcessBlock.tsx', import.meta.url),
  'utf8',
);
const rightRailSource = readFileSync(
  new URL('../src/renderer/shell/RightRail.tsx', import.meta.url),
  'utf8',
);

const historyHookSource = readFileSync(
  new URL('../src/renderer/shell/use-run-process-history.ts', import.meta.url),
  'utf8',
);
const historyLoaderSource = readFileSync(
  new URL('../src/renderer/shell/run-process-history-loader.ts', import.meta.url),
  'utf8',
);

describe('run process renderer wiring', () => {
  it('loads and stores one projected process object per run', () => {
    expect(chatViewSource).toContain('runProcessById');
    expect(historyHookSource).toContain('api.getConversationRunProcess({ runId: runId as RunId })');
    expect(chatViewSource).toContain('process: event.snapshot.process');
    expect(chatViewSource).toContain('if (item.process) updateRunProcess(item.process)');
    expect(chatViewSource).toContain('updateRunProcess(frame.process)');
    expect(chatViewSource).toContain(
      'processView={msg.runId ? displayRunProcessById.get(msg.runId) : undefined}',
    );
  });

  it('prefetches visible history plus transient and projected active runs', () => {
    expect(chatViewSource).toContain('visibleDurableMessages');
    expect(chatViewSource).toContain('useRunProcessHistoryRequests({');
    expect(chatViewSource).toContain('streamingMessage?.runId, projected.activeRunId');
    expect(historyHookSource).toContain('new IntersectionObserver(');
    expect(historyHookSource).not.toContain('getBoundingClientRect');
    expect(chatViewSource).not.toContain(
      "loadedMessages\n        .filter((message) => message.role === 'assistant'",
    );
  });

  it('retries transient historical process query failures with bounded backoff', () => {
    expect(historyLoaderSource).toContain('entry.attempts < 3');
    expect(historyLoaderSource).toContain('this.inFlight.size < 3');
    expect(chatViewSource).toContain('onRetryProcess={retryRunProcess}');
    expect(chatViewSource).not.toContain('runProcessRetryTimersRef');
  });

  it('does not project raw events inside production renderer components', () => {
    expect(chatViewSource).not.toContain('projectExecutionProcess');
    expect(processBlockSource).not.toContain('projectExecutionProcess');
    expect(rightRailSource).not.toContain('projectExecutionProcess');
    expect(processBlockSource).toContain('view: RunProcessView');
    expect(processBlockSource).toContain('<ExecutionProcessStepCard');
    expect(processBlockSource).toContain(
      'view.fileChanges.slice(0, FILE_CHANGES_CARD_PREVIEW_LIMIT)',
    );
    expect(processBlockSource).toContain('renderChangeItems(previewItems)');
  });

  it('memoizes message bubbles and keeps list callbacks stable during process updates', () => {
    expect(chatViewSource).toContain('const MessageBubble = memo(function MessageBubble');
    expect(chatViewSource).toContain('onRegenerate={handleRegenerate}');
    expect(chatViewSource).toContain('onOpenChange={onOpenFile}');
    expect(chatViewSource).toContain('onOpenReview={onOpenReview}');
    expect(chatViewSource).toContain('projectFolder={projectFolder}');
    expect(chatViewSource).not.toContain('onExpandRail={expandRail}');
    expect(chatViewSource).not.toContain('onRegenerate={() => void handleRegenerate(msg.id)}');
  });

  it('uses one adaptive display batch per animation frame and reschedules bounded catch-up', () => {
    expect(chatViewSource).toContain('transientFrameQueueRef');
    expect(chatViewSource).toContain('transientFrameFlushRef');
    expect(chatViewSource).toContain('getConversationDisplayQueueFlushDelay(queued)');
    expect(chatViewSource).toContain('takeConversationDisplayQueueBatch');
    expect(chatViewSource).toContain('getConversationDisplayQueueBatchOptions(queued)');
    expect(chatViewSource).not.toContain('while (queued.length > 0)');
    expect(chatViewSource).toContain(
      'if (queued.length > 0 && transientFrameFlushRef.current === null)',
    );
    expect(chatViewSource).toContain('applyConversationStreamOperations');
    expect(chatViewSource).toContain('lastTransientSequenceRef.current = Math.max');
  });

  it('pins goal rounds to the composer model and kernel route', () => {
    expect(chatViewSource).toContain('const goalModelId = resolveSendModelId');
    expect(chatViewSource).toContain('modelId: goalModelId');
    expect(chatViewSource).toContain('kernelId: kernelOverride');
  });

  it('does not let durable terminal events overtake a healthy transient stream', () => {
    expect(chatViewSource).toContain('if (transientStreamHealthyRef.current) return;');
    expect(chatViewSource).not.toContain(
      "batch.operations.filter((operation) => operation.type === 'run.terminal')",
    );
  });
});
