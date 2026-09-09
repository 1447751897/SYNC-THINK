import { describe, expect, it } from 'vitest';
import { createWebsiteDemoSession, demoAsk, demoScenes, demoTodo } from './website-demo-state.js';

describe('website ChatApp isolated session', () => {
  it('starts with the real task projection and completes one task at a time', () => {
    const session = createWebsiteDemoSession();
    expect(demoTodo(session.getSnapshot()).items[0].status).toBe('in_progress');
    for (let index = 1; index <= 4; index++) {
      session.next();
      expect(session.getSnapshot().completed).toBe(index);
    }
    expect(session.getSnapshot().phase).toBe('complete');
    session.next();
    expect(session.getSnapshot().completed).toBe(4);
  });
  it('requires answers, plan approval and tool approval in order', async () => {
    const session = createWebsiteDemoSession();
    session.select('flow');
    session.send('检查当前任务');
    expect(session.getSnapshot().phase).toBe('question');
    session.next();
    expect(session.getSnapshot().completed).toBe(0);
    await expect(session.runtime.conversationPlanApprove({ revision: 1 })).rejects.toThrow();
    await session.runtime.conversationAskAnswer({
      askId: demoAsk.askId,
      answers: [
        { id: 'audience', selected: ['产品团队'] },
        { id: 'coverage', selected: ['任务进度'], custom: '键盘交互' },
      ],
    });
    expect(session.getSnapshot().phase).toBe('plan');
    await session.runtime.conversationPlanApprove({ revision: 1 });
    expect(session.getSnapshot().phase).toBe('tool');
    session.approveTool('once');
    expect(session.getSnapshot().phase).toBe('running');
    session.next();
    expect(session.getSnapshot().completed).toBe(1);
  });
  it('revises plans immutably, rejects stale approval, and executes revised steps', async () => {
    const session = createWebsiteDemoSession();
    session.select('plan');
    const previous = session.getSnapshot().plan;
    const revised = {
      ...previous.latest.plan,
      steps: [{ ...previous.latest.plan.steps[0], title: '新任务' }],
    };
    await session.runtime.conversationPlanRevise({ expectedRevision: 1, plan: revised });
    expect(previous.currentRevision).toBe(1);
    expect(session.getSnapshot().plan.revisions).toHaveLength(2);
    await expect(session.runtime.conversationPlanApprove({ revision: 1 })).rejects.toThrow();
    await session.runtime.conversationPlanApprove({ revision: 2 });
    session.approveTool('session');
    expect(demoTodo(session.getSnapshot()).total).toBe(1);
    expect(demoTodo(session.getSnapshot()).items[0].title).toBe('新任务');
    session.next();
    expect(session.getSnapshot().phase).toBe('complete');
  });
  it('cancellation and denial never advance execution', async () => {
    const session = createWebsiteDemoSession();
    session.select('question');
    await session.runtime.conversationAskCancel();
    session.next();
    expect(session.getSnapshot().phase).toBe('cancelled');
    session.select('plan');
    await session.runtime.conversationPlanCancel();
    expect(session.getSnapshot().phase).toBe('cancelled');
    session.select('tool');
    session.denyTool();
    session.next();
    expect(session.getSnapshot().phase).toBe('cancelled');
    expect(session.getSnapshot().completed).toBe(0);
  });
  it('every scene resets pending data, and each session is independent', () => {
    const session = createWebsiteDemoSession();
    const other = createWebsiteDemoSession();
    for (const scene of demoScenes) {
      session.select(scene.id);
      expect(session.getSnapshot().scene).toBe(scene.id);
      expect(session.getSnapshot().plan.currentRevision).toBe(1);
    }
    expect(other.getSnapshot().scene).toBe('tasks');
    expect(other.getSnapshot().revision).toBe(0);
  });
  it('handles retries and subscriptions without duplicate notifications after unsubscribe', () => {
    const session = createWebsiteDemoSession();
    let notifications = 0;
    const unsubscribe = session.subscribe(() => {
      notifications++;
    });
    session.select('error');
    session.retry();
    expect(session.getSnapshot().phase).toBe('running');
    const count = notifications;
    unsubscribe();
    session.next();
    expect(notifications).toBe(count);
  });
  it('keeps the bridge restricted to memory-only demonstration operations', () => {
    const session = createWebsiteDemoSession();
    expect(Object.keys(session.runtime).sort()).toEqual(
      [
        'conversationAskAnswer',
        'conversationAskCancel',
        'conversationPlanApprove',
        'conversationPlanCancel',
        'conversationPlanRevise',
        'readConversationFileDiff',
      ].sort(),
    );
    session.select('flow');
    session.send('x'.repeat(5000));
    expect(session.getSnapshot().messages.at(-1)?.text.length).toBe(2000);
  });
});
