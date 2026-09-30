import { describe, expect, it } from 'vitest';
import { createCalendarPreviewRuntime } from './calendar.js';

const ids = {
  agentId: 'agent-1',
  modelId: 'model-1',
  teamId: 'team-1',
  workspaceId: 'workspace-1',
};
describe('isolated calendar QA service', () => {
  it('provides all task types, disabled tasks and recorded results without starting real runs', async () => {
    const service = createCalendarPreviewRuntime(ids, new Date(2026, 8, 30, 10));
    const { tasks } = await service.listScheduledTasks();
    expect(new Set(tasks.map((task) => task.target.kind))).toEqual(
      new Set(['agent', 'model', 'team']),
    );
    expect(tasks.some((task) => !task.enabled)).toBe(true);
    expect(tasks.some((task) => task.lastResult?.status === 'failed')).toBe(true);
    const task = tasks[0]!;
    expect(
      (await service.scheduledTaskHistory({ taskId: task.id })).entries.length,
    ).toBeGreaterThan(0);
    expect((await service.triggerScheduledTask({ taskId: task.id })).fired).toBe(false);
  });

  it('round-trips create and edit only inside its own memory', async () => {
    const service = createCalendarPreviewRuntime(ids, new Date(2026, 8, 30, 10));
    const { task } = await service.createScheduledTask({
      name: '新建日历示例',
      instruction: '检查',
      target: { kind: 'model', modelId: ids.modelId },
      rule: { kind: 'at', runAt: new Date(2027, 0, 2, 10).toISOString() },
      workspaceId: ids.workspaceId,
    });
    expect((await service.listScheduledTasks()).tasks.some((item) => item.id === task.id)).toBe(
      true,
    );
    await service.updateScheduledTask({
      taskId: task.id,
      patch: {
        name: '已修改的示例',
        enabled: false,
        workspaceId: null,
        skillVersionIds: null,
        nextRunAt: null,
      },
    });
    const updated = (await service.listScheduledTasks()).tasks.find((item) => item.id === task.id)!;
    expect(updated).toMatchObject({ name: '已修改的示例', enabled: false });
    expect(updated.workspaceId).toBeUndefined();
    expect(updated.nextRunAt).toBeUndefined();
    expect(
      (await createCalendarPreviewRuntime(ids).listScheduledTasks()).tasks.some(
        (item) => item.name === '已修改的示例',
      ),
    ).toBe(false);
  });
});
