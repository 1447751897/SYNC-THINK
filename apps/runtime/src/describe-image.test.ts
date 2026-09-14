import { describe, expect, it } from 'vitest';
import {
  buildAttachmentGuidance,
  buildDescriptionSuffix,
  buildImageHandlingFailureSuffix,
  buildImageToolGuidance,
  buildImageDescriptionPrompt,
  buildWindowsOcrSuffix,
  catalogEntryVisionCapable,
  isModelVisionCapable,
  parseVisionFallbackSetting,
  resolveVisionDescribeModels,
  resolveVisionDescribeModel,
} from './describe-image.js';

describe('isModelVisionCapable', () => {
  it('marks known text-only providers as non-vision', () => {
    expect(isModelVisionCapable('deepseek-v4-flash')).toBe(false);
    expect(isModelVisionCapable('deepseek-chat')).toBe(false);
    expect(isModelVisionCapable('Qwen2.5-72B')).toBe(false);
    expect(isModelVisionCapable('gemma-3-27b')).toBe(false);
  });

  it('marks known multimodal providers as vision', () => {
    expect(isModelVisionCapable('gpt-4o')).toBe(true);
    expect(isModelVisionCapable('gpt-5.2')).toBe(true);
    expect(isModelVisionCapable('gpt-6-astra')).toBe(true);
    expect(isModelVisionCapable('grok-4.5')).toBe(true);
    expect(isModelVisionCapable('gemini-2.5-pro')).toBe(true);
    expect(isModelVisionCapable('claude-sonnet-4')).toBe(true);
    expect(isModelVisionCapable('qwen2.5-vl-72b')).toBe(true);
    expect(isModelVisionCapable('deepseek-v4-flash-vision-exp')).toBe(true);
  });

  it('defaults unknown ids to non-vision until capability is confirmed', () => {
    expect(isModelVisionCapable('mystery-model-9000')).toBe(false);
    expect(isModelVisionCapable('')).toBe(false);
  });
});

describe('catalogEntryVisionCapable', () => {
  it('trusts confirmed vision tag', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm1',
        providerModelId: 'some-model',
        protocol: 'openai-chat',
        capabilities: ['vision', 'text'],
        capabilitiesConfirmed: true,
      }),
    ).toBe(true);
  });

  it('trusts confirmed text-only tag over the name heuristic', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm2',
        providerModelId: 'gpt-4o-lookalike',
        protocol: 'openai-chat',
        capabilities: ['text'],
        capabilitiesConfirmed: true,
      }),
    ).toBe(false);
  });

  it('falls back to the name heuristic without confirmed tags', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm3',
        providerModelId: 'deepseek-v3',
        protocol: 'openai-chat',
        capabilities: [],
        capabilitiesConfirmed: false,
      }),
    ).toBe(false);
  });

  it('treats a confirmed catalog without vision as non-vision even if its name looks visual', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm4',
        providerModelId: 'gpt-4o-lookalike',
        protocol: 'openai-chat',
        capabilities: [],
        capabilitiesConfirmed: true,
      }),
    ).toBe(false);
  });
});

