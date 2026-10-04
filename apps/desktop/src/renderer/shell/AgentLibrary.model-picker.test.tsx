/**
 * @vitest-environment jsdom
 *
 * Real-interaction coverage for the agent drawer default-model picker.
 * This file deliberately does NOT mock compose-toolbar: it exercises the real
 * model panel inside the Radix modal, including focus ownership, missing-model
 * repair and persistence. A body-level portal can look correct while Radix
 * blocks its pointer events, focus and accessibility tree.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GlobalAgent } from '@sync-think/shared';
import { AgentLibrary } from './AgentLibrary.js';
import { DialogProvider } from './Dialog.js';
import { invalidateMcpCatalog } from './mcp-catalog-loader.js';
import { invalidateSkillCatalog } from './skill-catalog-loader.js';

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
  writePolicy: 'read-only',
  archived: false,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};

const runtime = {
  detectKernels: vi.fn().mockResolvedValue({ kernels: [
    { kernelId: 'native', name: '原生内核', icon: 'native', installed: true, capabilities: {} },
    { kernelId: 'codex', name: 'Codex', icon: 'codex', installed: true, version: '1.0', capabilities: {} },
  ] }),
  updateGlobalAgent: vi.fn().mockResolvedValue({ agent }),
  listSkills: vi.fn().mockResolvedValue({ skills: [] }),
  listMcpServers: vi.fn().mockResolvedValue({ servers: [] }),
};

beforeEach(() => {
  invalidateMcpCatalog();
  invalidateSkillCatalog();
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

function openDrawer(currentAgent: GlobalAgent = agent) {
  render(
    <DialogProvider>
      <AgentLibrary
        agents={[currentAgent]}
        models={[
          { modelId: 'model-alpha', displayName: 'Model Alpha', providerName: 'Provider Alpha' },
          { modelId: 'model-beta', displayName: 'Model Beta', providerName: 'Provider Alpha' },
        ]}
        onRefresh={vi.fn()}
      />
    </DialogProvider>,
  );
  fireEvent.click(screen.getByText('Agent Alpha').closest('.agent-card')!);
}

describe('AgentLibrary default model picker (real modal interaction)', () => {
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

  it('keeps the panel inside the modal focus scope and allows model search', async () => {
    openDrawer();
    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
    fireEvent.click(screen.getByTitle('切换模型'));
    const drawer = screen.getByTestId('agent-detail-drawer');
    const picker = await screen.findByRole('dialog', { name: '选择模型' });
    expect(drawer.contains(picker)).toBe(true);
    const search = screen.getByRole('textbox', { name: '搜索模型' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: 'Beta' } });
    expect(screen.queryByRole('menuitemradio', { name: /Model Alpha/ })).toBeNull();
    expect(screen.getByRole('menuitemradio', { name: /Model Beta/ })).toBeTruthy();
  });

  it('repairs an unavailable default model with a real selection and saves the new id', async () => {
    openDrawer({ ...agent, defaultModelId: 'removed-model' as GlobalAgent['defaultModelId'] });
    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
    expect(screen.getByTitle('切换模型').textContent).toContain('模型不可用');
    fireEvent.click(screen.getByTitle('切换模型'));
    const option = await screen.findByRole('menuitemradio', { name: /Model Beta/ });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(screen.getByTitle('切换模型').textContent).toContain('Model Beta');
    expect(screen.getByTestId('agent-detail-drawer')).toBeTruthy();
    expect(option.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(runtime.updateGlobalAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: agent.id, defaultModelId: 'model-beta' }),
    ));
  });

  it('dismisses the picker with Escape without closing the drawer or losing the draft', async () => {
    openDrawer();
    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
    fireEvent.click(screen.getByTitle('切换模型'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Model Beta/ }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: '搜索模型' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '选择模型' })).toBeNull();
    expect(screen.getByTestId('agent-detail-drawer')).toBeTruthy();
    expect(screen.getByTitle('切换模型').textContent).toContain('Model Beta');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('agent-detail-drawer')).toBeNull();
  });

  it('dismisses only the kernel submenu with the first Escape inside the modal', async () => {
    openDrawer();
    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
    await waitFor(() => expect(runtime.detectKernels).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle('切换模型'));
    fireEvent.click(await screen.findByTestId('model-kernel-trigger'));
    fireEvent.keyDown(await screen.findByTestId('kernel-option-native'), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '选择内核' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '选择模型' })).toBeTruthy();
    expect(screen.getByTestId('agent-detail-drawer')).toBeTruthy();
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


it('saves the selected kernel on the agent, together with its default model', async () => {
  openDrawer();
  fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
  await waitFor(() => expect(runtime.detectKernels).toHaveBeenCalled());
  fireEvent.click(screen.getByTitle('切换模型'));
  fireEvent.click(await screen.findByTestId('model-kernel-trigger'));
  fireEvent.click(await screen.findByTestId('kernel-option-codex'));
  expect(screen.getByTitle('切换模型').textContent).toContain('GPT');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(runtime.updateGlobalAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: agent.id, defaultModelId: 'model-alpha', defaultKernelId: 'codex' })));
});
