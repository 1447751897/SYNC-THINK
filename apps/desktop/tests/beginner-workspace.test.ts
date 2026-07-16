import { describe, expect, it } from 'vitest';
import { projectBeginnerWorkspace } from '../src/renderer/beginner-workspace.js';

describe('beginner workspace overview', () => {
  it('invites creating a project when the catalog is empty', () => {
    const view = projectBeginnerWorkspace({
      hasActiveTask: false,
      hasWorkspace: false,
      connectionState: 'online',
      agentReady: false,
      streaming: false,
      messageCount: 0,
      artifactCount: 0,
      approvalCount: 0,
    });

    expect(view.state).toBe('empty');
    expect(view.action).toBe('create-project');
    expect(view.actionLabel).toMatch(/新建项目/);
    expect(view.emptyTitle).toMatch(/推进/);
    expect(view.showNextStepStrip).toBe(false);
    expect(view.showProgressSteps).toBe(false);
  });

  it('invites creating a task when projects exist but none is open', () => {
    const view = projectBeginnerWorkspace({
      hasActiveTask: false,
      hasWorkspace: true,
      connectionState: 'online',
      agentReady: false,
      streaming: false,
      messageCount: 0,
      artifactCount: 0,
      approvalCount: 0,
    });

    expect(view.state).toBe('empty');
    expect(view.action).toBe('create-task');
    expect(view.actionLabel).toMatch(/新建任务/);
    expect(view.nextAction).toMatch(/任务/);
    expect(view.showNextStepStrip).toBe(false);
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
    expect(view.showNextStepStrip).toBe(true);
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
    expect(view.showNextStepStrip).toBe(true);
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
    expect(view.emptyTitle).toMatch(/智能体/);
    expect(view.showNextStepStrip).toBe(false);
    expect(view.showProgressSteps).toBe(false);
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
    expect(view.showNextStepStrip).toBe(false);
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
    expect(approval.showNextStepStrip).toBe(true);

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
