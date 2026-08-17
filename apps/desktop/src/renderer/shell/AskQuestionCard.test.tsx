/**
 * @vitest-environment jsdom
 *
 * 问询卡片：通用流（单选自动前进/多选/推荐徽章/自定义/跳过/分页/校验/取消）、
 * plan-review 特例卡（确认/拒绝/去聊天）、工具结果可读渲染。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PendingAsk } from './AskQuestionCard.js';
import { AskQuestionCard, formatAskToolResult } from './AskQuestionCard.js';

const ask: PendingAsk = {
  askId: 'ask-1',
  threadId: 'thread-1',
  runId: 'run-1',
  createdAt: '2025-01-01T00:00:00.000Z',
  questions: [
    {
      id: 'q1',
      question: '继续吗？',
      header: '确认',
      options: [
        { label: '继续（推荐）', description: '继续执行' },
        { label: '停止' },
      ],
    },
    {
      id: 'q2',
      question: '选哪个方案？',
      options: [{ label: '方案 A' }, { label: '方案 B' }],
    },
  ],
};

const planReviewAsk: PendingAsk = {
  askId: 'ask-plan',
  threadId: 'thread-1',
  runId: 'run-1',
  createdAt: '2025-01-01T00:00:00.000Z',
  questions: [
    {
      id: 'plan-q',
      question: '是否执行该方案？',
      intent: { kind: 'plan-review', approve: '确认执行' },
      detail: '# 方案\n1. 步骤一（验收：X）',
      options: [{ label: '确认执行' }, { label: '拒绝' }],
    },
  ],
};

function mockBridge(overrides: Record<string, unknown> = {}) {
  const runtime = {
    conversationAskAnswer: vi.fn(async () => ({ askId: 'ask-1' })),
    conversationAskCancel: vi.fn(async () => ({ askId: 'ask-1' })),
    ...overrides,
  };
  (window as unknown as Record<string, unknown>).syncThink = { runtime };
  return runtime;
}

describe('AskQuestionCard generic flow', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).syncThink;
  });

  it('renders the first question with options and the recommended badge', () => {
    mockBridge();
    render(<AskQuestionCard ask={ask} onSettled={() => undefined} />);
    expect(screen.getByTestId('ask-question-card')).toBeTruthy();
    expect(screen.getByText('确认')).toBeTruthy();
    expect(screen.getByText('继续吗？')).toBeTruthy();
    // 推荐徽章：后缀被剥离，徽章渲染。
    expect(screen.getByText('继续')).toBeTruthy();
    expect(screen.getByText('推荐')).toBeTruthy();
    expect(screen.queryByText('继续（推荐）')).toBeNull();
    expect(screen.getByText('继续执行')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('advances to the next question on single-select choice', () => {
    mockBridge();
    render(<AskQuestionCard ask={ask} onSettled={() => undefined} />);
    fireEvent.click(screen.getByLabelText('继续'));
    expect(screen.getByText('选哪个方案？')).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
    // 上一题可回退。
    fireEvent.click(screen.getByLabelText('上一题'));
    expect(screen.getByText('继续吗？')).toBeTruthy();
  });

  it('submits the whole batch with custom answers on the last question', async () => {
    const runtime = mockBridge();
    const onSettled = vi.fn();
    render(<AskQuestionCard ask={ask} onSettled={onSettled} />);
    fireEvent.click(screen.getByLabelText('继续'));
    fireEvent.change(screen.getByPlaceholderText('输入你的答案'), { target: { value: '都不选' } });
    fireEvent.keyDown(screen.getByPlaceholderText('输入你的答案'), { key: 'Enter' });
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.conversationAskAnswer).toHaveBeenCalledWith({
      askId: 'ask-1',
      answers: [
        { id: 'q1', selected: ['继续（推荐）'] },
        { id: 'q2', selected: [], custom: '都不选' },
      ],
    });
    expect(onSettled).toHaveBeenCalled();
  });

  it('skips a question and blocks submit until the last is answered', async () => {
    const runtime = mockBridge();
    render(<AskQuestionCard ask={ask} onSettled={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '跳过本题' }));
    expect(screen.getByText('选哪个方案？')).toBeTruthy();
    // 最后一道未答时提交被拦截（无 options → textarea 空 → 提交禁用）。
    const submit = screen.getByRole('button', { name: '提交' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('输入你的答案'), { target: { value: '方案 B' } });
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit);
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.conversationAskAnswer).toHaveBeenCalledWith({
      askId: 'ask-1',
      answers: [
        { id: 'q1', selected: [] },
        { id: 'q2', selected: [], custom: '方案 B' },
      ],
    });
  });

  it('cancels the whole batch through the header close button', async () => {
    const runtime = mockBridge();
    const onSettled = vi.fn();
    render(<AskQuestionCard ask={ask} onSettled={onSettled} />);
    fireEvent.click(screen.getByLabelText('放弃整组问题'));
    await Promise.resolve();
    expect(runtime.conversationAskCancel).toHaveBeenCalledWith({ askId: 'ask-1' });
    expect(onSettled).toHaveBeenCalled();
  });

  it('multi-select keeps the checkbox row and submits all selections', async () => {
    const runtime = mockBridge();
    const multi: PendingAsk = {
      ...ask,
      questions: [
        {
          id: 'm1',
          question: '多选？',
          multiSelect: true,
          options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        },
      ],
    };
    render(<AskQuestionCard ask={multi} onSettled={() => undefined} />);
    fireEvent.click(screen.getByLabelText('A'));
    fireEvent.click(screen.getByLabelText('C'));
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.conversationAskAnswer).toHaveBeenCalledWith({
      askId: 'ask-1',
      answers: [{ id: 'm1', selected: ['A', 'C'] }],
    });
  });
});

describe('AskQuestionCard plan-review special card', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).syncThink;
  });

  it('renders the plan review card with the markdown plan', () => {
    mockBridge();
    render(<AskQuestionCard ask={planReviewAsk} onSettled={() => undefined} />);
    expect(screen.getByTestId('ask-plan-review-card')).toBeTruthy();
    expect(screen.getByText('方案待审')).toBeTruthy();
    expect(screen.getByText('步骤一（验收：X）')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认执行' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '去聊天里说' })).toBeTruthy();
  });

  it('approves through the answer command with the approve label', async () => {
    const runtime = mockBridge();
    const onSettled = vi.fn();
    render(<AskQuestionCard ask={planReviewAsk} onSettled={onSettled} />);
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await Promise.resolve();
    expect(runtime.conversationAskAnswer).toHaveBeenCalledWith({
      askId: 'ask-plan',
      answers: [{ id: 'plan-q', selected: ['确认执行'] }],
    });
    expect(onSettled).toHaveBeenCalled();
  });

  it('declines through the decline button', async () => {
    const runtime = mockBridge();
    render(<AskQuestionCard ask={planReviewAsk} onSettled={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await Promise.resolve();
    expect(runtime.conversationAskAnswer).toHaveBeenCalledWith({
      askId: 'ask-plan',
      answers: [{ id: 'plan-q', selected: ['拒绝'] }],
    });
  });
});

describe('formatAskToolResult', () => {
  it('renders selections, custom answers and skips readably', () => {
    expect(
      formatAskToolResult(
        JSON.stringify({
          answers: [
            { id: 'q1', selected: ['继续（推荐）'] },
            { id: 'q2', custom: '都不选' },
            { id: 'q3', selected: [] },
          ],
        }),
      ),
    ).toBe('你选择了：继续（推荐）\n你的回答：都不选\n已跳过');
  });

  it('returns undefined for non-answer payloads', () => {
    expect(formatAskToolResult('plain text')).toBeUndefined();
    expect(formatAskToolResult(JSON.stringify({ ok: true }))).toBeUndefined();
  });
});
