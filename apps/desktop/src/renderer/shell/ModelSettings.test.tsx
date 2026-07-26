/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProviderSummary } from '@sync-think/protocol';
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
      capabilities: [],
      capabilitiesConfirmed: true,
      priority: 0,
      contextWindow: 372_000,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const runtime = {
  listProviders: vi.fn(),
  getSettings: vi.fn(),
  updateProvider: vi.fn(),
  addProviderCredential: vi.fn(),
  revealProviderCredential: vi.fn(),
  updateProviderCredential: vi.fn(),
  discoverModels: vi.fn(),
  addModels: vi.fn(),
  removeProviderModel: vi.fn(),
  setModelPriorities: vi.fn(),
  setSetting: vi.fn(),
};

beforeEach(() => {
  runtime.listProviders.mockResolvedValue({ providers: [provider] });
  runtime.getSettings.mockResolvedValue({ settings: {} });
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
  render(<ModelSettings onDirtyChange={onDirtyChange} />);
  await screen.findByDisplayValue('CODEX');
  return onDirtyChange;
}

describe('ModelSettings NewMax provider detail', () => {
  it('shows direct-edit fields without the legacy edit and save controls', async () => {
    await renderSettings();

    expect(screen.queryByText('取消编辑')).toBeNull();
    expect(screen.queryByText('保存更改')).toBeNull();
    expect(screen.queryByText('轮换 API Key（留空则不改）')).toBeNull();
    expect(screen.getByText('API 密钥')).toBeTruthy();
    expect(screen.getByText('模型优先级（1）')).toBeTruthy();
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
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '图片识别 Fallback' }));

    expect(screen.getByRole('heading', { name: '图片识别 Fallback' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    fireEvent.click(screen.getByRole('switch'));

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

    expect(screen.getByRole('heading', { name: '规划 & 执行模型' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: 'plan-act',
        value: { enabled: true, planModelId: null, actModelId: null },
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

  it('keeps manual add collapsed behind 添加模型', async () => {
    await renderSettings();
    expect(screen.queryByPlaceholderText('模型 ID')).toBeNull();
    const addModelButtons = screen.getAllByRole('button', { name: '添加模型' });
    fireEvent.click(addModelButtons[addModelButtons.length - 1]!);
    expect(screen.getByPlaceholderText('模型 ID')).toBeTruthy();
    expect(screen.getByRole('button', { name: '从服务商拉取模型列表' })).toBeTruthy();
  });
});
