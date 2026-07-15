import { describe, expect, it } from 'vitest';
import {
  mapCcSwitchProviderRow,
  previewCcSwitchProviderRows,
  toCcSwitchPreviewItem,
} from './cc-switch-import.js';

describe('cc-switch-import mapper', () => {
  it('maps codex openai_chat row with secret and model', () => {
    const mapped = mapCcSwitchProviderRow({
      id: 'kmkapi-1',
      app_type: 'codex',
      name: 'KMKAPI-GLM',
      settings_config: JSON.stringify({
        auth: { OPENAI_API_KEY: 'sk-test-secret-not-for-preview' },
        config: 'model_provider = "custom"\nmodel = "z-ai/glm-5.2"\n\n[model_providers.custom]\nbase_url = "https://www.kamenking.top"\n',
      }),
      meta: JSON.stringify({ apiFormat: 'openai_chat' }),
    });
    expect(mapped.importable).toBe(true);
    expect(mapped.surface).toBe('codex');
    expect(mapped.protocol).toBe('openai-chat');
    expect(mapped.baseUrl).toBe('https://www.kamenking.top');
    expect(mapped.apiKey).toBe('sk-test-secret-not-for-preview');
    expect(mapped.models).toContain('z-ai/glm-5.2');
    expect(mapped.importedFrom).toBe('cc-switch@local-db');

    const preview = toCcSwitchPreviewItem(mapped);
    expect(JSON.stringify(preview)).not.toContain('sk-test');
    expect(preview.hasSecret).toBe(true);
    expect((preview as { apiKey?: string }).apiKey).toBeUndefined();
  });

  it('maps claude openai_responses with ANTHROPIC env', () => {
    const mapped = mapCcSwitchProviderRow({
      id: 'kmkapi-grok',
      app_type: 'claude',
      name: 'KMKAPI-GROK',
      settings_config: {
        env: {
          ANTHROPIC_AUTH_TOKEN: 'sk-ant-test-secret',
          ANTHROPIC_BASE_URL: 'https://www.kamenking.top',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'grok-4.5[1M]',
        },
      },
      meta: { apiFormat: 'openai_responses' },
    });
    expect(mapped.importable).toBe(true);
    expect(mapped.surface).toBe('claude');
    expect(mapped.protocol).toBe('openai-responses');
    expect(mapped.models).toContain('grok-4.5[1M]');
  });

  it('maps anthropic custom without apiFormat', () => {
    const mapped = mapCcSwitchProviderRow({
      id: 'unity2',
      app_type: 'claude',
      name: 'Unity2.Ai',
      settings_config: {
        env: {
          ANTHROPIC_AUTH_TOKEN: 'token-unity',
          ANTHROPIC_BASE_URL: 'https://api.unity2.ai',
        },
      },
      meta: {},
    });
    expect(mapped.importable).toBe(true);
    expect(mapped.surface).toBe('claude');
    expect(mapped.protocol).toBe('anthropic-messages');
    expect(mapped.baseUrl).toBe('https://api.unity2.ai');
  });

  it('skips official profiles without gateway', () => {
    const mapped = mapCcSwitchProviderRow({
      id: 'claude-official',
      app_type: 'claude',
      name: 'Claude Official',
      settings_config: { env: {} },
      meta: {},
    });
    expect(mapped.importable).toBe(false);
    expect(mapped.warnings.some((w) => /官方|base URL|密钥/i.test(w))).toBe(true);
  });

  it('preview list never includes secrets', () => {
    const items = previewCcSwitchProviderRows([
      {
        id: 'x',
        app_type: 'codex',
        name: 'X',
        settings_config: JSON.stringify({
          auth: { OPENAI_API_KEY: 'sk-NEVER-IN-PREVIEW' },
          config: 'model = "m1"\n[model_providers.custom]\nbase_url = "https://gw.example"\n',
        }),
        meta: JSON.stringify({ apiFormat: 'openai_responses' }),
      },
    ]);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain('sk-NEVER');
    expect(items[0]?.importable).toBe(true);
    expect(items[0]?.surface).toBe('codex');
  });
});