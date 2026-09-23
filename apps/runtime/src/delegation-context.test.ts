import { expect, it } from 'vitest';
import { formatDelegatedRunContext } from './delegation-context.js';
import type { DelegatedRunRecord } from '@sync-think/shared';

it('keeps older running tasks and identifies omitted history explicitly', () => {
  const rows: DelegatedRunRecord[] = Array.from({ length: 20 }, (_, index) => ({
    childRunId: `child-${index}`,
    parentRunId: 'parent',
    threadId: 'thread',
    agentId: 'agent',
    name: 'Reviewer',
    status: index === 0 ? 'running' : 'completed',
    toolCount: 120,
    sequence: index,
    updatedAt: `2026-09-19T00:00:${String(index).padStart(2, '0')}Z`,
  }));
  const context = formatDelegatedRunContext(rows);
  expect(context).toContain('仍在运行；120 项工具调用');
  expect(context).toContain('childRunId: child-0');
  expect(context).toContain('childRunId: child-19');
  expect(context).toContain('另有 11 个历史任务未列出');
});
