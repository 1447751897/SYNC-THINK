import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';
import { ProvidersPanel, projectProvidersReadiness } from '../src/components/ProvidersPanel.js';

afterEach(() => cleanup());

describe('ProvidersPanel', () => {
  it('renders empty state and create form without echoing secrets later', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<ProvidersPanel providers={[]} onCreate={onCreate} emptyTitle="空注册表" />);
    expect(screen.getByTestId('provider-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('provider-add-toggle'));
    expect(screen.getByTestId('provider-clipboard-notice').textContent).toMatch(
      /系统剪贴板.*安全存储/,
    );
    expect(screen.getByTestId('provider-submit').textContent).toMatch(/从系统剪贴板读取凭据并创建/);
    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'Fake' } });
    fireEvent.change(screen.getByTestId('provider-base-url'), {
      target: { value: 'https://fake.example/v1' },
    });
    fireEvent.submit(screen.getByTestId('provider-form'));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Fake',
        }),
      );
    });
    expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty('apiKey');
    expect(screen.queryByTestId('provider-api-key')).toBeNull();
  });

  it('lists providers with masked credentials and discover action', () => {
    const onDiscover = vi.fn();
    render(
      <ProvidersPanel
        providers={[
          {
            providerId: 'p1',
            name: 'Gateway',
            baseUrl: 'https://gw.example/v1',
            protocol: 'openai-chat',
            supportsDiscovery: true,
            credentials: [
              {
                credentialRefId: 'c1',
                groupName: 'default',
                label: 'primary',
                kind: 'api-key',
                hasSecret: true,
              },
            ],
            models: [
              {
                modelId: 'm1',
                providerModelId: 'fake-mini',
                displayName: 'Fake Mini',
                protocol: 'openai-chat',
                capabilities: ['text'],
                capabilitiesConfirmed: false,
              },
            ],
            createdAt: new Date().toISOString(),
          },
        ]}
        onDiscover={onDiscover}
      />,
    );
    expect(screen.getAllByText('Gateway').length).toBeGreaterThanOrEqual(2);
    // The selected provider detail is open by default.
    expect(screen.getByTestId('provider-secret-chip-p1')).toBeTruthy();
    expect(screen.getAllByText(/••••/).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByTestId('provider-expand-p1'));
    expect(screen.getAllByText(/••••/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/sk-/)).toBeNull();
    fireEvent.click(screen.getByTestId('provider-discover-p1'));
    expect(onDiscover).toHaveBeenCalledWith('p1');
  });

  it('probes capabilities and confirms edited tags', async () => {
    const onProbeCapabilities = vi.fn();
    const onConfirmCapabilities = vi.fn().mockResolvedValue(undefined);
    render(
      <ProvidersPanel
        providers={[
          {
            providerId: 'p1',
            name: 'Gateway',
            baseUrl: 'https://gw.example/v1',
            protocol: 'openai-chat',
            supportsDiscovery: true,
            credentials: [
              {
                credentialRefId: 'c1',
                groupName: 'default',
                label: 'primary',
                kind: 'api-key',
                hasSecret: true,
              },
            ],
            models: [
              {
                modelId: 'm1',
                providerModelId: 'gpt-4o',
                displayName: 'GPT-4o',
                protocol: 'openai-chat',
                capabilities: ['text', 'vision', 'tool-calling'],
                capabilitiesConfirmed: false,
              },
            ],
            createdAt: new Date().toISOString(),
          },
        ]}
        onProbeCapabilities={onProbeCapabilities}
        onConfirmCapabilities={onConfirmCapabilities}
      />,
    );

    fireEvent.click(screen.getByTestId('provider-expand-p1'));
    expect(screen.getByTestId('provider-cap-suggested-m1')).toBeTruthy();
    expect(screen.getByTestId('provider-cap-m1-text').getAttribute('data-active')).toBe('1');
    expect(screen.getByTestId('provider-cap-m1-vision').getAttribute('data-active')).toBe('1');

    fireEvent.click(screen.getByTestId('provider-probe-p1'));
    expect(onProbeCapabilities).toHaveBeenCalledWith('p1');

    // uncheck tool-calling then confirm
    fireEvent.click(screen.getByTestId('provider-cap-m1-tool-calling'));
    fireEvent.click(screen.getByTestId('provider-cap-confirm-m1'));
    await waitFor(() => {
      expect(onConfirmCapabilities).toHaveBeenCalled();
    });
    const call = onConfirmCapabilities.mock.calls[0];
    expect(call[0]).toBe('m1');
    expect(call[1]).toEqual(expect.arrayContaining(['text', 'vision']));
    expect(call[1]).not.toContain('tool-calling');
    expect(call[2]).toBe(true);
  });
  it('shows provider protocol badge for discovery observability', () => {
    render(
      <ProvidersPanel
        providers={[
          {
            providerId: 'p-proto',
            name: 'Anthropic GW',
            baseUrl: 'https://anth.example',
            protocol: 'anthropic-messages',
            supportsDiscovery: true,
            credentials: [
              {
                credentialRefId: 'c1',
                groupName: 'default',
                label: 'primary',
                kind: 'api-key',
                hasSecret: true,
              },
            ],
            models: [],
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );
    expect(screen.getByTestId('provider-protocol-p-proto').textContent).toContain(
      'anthropic-messages',
    );
  });

  it('does not render the provider limitations / observability notice', () => {
    render(<ProvidersPanel providers={[]} />);
    expect(screen.queryByTestId('provider-limitations')).toBeNull();
  });
  it('keeps M1 readiness out of the user-facing provider workspace', () => {
    render(<ProvidersPanel providers={[]} />);
    expect(screen.queryByTestId('provider-m1-readiness')).toBeNull();
    expect(screen.queryByText(/soft 门槛|dogfood|验证区/)).toBeNull();
  });
});

describe('projectProvidersReadiness', () => {
  it('projects empty when no providers', () => {
    const r = projectProvidersReadiness({ providers: [] });
    expect(r.level).toBe('empty');
    expect(r.badge).toBe('尚未配置');
    expect(r.providersOk).toBe(false);
    expect(r.modelsOk).toBe(false);
    expect(r.note).toMatch(/安全存储|遮罩|≥2/);
  });

  it('projects partial with one provider', () => {
    const r = projectProvidersReadiness({
      providers: [
        {
          protocol: 'openai-chat',
          models: [{}],
          credentials: [{ hasSecret: true }],
        },
      ],
    });
    expect(r.level).toBe('partial');
    expect(r.badge).toBe('进行中');
    expect(r.providerCount).toBe(1);
    expect(r.modelCount).toBe(1);
    expect(r.secretsOk).toBe(true);
    expect(r.note).toMatch(/1\/2|进行中/);
  });

  it('projects ready at ≥2 providers and ≥3 models', () => {
    const r = projectProvidersReadiness({
      providers: [
        {
          protocol: 'openai-chat',
          models: [{}, {}],
          credentials: [{ hasSecret: true }],
        },
        {
          protocol: 'anthropic-messages',
          models: [{}],
          credentials: [{ hasSecret: true }],
        },
      ],
    });
    expect(r.level).toBe('ready');
    expect(r.badge).toBe('已达 soft 门槛');
    expect(r.providersOk).toBe(true);
    expect(r.modelsOk).toBe(true);
    expect(r.multiProtocol).toBe(true);
    expect(r.note).toMatch(/M1|验证区|dogfood/);
    expect(r.note).not.toMatch(/仍需.*外网/);
  });

  it('projects ready single-protocol note without multi', () => {
    const r = projectProvidersReadiness({
      providers: [
        { protocol: 'openai-chat', models: [{}, {}], credentials: [{ hasSecret: true }] },
        { protocol: 'openai-chat', models: [{}], credentials: [{ hasSecret: false }] },
      ],
    });
    expect(r.level).toBe('ready');
    expect(r.multiProtocol).toBe(false);
    expect(r.note).toMatch(/可再混用|soft 门槛已满/);
  });

  it('keeps stored secrets out of the edit form and preserves them on metadata edits', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <ProvidersPanel
        providers={[
          {
            providerId: 'p1',
            name: 'Gateway',
            baseUrl: 'https://gw.example/v1',
            protocol: 'openai-chat',
            supportsDiscovery: true,
            credentials: [
              {
                credentialRefId: 'c1',
                groupName: 'default',
                label: 'primary',
                kind: 'api-key',
                hasSecret: true,
              },
            ],
            models: [],
            createdAt: new Date().toISOString(),
          },
        ]}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByTestId('provider-expand-p1'));
    fireEvent.click(screen.getByTestId('provider-edit-p1'));
    expect(screen.queryByTestId('provider-edit-api-key-p1')).toBeNull();
    fireEvent.change(screen.getByTestId('provider-edit-name-p1'), {
      target: { value: 'Gateway Edited' },
    });
    fireEvent.change(screen.getByTestId('provider-edit-base-url-p1'), {
      target: { value: 'https://gw.example/v2' },
    });
    // Empty means Runtime keeps the existing secure-store value.
    fireEvent.submit(screen.getByTestId('provider-edit-form-p1'));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'p1',
          name: 'Gateway Edited',
          baseUrl: 'https://gw.example/v2',
          rotateCredentialFromClipboard: false,
        }),
      );
    });
  });

  it('requests a clipboard rotation without accepting a renderer secret', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <ProvidersPanel
        providers={[
          {
            providerId: 'p1',
            name: 'Gateway',
            baseUrl: 'https://gw.example/v1',
            protocol: 'openai-chat',
            supportsDiscovery: true,
            credentials: [
              {
                credentialRefId: 'c1',
                groupName: 'default',
                label: 'primary',
                kind: 'api-key',
                hasSecret: true,
              },
            ],
            models: [],
            createdAt: new Date().toISOString(),
          },
        ]}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByTestId('provider-expand-p1'));
    fireEvent.click(screen.getByTestId('provider-edit-p1'));
    fireEvent.click(screen.getByTestId('provider-edit-rotate-credential-p1'));
    fireEvent.submit(screen.getByTestId('provider-edit-form-p1'));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'p1',
          rotateCredentialFromClipboard: true,
        }),
      );
    });
  });

  it('previews and imports CC Switch rows without secrets in UI', async () => {
    const onPreviewCcSwitchImport = vi.fn().mockResolvedValue({
      items: [
        {
          sourceId: 'src-1',
          appType: 'codex',
          name: 'KMKAPI',
          baseUrl: 'https://gw.example',
          protocol: 'openai-chat',
          hasSecret: true,
          models: ['m1'],
          credentialGroupName: 'cc-switch:codex',
          importedFrom: 'cc-switch@local-db',
          warnings: [],
          importable: true,
        },
        {
          sourceId: 'official',
          appType: 'claude',
          name: 'Claude Official',
          hasSecret: false,
          models: [],
          credentialGroupName: 'cc-switch:claude',
          importedFrom: 'cc-switch@local-db',
          warnings: ['官方配置缺少自定义 base URL'],
          importable: false,
        },
      ],
    });
    const onImportCcSwitch = vi.fn().mockResolvedValue(undefined);
    render(
      <ProvidersPanel
        providers={[]}
        onPreviewCcSwitchImport={onPreviewCcSwitchImport}
        onImportCcSwitch={onImportCcSwitch}
      />,
    );
    fireEvent.click(screen.getByTestId('provider-cc-switch-preview'));
    await waitFor(() => {
      expect(screen.getByTestId('provider-cc-switch-list')).toBeTruthy();
    });
    expect(screen.queryByText(/sk-/)).toBeNull();
    expect(screen.getByTestId('provider-cc-item-src-1').getAttribute('data-importable')).toBe('1');
    expect(screen.getByTestId('provider-cc-item-official').getAttribute('data-importable')).toBe(
      '0',
    );
    fireEvent.click(screen.getByTestId('provider-cc-switch-import'));
    await waitFor(() => {
      expect(onImportCcSwitch).toHaveBeenCalledWith(['src-1']);
    });
  });

  it('groups providers by surface in CC Switch order', () => {
    render(
      <ProvidersPanel
        providers={[
          {
            providerId: 'p-claude',
            name: 'Claude Gateway',
            baseUrl: 'https://claude.example/v1',
            protocol: 'anthropic-messages',
            supportsDiscovery: true,
            surface: 'claude',
            credentials: [
              {
                credentialRefId: 'c1',
                groupName: 'default',
                label: 'primary',
                kind: 'api-key',
                hasSecret: true,
              },
            ],
            models: [
              {
                modelId: 'm1',
                providerModelId: 'claude-sonnet',
                displayName: 'Sonnet',
                protocol: 'anthropic-messages',
                capabilities: ['text'],
                capabilitiesConfirmed: false,
              },
            ],
            createdAt: new Date().toISOString(),
          },
          {
            providerId: 'p-codex',
            name: 'Codex Gateway',
            baseUrl: 'https://codex.example/v1',
            protocol: 'openai-responses',
            supportsDiscovery: true,
            surface: 'codex',
            credentials: [
              {
                credentialRefId: 'c2',
                groupName: 'default',
                label: 'primary',
                kind: 'api-key',
                hasSecret: true,
              },
            ],
            models: [
              {
                modelId: 'm2',
                providerModelId: 'gpt-5',
                displayName: 'GPT-5',
                protocol: 'openai-responses',
                capabilities: ['text'],
                capabilitiesConfirmed: false,
              },
            ],
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    expect(screen.getByTestId('provider-surface-rail')).toBeTruthy();
    expect(screen.getByTestId('provider-surface-tab-codex').textContent).toMatch(/Codex/);
    expect(screen.getByTestId('provider-surface-tab-claude').textContent).toMatch(/Claude/);

    const groups = screen.getAllByTestId(/provider-index-group-/);
    expect(groups.map((el) => el.getAttribute('data-surface'))).toEqual(['codex', 'claude']);
    expect(screen.getByTestId('provider-index-group-codex').textContent).toMatch(/Codex Gateway/);
    expect(screen.getByTestId('provider-index-group-claude').textContent).toMatch(/Claude Gateway/);

    // Only the selected provider owns the detail area.
    expect(screen.getByTestId('provider-card-p-claude')).toBeTruthy();
    expect(screen.queryByTestId('provider-card-p-codex')).toBeNull();
    fireEvent.click(screen.getByTestId('provider-select-p-codex'));
    expect(screen.getByTestId('provider-card-p-codex').textContent).toMatch(/Codex/);
    expect(screen.getByTestId('provider-meta-surface-p-codex').textContent).toMatch(/Codex/);

    // filter to Claude only
    fireEvent.click(screen.getByTestId('provider-surface-tab-claude'));
    expect(screen.queryByTestId('provider-surface-section-codex')).toBeNull();
    expect(screen.getByTestId('provider-surface-section-claude')).toBeTruthy();
    expect(screen.queryByTestId('provider-card-p-codex')).toBeNull();
    expect(screen.getByTestId('provider-card-p-claude')).toBeTruthy();
  });

  it('opens only the selected provider detail by default', () => {
    render(
      <ProvidersPanel
        providers={[
          {
            providerId: 'p1',
            name: 'Gateway',
            baseUrl: 'https://gw.example/v1',
            protocol: 'openai-chat',
            supportsDiscovery: true,
            credentials: [
              {
                credentialRefId: 'c1',
                groupName: 'default',
                label: 'primary',
                kind: 'api-key',
                hasSecret: true,
              },
            ],
            models: [
              {
                modelId: 'm1',
                providerModelId: 'fake-mini',
                displayName: 'Fake Mini',
                protocol: 'openai-chat',
                capabilities: ['text'],
                capabilitiesConfirmed: false,
              },
            ],
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    );
    expect(screen.getByTestId('provider-expand-p1').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('provider-model-m1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('provider-expand-p1'));
    expect(screen.getByTestId('provider-expand-p1').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('provider-model-m1')).toBeTruthy();
  });
});
