import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantTurnSegment } from '@sync-think/protocol';
import { CollaborationProgressPublisher, projectCollaborationRunProgress } from './collaboration-run-progress.js';

const run = (assistantTimeline: AssistantTurnSegment[] = []) => ({ assistantTimeline, assistantText: '', commentaryText: '', legacyPendingText: '' });
const final = (text: string, sequence = 1): AssistantTurnSegment => ({ id: `final-${sequence}`, sequence, kind: 'text', phase: 'final_answer', text, status: 'streaming' });
const tool: AssistantTurnSegment = { id: 't', sequence: 2, kind: 'tool', toolCallId: 't', name: 'read_file', status: 'running' };
afterEach(() => vi.useRealTimers());

describe('collaboration progress channels', () => {
  it('keeps an unclassified preamble out of the answer bubble', () => {
    expect(projectCollaborationRunProgress({ ...run(), legacyPendingText: '我先' })).toMatchObject({ output: '', commentary: '', phase: 'thinking' });
  });
  it('does not copy provider reasoning into either visible text channel', () => {
    const result = projectCollaborationRunProgress(run([{ id: 'r', sequence: 1, kind: 'thinking', text: 'private provider reasoning', status: 'streaming' }]));
    expect(result).toMatchObject({ output: '', commentary: '', phase: 'thinking' });
    expect(JSON.stringify(result)).not.toContain('private provider reasoning');
  });
  it('streams only explicitly classified final text', () => {
    expect(projectCollaborationRunProgress(run([final('先讨论人物')]))).toMatchObject({ output: '先讨论人物', phase: 'answering' });
  });
  it('retracts a mislabeled final prefix after a tool boundary', () => {
    const result = projectCollaborationRunProgress({ ...run([final('我先检查'), tool]), assistantText: '我先检查' });
    expect(result).toMatchObject({ output: '', commentary: '我先检查', phase: 'working', tools: [{ id: 't', name: 'read_file', status: 'running' }] });
  });
  it('keeps progress commentary separate when the final answer follows tool work', () => {
    const result = projectCollaborationRunProgress(run([final('我先检查'), { ...tool, status: 'completed' }, final('我们可以先聊世界观。', 3)]));
    expect(result).toMatchObject({ output: '我们可以先聊世界观。', commentary: '我先检查', phase: 'answering' });
  });
  it('falls back to the classified run fields, never the pending tail', () => {
    expect(projectCollaborationRunProgress({ ...run(), assistantText: '已分类回答', legacyPendingText: '待定片段' }).output).toBe('已分类回答');
  });
});

describe('progress throttling', () => {
  it('flushes the last chunk even when there is no next token to trigger a refresh', () => {
    vi.useFakeTimers(); const publish = vi.fn(); const publisher = new CollaborationProgressPublisher(publish);
    publisher.update({ phase: 'answering', output: '一' });
    vi.advanceTimersByTime(20); publisher.update({ phase: 'answering', output: '一句完整的话' });
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100); expect(publish).toHaveBeenLastCalledWith({ phase: 'answering', output: '一句完整的话' });
    publisher.dispose();
  });
  it('publishes phase changes and clears a provisional bubble immediately', () => {
    vi.useFakeTimers(); const publish = vi.fn(); const publisher = new CollaborationProgressPublisher(publish);
    publisher.update({ phase: 'answering', output: '我先检查' });
    publisher.update({ phase: 'working', output: '', commentary: '我先检查' });
    expect(publish).toHaveBeenCalledTimes(2);
    publisher.dispose();
  });
  it('cancels pending updates on stop and skips identical snapshots', () => {
    vi.useFakeTimers(); const publish = vi.fn(); const publisher = new CollaborationProgressPublisher(publish);
    publisher.update({ phase: 'thinking', output: '' });
    publisher.update({ phase: 'thinking', output: '' }); vi.advanceTimersByTime(120);
    expect(publish).toHaveBeenCalledTimes(1);
    publisher.update({ phase: 'answering', output: '1' });
    publisher.update({ phase: 'answering', output: '12' }); publisher.dispose(); vi.runAllTimers();
    expect(publish).toHaveBeenLastCalledWith({ phase: 'answering', output: '1' });
  });
});
