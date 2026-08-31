/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  ComposerActionSlot,
  ContextRing,
  ModelPickerMenu,
  ModelTrigger,
  PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL,
  SKILL_COLLAPSED_TOOLBAR_LEVEL,
  resolveFloatingMenuStyle,
  resolveToolbarCollapseLevel,
  useComposerToolbarCollapse,
} from './compose-toolbar.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('resolveToolbarCollapseLevel', () => {
  it('collapses permission first, then skill and secondary controls', () => {
    expect(
      resolveToolbarCollapseLevel({
        expandedWidth: 414,
        availableWidth: 434,
        permissionCollapseWidth: 88,
      }),
    ).toBe(0);
    expect(
      resolveToolbarCollapseLevel({
        expandedWidth: 414,
        availableWidth: 384,
        permissionCollapseWidth: 88,
      }),
    ).toBe(1);
    expect(
      resolveToolbarCollapseLevel({
        expandedWidth: 414,
        availableWidth: 314,
        permissionCollapseWidth: 88,
      }),
    ).toBe(2);
  });
});

describe('useComposerToolbarCollapse', () => {
  it('measures real children, closes permission first, then hides secondary controls', async () => {
    let resize: ResizeObserverCallback | undefined;
    class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const onPermissionMenuOpenChange = vi.fn();

    function Harness() {
      const toolbar = useComposerToolbarCollapse({
        permissionMenuOpen: true,
        onPermissionMenuOpenChange,
      });
      return (
        <div
          ref={toolbar.outerRef}
          data-testid="toolbar-outer"
          data-collapse-level={toolbar.collapseLevel}
        >
          <div ref={toolbar.leftRef} data-testid="toolbar-left">
            <span data-testid="toolbar-add">add</span>
            <span
              data-testid="toolbar-skill"
              hidden={toolbar.collapseLevel >= SKILL_COLLAPSED_TOOLBAR_LEVEL}
            >
              skill
            </span>
            <span
              ref={toolbar.permissionRef}
              data-testid="toolbar-permission"
              hidden={toolbar.collapseLevel >= PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL}
            >
              permission
            </span>
            <span
              data-testid="toolbar-secondary"
              hidden={toolbar.collapseLevel >= SKILL_COLLAPSED_TOOLBAR_LEVEL}
            >
              secondary
            </span>
          </div>
          <div ref={toolbar.rightRef} data-testid="toolbar-right">
            <span data-testid="toolbar-model">model</span>
            <span data-testid="toolbar-action">action</span>
          </div>
        </div>
      );
    }

    render(<Harness />);
    let outerWidth = 450;
    const widths: Record<string, number> = {
      'toolbar-add': 40,
      'toolbar-skill': 60,
      'toolbar-permission': 80,
      'toolbar-secondary': 50,
      'toolbar-model': 100,
      'toolbar-action': 36,
    };
    Object.defineProperty(screen.getByTestId('toolbar-outer'), 'clientWidth', {
      configurable: true,
      get: () => outerWidth,
    });
    for (const [testId, width] of Object.entries(widths)) {
      Object.defineProperty(screen.getByTestId(testId), 'offsetWidth', {
        configurable: true,
        get: () => width,
      });
    }

    await act(async () => {
      resize?.([], {} as ResizeObserver);
      await Promise.resolve();
    });
    expect(screen.getByTestId('toolbar-outer').dataset.collapseLevel).toBe('0');

    outerWidth = 400;
    await act(async () => {
      resize?.([], {} as ResizeObserver);
      await Promise.resolve();
    });
    expect(screen.getByTestId('toolbar-outer').dataset.collapseLevel).toBe('1');
    expect(screen.getByTestId('toolbar-permission').hidden).toBe(true);
    expect(screen.getByTestId('toolbar-skill').hidden).toBe(false);
    expect(onPermissionMenuOpenChange).toHaveBeenLastCalledWith(false);

    outerWidth = 330;
    await act(async () => {
      resize?.([], {} as ResizeObserver);
      await Promise.resolve();
    });
    expect(screen.getByTestId('toolbar-outer').dataset.collapseLevel).toBe('2');
    expect(screen.getByTestId('toolbar-skill').hidden).toBe(true);
    expect(screen.getByTestId('toolbar-secondary').hidden).toBe(true);

    outerWidth = 450;
    await act(async () => {
      resize?.([], {} as ResizeObserver);
      await Promise.resolve();
    });
    expect(screen.getByTestId('toolbar-outer').dataset.collapseLevel).toBe('0');
  });
});

