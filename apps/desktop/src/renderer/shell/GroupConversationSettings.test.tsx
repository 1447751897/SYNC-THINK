/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollaborationSnapshot } from '@sync-think/shared';
import { GroupConversationSettings } from './GroupConversationSettings.js';

afterEach(cleanup);
function snapshot(description = '', revision = 0): CollaborationSnapshot {
  return {
    conversation: {
      id: 'group',
      workspaceId: 'w',
      kind: 'group',
      title: 'Existing group',
      coordinatorMemberId: 'a',
      policy: {
        allowPeerDirect: false,
        maxConcurrent: 3,
        maxMessageHops: 6,
        maxAutoMessages: 12,
        taskTimeoutSeconds: 120,
        statusTimeoutSeconds: 30,
      },
      createdAt: 'fixture',
      groupDescription: description,
      groupConfigurationRevision: revision,
    },
    members: [],
    messages: [],
    tasks: [],
    attempts: [],
    deliveries: [],
    revision: 1,
    receipts: {},
  };
}
describe('local group conversation settings', () => {
  it('saves this group only using a revision and trimmed text', () => {
    const onCommand = vi.fn();
    render(<GroupConversationSettings snapshot={snapshot()} busy={false} onCommand={onCommand} />);
    fireEvent.change(screen.getByRole('textbox', { name: '群描述' }), {
      target: { value: '  A → B → 主持人  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存群描述' }));
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'group-config',
        conversationId: 'group',
        description: 'A → B → 主持人',
        expectedRevision: 0,
      }),
    );
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'A → B → 主持人');
  });
  it('does not opt legacy groups in silently', () => {
    const onCommand = vi.fn();
    render(<GroupConversationSettings snapshot={snapshot()} busy={false} onCommand={onCommand} />);
    const checkbox = screen.getByRole('checkbox', { name: '协调员组织群讨论' });
    expect(checkbox).toHaveProperty('checked', false);
    fireEvent.click(checkbox);
    expect(onCommand).toHaveBeenCalledWith({
      action: 'policy',
      conversationId: 'group',
      policy: { coordinateDiscussion: true },
    });
  });
  it('retains a local edit on conflict until the user reloads', () => {
    const props = { busy: false, onCommand: vi.fn() };
    const { rerender } = render(
      <GroupConversationSettings {...props} snapshot={snapshot('old', 1)} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my edit' } });
    rerender(<GroupConversationSettings {...props} snapshot={snapshot('remote', 2)} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'my edit');
    expect(screen.getByRole('button', { name: '保存群描述' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '载入最新描述' }));
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'remote');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('recognizes an accepted revision and disables edits while busy', () => {
    const onCommand = vi.fn();
    const { rerender } = render(
      <GroupConversationSettings snapshot={snapshot('old')} busy={false} onCommand={onCommand} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: '保存群描述' }));
    rerender(
      <GroupConversationSettings snapshot={snapshot('new', 1)} busy={true} onCommand={onCommand} />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true);
  });
});
