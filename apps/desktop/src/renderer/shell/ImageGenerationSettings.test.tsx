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
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  protocol: 'openai-images',
  supportsDiscovery: false,
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
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const runtime = {
  listProviders: vi.fn(),
  createProvider: vi.fn(),
  discoverModels: vi.fn(),
  addModels: vi.fn(),
  confirmCapabilities: vi.fn(),
  reorderProviders: vi.fn(),
  updateProvider: vi.fn(),
  removeProviderCredential: vi.fn(),
  removeProviderModel: vi.fn(),
};

beforeEach(() => {
  runtime.listProviders.mockResolvedValue({ providers: [chatProvider] });
  runtime.createProvider.mockResolvedValue({
    provider: imageProvider,
    credentialRefId: 'credential-image',
    discoveredModelCount: 0,
  });
  runtime.discoverModels.mockResolvedValue({
    providerId: imageProvider.providerId,
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
    providerId: imageProvider.providerId,
    models: imageProvider.models,
  });
  runtime.confirmCapabilities.mockResolvedValue({});
  runtime.reorderProviders.mockResolvedValue({ providers: [chatProvider, imageProvider] });
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
      .mockResolvedValue({ providers: [imageProvider] });
    render(<ImageGenerationSettings />);
    expect((await screen.findAllByText('OpenAI')).length).toBeGreaterThan(0);
    expect(runtime.listProviders).toHaveBeenCalledTimes(2);
  });

  it('shows NewMax empty copy and 添加生图模型', async () => {
    render(<ImageGenerationSettings />);
    expect(await screen.findByText(IMAGE_GENERATION_COPY.empty)).toBeTruthy();
    expect(screen.getByText(IMAGE_GENERATION_COPY.description)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: IMAGE_GENERATION_COPY.addImageProvider }).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText('CODEX')).toBeNull();
  });

  it('opens the OpenAI-compatible catalog and creates a provider via clipboard hop', async () => {
    runtime.listProviders
      .mockResolvedValueOnce({ providers: [chatProvider] })
      .mockResolvedValue({ providers: [chatProvider, imageProvider] });
    render(<ImageGenerationSettings />);
    await screen.findByText(IMAGE_GENERATION_COPY.empty);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.model-enabled-list__add')!);
    expect(await screen.findByRole('region', { name: IMAGE_GENERATION_COPY.addImageProvider })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^OpenAI/ }));

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
    });
    expect(screen.queryByTestId('image-provider-models')).toBeNull();
    expect(screen.queryByText('gpt-4o')).toBeNull();
    expect(screen.getByRole('button', { name: /添加已选模型 \(0\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /gpt-image-2/i }));
    fireEvent.click(screen.getByRole('button', { name: /添加已选模型 \(1\)/ }));
    expect(runtime.addModels).toHaveBeenCalledWith({
      providerId: imageProvider.providerId,
      protocol: 'openai-images',
      models: [
        {
          providerModelId: 'gpt-image-2',
          displayName: 'gpt-image-2',
          capabilities: ['image-generation'],
        },
      ],
    });
    expect(screen.queryByText('Gemini API')).toBeNull();
  });
});
