/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProviderSummary } from '@sync-think/protocol';
import { ImageGenerationSettings } from './ImageGenerationSettings.js';
import { IMAGE_GENERATION_COPY } from './image-generation-providers.js';

const chatProvider: ProviderSummary = {
  providerId: 'provider-chat' as ProviderSummary['providerId'],
  name: 'CODEX',
  baseUrl: 'https://example.com',
  protocol: 'openai-chat',
  supportsDiscovery: true,
  surface: 'generic',
  enabled: true,
  sortOrder: 0,
  credentials: [
    {
      credentialRefId: 'credential-chat' as ProviderSummary['credentials'][number]['credentialRefId'],
      credentialGroupId: 'group-chat' as ProviderSummary['credentials'][number]['credentialGroupId'],
      groupName: 'default',
      label: 'primary',
      kind: 'api-key',
      hasSecret: true,
    },
  ],
  models: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const imageProvider: ProviderSummary = {
  providerId: 'provider-image' as ProviderSummary['providerId'],
  name: '自定义生图',
  baseUrl: 'https://super-canvas.com/v1',
  protocol: 'openai-images',
  supportsDiscovery: true,
  surface: 'generic',
  enabled: true,
  sortOrder: 1,
  credentials: [
    {
      credentialRefId: 'credential-image' as ProviderSummary['credentials'][number]['credentialRefId'],
      credentialGroupId: 'group-image' as ProviderSummary['credentials'][number]['credentialGroupId'],
      groupName: 'default',
      label: 'primary',
      kind: 'api-key',
      hasSecret: true,
    },
  ],
  models: [
    {
      modelId: 'model-image' as ProviderSummary['models'][number]['modelId'],
      providerModelId: 'gpt-image-2',
      displayName: 'gpt-image-2',
      protocol: 'openai-images',
      capabilities: ['image-generation'],
      capabilitiesConfirmed: true,
      priority: 0,
    },
    {
      modelId: 'model-image-backup' as ProviderSummary['models'][number]['modelId'],
      providerModelId: 'gpt-image-2.5',
      displayName: 'gpt-image-2.5',
      protocol: 'openai-images',
      capabilities: ['image-generation'],
      capabilitiesConfirmed: true,
      priority: 1,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const openaiCatalogProvider: ProviderSummary = {
  ...imageProvider,
  providerId: 'provider-openai' as ProviderSummary['providerId'],
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  models: [imageProvider.models[0]!],
};

const runtime = {
  listProviders: vi.fn(),
  createProvider: vi.fn(),
  discoverModels: vi.fn(),
  addModels: vi.fn(),
  confirmCapabilities: vi.fn(),
  reorderProviders: vi.fn(),
  updateProvider: vi.fn(),
  updateProviderCredential: vi.fn(),
  addProviderCredential: vi.fn(),
  removeProviderCredential: vi.fn(),
  removeProviderModel: vi.fn(),
  setModelPriorities: vi.fn(),
  getSettings: vi.fn(),
  setSetting: vi.fn(),
};

beforeEach(() => {
  runtime.listProviders.mockResolvedValue({ providers: [chatProvider] });
  runtime.createProvider.mockResolvedValue({
    provider: openaiCatalogProvider,
    credentialRefId: 'credential-image',
    discoveredModelCount: 0,
  });
  runtime.discoverModels.mockResolvedValue({
    providerId: openaiCatalogProvider.providerId,
    discoveredIds: ['gpt-image-2', 'gpt-4o'],
    models: [
      {
        modelId: 'model-image',
        providerModelId: 'gpt-image-2',
        displayName: 'gpt-image-2',
        protocol: 'openai-images',
        capabilities: ['image-generation'],
        capabilitiesConfirmed: false,
        priority: 0,
      },
      {
        modelId: 'model-text',
        providerModelId: 'gpt-4o',
        displayName: 'gpt-4o',
        protocol: 'openai-images',
        capabilities: ['text'],
        capabilitiesConfirmed: false,
        priority: 1,
      },
    ],
    source: 'adapter',
  });
  runtime.addModels.mockResolvedValue({
    providerId: openaiCatalogProvider.providerId,
    models: openaiCatalogProvider.models,
  });
  runtime.confirmCapabilities.mockResolvedValue({});
  runtime.reorderProviders.mockResolvedValue({
    providers: [chatProvider, openaiCatalogProvider],
  });
  runtime.getSettings.mockResolvedValue({ settings: {} });
  runtime.setSetting.mockResolvedValue({
    key: 'image-generation',
    value: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  runtime.updateProvider.mockResolvedValue({ provider: imageProvider });
  runtime.updateProviderCredential.mockResolvedValue({
    credential: imageProvider.credentials[0],
  });
  runtime.addProviderCredential.mockResolvedValue({
    credential: imageProvider.credentials[0],
  });
  runtime.setModelPriorities.mockResolvedValue({
    providerId: imageProvider.providerId,
    models: imageProvider.models,
  });
  runtime.removeProviderModel.mockResolvedValue({
    providerId: imageProvider.providerId,
    models: [imageProvider.models[0]],
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

describe('ImageGenerationSettings', () => {
  it('reloads image providers after a transient provider.list timeout', async () => {
    runtime.listProviders
      .mockRejectedValueOnce(new Error('Runtime request timed out: provider.list'))
      .mockResolvedValue({ providers: [openaiCatalogProvider] });
    render(<ImageGenerationSettings />);
    expect((await screen.findAllByText('OpenAI')).length).toBeGreaterThan(0);
    expect(runtime.listProviders).toHaveBeenCalledTimes(2);
  });

  it('shows NewMax empty copy and 添加生图模型', async () => {
    render(<ImageGenerationSettings />);
    expect(await screen.findByText(IMAGE_GENERATION_COPY.empty)).toBeTruthy();
    expect(screen.getByText(IMAGE_GENERATION_COPY.description)).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: IMAGE_GENERATION_COPY.addImageProvider }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('CODEX')).toBeNull();
  });

  it('opens the OpenAI-compatible catalog and creates a provider via clipboard hop', async () => {
    runtime.listProviders
      .mockResolvedValueOnce({ providers: [chatProvider] })
      .mockResolvedValue({ providers: [chatProvider, openaiCatalogProvider] });
    render(<ImageGenerationSettings />);
    await screen.findByText(IMAGE_GENERATION_COPY.empty);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.model-enabled-list__add')!);
    expect(
      await screen.findByRole('region', { name: IMAGE_GENERATION_COPY.addImageProvider }),
    ).toBeTruthy();
    expect(screen.queryByText('NewMax Gateway')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^OpenAI/ }));

    expect(screen.getByLabelText(IMAGE_GENERATION_COPY.apiProvider)).toBeTruthy();
    expect(screen.getByLabelText(IMAGE_GENERATION_COPY.baseUrl)).toBeTruthy();
    const apiKey = document.querySelector<HTMLInputElement>(
      '.model-provider-form input[type="password"]',
    );
    expect(apiKey).toBeTruthy();
    fireEvent.change(apiKey!, { target: { value: 'sk-image-test' } });
    fireEvent.click(screen.getByRole('button', { name: IMAGE_GENERATION_COPY.testAndActivate }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sk-image-test');
      expect(runtime.createProvider).toHaveBeenCalledWith({
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'openai-images',
        supportsDiscovery: true,
        discoverOnCreate: false,
      });
      expect(runtime.addModels).toHaveBeenCalledWith({
        providerId: openaiCatalogProvider.providerId,
        protocol: 'openai-images',
        models: [
          {
            providerModelId: 'gpt-image-2',
            displayName: 'gpt-image-2',
            capabilities: ['image-generation'],
          },
        ],
      });
    });
    expect(screen.queryByRole('button', { name: /添加已选模型/ })).toBeNull();
    expect(screen.queryByText('gpt-4o')).toBeNull();
    expect(screen.queryByText('Gemini API')).toBeNull();
  });

  it('shows the NewMax custom image-provider detail form', async () => {
    runtime.listProviders.mockResolvedValue({ providers: [chatProvider, imageProvider] });
    render(<ImageGenerationSettings />);

    expect(await screen.findByText(IMAGE_GENERATION_COPY.defaultProvider)).toBeTruthy();
    expect(screen.getByText(IMAGE_GENERATION_COPY.dedicatedKey)).toBeTruthy();
    expect(screen.getByText(IMAGE_GENERATION_COPY.providerCardDesc)).toBeTruthy();
    expect((screen.getByLabelText(IMAGE_GENERATION_COPY.apiProvider) as HTMLSelectElement).value).toBe(
      'openai',
    );
    expect(screen.getByRole('option', { name: 'OpenAI / 兼容' })).toBeTruthy();
    expect(screen.getByLabelText(IMAGE_GENERATION_COPY.baseUrl)).toBeTruthy();
    expect(screen.getByDisplayValue('https://super-canvas.com/v1')).toBeTruthy();
    expect(screen.getByLabelText(IMAGE_GENERATION_COPY.apiKey)).toBeTruthy();
    expect(screen.getByText(IMAGE_GENERATION_COPY.usingDedicatedKey)).toBeTruthy();
    expect(screen.getByText(IMAGE_GENERATION_COPY.defaultModel)).toBeTruthy();
    expect(
      screen.getByText(IMAGE_GENERATION_COPY.imageModelBackup.replace('{{index}}', '1')),
    ).toBeTruthy();
    expect(screen.getAllByText('gpt-image-2').length).toBeGreaterThan(0);
    expect(screen.getByText('gpt-image-2.5')).toBeTruthy();
    expect(screen.getByRole('button', { name: IMAGE_GENERATION_COPY.fetchModelList })).toBeTruthy();
    expect(screen.getByRole('button', { name: IMAGE_GENERATION_COPY.testConnection })).toBeTruthy();
    expect(screen.getByText(IMAGE_GENERATION_COPY.helperText)).toBeTruthy();
    expect(screen.queryByText('NewMax Gateway')).toBeNull();
    expect(screen.queryByRole('button', { name: /添加已选模型/ })).toBeNull();
  });

  it('tests connection after saving the detail form, without persisting discovered models', async () => {
    runtime.listProviders.mockResolvedValue({ providers: [imageProvider] });
    runtime.discoverModels.mockResolvedValue({
      providerId: imageProvider.providerId,
      discoveredIds: ['gpt-image-2'],
      models: [
        {
          ...imageProvider.models[0]!,
          capabilitiesConfirmed: false,
        },
      ],
      source: 'adapter',
    });
    render(<ImageGenerationSettings />);
    await screen.findByText(IMAGE_GENERATION_COPY.dedicatedKey);

    fireEvent.change(screen.getByLabelText(IMAGE_GENERATION_COPY.apiKey), {
      target: { value: 'sk-image-live' },
    });
    fireEvent.click(screen.getByRole('button', { name: IMAGE_GENERATION_COPY.testConnection }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sk-image-live');
      expect(runtime.updateProviderCredential).toHaveBeenCalledWith({
        providerId: imageProvider.providerId,
        credentialRefId: imageProvider.credentials[0]!.credentialRefId,
        rotateCredentialFromClipboard: true,
      });
      expect(runtime.discoverModels).toHaveBeenCalledWith({
        providerId: imageProvider.providerId,
        persist: false,
      });
    });
    expect(screen.queryByRole('button', { name: /添加已选模型/ })).toBeNull();
  });

  it('adds a backup model id from the NewMax list action', async () => {
    runtime.listProviders.mockResolvedValue({ providers: [imageProvider] });
    runtime.addModels.mockResolvedValue({
      providerId: imageProvider.providerId,
      models: imageProvider.models,
    });
    render(<ImageGenerationSettings />);
    await screen.findByText(IMAGE_GENERATION_COPY.defaultModel);

    const modelGroup = screen.getByRole('group', { name: IMAGE_GENERATION_COPY.modelId });
    fireEvent.click(modelGroup.querySelector('button.image-model-id-list__add')!);
    const draft = await screen.findByLabelText('新的生图模型 ID');
    fireEvent.change(draft, { target: { value: 'flux-1.1-pro' } });
    fireEvent.blur(draft);

    await waitFor(() => {
      expect(runtime.addModels).toHaveBeenCalledWith({
        providerId: imageProvider.providerId,
        protocol: 'openai-images',
        models: [
          {
            providerModelId: 'flux-1.1-pro',
            displayName: 'flux-1.1-pro',
            capabilities: ['image-generation'],
          },
        ],
      });
    });
  });

  it('merges fetched image models into the id list instead of opening an import picker', async () => {
    runtime.listProviders.mockResolvedValue({ providers: [imageProvider] });
    runtime.discoverModels.mockResolvedValue({
      providerId: imageProvider.providerId,
      discoveredIds: ['gpt-image-2', 'flux-1.1-pro', 'gpt-4o'],
      models: [
        {
          modelId: 'model-image',
          providerModelId: 'gpt-image-2',
          displayName: 'gpt-image-2',
          protocol: 'openai-images',
          capabilities: ['image-generation'],
          capabilitiesConfirmed: false,
          priority: 0,
        },
        {
          modelId: 'model-flux',
          providerModelId: 'flux-1.1-pro',
          displayName: 'flux-1.1-pro',
          protocol: 'openai-images',
          capabilities: ['image-generation'],
          capabilitiesConfirmed: false,
          priority: 1,
        },
        {
          modelId: 'model-text',
          providerModelId: 'gpt-4o',
          displayName: 'gpt-4o',
          protocol: 'openai-images',
          capabilities: ['text'],
          capabilitiesConfirmed: false,
          priority: 2,
        },
      ],
      source: 'adapter',
    });
    render(<ImageGenerationSettings />);
    await screen.findByText(IMAGE_GENERATION_COPY.dedicatedKey);
    fireEvent.click(screen.getByRole('button', { name: IMAGE_GENERATION_COPY.fetchModelList }));

    await waitFor(() => {
      expect(runtime.discoverModels).toHaveBeenCalledWith({
        providerId: imageProvider.providerId,
        persist: false,
      });
      expect(runtime.addModels).toHaveBeenCalledWith({
        providerId: imageProvider.providerId,
        protocol: 'openai-images',
        models: [
          {
            providerModelId: 'flux-1.1-pro',
            displayName: 'flux-1.1-pro',
            capabilities: ['image-generation'],
          },
        ],
      });
    });
    expect(screen.queryByRole('button', { name: /添加已选模型/ })).toBeNull();
  });

  it('saves 生图接口 to settings without writing the API key there', async () => {
    runtime.listProviders.mockResolvedValue({ providers: [imageProvider] });
    render(<ImageGenerationSettings />);
    await screen.findByText(IMAGE_GENERATION_COPY.dedicatedKey);
    fireEvent.change(screen.getByLabelText(IMAGE_GENERATION_COPY.apiProvider), {
      target: { value: 'openrouter' },
    });
    await waitFor(() => {
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: 'image-generation',
        value: {
          overrides: {
            [imageProvider.providerId]: { apiProvider: 'openrouter' },
          },
        },
      });
    });
    const stored = runtime.setSetting.mock.calls[0]?.[0]?.value as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toMatch(/sk-|apiKey|secret/i);
  });
});
