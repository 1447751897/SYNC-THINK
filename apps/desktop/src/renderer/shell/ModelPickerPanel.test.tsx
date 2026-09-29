/** @vitest-environment jsdom */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ModelPickerMenu } from './compose-toolbar.js';
const models = [
  { modelId: 'a', displayName: 'GPT Example', providerName: 'Custom', providerId: 'first' },
  { modelId: 'b', displayName: 'DeepSeek Example', providerName: 'Custom', providerId: 'second' },
  { modelId: 'c', displayName: 'Claude Example', providerName: 'Anthropic', providerId: 'third' },
];
function setup(selectedModelId = 'b') {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const props = {
    open: true,
    models,
    selectedModelId,
    defaultLabel: '选择模型',
    anchorEl: anchor,
    reasoningEffort: 'high' as const,
    onClose: vi.fn(),
    onPick: vi.fn(),
    onReasoningChange: vi.fn(),
  };
  render(<ModelPickerMenu {...props} />);
  return props;
}
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});
describe('model picker provider rail', () => {
  it('keeps the controlled picker and search open across repeated selections and effort changes', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    function Picker() {
      const [open, setOpen] = useState(true);
      const [selected, setSelected] = useState('b');
      const [effort, setEffort] = useState<'high' | 'max'>('high');
      return (
        <ModelPickerMenu
          open={open}
          models={models}
          selectedModelId={selected}
          defaultLabel="模型"
          anchorEl={anchor}
          onClose={() => setOpen(false)}
          onPick={setSelected}
          reasoningEffort={effort}
          onReasoningChange={(value) => {
            if (value === 'high' || value === 'max') setEffort(value);
          }}
        />
      );
    }
    render(<Picker />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索模型' }), {
      target: { value: 'Example' },
    });
    for (const name of ['GPT Example', 'DeepSeek Example']) {
      fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(name) }));
      expect(screen.getByRole('dialog', { name: '选择模型' })).toBeTruthy();
      expect(
        screen.getByRole('menuitemradio', { name: new RegExp(name) }).getAttribute('aria-checked'),
      ).toBe('true');
      expect((screen.getByRole('textbox', { name: '搜索模型' }) as HTMLInputElement).value).toBe(
        'Example',
      );
    }
    fireEvent.click(screen.getByTestId('model-reasoning-trigger'));
    fireEvent.click(screen.getByTestId('model-reasoning-option-max'));
    expect(screen.getByTestId('model-reasoning-trigger').getAttribute('aria-label')).toBe(
      '思考强度：最高',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '选择模型' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: '选择模型' })).toBeNull();
  });
  it('keeps kernels collapsed to an icon row and opens choices only on demand', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    render(
      <ModelPickerMenu
        open
        models={models}
        selectedModelId="a"
        defaultLabel="模型"
        anchorEl={anchor}
        onClose={vi.fn()}
        onPick={vi.fn()}
        kernels={[
          {
            kernelId: 'native',
            name: 'Sync-Think',
            icon: 'native',
            installed: true,
            version: null,
            executablePath: null,
            knownGood: true,
            capabilities: {
              permission: 'own',
              permissionBridge: false,
              pause: 'executor',
              compress: 'own',
              usageReport: true,
              protocols: [],
            },
          },
        ]}
        selectedKernelId="native"
      />,
    );
    const menu = screen.getByRole('dialog', { name: '选择模型' });
    expect(within(menu).queryByRole('menu', { name: '选择内核' })).toBeNull();
    const trigger = screen.getByTestId('model-kernel-trigger');
    expect(trigger.textContent).toBe('内核');
    expect(trigger.getAttribute('aria-label')).toContain('Sync-Think');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(within(menu).getByRole('menu', { name: '选择内核' })).toBeTruthy();
    expect(within(menu).getByTestId('kernel-option-native').getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(screen.getByTestId('kernel-option-native'));
    expect(screen.queryByRole('menu', { name: '选择内核' })).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });
  it('updates only the current kernel icon after selection and supports keyboard dismissal', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const capabilities = {
      permission: 'own' as const,
      permissionBridge: false,
      pause: 'executor' as const,
      compress: 'own' as const,
      usageReport: true,
      protocols: [],
    };
    const kernels = [
      {
        kernelId: 'native',
        name: 'Sync-Think',
        icon: 'native' as const,
        installed: true,
        version: null,
        executablePath: null,
        knownGood: true,
        capabilities,
      },
      {
        kernelId: 'codex',
        name: 'Codex',
        icon: 'codex' as const,
        installed: true,
        version: '1.0',
        executablePath: 'codex',
        knownGood: true,
        capabilities,
      },
    ];
    const close = vi.fn();
    function Picker() {
      const [kernel, setKernel] = useState('native');
      return (
        <ModelPickerMenu
          open
          models={models}
          selectedModelId="a"
          defaultLabel="模型"
          anchorEl={anchor}
          onClose={close}
          onPick={vi.fn()}
          kernels={kernels}
          selectedKernelId={kernel}
          onPickKernel={setKernel}
        />
      );
    }
    render(<Picker />);
    const trigger = screen.getByTestId('model-kernel-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('kernel-option-native'));
    fireEvent.keyDown(screen.getByRole('menu', { name: '选择内核' }), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('kernel-option-codex'));
    fireEvent.click(screen.getByTestId('kernel-option-codex'));
    expect(screen.queryByRole('menu', { name: '选择内核' })).toBeNull();
    expect(trigger.textContent).toBe('内核');
    expect(trigger.getAttribute('aria-label')).toContain('GPT');
    expect(screen.getByTestId('model-kernel-current').getAttribute('data-kernel-id')).toBe('codex');
    fireEvent.click(trigger);
    expect(screen.getByTestId('kernel-option-codex').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '选择内核' })).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('textbox', { name: '搜索模型' }));
    expect(screen.queryByRole('menu', { name: '选择内核' })).toBeNull();
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('starts on the selected model provider and separates duplicate provider names by ID', () => {
    setup();
    const tabs = screen.getAllByRole('tab', { name: 'Custom' });
    expect(tabs).toHaveLength(2);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('GPT Example')).toBeNull();
    fireEvent.click(tabs[0]!);
    expect(screen.getByText('GPT Example')).toBeTruthy();
    expect(screen.queryByText('DeepSeek Example')).toBeNull();
  });
  it('searches all providers and selects a result through the existing callback', () => {
    const props = setup();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索模型' }), {
      target: { value: 'claude' },
    });
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Claude Example/ }));
    expect(props.onPick).toHaveBeenCalledWith('c');
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it('offers keyboard navigation and closes only the nested effort panel on first Escape', () => {
    const props = setup();
    const search = screen.getByRole('textbox', { name: '搜索模型' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio'));
    const trigger = screen.getByTestId('model-reasoning-trigger');
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '思考强度' })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledOnce();
  });
  it('maps the discrete slider to the existing effort values without choosing a different model', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('model-reasoning-trigger'));
    fireEvent.change(screen.getByRole('slider', { name: '思考强度档位' }), {
      target: { value: '5' },
    });
    expect(props.onReasoningChange).toHaveBeenLastCalledWith('max');
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '思考强度' })).getByRole('button', {
        name: '自动',
      }),
    );
    expect(props.onReasoningChange).toHaveBeenLastCalledWith('auto');
    expect(props.onPick).not.toHaveBeenCalled();
  });
  it('shows a useful empty search state and closes on an outside pointer event', () => {
    const props = setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing-model' } });
    expect(screen.getByText('没有匹配的模型')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