describe('ComposerActionSlot', () => {
  it('uses one slot for voice, send, stop, and running interjection', () => {
    const onVoice = vi.fn();
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <ComposerActionSlot
        hasContent={false}
        running={false}
        onVoice={onVoice}
        onSend={onSend}
        onStop={onStop}
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('compose-voice'));
    expect(onVoice).toHaveBeenCalledTimes(1);

    rerender(
      <ComposerActionSlot
        hasContent
        running={false}
        onVoice={onVoice}
        onSend={onSend}
        onStop={onStop}
      />,
    );
    expect(screen.queryByTestId('compose-voice')).toBeNull();
    fireEvent.click(screen.getByTestId('compose-send'));
    expect(onSend).toHaveBeenCalledTimes(1);

    rerender(
      <ComposerActionSlot
        hasContent={false}
        running
        onVoice={onVoice}
        onSend={onSend}
        onStop={onStop}
      />,
    );
    expect(screen.queryByTestId('compose-send')).toBeNull();
    fireEvent.click(screen.getByTestId('compose-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);

    rerender(
      <ComposerActionSlot hasContent running onVoice={onVoice} onSend={onSend} onStop={onStop} />,
    );
    expect(screen.queryByTestId('compose-stop')).toBeNull();
    fireEvent.click(screen.getByTestId('compose-send'));
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('resolveFloatingMenuStyle', () => {
  it('flips below a high anchor and clamps width inside the viewport', () => {
    expect(
      resolveFloatingMenuStyle(
        { top: 70, bottom: 130, left: 20, right: 320, width: 300, height: 60 },
        { width: 500, height: 600 },
        { width: 520, maxHeight: 360 },
      ),
    ).toMatchObject({ left: 8, top: 138, width: 484, maxHeight: 360 });
  });

  it('stays above a low anchor without forcing a height beyond available space', () => {
    expect(
      resolveFloatingMenuStyle(
        { top: 120, bottom: 170, left: 30, right: 230, width: 200, height: 50 },
        { width: 400, height: 180 },
        { width: 240, maxHeight: 360 },
      ),
    ).toMatchObject({ left: 30, bottom: 68, width: 240, maxHeight: 104 });
  });
});

describe('ContextRing', () => {
  it('shows the complete runtime context window, compact threshold, and saved summary', () => {
    render(
      <ContextRing
        used={12_500}
        limit={10_000}
        usageRatio={1.25}
        compactThreshold={0.7}
        compactedAt="2026-08-04T09:30:00.000Z"
        sessionTokens={48_000}
        sections={[
          { type: 'system', tokens: 1_000 },
          { type: 'agent', tokens: 2_000 },
          { type: 'project', tokens: 3_000 },
          { type: 'summary', tokens: 500 },
          { type: 'messages', tokens: 5_000 },
          { type: 'tools', tokens: 1_000 },
        ]}
      />,
    );

    const ring = screen.getByTestId('context-ring');
    expect(ring.getAttribute('aria-label')).toContain('125%');
    fireEvent.mouseEnter(ring);

    expect(screen.getByText('当前上下文窗口')).toBeTruthy();
    expect(screen.getByText('当前模型实际可见的完整上下文窗口')).toBeTruthy();
    expect(screen.getByText('当前对话上下文构成')).toBeTruthy();
    expect(screen.getByTestId('context-used-value').getAttribute('title')).toBe('12,500 Token');
    expect(screen.getByText('自动压缩')).toBeTruthy();
    expect(screen.getByText(/7k/)).toBeTruthy();
    expect(screen.getByTestId('context-compact-distance').textContent).toBe('已达阈值');
    expect(screen.getByTestId('context-compacted-at').textContent).not.toBe('尚未发生');
    expect(screen.getByTestId('context-section-system').textContent).toContain('系统指令');
    expect(screen.getByTestId('context-section-system').textContent).toContain('1k');
    expect(
      screen.getByTestId('context-section-system').querySelector('strong')?.getAttribute('title'),
    ).toBe('1,000 Token');
    expect(screen.getByTestId('context-section-agent').textContent).toContain('智能体 / 小队');
    expect(screen.getByTestId('context-section-project').textContent).toContain('项目上下文');
    expect(screen.getByTestId('context-section-summary').textContent).toContain('已保存摘要');
    expect(screen.getByTestId('context-section-messages').textContent).toContain('消息历史');
    expect(screen.getByTestId('context-section-tools').textContent).toContain('工具定义');
    expect(screen.getByText('累计 Token 消耗')).toBeTruthy();
    expect(screen.getByText('48k')).toBeTruthy();
    expect(screen.queryByText(/prompt body|hidden reasoning/i)).toBeNull();
  });

  it('opens on click and reports remaining capacity before automatic compact', () => {
    render(
      <ContextRing
        used={17_000}
        limit={400_000}
        usageRatio={0.0425}
        compactThreshold={0.7}
        sections={[
          { type: 'system', tokens: 2_000 },
          { type: 'agent', tokens: 27 },
          { type: 'project', tokens: 79 },
          { type: 'summary', tokens: 0 },
          { type: 'messages', tokens: 9_000 },
          { type: 'tools', tokens: 5_894 },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId('context-ring'));

    expect(screen.getByText('达到 70% 时，在发送下一条消息前自动压缩')).toBeTruthy();
    expect(screen.getByTestId('context-compact-distance').textContent).toBe('263k');
    expect(screen.getByTestId('context-compacted-at').textContent).toBe('尚未发生');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('400000');
  });

  it('marks cumulative token usage as unreported instead of fabricating zero', () => {
    render(
      <ContextRing
        used={9_000}
        limit={400_000}
        usageRatio={0.0225}
        compactThreshold={0.7}
        sections={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('context-ring'));

    expect(screen.getByText('当前上下文窗口')).toBeTruthy();
    expect(screen.getByText('累计 Token 消耗')).toBeTruthy();
    expect(screen.getByTestId('context-session-tokens').textContent).toBe('尚未上报');
  });

  it('labels a kernel-capped limit (non-overridable native cap) on the capacity row', () => {
    render(
      <ContextRing
        used={100_000}
        limit={200_000}
        contextWindowSource="kernel-capped"
        compactThreshold={0.7}
        sections={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('context-ring'));

    expect(screen.getByTestId('context-limit-kernel-capped').textContent).toContain('受内核限制');
    expect(screen.queryByTestId('context-limit-estimated')).toBeNull();
  });

  it('prefers the estimated label when metadata is missing even under a cap', () => {
    render(
      <ContextRing
        used={20_000}
        limit={128_000}
        contextWindowEstimated
        contextWindowSource="kernel-capped"
        compactThreshold={0.7}
        sections={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('context-ring'));

    expect(screen.getByTestId('context-limit-estimated').textContent).toContain('估算');
    expect(screen.queryByTestId('context-limit-kernel-capped')).toBeNull();
  });

  it('uses the configured model capacity without exposing a conversation editor', () => {
    render(
      <ContextRing
        used={20_000}
        limit={200_000}
        modelContextWindow={200_000}
        contextWindowSource="configured"
        compactThreshold={0.7}
        sections={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('context-ring'));
    expect(screen.getByTestId('context-model-default').textContent).toContain('200k');
    expect(screen.queryByText('会话设置')).toBeNull();
    expect(screen.queryByRole('button', { name: '编辑会话容量' })).toBeNull();
  });

  it('lets an external kernel own compaction without showing host thresholds', () => {
    render(
      <ContextRing
        used={80_000}
        limit={200_000}
        modelContextWindow={400_000}
        contextWindowSource="kernel-capped"
        compactThreshold={0.7}
        compactedAt="2026-08-29T00:00:00.000Z"
        kernelSelfManaged
        sections={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('context-ring'));

    expect(screen.getByTestId('context-kernel-self-managed')).toBeTruthy();
    expect(screen.queryByText('自动压缩')).toBeNull();
    expect(screen.queryByText('距离压缩')).toBeNull();
    expect(screen.queryByText('最近压缩')).toBeNull();
    expect(screen.queryByText(/发送下一条消息前自动压缩/)).toBeNull();
  });

  it('shows the active kernel in the context window header', () => {
    render(
      <ContextRing
        used={20_000}
        limit={200_000}
        kernelLabel="ClaudeCode"
        contextWindowSource="kernel-capped"
        kernelSelfManaged
      />,
    );

    fireEvent.click(screen.getByTestId('context-ring'));

    expect(screen.getByTestId('context-kernel-label').textContent).toBe('ClaudeCode');
    expect(screen.getByTestId('context-kernel-label').getAttribute('title')).toBe(
      '当前内核：ClaudeCode',
    );
  });
});

describe('ModelPickerMenu', () => {
  it('keeps the virtual Radix anchor in body coordinates', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    render(
      <ModelPickerMenu
        open
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider A' }]}
        selectedModelId="model-a"
        defaultLabel="选择模型"
        anchorEl={anchor}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );

    const virtualAnchor = await screen.findByTestId('model-picker-anchor');
    expect(virtualAnchor.parentElement).toBe(document.body);
  });

  it('opens a provider flyout after the root menu uses the body anchor', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    render(
      <ModelPickerMenu
        open
        models={[
          { modelId: 'model-a', displayName: 'Model A', providerName: 'Provider A' },
          { modelId: 'model-b', displayName: 'Model B', providerName: 'Provider A' },
        ]}
        selectedModelId="model-a"
        defaultLabel="选择模型"
        anchorEl={anchor}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );

    const provider = await screen.findByTestId('model-provider-Provider A');
    fireEvent.click(provider);
    expect(await screen.findByText('Model B')).toBeTruthy();
  });

  it('keeps thinking effort at the bottom and opens its nested menu on click', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const onReasoningChange = vi.fn();

    render(
      <ModelPickerMenu
        open
        models={[
          { modelId: 'model-a', displayName: 'Model A', providerName: 'Provider A' },
          { modelId: 'model-b', displayName: 'Model B', providerName: 'Provider B' },
        ]}
        selectedModelId="model-a"
        defaultLabel="选择模型"
        reasoningEffort="high"
        anchorEl={anchor}
        onClose={vi.fn()}
        onPick={vi.fn()}
        onReasoningChange={onReasoningChange}
      />,
    );

    const trigger = await screen.findByTestId('model-reasoning-trigger');
    expect(trigger.closest('.shell-menu__model-footer')).toBeTruthy();
    expect(trigger.textContent).toContain('思考强度');
    expect(trigger.textContent).toContain('高');

    fireEvent.click(trigger);
    const maxOption = await screen.findByTestId('model-reasoning-option-max');
    expect(maxOption.textContent).toContain('最高');
    fireEvent.click(maxOption);

    expect(onReasoningChange).toHaveBeenCalledWith('max');
  });

  it('shows the current thinking effort beside the model without wrapping it into the name', () => {
    render(
      <ModelTrigger label="GPT-5.6 Luna" reasoningLabel="超高" open={false} onClick={vi.fn()} />,
    );

    expect(screen.getByText('GPT-5.6 Luna').classList.contains('shell-compose__model-label')).toBe(
      true,
    );
    expect(screen.getByText('超高').classList.contains('shell-compose__model-reasoning')).toBe(
      true,
    );
    expect(screen.getByTitle('切换模型，思考强度：超高')).toBeTruthy();
  });

  it('shows the planning model while Plan mode is active and restores the execution model', () => {
    const { rerender } = render(
      <ModelTrigger
        label="GPT-5.6 Luna"
        reasoningLabel="高"
        mode="plan"
        planLabel="GPT-5.6 Sol"
        planReasoningLabel="最高"
        open={false}
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText('GPT-5.6 Sol')).toBeTruthy();
    expect(screen.getByText('最高')).toBeTruthy();
    expect(screen.queryByText('GPT-5.6 Luna')).toBeNull();
    expect(screen.getByTitle('切换规划模型，思考强度：最高')).toBeTruthy();

    rerender(
      <ModelTrigger
        label="GPT-5.6 Luna"
        reasoningLabel="高"
        mode="execute"
        planLabel="GPT-5.6 Sol"
        planReasoningLabel="最高"
        open={false}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText('GPT-5.6 Luna')).toBeTruthy();
    expect(screen.getByText('高')).toBeTruthy();
    expect(screen.queryByText('GPT-5.6 Sol')).toBeNull();
  });

  it('renders the kernel group with badges and install state', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const onPickKernel = vi.fn();
    const onInstallKernel = vi.fn();

    render(
      <ModelPickerMenu
        open
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider A' }]}
        selectedModelId="model-a"
        defaultLabel="选择模型"
        anchorEl={anchor}
        onClose={vi.fn()}
        onPick={vi.fn()}
        kernels={[
          {
            kernelId: 'native',
            name: 'Sync-Think',
            icon: 'native',
            capabilities: {
              permission: 'own',
              permissionBridge: false,
              pause: 'executor',
              compress: 'own',
              usageReport: true,
              protocols: [],
            },
            installed: true,
            version: null,
            executablePath: null,
            knownGood: true,
          },
          {
            kernelId: 'claude-code',
            name: 'Claude Code',
            icon: 'claude-code',
            capabilities: {
              permission: 'own',
              permissionBridge: true,
              pause: 'turn',
              compress: 'own',
              usageReport: true,
              protocols: ['anthropic-messages'],
            },
            installed: true,
            version: '2.1.222',
            executablePath: 'C:/claude',
            knownGood: true,
          },
          {
            kernelId: 'codex',
            name: 'Codex',
            icon: 'codex',
            capabilities: {
              permission: 'own',
              permissionBridge: false,
              pause: 'session',
              compress: 'own',
              usageReport: true,
              protocols: ['openai-chat'],
            },
            installed: true,
            version: '0.147.0',
            executablePath: 'C:/codex',
            knownGood: true,
          },
          {
            kernelId: 'pi',
            name: 'Pi',
            icon: 'pi',
            capabilities: {
              permission: 'none',
              permissionBridge: false,
              pause: 'kill',
              compress: 'own',
              usageReport: false,
              protocols: [],
            },
            installed: false,
            version: null,
            executablePath: null,
            knownGood: false,
            installCommand: 'npm i -g pi',
          },
        ]}
        selectedKernelId="native"
        onPickKernel={onPickKernel}
        onInstallKernel={onInstallKernel}
      />,
    );

    expect(screen.getByText('内核')).toBeTruthy();
    const nativeOption = await screen.findByTestId('kernel-option-native');
    expect(nativeOption.textContent).toContain('Sync-Think');
    const ccOption = await screen.findByTestId('kernel-option-claude-code');
    expect(ccOption.textContent).toContain('ClaudeCode');
    expect(ccOption.textContent).not.toContain('Claude Code');
    expect(screen.getByTestId('kernel-version-claude-code').textContent).toBe('v2.1.222');
    expect(ccOption.getAttribute('aria-label')).toContain('已安装 v2.1.222');
    const codexOption = await screen.findByTestId('kernel-option-codex');
    expect(codexOption.textContent).toContain('GPT');
    expect(codexOption.textContent).not.toContain('Codex');

    // Kernel badges render brand logos; native now carries the Sync-Think mark.
    const nativeBadge = await screen.findByTestId('kernel-badge-native');
    expect(nativeBadge.textContent).toBe('');
    expect(nativeBadge.querySelector('[role="img"][aria-label="Sync-Think"]')).toBeTruthy();
    expect(
      (nativeBadge.querySelector('.shell-brand-logo') as HTMLElement | null)?.style.transform,
    ).toBe('scale(1.12)');
    const ccBadge = await screen.findByTestId('kernel-badge-claude-code');
    expect(ccBadge.querySelector('img[alt="ClaudeCode"]')).toBeTruthy();
    expect(ccBadge.textContent).toBe('');
    const codexBadge = await screen.findByTestId('kernel-badge-codex');
    expect(codexBadge.querySelector('[role="img"][aria-label="GPT"]')).toBeTruthy();
    const piBadge = await screen.findByTestId('kernel-badge-pi');
    expect(
      (piBadge.querySelector('.shell-brand-logo') as HTMLElement | null)?.style.transform,
    ).toBe('scale(0.74)');

    // Installable kernels stay on one row: status sits to the right of the name.
    const piOption = await screen.findByTestId('kernel-option-pi');
    expect(piOption.hasAttribute('aria-disabled')).toBe(false);
    const piStatus = screen.getByTestId('kernel-status-pi');
    expect(piStatus.textContent).toContain('未安装');
    expect(piStatus.textContent).toContain('npm i -g pi');
    expect(piOption.querySelector('.shell-menu__item-hint')).toBeNull();
    fireEvent.click(piOption);
    expect(onInstallKernel).toHaveBeenCalledWith('pi');

    // Selecting an installed kernel routes through onPickKernel.
    fireEvent.click(ccOption);
    expect(onPickKernel).toHaveBeenCalledWith('claude-code');
    expect(onPickKernel).toHaveBeenCalledTimes(1);
  });

  it('renders installing, verifying, success, and failure status for Pi', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const baseProps = {
      open: true,
      models: [{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider A' }],
      selectedModelId: 'model-a',
      defaultLabel: '选择模型',
      anchorEl: anchor,
      onClose: vi.fn(),
      onPick: vi.fn(),
      kernels: [
        {
          kernelId: 'pi',
          name: 'Pi',
          icon: 'pi' as const,
          capabilities: {
            permission: 'none' as const,
            permissionBridge: false,
            pause: 'kill' as const,
            compress: 'own' as const,
            usageReport: false,
            protocols: [],
          },
          installed: false,
          version: null,
          executablePath: null,
          knownGood: false,
          installCommand: 'npm i -g pi',
        },
      ],
      selectedKernelId: 'native',
      onPickKernel: vi.fn(),
      onInstallKernel: vi.fn(),
    };
    const { rerender } = render(
      <ModelPickerMenu {...baseProps} kernelInstallStates={{ pi: { status: 'installing' } }} />,
    );

    expect((await screen.findByTestId('kernel-status-pi')).textContent).toContain('安装中');

    rerender(
      <ModelPickerMenu {...baseProps} kernelInstallStates={{ pi: { status: 'verifying' } }} />,
    );
    expect(screen.getByTestId('kernel-status-pi').textContent).toContain('安装成功 · 正在检测');

    rerender(
      <ModelPickerMenu
        {...baseProps}
        kernels={[{ ...baseProps.kernels[0]!, installed: true, version: '1.2.3' }]}
        kernelInstallStates={{ pi: { status: 'success' } }}
      />,
    );
    expect(screen.getByTestId('kernel-option-pi').getAttribute('aria-label')).toContain(
      '安装成功 v1.2.3',
    );
    const installedPi = screen.getByTestId('kernel-option-pi');
    expect(screen.getByTestId('kernel-version-pi').textContent).toBe('v1.2.3');
    expect(screen.queryByTestId('kernel-status-pi')).toBeNull();
    expect(installedPi.querySelector('.shell-menu__item-hint')).toBeNull();
    expect(installedPi.textContent).not.toContain('安装成功 v1.2.3');

    rerender(
      <ModelPickerMenu
        {...baseProps}
        kernelInstallStates={{ pi: { status: 'error', error: '权限不足' } }}
      />,
    );
    expect(screen.getByTestId('kernel-status-pi').textContent).toContain('安装失败 · 权限不足');
  });
});
