/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CollaborationSnapshot } from '@sync-think/shared';
import { CollaborationResultsPanel } from './CollaborationTaskTrace.js';
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));
afterEach(cleanup);
it('does not promote a failed attempt or an old version into an accepted delivery', () => {
  const snapshot = { members: [{ id: 'writer', name: '主笔' }], tasks: [{ id: 't', currentAttemptId: 'new', assigneeMemberId: 'writer' }], attempts: [
    { id: 'old', number: 1, status: 'succeeded', artifacts: [{ id: 'old-doc', taskId: 't', title: '旧稿', content: '旧', kind: 'document', bytes: 3, sha256: 'old', createdAt: '2026-09-30' }] },
    { id: 'new', number: 2, status: 'failed', artifacts: [{ id: 'new-doc', taskId: 't', title: '未完成稿', content: '雨。 😀', kind: 'document', bytes: 11, sha256: 'new', createdAt: '2026-10-01' }] },
  ] } as unknown as CollaborationSnapshot;
  render(<CollaborationResultsPanel snapshot={snapshot} onSelect={vi.fn()} onSelectTask={vi.fn()} />);
  expect(screen.getByRole('button', { name: /旧稿.*历史版本/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /未完成稿.*草稿/ })).toBeTruthy();
  expect(screen.queryByText(/已交付/)).toBeNull(); expect(screen.getByText(/整份文档 3 字符/)).toBeTruthy();
  expect(screen.getByText(/此历史版本没有本地文件记录/)).toBeTruthy();
});
