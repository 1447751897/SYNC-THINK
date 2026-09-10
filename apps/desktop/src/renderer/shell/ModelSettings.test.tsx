/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProviderSummary } from '@sync-think/protocol';
import { DialogProvider } from './Dialog.js';
import { ToastProvider, resetToastStoreForTests } from './Toast.js';
import { ModelSettings } from './ModelSettings.js';

const provider: ProviderSummary = {
  providerId: 'provider-1' as ProviderSummary['providerId'],
  name: 'CODEX',
  baseUrl: 'https://example.com',
  protocol: 'openai-chat',
  supportsDiscovery: true,
  surface: 'generic',
  enabled: true,
  sortOrder: 0,
  unverified: false,
  credentials: [
    {
      credentialRefId: 'credential-1' as ProviderSummary['credentials'][number]['credentialRefId'],
      credentialGroupId: 'group-1' as ProviderSummary['credentials'][number]['credentialGroupId'],
      groupName: 'default',
      label: 'primary',
      kind: 'api-key',
      hasSecret: true,
    },
  ],
  models: [
    {
      modelId: 'model-1' as ProviderSummary['models'][number]['modelId'],
      providerModelId: 'gpt-5',
      displayName: 'gpt-5',
      protocol: 'openai-chat',
      capabilities: ['text', 'vision'],
      capabilitiesConfirmed: true,
      priority: 0,
      contextWindow: 372_000,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const importedProvider: ProviderSummary = {
  ...provider,
  providerId: 'provider-imported' as ProviderSummary['providerId'],
  name: 'Imported Claude',
  baseUrl: 'https://imported.example.com',
  protocol: 'anthropic-messages',
  credentials: [
    {
      ...provider.credentials[0],
      credentialRefId:
        'credential-imported' as ProviderSummary['credentials'][number]['credentialRefId'],
      credentialGroupId:
        'group-imported' as ProviderSummary['credentials'][number]['credentialGroupId'],
    },
  ],
  models: [],
  sortOrder: 1,
};

const runtime = {
  listProviders: vi.fn(),
  getSettings: vi.fn(),
  createProvider: vi.fn(),
  previewCcSwitchImport: vi.fn(),
  importCcSwitch: vi.fn(),
  updateProvider: vi.fn(),
  addProviderCredential: vi.fn(),
  revealProviderCredential: vi.fn(),
  updateProviderCredential: vi.fn(),
  discoverModels: vi.fn(),
  probeModels: vi.fn(),
  addModels: vi.fn(),
  probeCapabilities: vi.fn(),
  confirmCapabilities: vi.fn(),
  removeProviderModel: vi.fn(),
  updateModel: vi.fn(),
  setModelPriorities: vi.fn(),
  setSetting: vi.fn(),
  getUsageSummary: vi.fn(),
  removeProviderCredential: vi.fn(),
};

beforeEach(() => {
  runtime.listProviders.mockResolvedValue({ providers: [provider] });
  runtime.getSettings.mockResolvedValue({ settings: {} });
  runtime.createProvider.mockResolvedValue({
    provider: importedProvider,
    credentialRefId: 'credential-imported',
    discoveredModelCount: 0,
  });
  runtime.previewCcSwitchImport.mockResolvedValue({
    dbPath: 'C:\\Users\\tester\\.cc-switch\\cc-switch.db',
    skippedCount: 0,
    importableCount: 1,
    items: [
      {
        sourceId: 'source-claude',
        appType: 'claude',
        name: 'Imported Claude',
        baseUrl: 'https://imported.example.com',
        protocol: 'anthropic-messages',
        hasSecret: true,
        models: ['claude-sonnet-4'],
        credentialGroupName: 'default',
        importedFrom: 'cc-switch',
        warnings: [],
        importable: true,
      },
    ],
  });
  runtime.importCcSwitch.mockResolvedValue({
    importedCount: 1,
    failedCount: 0,
    results: [
      {
        sourceId: 'source-claude',
        ok: true,
        providerId: importedProvider.providerId,
        name: importedProvider.name,
        discoveredModelCount: 1,
      },
    ],
  });
  runtime.updateProvider.mockImplementation(async (payload: Record<string, unknown>) => ({
    provider: { ...provider, ...payload },
    secretRotated: false,
  }));
  runtime.updateModel.mockImplementation(async (payload: { contextWindow?: number | null }) => ({
    model: { ...provider.models[0], contextWindow: payload.contextWindow ?? null },
  }));
  runtime.addProviderCredential.mockResolvedValue({
    provider,
    credentialRefId: 'credential-2',
  });
  runtime.revealProviderCredential.mockResolvedValue({
    providerId: provider.providerId,
    credentialRefId: 'credential-1',
    label: 'primary',
    apiKey: 'sk-revealed-secret',
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
  });
  runtime.updateProviderCredential.mockResolvedValue({
    provider: {
      ...provider,
      credentials: [
        {
          ...provider.credentials[0],
          label: 'primary-updated',
        },
      ],
    },
    credentialRefId: 'credential-1',
    secretRotated: true,
  });
  runtime.discoverModels.mockResolvedValue({
    providerId: provider.providerId,
    models: provider.models,
    discoveredIds: ['gpt-5', 'gpt-4.1'],
    source: 'adapter',
    latencyMs: 128,
    addedIds: ['gpt-4.1'],
    previousModelCount: 1,
  });
  runtime.addModels.mockResolvedValue({ providerId: provider.providerId, models: provider.models });
  runtime.probeCapabilities.mockResolvedValue({
    providerId: provider.providerId,
    applied: true,
    suggestions: [
      {
        modelId: provider.models[0]!.modelId,
        providerModelId: provider.models[0]!.providerModelId,
        displayName: provider.models[0]!.displayName,
        capabilities: ['text', 'vision', 'tool-calling', 'web-search'],
        capabilitiesConfirmed: false,
        results: {
          text: true,
          vision: true,
          'tool-calling': true,
          'web-search': true,
        },
        confidence: 'medium',
        reasons: ['文本请求实测成功'],
        source: 'live',
      },
    ],
  });
  runtime.confirmCapabilities.mockImplementation(
    async (payload: { capabilities: ProviderSummary['models'][number]['capabilities'] }) => ({
      model: {
        ...provider.models[0]!,
        capabilities: payload.capabilities,
        capabilitiesConfirmed: true,
      },
    }),
  );
  runtime.removeProviderModel.mockResolvedValue({ providerId: provider.providerId, removed: true });
  runtime.setModelPriorities.mockResolvedValue({
    providerId: provider.providerId,
    models: provider.models,
  });
  runtime.setSetting.mockResolvedValue({});
  runtime.removeProviderCredential.mockResolvedValue({ providerId: provider.providerId });
  runtime.getUsageSummary.mockResolvedValue({
    rows: [],
    requests: [
      {
        requestId: 'request-cache-1',
        taskId: 'task-usage-1',
        runId: 'run-usage-1',
        occurredAt: '2026-08-04T09:30:00.000Z',
        modelId: 'model-1',
        providerId: 'provider-1',
        providerModelId: 'gpt-5-provider',
        purpose: 'normal',
        displayName: 'gpt-5',
        providerName: 'CODEX',
        tokensIn: 14_000,
        tokensOut: 488,
        cachedTokensHit: 12_800,
        cachedTokensCreated: 0,
        reasoningTokens: 123,
        totalTokens: 14_488,
        status: 'success',
        estimatedCost: 0.018256,
        estimatedCostBreakdown: {
          input: 0.006,
          cacheRead: 0.0064,
          cacheWrite: 0,
          output: 0.005856,
          total: 0.018256,
        },
        currency: 'USD',
      },
    ],
    tools: [],
    toolModels: [],
    toolFailures: [],
    pricing: [],
    totalRequests: 1,
    totalTokensIn: 14_000,
    totalTokensOut: 488,
    totalCachedTokensHit: 12_800,
    totalCachedTokensCreated: 0,
    totalCostByCurrency: { USD: 0.018256 },
    totalReasoningTokens: 0,
    totalTokens: 14_488,
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  resetToastStoreForTests();
  vi.clearAllMocks();
});

function renderWithProviders(ui: ReactNode) {
  return render(
    <DialogProvider>
      <ToastProvider>{ui}</ToastProvider>
    </DialogProvider>,
  );
}

async function renderSettings(onDirtyChange = vi.fn()) {
  renderWithProviders(<ModelSettings onDirtyChange={onDirtyChange} />);
  await screen.findByDisplayValue('CODEX');
  return onDirtyChange;
}

async function openProviderCatalog() {
  const button = document.querySelector<HTMLButtonElement>('.model-enabled-list__add');
  expect(button).toBeTruthy();
  fireEvent.click(button!);
  await screen.findByRole('region', { name: '添加模型' });
}

describe('ModelSettings NewMax provider detail', () => {
  it('reloads enabled models after a transient provider.list timeout', async () => {
    runtime.listProviders
      .mockRejectedValueOnce(new Error('Runtime request timed out: provider.list'))
      .mockResolvedValue({ providers: [provider] });
    renderWithProviders(<ModelSettings />);
    expect(await screen.findByDisplayValue('CODEX')).toBeTruthy();
    expect(runtime.listProviders).toHaveBeenCalledTimes(2);
  });

  it('keeps the text list mounted when switching to image and back', async () => {
    renderWithProviders(<ModelSettings />);
    expect(await screen.findByDisplayValue('CODEX')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '图像生成' }));
    expect(await screen.findByText(/还没有配置过生图模型的提供商/)).toBeTruthy();
    expect(screen.queryByText('加载模型源…')).toBeNull();
    const listCallsOnImage = runtime.listProviders.mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: '文本生成' }));
    expect(screen.getByDisplayValue('CODEX')).toBeTruthy();
    expect(screen.queryByText('加载模型源…')).toBeNull();
    expect(runtime.listProviders.mock.calls.length).toBe(listCallsOnImage);
    fireEvent.click(screen.getByRole('tab', { name: '使用统计' }));
    expect(await screen.findByText('总请求')).toBeTruthy();
    expect(screen.getByRole('button', { name: '近 7 天' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'CODEX' })).toBeNull();
    expect(screen.queryByText('加载模型源…')).toBeNull();
  });

  it('keeps usage stats on screen when switching away and back', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    runtime.getUsageSummary.mockReturnValueOnce(pending);

    renderWithProviders(<ModelSettings />);
    await screen.findByDisplayValue('CODEX');
    fireEvent.click(screen.getByRole('tab', { name: '使用统计' }));
    expect(await screen.findByText('正在加载使用统计…')).toBeTruthy();
    expect(screen.getByRole('button', { name: '近 7 天' })).toBeTruthy();

    release({
      rows: [],
      requests: [],
      tools: [],
      toolModels: [],
      toolFailures: [],
      pricing: [],
      totalRequests: 3,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCostByCurrency: { USD: 1.5 },
      totalReasoningTokens: 0,
      totalTokens: 0,
    });

    expect(await screen.findByText('总请求')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('$1.50')).toBeTruthy();
    expect(screen.queryByText('¥0.00')).toBeNull();
    expect(screen.queryByText('正在加载使用统计…')).toBeNull();

    const callsAfterFirstLoad = runtime.getUsageSummary.mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: '文本生成' }));
    expect(screen.getByDisplayValue('CODEX')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '使用统计' }));
    expect(screen.queryByText('正在加载使用统计…')).toBeNull();
    expect(screen.getByText('总请求')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(runtime.getUsageSummary.mock.calls.length).toBe(callsAfterFirstLoad);
  });

  it('opens Plan & Act from a navigation request and replays only when its key changes', async () => {
    const { rerender } = renderWithProviders(
      <ModelSettings initialDetailView="plan-act" navigationKey="plan-act-1" />,
    );

    expect(await screen.findByRole('heading', { name: '规划 & 执行模型' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '图片识别 Fallback' }));
    expect(await screen.findByRole('heading', { name: '图片识别 Fallback' })).toBeTruthy();

    rerender(
      <DialogProvider>
        <ToastProvider>
          <ModelSettings initialDetailView="plan-act" navigationKey="plan-act-1" />
        </ToastProvider>
      </DialogProvider>,
    );
    expect(screen.getByRole('heading', { name: '图片识别 Fallback' })).toBeTruthy();

    rerender(
      <DialogProvider>
        <ToastProvider>
          <ModelSettings initialDetailView="plan-act" navigationKey="plan-act-2" />
        </ToastProvider>
      </DialogProvider>,
    );
    expect(await screen.findByRole('heading', { name: '规划 & 执行模型' })).toBeTruthy();
  });

  it('shows readable cache efficiency and token tip cache rows only when reported', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: '使用统计' }));

    const requestTable = await screen.findByRole('table');
    expect(screen.getByText('缓存命中率')).toBeTruthy();
    expect(screen.getByText('按 Token 91.4%')).toBeTruthy();
    expect(screen.getByText(/按请求 100\.0% · 命中 12\.8k \/ 创建 0/)).toBeTruthy();
    expect(screen.getByText(/输入 14\.0k \/ 输出 488/)).toBeTruthy();
    expect(screen.getByText('授权登录使用订阅额度，不计入总费用；其他费用以供应商最终结算为准')).toBeTruthy();
    expect(within(requestTable).getByText('供应商')).toBeTruthy();
    expect(within(requestTable).getByText('模型')).toBeTruthy();
    expect(within(requestTable).getByText('Token')).toBeTruthy();
    expect(within(requestTable).getByText('CODEX')).toBeTruthy();
    expect(within(requestTable).getByText('gpt-5')).toBeTruthy();
    expect(within(requestTable).getByText('14.5k')).toBeTruthy();
    expect(within(requestTable).queryByText('普通输入 1.2k')).toBeNull();
    expect(within(requestTable).getByText('成功')).toBeTruthy();
    expect(screen.queryByText(/普通输入费 \$0\.006000/)).toBeNull();
    expect(screen.queryByText('200')).toBeNull();
    expect(screen.queryByRole('button', { name: '查看 gpt-5 请求详情' })).toBeNull();

    fireEvent.click(within(requestTable).getByText('14.5k'));
    expect(screen.queryByTestId('usage-request-details-request-cache-1')).toBeNull();
    fireEvent.mouseEnter(within(requestTable).getByRole('button', { name: 'Token 明细' }));
    fireEvent.click(within(requestTable).getByRole('button', { name: 'Token 明细' }));
    expect(screen.queryByTestId('usage-request-details-request-cache-1')).toBeNull();
    const tokenTip = await screen.findByRole('tooltip');
    expect(within(tokenTip).getByText('Token 明细')).toBeTruthy();
    expect(within(tokenTip).getByText('输入 Token')).toBeTruthy();
    expect(within(tokenTip).getByText('14.0k')).toBeTruthy();
    expect(within(tokenTip).getByText('输出 Token')).toBeTruthy();
    expect(within(tokenTip).getByText('488')).toBeTruthy();
    expect(within(tokenTip).getByText('缓存读取')).toBeTruthy();
    expect(within(tokenTip).getByText('12.8k')).toBeTruthy();
    expect(within(tokenTip).getByText('缓存创建')).toBeTruthy();
    expect(within(tokenTip).getByText('0')).toBeTruthy();
    expect(within(tokenTip).getByText('总 Token')).toBeTruthy();
    expect(within(tokenTip).getByText('14.5k')).toBeTruthy();
    expect(screen.queryByText('请求信息')).toBeNull();
    expect(screen.queryByText('费用明细')).toBeNull();
    expect(screen.queryByText('详情记录')).toBeNull();
  });

  it('distinguishes unreported cache fields and excludes them from the hit-rate denominator', async () => {
    runtime.getUsageSummary.mockResolvedValueOnce({
      rows: [],
      requests: [
        {
          requestId: 'request-reported',
          occurredAt: '2026-08-04T09:31:00.000Z',
          modelId: 'model-1',
          providerId: 'provider-1',
          displayName: 'gpt-5',
          providerName: 'CODEX',
          tokensIn: 1_000,
          tokensOut: 10,
          cachedTokensHit: 500,
          cachedTokensCreated: 0,
          totalTokens: 1_010,
          status: 'success',
        },
        {
          requestId: 'request-unreported',
          occurredAt: '2026-08-04T09:30:00.000Z',
          modelId: 'model-1',
          providerId: 'provider-1',
          displayName: 'gpt-5',
          providerName: 'CODEX',
          tokensIn: 9_000,
          tokensOut: 20,
          totalTokens: 9_020,
          status: 'unknown',
        },
      ],
      tools: [],
      toolModels: [],
      toolFailures: [],
      pricing: [],
      totalRequests: 2,
      totalTokensIn: 10_000,
      totalTokensOut: 30,
      totalCachedTokensHit: 500,
      totalCachedTokensCreated: 0,
      totalCostByCurrency: {},
      totalReasoningTokens: 0,
      totalTokens: 10_030,
    });

    await renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: '使用统计' }));

    expect(await screen.findByText('按 Token 50.0%')).toBeTruthy();
    const requestTable = screen.getByRole('table');
    const unreportedRow = within(requestTable).getByText('9.0k').closest('tr');
    expect(unreportedRow).toBeTruthy();
    expect(within(unreportedRow!).queryByText('缓存读取 未上报')).toBeNull();
    expect(within(unreportedRow!).getByText('未结束')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '查看 gpt-5 请求详情' })).toBeNull();

    fireEvent.mouseEnter(within(unreportedRow!).getByRole('button', { name: 'Token 明细' }));
    const tokenTip = await screen.findByRole('tooltip');
    expect(within(tokenTip).getByText('Token 明细')).toBeTruthy();
    expect(within(tokenTip).queryByText('缓存读取')).toBeNull();
    expect(within(tokenTip).queryByText('缓存创建')).toBeNull();
    expect(within(tokenTip).queryByText('未上报')).toBeNull();
  });

  it('shows direct-edit fields without the legacy edit and save controls', async () => {
    await renderSettings();

    expect(screen.queryByText('取消编辑')).toBeNull();
    expect(screen.queryByText('保存更改')).toBeNull();
    expect(screen.queryByText('轮换 API Key（留空则不改）')).toBeNull();
    expect(screen.getByText('API 密钥')).toBeTruthy();
    expect(screen.getByText('模型优先级（至少添加一个）')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '语音识别' })).toBeTruthy();
    expect(document.querySelector('.model-settings-guide')?.textContent).toBe(
      '如果配置遇到问题，可以查阅配置指南。',
    );
  });

  it('opens a unified model detail dialog and confirms detected capabilities', async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole('button', { name: '查看模型 gpt-5' }));

    const detail = await screen.findByRole('dialog', { name: 'gpt-5' });
    expect(within(detail).getByText('CODEX / gpt-5')).toBeTruthy();
    expect(within(detail).getByText('OpenAI Chat Completions')).toBeTruthy();
    expect(within(detail).getByText('372k')).toBeTruthy();
    expect(within(detail).getByRole('button', { name: '文本：支持' })).toBeTruthy();
    expect(within(detail).getByRole('button', { name: '联网搜索：未标记' })).toBeTruthy();

    fireEvent.click(within(detail).getByRole('button', { name: '检测能力' }));

    await waitFor(() => {
      expect(runtime.probeCapabilities).toHaveBeenCalledWith({
        providerId: 'provider-1',
        modelId: 'model-1',
      });
    });
    expect(await within(detail).findByRole('button', { name: '联网搜索：支持' })).toBeTruthy();
    expect(within(detail).getByText(/检测完成：已向接口实测，建议勾选 4 项/)).toBeTruthy();

    fireEvent.click(within(detail).getByRole('button', { name: '保存能力' }));

    await waitFor(() => {
      expect(runtime.confirmCapabilities).toHaveBeenCalledWith({
        modelId: 'model-1',
        capabilities: ['text', 'vision', 'tool-calling', 'web-search'],
        confirmed: true,
      });
    });
    // Save succeeds → dialog closes immediately (no lingering "已保存" state).
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'gpt-5' })).toBeNull();
    });
  });

  it('edits the context window inside the capability dialog via input and presets', async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole('button', { name: '查看模型 gpt-5' }));
    const detail = await screen.findByRole('dialog', { name: 'gpt-5' });

    // Current value renders as a clickable control, not static text.
    fireEvent.click(within(detail).getByRole('button', { name: '372k' }));
    const input = within(detail).getByLabelText('gpt-5 上下文窗口（tokens）') as HTMLInputElement;
    expect(input.value).toBe('372k');

    // Quick-pick preset saves straight away.
    fireEvent.click(within(detail).getByRole('button', { name: '1m' }));
    await waitFor(() => {
      expect(runtime.updateModel).toHaveBeenCalledWith({
        providerId: 'provider-1',
        modelId: 'model-1',
        contextWindow: 1_000_000,
      });
    });

    // Re-open and type a custom value; Enter commits it.
    fireEvent.click(within(detail).getByRole('button', { name: '1m' }));
    const typed = within(detail).getByLabelText('gpt-5 上下文窗口（tokens）');
    fireEvent.change(typed, { target: { value: '272k' } });
    fireEvent.keyDown(typed, { key: 'Enter' });

    await waitFor(() => {
      expect(runtime.updateModel).toHaveBeenLastCalledWith({
        providerId: 'provider-1',
        modelId: 'model-1',
        contextWindow: 272_000,
      });
    });
  });

  it('portals the model capability dialog outside the settings frame', async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole('button', { name: '查看模型 gpt-5' }));

    const detail = await screen.findByRole('dialog', { name: 'gpt-5' });
    expect(detail.closest('.model-settings-root')).toBeNull();
    expect(detail.closest('.model-priority-row')).toBeNull();
    expect(detail.closest('.settings-modal-content')).toBeNull();
    expect(document.body.contains(detail)).toBe(true);
    expect(document.querySelector('.model-capability-dialog__overlay')?.parentElement).toBe(
      detail.parentElement,
    );
  });

  it('keeps model details open and allows retry when capability detection fails', async () => {
    runtime.probeCapabilities.mockRejectedValueOnce(new Error('能力检测请求超时'));
    await renderSettings();

    fireEvent.click(screen.getByRole('button', { name: '查看模型 gpt-5' }));
    const detail = await screen.findByRole('dialog', { name: 'gpt-5' });
    fireEvent.click(within(detail).getByRole('button', { name: '检测能力' }));

    expect((await within(detail).findByRole('alert')).textContent).toContain('能力检测请求超时');
    expect(within(detail).getByRole('button', { name: '检测能力' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.getByRole('dialog', { name: 'gpt-5' })).toBeTruthy();
  });

  it('humanizes a probeCapabilities IPC timeout inside the model dialog', async () => {
    runtime.probeCapabilities.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'runtime:provider-probe-capabilities': RuntimeTransientError: Runtime request timed out: provider.probeCapabilities",
      ),
    );
    await renderSettings();

    fireEvent.click(screen.getByRole('button', { name: '查看模型 gpt-5' }));
    const detail = await screen.findByRole('dialog', { name: 'gpt-5' });
    fireEvent.click(within(detail).getByRole('button', { name: '检测能力' }));

    expect((await within(detail).findByRole('alert')).textContent).toContain('能力检测超时');
    expect(within(detail).getByRole('alert').textContent).not.toContain('Error invoking remote method');
    expect(within(detail).getByRole('button', { name: '检测能力' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.getByRole('dialog', { name: 'gpt-5' })).toBeTruthy();
  });

  it('maps invalid confirm-capabilities IPC errors to a readable save failure', async () => {
    runtime.confirmCapabilities.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'runtime:provider-confirm-capabilities': Error: Invalid confirm-capabilities payload",
      ),
    );
    await renderSettings();

    fireEvent.click(screen.getByRole('button', { name: '查看模型 gpt-5' }));
    const detail = await screen.findByRole('dialog', { name: 'gpt-5' });
    fireEvent.click(within(detail).getByRole('button', { name: '联网搜索：未标记' }));
    fireEvent.click(within(detail).getByRole('button', { name: '保存能力' }));

    expect((await within(detail).findByRole('alert')).textContent).toContain(
      '保存失败：当前勾选的能力无法提交',
    );
    expect(within(detail).getByRole('button', { name: '保存能力' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('saves the provider name only on blur with a partial patch', async () => {
    await renderSettings();
    const input = screen.getByLabelText('供应商名称');

    fireEvent.change(input, { target: { value: 'CODEX Next' } });
    expect(runtime.updateProvider).not.toHaveBeenCalled();
    fireEvent.blur(input, { target: { value: 'CODEX Next' } });

    await waitFor(() => {
      expect(runtime.updateProvider).toHaveBeenCalledWith({
        providerId: 'provider-1',
        name: 'CODEX Next',
      });
    });
  });

  it('saves protocol changes immediately without marking a transient draft', async () => {
    const onDirtyChange = await renderSettings();

    fireEvent.click(screen.getByRole('tab', { name: 'Anthropic 格式' }));

    await waitFor(() => {
      expect(runtime.updateProvider).toHaveBeenCalledWith({
        providerId: 'provider-1',
        protocol: 'anthropic-messages',
      });
    });
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('reports only an in-progress key draft as dirty and clears it after cancellation', async () => {
    const onDirtyChange = await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '添加 API 密钥' }));
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-secret' } });

    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('opens Vision Fallback as a list-backed detail panel and saves changes immediately', async () => {
    runtime.listProviders.mockResolvedValueOnce({
      providers: [
        {
          ...provider,
          models: [
            ...provider.models,
            {
              ...provider.models[0]!,
              modelId: 'model-text' as ProviderSummary['models'][number]['modelId'],
              providerModelId: 'deepseek-chat',
              displayName: 'DeepSeek Chat',
              capabilities: ['text'],
              capabilitiesConfirmed: true,
              priority: 1,
            },
          ],
        },
      ],
    });
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '图片识别 Fallback' }));

    expect(await screen.findByRole('heading', { name: '图片识别 Fallback' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    const picker = screen.getByRole('combobox', { name: '视觉模型' });
    fireEvent.click(picker);
    const list = await screen.findByRole('listbox', { name: '视觉模型' });
    expect(within(list).getByRole('option', { name: /gpt-5/ })).toBeTruthy();
    expect(within(list).queryByRole('option', { name: /DeepSeek Chat/ })).toBeNull();
    expect(within(list).queryByRole('option', { name: '选择视觉模型…' })).toBeNull();
    fireEvent.pointerDown(within(list).getByRole('option', { name: /gpt-5/ }));

    await waitFor(() => {
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: 'vision-fallback',
        value: { enabled: true, modelId: 'model-1' },
      });
    });
    expect(screen.queryByText('图片识别 Fallback 已更新')).toBeNull();
    expect(screen.queryByTestId('shell-toast')).toBeNull();
  });

  it('opens Plan & Act as a list-backed detail panel and saves changes immediately', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '规划 & 执行模型' }));

    expect(await screen.findByRole('heading', { name: '规划 & 执行模型' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('combobox', { name: '规划模型' }));
    expect(screen.getByRole('listbox', { name: '规划模型' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /gpt-5/ })).toBeTruthy();

    await waitFor(() => {
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: 'plan-act',
        value: {
          enabled: true,
          planModelId: null,
          actModelId: null,
          planReasoningEffort: null,
          actReasoningEffort: null,
        },
      });
    });
    expect(screen.queryByText('规划与执行模型已更新')).toBeNull();
    expect(screen.queryByTestId('shell-toast')).toBeNull();
  });

  it('does not expose or load a separate Goal evaluator setting', async () => {
    await renderSettings();

    expect(screen.getByRole('button', { name: '模型配置云同步' })).toBeTruthy();
    expect(runtime.getSettings).toHaveBeenCalledWith({
      keys: ['vision-fallback', 'plan-act', 'model-config-cloud-sync'],
    });
    expect(screen.queryByRole('button', { name: '更多模型设置' })).toBeNull();
    expect(screen.queryByText('目标模式评估模型')).toBeNull();
  });

  it('persists the model configuration cloud-sync preference', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '模型配置云同步' }));

    expect(await screen.findByRole('heading', { name: '云端同步' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: 'model-config-cloud-sync',
        value: true,
      });
    });
    expect(screen.queryByText('模型配置云同步已开启')).toBeNull();
    expect(screen.queryByTestId('shell-toast')).toBeNull();
  });

  it('reveals a saved credential through the explicit eye control without primary label', async () => {
    await renderSettings();
    expect(screen.queryByText('primary')).toBeNull();
    expect(screen.getByLabelText('API 密钥')).toBeTruthy();

    await waitFor(() => {
      expect(runtime.revealProviderCredential).toHaveBeenCalledWith({
        providerId: 'provider-1',
        credentialRefId: 'credential-1',
      });
    });

    const eye = screen.getByRole('button', { name: '显示密钥' });
    expect(eye.querySelector('.model-settings-spin')).toBeNull();
    fireEvent.click(eye);
    expect(eye.querySelector('.model-settings-spin')).toBeNull();
    expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe(
      'sk-revealed-secret',
    );
  });

  it('stages credential edits on blur without writing secure-store immediately', async () => {
    const onDirtyChange = await renderSettings();
    await waitFor(() => {
      expect(runtime.revealProviderCredential).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }));
    expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe(
      'sk-revealed-secret',
    );

    const input = screen.getByLabelText('API 密钥') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-new-secret' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
    expect(runtime.updateProviderCredential).not.toHaveBeenCalled();
  });

  it('opens the import dialog after fetching models from the provider', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '从服务商拉取模型列表' }));

    await waitFor(() => {
      expect(runtime.discoverModels).toHaveBeenCalledWith({
        providerId: 'provider-1',
        persist: false,
      });
    });
    expect(await screen.findByRole('heading', { name: '导入模型' })).toBeTruthy();
    expect(screen.getByText('gpt-4.1')).toBeTruthy();
    expect(screen.getByRole('button', { name: '全选' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /应用到优先级/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy();
    expect(screen.getByText(/将新增 1/)).toBeTruthy();
  });

  it('closes the import dialog from a transparent overlay without covering the page', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '从服务商拉取模型列表' }));
    expect(await screen.findByRole('heading', { name: '导入模型' })).toBeTruthy();
    const overlay = document.querySelector('.model-import-overlay');
    expect(overlay).toBeTruthy();
    fireEvent.pointerDown(overlay!);
    expect(screen.queryByRole('heading', { name: '导入模型' })).toBeNull();
    expect(screen.getByDisplayValue('CODEX')).toBeTruthy();
  });

  it('toasts a humanized discover timeout instead of a page banner', async () => {
    runtime.discoverModels.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'runtime:provider-discover': RuntimeTransientError: Runtime request timed out: provider.discoverModels",
      ),
    );
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '从服务商拉取模型列表' }));

    const toast = await screen.findByTestId('shell-toast');
    expect(toast.textContent).toContain('响应超时');
    expect(toast.textContent).not.toContain('Error invoking remote method');
    const root = document.querySelector('.model-settings-root');
    expect(root).toBeTruthy();
    expect(within(root as HTMLElement).queryByRole('alert')).toBeNull();
  });

  it('runs a connection test and shows latency under the button', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() => {
      expect(runtime.discoverModels).toHaveBeenCalledWith({
        providerId: 'provider-1',
        persist: false,
      });
    });
    expect(await screen.findByText(/连接成功 · 128ms/)).toBeTruthy();
  });

  it('opens the provider catalog before showing a provider form', async () => {
    await renderSettings();
    await openProviderCatalog();

    expect(await screen.findByRole('region', { name: '添加模型' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '推荐服务' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('button', { name: /NewMax Gateway/ })).toBeNull();
    expect(screen.getByRole('button', { name: /自定义供应商/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /从 CC Switch 导入/ })).toBeTruthy();
    expect(screen.queryByTestId('provider-icon-newmax-gateway')).toBeNull();
    expect(screen.getByTestId('provider-icon-custom')).toBeTruthy();
    expect(screen.getByTestId('provider-icon-cc-switch')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '自定义供应商' })).toBeNull();
    expect(screen.queryByDisplayValue('https://')).toBeNull();
  });

  it('renders vendored brand logos for catalog providers that have one', async () => {
    await renderSettings();
    await openProviderCatalog();

    fireEvent.click(screen.getByRole('tab', { name: '国内服务' }));
    const deepseek = await screen.findByTestId('provider-icon-deepseek');
    expect(deepseek.getAttribute('data-brand-logo')).toBe('true');
    expect(deepseek.querySelector('img,[role="img"]')).toBeTruthy();
    expect(deepseek.textContent?.trim()).toBe('');

    fireEvent.click(screen.getByRole('tab', { name: '本地模型' }));
    const ollama = await screen.findByTestId('provider-icon-ollama');
    expect(ollama.getAttribute('data-brand-logo')).toBe('true');
  });

  it('opens custom provider configuration and returns to the catalog', async () => {
    await renderSettings();
    await openProviderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /自定义供应商/ }));

    expect(await screen.findByRole('heading', { name: '自定义供应商' })).toBeTruthy();
    expect(screen.getByTestId('provider-form-icon-custom')).toBeTruthy();
    expect(screen.getByTestId('provider-base-url')).toHaveProperty('value', 'https://');
    expect(screen.getByTestId('custom-provider-connection-hint').textContent).toBe(
      '请从服务商接入文档复制 Base URL 或完整请求地址，离开输入框后会自动识别并整理。',
    );

    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    expect(await screen.findByRole('region', { name: '添加模型' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '自定义供应商' })).toBeNull();
  });

  it('uses built-in endpoints for OpenAI, Moonshot and Ollama without exposing URL fields', async () => {
    await renderSettings();
    await openProviderCatalog();

    fireEvent.click(screen.getByRole('tab', { name: '海外平台' }));
    fireEvent.click(screen.getByRole('button', { name: /^OpenAI/ }));
    expect(await screen.findByDisplayValue('OpenAI')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'OpenAI' })).toBeTruthy();
    expect(screen.getByTestId('provider-form-icon-openai')).toBeTruthy();
    expect(screen.queryByTestId('provider-base-url')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));

    fireEvent.click(screen.getByRole('tab', { name: '国内服务' }));
    fireEvent.click(screen.getByRole('button', { name: /^Moonshot/ }));
    expect(await screen.findByDisplayValue('Moonshot')).toBeTruthy();
    expect(screen.getByTestId('provider-form-icon-moonshot')).toBeTruthy();
    expect(screen.queryByTestId('provider-base-url')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));

    fireEvent.click(screen.getByRole('tab', { name: '本地模型' }));
    fireEvent.click(screen.getByRole('button', { name: /^Ollama/ }));
    expect(await screen.findByDisplayValue('Ollama')).toBeTruthy();
    expect(screen.getByTestId('provider-form-icon-ollama')).toBeTruthy();
    expect(screen.queryByTestId('provider-base-url')).toBeNull();
    expect(screen.getByDisplayValue('ollama-local')).toBeTruthy();
  });

  it('submits the hidden built-in endpoint for a catalog provider', async () => {
    runtime.probeModels.mockResolvedValue({
      discoveredIds: [],
      protocol: 'openai-responses',
      latencyMs: 42,
    });
    await renderSettings();
    await openProviderCatalog();

    fireEvent.click(screen.getByRole('tab', { name: '海外平台' }));
    fireEvent.click(screen.getByRole('button', { name: /^OpenAI/ }));

    const apiKey = document.querySelector<HTMLInputElement>(
      '.model-provider-form input[type="password"]',
    );
    expect(apiKey).toBeTruthy();
    fireEvent.change(apiKey!, { target: { value: 'sk-openai-test' } });

    // The priority chain is authored on the form now, so at least one model is
    // required before the provider can be activated.
    fireEvent.click(screen.getByTestId('create-provider-add-model'));
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'gpt-5' } });
    fireEvent.click(screen.getByTestId('create-provider-add-model-confirm'));

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() => {
      expect(runtime.createProvider).toHaveBeenCalledWith({
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'openai-responses',
        supportsDiscovery: true,
        discoverOnCreate: false,
        models: [{ providerModelId: 'gpt-5', displayName: 'gpt-5' }],
      });
    });
    expect(screen.queryByText(/已创建/)).toBeNull();
    expect(screen.queryByTestId('shell-toast')).toBeNull();
  });

  it('requires Base URL only for a custom provider', async () => {
    await renderSettings();
    await openProviderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /自定义供应商/ }));

    const name = document.querySelector<HTMLInputElement>(
      '.model-provider-form input:not([type="password"])',
    );
    const apiKey = document.querySelector<HTMLInputElement>(
      '.model-provider-form input[type="password"]',
    );
    expect(name).toBeTruthy();
    expect(apiKey).toBeTruthy();
    fireEvent.change(name!, { target: { value: 'Custom Gateway' } });
    fireEvent.change(apiKey!, { target: { value: 'sk-custom-test' } });
    fireEvent.click(screen.getByRole('button', { name: '从服务商拉取模型列表' }));

    expect((await screen.findAllByText('请填写 Base URL')).length).toBeGreaterThan(0);
    expect(runtime.createProvider).not.toHaveBeenCalled();
  });

  it('fetches models into the create draft without creating the provider first', async () => {
    runtime.probeModels.mockResolvedValue({
      discoveredIds: ['gpt-5', 'gpt-5-mini'],
      protocol: 'openai-chat',
    });
    await renderSettings();
    await openProviderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /自定义供应商/ }));

    const name = document.querySelector<HTMLInputElement>(
      '.model-provider-form input:not([type="password"])',
    );
    const apiKey = document.querySelector<HTMLInputElement>(
      '.model-provider-form input[type="password"]',
    );
    const baseUrl = document.querySelector<HTMLInputElement>('[data-testid="provider-base-url"]');
    expect(name && apiKey && baseUrl).toBeTruthy();
    fireEvent.change(name!, { target: { value: 'Custom Gateway' } });
    fireEvent.change(baseUrl!, { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(apiKey!, { target: { value: 'sk-custom-test' } });

    fireEvent.click(screen.getByRole('button', { name: '从服务商拉取模型列表' }));

    await waitFor(() => {
      expect(runtime.probeModels).toHaveBeenCalledWith({
        baseUrl: 'https://api.example.com/v1',
        protocol: 'openai-chat',
      });
    });
    // The probe must not persist anything — the provider does not exist yet.
    expect(runtime.createProvider).not.toHaveBeenCalled();

    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      '.model-import-dialog__row input[type="checkbox"]',
    );
    expect(checkboxes.length).toBeGreaterThan(0);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /应用到优先级/ }));

    // Checked ids land in the draft list, still without touching the runtime.
    await waitFor(() => {
      expect(
        document.querySelectorAll('.model-priority-list .model-priority-row').length,
      ).toBe(1);
    });
    expect(runtime.createProvider).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() => {
      expect(runtime.createProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Custom Gateway',
          baseUrl: 'https://api.example.com/v1',
          protocol: 'openai-chat',
          discoverOnCreate: false,
          models: [{ providerModelId: 'gpt-5', displayName: 'gpt-5' }],
        }),
      );
    });
    expect(screen.queryByText(/已创建/)).toBeNull();
    expect(screen.queryByTestId('shell-toast')).toBeNull();
  });

  it('keeps the provider via「仍然保存」only after a failing connection test', async () => {
    // NewMax parity: a relay that rejects the capability probe can still be kept.
    runtime.probeModels.mockRejectedValue(new Error('401 Unauthorized'));
    await renderSettings();
    await openProviderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /自定义供应商/ }));

    const name = document.querySelector<HTMLInputElement>(
      '.model-provider-form input:not([type="password"])',
    );
    const apiKey = document.querySelector<HTMLInputElement>(
      '.model-provider-form input[type="password"]',
    );
    const baseUrl = document.querySelector<HTMLInputElement>('[data-testid="provider-base-url"]');
    expect(name && apiKey && baseUrl).toBeTruthy();
    fireEvent.change(name!, { target: { value: 'Relay Gateway' } });
    fireEvent.change(baseUrl!, { target: { value: 'https://relay.example.com/v1' } });
    fireEvent.change(apiKey!, { target: { value: 'sk-relay-test' } });

    fireEvent.click(screen.getByTestId('create-provider-add-model'));
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'gpt-5' } });
    fireEvent.click(screen.getByTestId('create-provider-add-model-confirm'));

    // The escape hatch is hidden until the test actually fails.
    expect(screen.queryByTestId('model-settings-save-unverified')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    const saveAnyway = await screen.findByTestId('model-settings-save-unverified');
    // A failing probe must never persist the provider on its own.
    expect(runtime.createProvider).not.toHaveBeenCalled();

    fireEvent.click(saveAnyway);
    await waitFor(() => {
      expect(runtime.createProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Relay Gateway',
          baseUrl: 'https://relay.example.com/v1',
          protocol: 'openai-chat',
          discoverOnCreate: false,
          unverified: true,
          models: [{ providerModelId: 'gpt-5', displayName: 'gpt-5' }],
        }),
      );
    });
    expect(screen.queryByTestId('shell-toast')).toBeNull();
  });

  it('restores the previously selected provider when its list row is selected', async () => {
    await renderSettings();
    await openProviderCatalog();
    const providerRow = document.querySelector<HTMLButtonElement>('.model-enabled-row__main');
    expect(providerRow).toBeTruthy();
    fireEvent.click(providerRow!);

    expect(await screen.findByDisplayValue('CODEX')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '添加模型' })).toBeNull();
  });

  it('previews and imports selected CC Switch providers', async () => {
    runtime.listProviders
      .mockResolvedValueOnce({ providers: [provider] })
      .mockResolvedValue({ providers: [provider, importedProvider] });

    await renderSettings();
    await openProviderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /从 CC Switch 导入/ }));

    await waitFor(() => {
      expect(runtime.previewCcSwitchImport).toHaveBeenCalledWith({});
    });
    expect(await screen.findByRole('heading', { name: '从 CC Switch 导入' })).toBeTruthy();
    expect(screen.getByText('CC Switch 配置')).toBeTruthy();
    expect(screen.getByText(/claude-sonnet-4/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '导入 1 项' }));
    await waitFor(() => {
      expect(runtime.importCcSwitch).toHaveBeenCalledWith({
        sourceIds: ['source-claude'],
      });
    });
    expect(await screen.findByDisplayValue('Imported Claude')).toBeTruthy();
  });

  it('keeps manual add collapsed behind 添加模型', async () => {
    await renderSettings();
    expect(screen.queryByPlaceholderText('模型 ID')).toBeNull();
    const addModelButtons = screen.getAllByRole('button', { name: '添加模型' });
    fireEvent.click(addModelButtons[addModelButtons.length - 1]!);
    expect(screen.getByPlaceholderText('模型 ID')).toBeTruthy();
    expect(screen.getByRole('button', { name: '从服务商拉取模型列表' })).toBeTruthy();
  });

  it('normalizes a pasted chat-completions URL on the custom provider form', async () => {
    await renderSettings();
    await openProviderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /自定义供应商/ }));

    const url = screen.getByTestId('provider-base-url');
    fireEvent.change(url, {
      target: { value: 'https://www.kamenking.top/v1/chat/completions' },
    });
    fireEvent.blur(url);

    expect(url).toHaveProperty('value', 'https://www.kamenking.top/v1');
    expect(screen.getByTestId('custom-provider-connection-hint').textContent).toBe(
      '已根据地址识别为 OpenAI 格式；仍可在下方手动修改。',
    );
  });

  it('uses 停用 and two-step 移除 on the enabled provider menu', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'CODEX 更多操作' }));
    expect(screen.getByRole('menuitem', { name: '停用' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '编辑配置' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: '移除' }));
    expect(screen.getByRole('menuitem', { name: '确认移除' })).toBeTruthy();
  });

  it('expands disabled providers under the section header', async () => {
    runtime.listProviders.mockResolvedValue({
      providers: [
        provider,
        {
          ...provider,
          providerId: 'provider-disabled' as ProviderSummary['providerId'],
          name: 'OLD',
          enabled: false,
          sortOrder: 1,
        },
      ],
    });
    await renderSettings();

    expect(screen.queryByTestId('model-settings-disabled-menu-list')).toBeNull();
    expect(screen.queryByText('OLD')).toBeNull();
    fireEvent.click(screen.getByTestId('model-settings-disabled-menu-trigger'));
    const disabledList = screen.getByTestId('model-settings-disabled-menu-list');
    expect(disabledList).toBeTruthy();
    expect(within(disabledList).getByText('OLD')).toBeTruthy();
    fireEvent.click(screen.getByTestId('model-settings-disabled-action-menu-trigger'));
    expect(screen.getByRole('menuitem', { name: '启用全部' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '清空' })).toBeTruthy();
  });

  it('keeps the disabled section open after selecting a disabled provider', async () => {
    runtime.listProviders.mockResolvedValue({
      providers: [
        provider,
        {
          ...provider,
          providerId: 'provider-disabled' as ProviderSummary['providerId'],
          name: 'OLD',
          enabled: false,
          sortOrder: 1,
        },
      ],
    });
    await renderSettings();

    fireEvent.click(screen.getByTestId('model-settings-disabled-menu-trigger'));
    fireEvent.click(screen.getByText('OLD'));
    expect(screen.getByTestId('model-settings-disabled-menu-list')).toBeTruthy();
    expect(screen.getByText('已停用')).toBeTruthy();
  });

  it('shows NewMax media-tab copy instead of an invented unavailable notice', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: '图像生成' }));
    expect(
      await screen.findByText(
        '还没有配置过生图模型的提供商。可以点击「添加生图模型」，测试成功后会出现在左侧列表。',
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '添加生图模型' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/尚未接入/)).toBeNull();
    expect(screen.queryByText(/SYNC-THINK/)).toBeNull();
  });

  it('keeps openai-images providers off the text-generation list', async () => {
    runtime.listProviders.mockResolvedValue({
      providers: [
        provider,
        {
          ...provider,
          providerId: 'provider-image' as ProviderSummary['providerId'],
          name: 'OpenAI Images',
          protocol: 'openai-images',
          sortOrder: 1,
          models: [
            {
              ...provider.models[0]!,
              modelId: 'model-image' as ProviderSummary['models'][number]['modelId'],
              providerModelId: 'gpt-image-2',
              displayName: 'gpt-image-2',
              protocol: 'openai-images',
              capabilities: ['image-generation'],
            },
          ],
        },
      ],
    });
    await renderSettings();
    expect(screen.getByDisplayValue('CODEX')).toBeTruthy();
    expect(screen.queryByText('OpenAI Images')).toBeNull();
  });
});
