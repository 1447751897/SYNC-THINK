import { describe, expect, it } from 'vitest';
import { projectBeginnerWorkspace } from '../src/renderer/beginner-workspace.js';

describe('beginner workspace overview', () => {
  it('guides an empty workspace to the task list', () => {
    const view = projectBeginnerWorkspace({
      hasActiveTask: false,
      connectionState: 'online',
      agentReady: false,
      streaming: false,
      messageCount: 0,
      artifactCount: 0,
      approvalCount: 0,
    });

    expect(view.state).toBe('empty');
    expect(view.nextAction).toMatch(/任务/);
    expect(view.action).toBe('tasks');
    expect(view.steps.map((step) => step.state)).toEqual(['active', 'pending', 'pending']);
  });

  it('prioritizes connection recovery before Agent setup', () => {
    const view = projectBeginnerWorkspace({
      hasActiveTask: true,
      connectionState: 'offline',
      agentReady: false,
      streaming: false,
      messageCount: 0,
      artifactCount: 0,
      approvalCount: 0,
    });

    expect(view.state).toBe('offline');
    expect(view.action).toBe('reconnect');
    expect(view.nextAction).toMatch(/连接/);
  });

  it('asks for Agent runtime setup before the first message', () => {
    const view = projectBeginnerWorkspace({
      hasActiveTask: true,
      connectionState: 'online',
      agentReady: false,
      streaming: false,
      messageCount: 0,
      artifactCount: 0,
      approvalCount: 0,
    });

    expect(view.state).toBe('setup');
    expect(view.action).toBe('agent');
    expect(view.nextAction).toMatch(/模型/);
  });

  it('makes Compose the next step when the task is ready', () => {
    const view = projectBeginnerWorkspace({
      hasActiveTask: true,
      connectionState: 'online',
      agentReady: true,
      streaming: false,
      messageCount: 0,
      artifactCount: 0,
      approvalCount: 0,
    });

    expect(view.state).toBe('ready');
    expect(view.action).toBe('compose');
    expect(view.steps.map((step) => step.state)).toEqual(['complete', 'active', 'pending']);
  });

  it('shows active work without asking for another action', () => {
    const view = projectBeginnerWorkspace({
      hasActiveTask: true,
      connectionState: 'online',
      agentReady: true,
      streaming: true,
      messageCount: 2,
      artifactCount: 0,
      approvalCount: 0,
    });

    expect(view.state).toBe('working');
    expect(view.action).toBe('none');
    expect(view.statusLabel).toMatch(/处理/);
  });

  it('surfaces approvals and results without exposing execution jargon', () => {
    const approval = projectBeginnerWorkspace({
      hasActiveTask: true,
      connectionState: 'online',
      agentReady: true,
      streaming: false,
      messageCount: 4,
      artifactCount: 0,
      approvalCount: 2,
    });
    expect(approval.state).toBe('approval');
    expect(approval.action).toBe('approvals');

    const result = projectBeginnerWorkspace({
      hasActiveTask: true,
      connectionState: 'online',
      agentReady: true,
      streaming: false,
      messageCount: 4,
      artifactCount: 1,
      approvalCount: 0,
    });
    expect(result.state).toBe('result');
    expect(result.action).toBe('artifacts');
    expect(result.steps.map((step) => step.state)).toEqual(['complete', 'complete', 'complete']);
    expect(`${result.statusLabel} ${result.statusDetail} ${result.nextAction}`).not.toMatch(
      /manifest|trace|event|token|run id/i,
    );
  });
});
