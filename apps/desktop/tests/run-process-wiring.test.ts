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

describe('run process renderer wiring', () => {
  it('loads and stores one projected process object per run', () => {
    expect(chatViewSource).toContain('runProcessById');
    expect(chatViewSource).toContain('.getConversationRunProcess({ runId })');
    expect(chatViewSource).toContain('process: event.snapshot.process');
    expect(chatViewSource).toContain('if (item.process) updateRunProcess(item.process)');
    expect(chatViewSource).toContain('updateRunProcess(frame.process)');
    expect(chatViewSource).toContain(
      'processView={msg.runId ? displayRunProcessById.get(msg.runId) : undefined}',
    );
  });

  it('prefetches historical process views only for the visible message window', () => {
    expect(chatViewSource).toContain('visibleDurableMessages');
    expect(chatViewSource).toContain('const runIds = new Set(');
    expect(chatViewSource).toContain('runProcessRetryTimersRef.current.delete(runId)');
    expect(chatViewSource).not.toContain("loadedMessages\n        .filter((message) => message.role === 'assistant'");
  });

  it('retries transient historical process query failures with bounded backoff', () => {
    expect(chatViewSource).toContain('runProcessRetryTimersRef');
    expect(chatViewSource).toContain('runProcessRetryAttemptsRef');
    expect(chatViewSource).toContain('setRunProcessRetryEpoch((value) => value + 1)');
    expect(chatViewSource).toContain('Math.min(500 * 2 ** Math.min(attempts - 1, 4), 8_000)');
  });

  it('does not project raw events inside production renderer components', () => {
    expect(chatViewSource).not.toContain('projectExecutionProcess');
    expect(processBlockSource).not.toContain('projectExecutionProcess');
    expect(rightRailSource).not.toContain('projectExecutionProcess');
    expect(processBlockSource).toContain('view: RunProcessView');
    expect(processBlockSource).toContain('<ExecutionProcessStepCard');
    expect(processBlockSource).toContain('view.fileChanges.map');
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

  it('batches transient text and reasoning frames to one animation-frame commit', () => {
    expect(chatViewSource).toContain('transientFrameQueueRef');
    expect(chatViewSource).toContain('transientFrameFlushRef');
    expect(chatViewSource).toContain('window.requestAnimationFrame(flushTransientFrames)');
    expect(chatViewSource).toContain('takeConversationDisplayQueueBatch');
    expect(chatViewSource).toContain('maxTextCharacters: 24');
    expect(chatViewSource).toContain('applyConversationStreamOperations');
    expect(chatViewSource).toContain('lastTransientSequenceRef.current = Math.max');
  });

  it('does not let durable terminal events overtake a healthy transient stream', () => {
    expect(chatViewSource).toContain('if (transientStreamHealthyRef.current) return;');
    expect(chatViewSource).not.toContain(
      "batch.operations.filter((operation) => operation.type === 'run.terminal')",
    );
  });
});
