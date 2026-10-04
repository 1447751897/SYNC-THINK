/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GlobalAgent } from '@sync-think/shared';
import { NewConversationDialog } from './NewConversationDialog.js';

afterEach(() => cleanup());

const agents: GlobalAgent[] = [
  { id: 'agent-a', name: 'Agent A', description: 'A', enabled: true, archived: false } as GlobalAgent,
  { id: 'agent-b', name: 'Agent B', description: 'B', enabled: true, archived: false } as GlobalAgent,
  { id: 'agent-c', name: 'Agent C', description: 'C', enabled: true, archived: false } as GlobalAgent,
];

function renderDialog(onPickCollaboration: NonNullable<React.ComponentProps<typeof NewConversationDialog>['onPickCollaboration']>) {
  return render(
    <NewConversationDialog
      track="agent"
      models={[]}
      agents={agents}
      teams={[]}
      onPick={vi.fn()}
      onPickCollaboration={onPickCollaboration}
      onGoToLibrary={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('NewConversationDialog collaboration selection', () => {
  it('returns the explicitly selected direct agent', () => {
    const onPick = vi.fn();
    renderDialog(onPick);
    fireEvent.click(screen.getByRole('button', { name: /智能体单聊/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent B' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(onPick).toHaveBeenCalledWith('direct', '', ['agent-b']);
  });

  it('returns all explicitly selected group agents', () => {
    const onPick = vi.fn();
    renderDialog(onPick);
    fireEvent.click(screen.getByRole('button', { name: /群聊/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent C' }));
    const picker = screen.getByTestId('collaboration-picker');
    expect(picker.textContent).toContain('Agent B + Agent C');
    fireEvent.click(screen.getByRole('button', { name: '创建群聊（2 位）' }));
    expect(onPick).toHaveBeenCalledWith('group', '', ['agent-b', 'agent-c']);
  });

  it('removes a member from its pill', () => {
    const onPick = vi.fn();
    renderDialog(onPick);
    fireEvent.click(screen.getByRole('button', { name: /群聊/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent B' }));
    fireEvent.click(screen.getByRole('button', { name: '移除Agent A' }));
    expect(screen.queryByRole('button', { name: '移除Agent A' })).toBeNull();
    expect((screen.getByRole('button', { name: '创建群聊（1 位）' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '移除Agent B' }));
    expect((screen.getByRole('button', { name: '创建群聊' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
