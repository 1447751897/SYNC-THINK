/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GlobalAgent } from '@sync-think/shared';
import { AgentLibrary } from './AgentLibrary.js';
import { DialogProvider } from './Dialog.js';

vi.mock('./compose-toolbar.js', () => ({
  ModelPickerMenu: () => null,
  ModelTrigger: ({
    label,
    onClick,
  }: {
    label: string;
    onClick(): void;
  }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

const agent: GlobalAgent = {
  id: 'agent-alpha' as GlobalAgent['id'],
  name: 'Agent Alpha',
  avatar: 'A',
  persona: 'Keep the interface consistent.',
  description: '',
  defaultModelId: 'model-alpha' as GlobalAgent['defaultModelId'],
  fallbackModelIds: [],
  skillIds: [],
  mcpServerIds: [],
  reasoningEffort: 'auto',
  archived: false,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};

function renderLibrary(onStartConversation = vi.fn()) {
  return {
    onStartConversation,
    ...render(
      <DialogProvider>
        <AgentLibrary
          agents={[agent]}
          models={[
            {
              modelId: 'model-alpha',
              displayName: 'Model Alpha',
              providerName: 'Provider Alpha',
            },
          ]}
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

describe('AgentLibrary shared visual structure', () => {
  it('keeps an empty description in the card layout and selects the card when editing', () => {
    renderLibrary();

    const card = screen.getByText('Agent Alpha').closest('.shell-library-card');
    expect(card).toBeTruthy();
    expect(card?.querySelector('.shell-library-card__description')?.getAttribute('data-empty')).toBe(
      '1',
    );
    expect(card?.classList.contains('shell-library-card--selected')).toBe(false);

    fireEvent.click(card!);

    expect(card?.classList.contains('shell-library-card--selected')).toBe(true);
    expect(document.querySelector('.shell-library-drawer--agent')).toBeTruthy();
    expect(document.querySelector('[data-testid="agent-detail-drawer"]')).toBeTruthy();
    expect(document.querySelector('.shell-library-drawer__body')).toBeTruthy();
    expect(document.querySelectorAll('.shell-library-field').length).toBeGreaterThan(0);
  });

  it('starts a conversation without opening the edit dialog', () => {
    const onStartConversation = vi.fn();
    renderLibrary(onStartConversation);

    const action = document.querySelector<HTMLButtonElement>('.shell-library-card__action');
    expect(action).toBeTruthy();
    fireEvent.click(action!);

    expect(onStartConversation).toHaveBeenCalledWith('agent-alpha');
    expect(document.querySelector('.shell-library-drawer--agent')).toBeNull();
  });

  it('closes the agent drawer with Escape', () => {
    renderLibrary();
    fireEvent.click(screen.getByText('Agent Alpha').closest('.shell-library-card')!);

    expect(screen.getByTestId('agent-detail-drawer')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('agent-detail-drawer')).toBeNull();
  });
});
