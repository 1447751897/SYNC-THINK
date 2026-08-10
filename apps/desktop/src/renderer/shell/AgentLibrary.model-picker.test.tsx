/**
 * @vitest-environment jsdom
 *
 * Real-interaction coverage for the agent drawer default-model picker.
 * This file deliberately does NOT mock compose-toolbar: it exercises the real
 * Radix DropdownMenu root flow inside the tabbed drawer. Radix sub-menus
 * (provider → model flyout) cannot be reliably driven by jsdom events, so the
 * sub-menu step is covered by the mocked menu test in AgentLibrary.test.tsx;
 * here we verify the menu opens, providers render, and the overview tab offers
 * a jump into the editable settings tab.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GlobalAgent } from '@sync-think/shared';
import { AgentLibrary } from './AgentLibrary.js';
import { DialogProvider } from './Dialog.js';

// ── jsdom polyfills for Radix popper ────────────────────────────────────────
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const originalRect = window.HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  // Radix positions menus from the trigger rect; give elements a real size.
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      right: 210,
      bottom: 40,
      width: 200,
      height: 30,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

afterEach(() => {
  window.HTMLElement.prototype.getBoundingClientRect = originalRect;
});

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

const runtime = {
  listSkills: vi.fn().mockResolvedValue({ skills: [] }),
  listMcpServers: vi.fn().mockResolvedValue({ servers: [] }),
};

beforeEach(() => {
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
  vi.clearAllMocks();
});

function openDrawer() {
  render(
    <DialogProvider>
      <AgentLibrary
        agents={[agent]}
        models={[
          { modelId: 'model-alpha', displayName: 'Model Alpha', providerName: 'Provider Alpha' },
          { modelId: 'model-beta', displayName: 'Model Beta', providerName: 'Provider Alpha' },
        ]}
        onRefresh={vi.fn()}
      />
    </DialogProvider>,
  );
  fireEvent.click(screen.getByText('Agent Alpha').closest('.shell-library-card')!);
}

describe('AgentLibrary default model picker (real Radix menu)', () => {
  it('opens the model menu from the settings tab and lists providers', async () => {
    openDrawer();
    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));

    // The trigger shows the current default model.
    const trigger = screen.getByTitle('切换模型');
    expect(trigger.textContent).toContain('Model Alpha');

    // Clicking the trigger opens the provider menu (real Radix flow).
    fireEvent.click(trigger);
    expect(await screen.findByTestId('model-provider-Provider Alpha')).toBeTruthy();
  });

  it('jumps from the overview model row to the editable settings tab', () => {
    openDrawer();

    // Overview shows the model read-only with a 修改 jump button.
    expect(screen.getByTestId('agent-drawer-overview')).toBeTruthy();
    fireEvent.click(screen.getByTestId('agent-overview-edit-model'));

    // Lands on the settings tab where the picker trigger lives.
    expect(screen.getByTestId('agent-drawer-settings')).toBeTruthy();
    expect(screen.getByTitle('切换模型').textContent).toContain('Model Alpha');
  });

  it('opens the model menu when the 默认模型 field label is clicked', async () => {
    openDrawer();
    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));

    // Clicking the field label (not the button) must also open the picker.
    fireEvent.click(screen.getByText('默认模型 *'));
    expect(await screen.findByTestId('model-provider-Provider Alpha')).toBeTruthy();
  });
});
