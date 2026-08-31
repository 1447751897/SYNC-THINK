/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProviderSummary } from '@sync-think/protocol';
import { DialogProvider } from './Dialog.js';
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
  addModels: vi.fn(),
  removeProviderModel: vi.fn(),
  setModelPriorities: vi.fn(),
  setSetting: vi.fn(),
  getUsageSummary: vi.fn(),
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
  runtime.removeProviderModel.mockResolvedValue({ providerId: provider.providerId, removed: true });
  runtime.setModelPriorities.mockResolvedValue({
    providerId: provider.providerId,
    models: provider.models,
  });
  runtime.setSetting.mockResolvedValue({});
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
  vi.clearAllMocks();
});

async function renderSettings(onDirtyChange = vi.fn()) {
  render(
    <DialogProvider>
      <ModelSettings onDirtyChange={onDirtyChange} />
    </DialogProvider>,
  );
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
  it('opens Plan & Act from a navigation request and replays only when its key changes', async () => {
    const { rerender } = render(
      <DialogProvider>
        <ModelSettings initialDetailView="plan-act" navigationKey="plan-act-1" />
      </DialogProvider>,
    );

    expect(await screen.findByRole('heading', { name: '规划 & 执行模型' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '图片识别 Fallback' }));
    expect(await screen.findByRole('heading', { name: '图片识别 Fallback' })).toBeTruthy();

    rerender(
      <DialogProvider>
        <ModelSettings initialDetailView="plan-act" navigationKey="plan-act-1" />
      </DialogProvider>,
    );
    expect(screen.getByRole('heading', { name: '图片识别 Fallback' })).toBeTruthy();

    rerender(
      <DialogProvider>
        <ModelSettings initialDetailView="plan-act" navigationKey="plan-act-2" />
      </DialogProvider>,
    );
    expect(await screen.findByRole('heading', { name: '规划 & 执行模型' })).toBeTruthy();
  });

  it('shows readable cache efficiency and expands one request cost breakdown on demand', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: '使用统计' }));

    const requestTable = await screen.findByRole('table');
    expect(screen.getByText('缓存命中率')).toBeTruthy();
    expect(within(requestTable).getByText('普通输入 1.2k')).toBeTruthy();
    expect(within(requestTable).getByText(/缓存读取 12\.8k/)).toBeTruthy();
    expect(within(requestTable).getByText('缓存命中 91.4%')).toBeTruthy();
    expect(within(requestTable).getByText('输出 488')).toBeTruthy();
    expect(within(requestTable).getByText('成功')).toBeTruthy();
    expect(screen.queryByText(/普通输入费 \$0\.006000/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看 gpt-5 请求详情' }));
    const details = await screen.findByTestId('usage-request-details-request-cache-1');
    expect(within(details).getByText('请求信息')).toBeTruthy();
    expect(within(details).getByText('请求 ID')).toBeTruthy();
    expect(within(details).getByText('request-cache-1')).toBeTruthy();
    expect(within(details).getByText('运行 ID')).toBeTruthy();
    expect(within(details).getByText('run-usage-1')).toBeTruthy();
    expect(within(details).getByText('Provider')).toBeTruthy();
    expect(within(details).getByText('CODEX · provider-1')).toBeTruthy();
    expect(within(details).getByText('Provider 模型')).toBeTruthy();
    expect(within(details).getByText('gpt-5-provider')).toBeTruthy();
    expect(within(details).getByText('Token 明细')).toBeTruthy();
    expect(within(details).getByText('推理 Token')).toBeTruthy();
    expect(within(details).getByText('123')).toBeTruthy();
    expect(within(details).getByText('总 Token')).toBeTruthy();
    expect(within(details).getByText('14.5k')).toBeTruthy();
    expect(within(details).getByText('费用明细')).toBeTruthy();
    expect(within(details).getByText('普通输入费')).toBeTruthy();
    expect(within(details).getByText('$0.006000')).toBeTruthy();
    expect(within(details).getByText('缓存读取费')).toBeTruthy();
    expect(within(details).getByText('$0.006400')).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起 gpt-5 请求详情' })).toBeTruthy();
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

    expect(await screen.findByText('50.0%')).toBeTruthy();
    const requestTable = screen.getByRole('table');
    const unreportedRow = within(requestTable).getByText('输入 9.0k').closest('tr');
    expect(unreportedRow).toBeTruthy();
    expect(within(unreportedRow!).getByText('缓存读取 未上报')).toBeTruthy();
    expect(within(unreportedRow!).getByText('缓存创建 未上报')).toBeTruthy();
    expect(within(unreportedRow!).getByText('缓存命中 未上报')).toBeTruthy();
    expect(within(unreportedRow!).getByText('未结束')).toBeTruthy();
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

    fireEvent.click(screen.getByRole('radio', { name: 'Anthropic 格式' }));

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
    const picker = screen.getByRole('combobox');
    expect(within(picker).getByRole('option', { name: /gpt-5/ })).toBeTruthy();
    expect(within(picker).queryByRole('option', { name: /DeepSeek Chat/ })).toBeNull();

    await waitFor(() => {
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: 'vision-fallback',
        value: { enabled: true, modelId: null },
      });
    });
  });

  it('opens Plan & Act as a list-backed detail panel and saves changes immediately', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '规划 & 执行模型' }));

    expect(await screen.findByRole('heading', { name: '规划 & 执行模型' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    fireEvent.click(screen.getByRole('switch'));

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
  });

  it('reveals a saved credential through the explicit eye control without primary label', async () => {
    await renderSettings();
    expect(screen.queryByText('primary')).toBeNull();
    expect(screen.getByLabelText('API 密钥')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }));

    await waitFor(() => {
      expect(runtime.revealProviderCredential).toHaveBeenCalledWith({
        providerId: 'provider-1',
        credentialRefId: 'credential-1',
      });
    });
    await waitFor(() => {
      expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe(
        'sk-revealed-secret',
      );
    });
  });

  it('stages credential edits on blur without writing secure-store immediately', async () => {
    const onDirtyChange = await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }));
    await waitFor(() => {
      expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe(
        'sk-revealed-secret',
      );
    });

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
    expect(screen.getByRole('button', { name: /更新列表/ })).toBeTruthy();
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
    expect(screen.queryByRole('heading', { name: '添加模型源' })).toBeNull();
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

    expect(await screen.findByRole('heading', { name: '添加模型源' })).toBeTruthy();
    expect(screen.getByText('正在配置 自定义供应商')).toBeTruthy();
    expect(screen.getByTestId('provider-form-icon-custom')).toBeTruthy();
    expect(screen.getByTestId('provider-base-url')).toHaveProperty('value', 'https://');

    fireEvent.click(screen.getByRole('button', { name: '返回服务商目录' }));
    expect(await screen.findByRole('region', { name: '添加模型' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '添加模型源' })).toBeNull();
  });

  it('uses built-in endpoints for OpenAI, Moonshot and Ollama without exposing URL fields', async () => {
    await renderSettings();
    await openProviderCatalog();

    fireEvent.click(screen.getByRole('tab', { name: '海外平台' }));
    fireEvent.click(screen.getByRole('button', { name: /^OpenAI/ }));
    expect(await screen.findByDisplayValue('OpenAI')).toBeTruthy();
    expect(screen.getByTestId('provider-form-icon-openai')).toBeTruthy();
    expect(screen.queryByTestId('provider-base-url')).toBeNull();
    expect(screen.getByText('连接地址已由 OpenAI 模板内置')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回服务商目录' }));

    fireEvent.click(screen.getByRole('tab', { name: '国内服务' }));
    fireEvent.click(screen.getByRole('button', { name: /^Moonshot/ }));
    expect(await screen.findByDisplayValue('Moonshot')).toBeTruthy();
    expect(screen.getByTestId('provider-form-icon-moonshot')).toBeTruthy();
    expect(screen.queryByTestId('provider-base-url')).toBeNull();
    expect(screen.getByText('连接地址已由 Moonshot 模板内置')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回服务商目录' }));

    fireEvent.click(screen.getByRole('tab', { name: '本地模型' }));
    fireEvent.click(screen.getByRole('button', { name: /^Ollama/ }));
    expect(await screen.findByDisplayValue('Ollama')).toBeTruthy();
    expect(screen.getByTestId('provider-form-icon-ollama')).toBeTruthy();
    expect(screen.queryByTestId('provider-base-url')).toBeNull();
    expect(screen.getByText('连接地址已由 Ollama 模板内置')).toBeTruthy();
    expect(screen.getByDisplayValue('ollama-local')).toBeTruthy();
  });

  it('submits the hidden built-in endpoint for a catalog provider', async () => {
    await renderSettings();
    await openProviderCatalog();

    fireEvent.click(screen.getByRole('tab', { name: '海外平台' }));
    fireEvent.click(screen.getByRole('button', { name: /^OpenAI/ }));

    const apiKey = document.querySelector<HTMLInputElement>(
      '.model-provider-form input[type="password"]',
    );
    expect(apiKey).toBeTruthy();
    fireEvent.change(apiKey!, { target: { value: 'sk-openai-test' } });
    fireEvent.click(screen.getByRole('button', { name: '创建并保存' }));

    await waitFor(() => {
      expect(runtime.createProvider).toHaveBeenCalledWith({
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'openai-responses',
        supportsDiscovery: true,
      });
    });
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
    fireEvent.click(screen.getByRole('button', { name: '创建并保存' }));

    expect((await screen.findAllByText('请填写 Base URL')).length).toBeGreaterThan(0);
    expect(runtime.createProvider).not.toHaveBeenCalled();
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
});