describe('resolveVisionDescribeModel', () => {
  const catalog = [
    {
      modelId: 'deepseek-vision',
      providerModelId: 'deepseek-v4-flash-vision-exp',
      protocol: 'openai-responses',
      capabilities: ['text', 'vision'],
      capabilitiesConfirmed: true,
      enabled: true,
    },
    {
      modelId: 'gpt5',
      providerModelId: 'gpt-5.2',
      protocol: 'openai-chat',
      capabilities: ['vision', 'text'],
      capabilitiesConfirmed: true,
      enabled: true,
    },
  ];

  it('resolves the configured model by catalog id', () => {
    expect(resolveVisionDescribeModel(catalog, 'deepseek-vision')?.providerModelId).toBe(
      'deepseek-v4-flash-vision-exp',
    );
  });

  it('resolves the configured model by provider-facing id', () => {
    expect(resolveVisionDescribeModel(catalog, 'gpt-5.2')?.modelId).toBe('gpt5');
  });

  it('returns undefined for unknown or empty ids (no automatic fallback)', () => {
    expect(resolveVisionDescribeModel(catalog, 'missing-model')).toBeUndefined();
    expect(resolveVisionDescribeModel(catalog, '')).toBeUndefined();
    expect(resolveVisionDescribeModel(catalog, undefined)).toBeUndefined();
    expect(resolveVisionDescribeModel(catalog, '  ')).toBeUndefined();
  });

  it('rejects a configured model that is disabled or confirmed text-only', () => {
    expect(
      resolveVisionDescribeModel(
        [
          {
            modelId: 'disabled-vision',
            providerModelId: 'gpt-4o',
            protocol: 'openai-chat',
            enabled: false,
          },
        ],
        'disabled-vision',
      ),
    ).toBeUndefined();
    expect(
      resolveVisionDescribeModel(
        [
          {
            modelId: 'text-only',
            providerModelId: 'gpt-4o-lookalike',
            protocol: 'openai-chat',
            capabilities: ['text'],
            capabilitiesConfirmed: true,
            enabled: true,
          },
        ],
        'text-only',
      ),
    ).toBeUndefined();
  });

  it('rejects an explicitly selected model with unknown vision state', () => {
    const unknownModel = {
      modelId: 'selected-unknown',
      providerId: 'provider-a',
      providerModelId: 'mystery-model-9000',
      protocol: 'openai-chat',
      capabilities: [],
      capabilitiesConfirmed: false,
      enabled: true,
    };

    expect(resolveVisionDescribeModel([unknownModel], unknownModel.modelId)).toBeUndefined();
    expect(resolveVisionDescribeModels([unknownModel], unknownModel.modelId)).toEqual([]);
  });

  it('builds a bounded chain with the configured model first', () => {
    const chain = resolveVisionDescribeModels(
      [
        {
          modelId: 'selected',
          providerId: 'provider-a',
          providerModelId: 'gpt-4o',
          protocol: 'openai-chat',
          capabilities: ['vision'],
          capabilitiesConfirmed: true,
          enabled: true,
        },
        {
          modelId: 'second',
          providerId: 'provider-a',
          providerModelId: 'claude-sonnet-4',
          protocol: 'openai-chat',
          capabilities: ['vision'],
          capabilitiesConfirmed: true,
          enabled: true,
        },
        {
          modelId: 'third',
          providerId: 'provider-b',
          providerModelId: 'gemini-2.5-pro',
          protocol: 'openai-chat',
          capabilities: ['vision'],
          capabilitiesConfirmed: true,
          enabled: true,
        },
        {
          modelId: 'fourth',
          providerId: 'provider-c',
          providerModelId: 'grok-4.5',
          protocol: 'openai-chat',
          capabilities: ['vision'],
          capabilitiesConfirmed: true,
          enabled: true,
        },
      ],
      'selected',
    );
    expect(chain.map((entry) => entry.modelId)).toEqual(['selected', 'second', 'third']);
  });

  it('uses the persisted provider id to disambiguate duplicate model ids', () => {
    const catalog = [
      {
        modelId: 'same-id',
        providerId: 'wrong-provider',
        providerModelId: 'vision-model',
        protocol: 'openai-chat',
        capabilities: ['vision'],
        capabilitiesConfirmed: true,
        enabled: true,
      },
      {
        modelId: 'same-id',
        providerId: 'right-provider',
        providerModelId: 'vision-model',
        protocol: 'openai-chat',
        capabilities: ['vision'],
        capabilitiesConfirmed: true,
        enabled: true,
      },
    ];
    expect(resolveVisionDescribeModel(catalog, 'same-id', 'right-provider')?.providerId).toBe(
      'right-provider',
    );
  });

  it('does not auto-append the built-in default provider to the fallback chain', () => {
    const chain = resolveVisionDescribeModels(
      [
        {
          modelId: 'selected',
          providerId: 'provider-a',
          providerModelId: 'gpt-4o',
          protocol: 'openai-chat',
          capabilities: ['vision'],
          capabilitiesConfirmed: true,
          enabled: true,
        },
        {
          modelId: 'default-vision',
          providerId: 'default',
          providerModelId: 'claude-sonnet',
          protocol: 'anthropic-messages',
          capabilities: ['vision'],
          capabilitiesConfirmed: true,
          enabled: true,
        },
        {
          modelId: 'other',
          providerId: 'provider-b',
          providerModelId: 'gemini-pro',
          protocol: 'openai-chat',
          capabilities: ['vision'],
          capabilitiesConfirmed: true,
          enabled: true,
        },
      ],
      'selected',
    );
    expect(chain.map((entry) => entry.modelId)).toEqual(['selected', 'other']);
  });
});

