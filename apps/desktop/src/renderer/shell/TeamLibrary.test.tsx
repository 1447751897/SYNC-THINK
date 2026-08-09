/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GlobalAgent, Team } from '@sync-think/shared';
import { DialogProvider } from './Dialog.js';
import { TeamLibrary } from './TeamLibrary.js';

const agent: GlobalAgent = {
  id: 'agent-alpha' as GlobalAgent['id'],
  name: 'Agent Alpha',
  avatar: 'A',
  persona: 'Coordinate delivery.',
  description: 'Coordinator',
  defaultModelId: 'model-alpha' as GlobalAgent['defaultModelId'],
  fallbackModelIds: [],
  skillIds: [],
  mcpServerIds: [],
  reasoningEffort: 'auto',
  archived: false,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};

const team: Team = {
  id: 'team-alpha' as Team['id'],
  name: 'Team Alpha',
  avatar: 'T',
  mission: '',
  strategy: 'serial',
  members: [],
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};

function renderLibrary(onStartConversation = vi.fn()) {
  return {
    onStartConversation,
    ...render(
      <DialogProvider>
        <TeamLibrary
          teams={[team]}
          agents={[agent]}
          onRefresh={vi.fn()}
          onStartConversation={onStartConversation}
        />
      </DialogProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TeamLibrary shared visual structure', () => {
  it('preserves empty-card spacing and uses the neutral selected card state', () => {
    renderLibrary();

    const card = screen.getByText('Team Alpha').closest('.shell-library-card');
    expect(card).toBeTruthy();
    expect(card?.querySelector('.shell-library-card__description')?.getAttribute('data-empty')).toBe(
      '1',
    );
    expect(card?.querySelector('.shell-library-card__meta')).toBeTruthy();

    fireEvent.click(card!);

    expect(card?.classList.contains('shell-library-card--selected')).toBe(true);
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('shell-library-drawer--team')).toBe(true);
    expect(dialog.getAttribute('data-testid')).toBe('team-detail-drawer');
    expect(dialog.querySelector('.shell-library-drawer__body')).toBeTruthy();
  });

  it('moves the selected style between collaboration strategies', () => {
    renderLibrary();
    fireEvent.click(screen.getByText('Team Alpha').closest('.shell-library-card')!);

    const options = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.shell-library-option'),
    );
    expect(options).toHaveLength(2);
    expect(options[0]?.classList.contains('shell-library-option--selected')).toBe(true);
    expect(options[1]?.classList.contains('shell-library-option--selected')).toBe(false);

    fireEvent.click(options[1]!);

    expect(options[0]?.classList.contains('shell-library-option--selected')).toBe(false);
    expect(options[1]?.classList.contains('shell-library-option--selected')).toBe(true);
  });

  it('starts a team conversation without opening the detail dialog', () => {
    const onStartConversation = vi.fn();
    renderLibrary(onStartConversation);

    const action = document.querySelector<HTMLButtonElement>('.shell-library-card__action');
    expect(action).toBeTruthy();
    fireEvent.click(action!);

    expect(onStartConversation).toHaveBeenCalledWith('team-alpha');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