describe('parseVisionFallbackSetting', () => {
  it('reads the enabled + modelId shape from the app KV value', () => {
    expect(parseVisionFallbackSetting({ enabled: true, providerId: 'p-1', modelId: 'm-1' })).toEqual({
      enabled: true,
      providerId: 'p-1',
      modelId: 'm-1',
    });
  });

  it('defaults the switch to enabled while leaving the model unselected', () => {
    expect(parseVisionFallbackSetting(undefined)).toEqual({ enabled: true, providerId: null, modelId: null });
    expect(parseVisionFallbackSetting(null)).toEqual({ enabled: true, providerId: null, modelId: null });
    expect(parseVisionFallbackSetting('nope')).toEqual({ enabled: true, providerId: null, modelId: null });
    expect(parseVisionFallbackSetting({ enabled: true, modelId: '' })).toEqual({
      enabled: true,
      providerId: null,
      modelId: null,
    });
  });
});

describe('prompt & suffix assembly', () => {
  it('does not instruct a vision-capable model to use OCR or a fallback', () => {
    expect(
      buildImageToolGuidance({
        visionCapable: true,
        visionFallbackEnabled: true,
        externalKernel: true,
      }),
    ).toEqual([]);
  });

  it('keeps image tools available only for text-only model workspace images', () => {
    const guidance = buildImageToolGuidance({
      visionCapable: false,
      visionFallbackEnabled: true,
      externalKernel: true,
    }).join('\n');
    expect(guidance).toContain('ocr_image');
    expect(guidance).toContain('describe_image');
  });

  it('uses NewMax wording for an unconfirmed model without adding OCR guidance', () => {
    const guidance = buildImageToolGuidance({
      visionState: 'unknown',
      visionFallbackEnabled: true,
      externalKernel: false,
    });
    expect(guidance).toHaveLength(1);
    expect(guidance[0]).toContain('当前模型未确认支持识图');
    expect(guidance[0]).toContain('原生图片输入');
    expect(guidance[0]).not.toContain('ocr_image');
  });

  it('builds an index-aware description prompt', () => {
    const prompt = buildImageDescriptionPrompt(
      { name: 'shot.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,xx' },
      1,
      2,
    );
    expect(prompt).toContain('第 1/2 张');
    expect(prompt).toContain('shot.png');
  });

  it('assembles the degraded suffix with per-image markers', () => {
    const suffix = buildDescriptionSuffix(
      [
        { name: 'a.png', text: '一张桌子' },
        { name: 'b.png', text: '一只猫' },
      ],
      true,
    );
    expect(suffix).toContain('【图片 1 · a.png】一张桌子');
    expect(suffix).toContain('【图片 2 · b.png】一只猫');
    expect(suffix).toContain('当前模型不含图像输入能力');
  });

  it('always guides text-only models to Windows OCR and only mentions visual fallback when enabled', () => {
    const files = [{ name: 'shot.png', relativePath: '.newmax-attachments\\shot.png' }];
    const ocrOnly = buildAttachmentGuidance(files, { visionFallbackEnabled: false });
    expect(ocrOnly).toContain('ocr_image');
    expect(ocrOnly).toContain('mcp__windows-ocr__ocr_image');
    expect(ocrOnly).not.toContain('describe_image');

    const withVision = buildAttachmentGuidance(files, { visionFallbackEnabled: true });
    expect(withVision).toContain('ocr_image');
    expect(withVision).toContain('describe_image');
  });

  it('assembles host-side OCR text and an explicit terminal degradation note', () => {
    const suffix = buildWindowsOcrSuffix([
      { name: 'error.png', text: 'Access denied', language: 'en-US' },
    ]);
    expect(suffix).toContain('Windows OCR');
    expect(suffix).toContain('【图片 1 · error.png · OCR en-US】Access denied');
    expect(suffix).toContain('不代表完整画面内容');
    expect(buildImageHandlingFailureSuffix()).toContain('图片转写失败');
  });
});
