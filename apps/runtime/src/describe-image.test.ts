import { describe, expect, it } from 'vitest';
import {
  IMAGE_DESCRIBE_TEXT,
  assertNotRefusal,
  buildAttachmentGuidance,
  buildDescriptionSuffix,
  buildImageHandlingFailureSuffix,
  buildImageToolGuidance,
  buildImageDescriptionPrompt,
  buildWindowsOcrSuffix,
  catalogEntryVisionCapable,
  catalogEntryVisionVerified,
  decideCatalogVisionFallback,
  decideVisionFallback,
  getFallbackLabel,
  getImageDescribeText,
  injectDescriptionsIntoContent,
  isLikelyRefusalText,
  isModelVisionCapable,
  parseVisionFallbackSetting,
  resolveVisionDescribeModels,
  resolveVisionDescribeModel,
  toCatalogModelEntry,
  truncateForError,
} from './describe-image.js';
import type { ModelRecord } from '@sync-think/storage';

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
  it('trusts a positive probe result', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm1',
        providerModelId: 'some-model',
        protocol: 'openai-chat',
        visionCapability: true,
      }),
    ).toBe(true);
  });

  it('ignores the legacy capability tag list — the probe result decides alone', () => {
    // `capabilities` / `capabilitiesConfirmed` are a SYNC-THINK-only input with
    // no NewMax counterpart. If they still steered the vision answer, a model
    // merely catalogued as vision-capable would outrank its own probe.
    expect(
      catalogEntryVisionCapable({
        modelId: 'm-tagged',
        providerModelId: 'some-unknown-model',
        protocol: 'openai-chat',
        capabilities: ['vision', 'text'],
        capabilitiesConfirmed: true,
      }),
    ).toBe(false);
  });

  it('answers unsupported for a name the known table rejects', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm3',
        providerModelId: 'deepseek-v3',
        protocol: 'openai-chat',
      }),
    ).toBe(false);
  });

  it('stays non-capable for a name no table knows and no probe touched', () => {
    expect(
      catalogEntryVisionCapable({
        modelId: 'm4',
        providerModelId: 'gpt-4o-lookalike',
        protocol: 'openai-chat',
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
      visionCapability: true,
      enabled: true,
    },
    {
      modelId: 'gpt5',
      providerModelId: 'gpt-5.2',
      protocol: 'openai-chat',
      visionCapability: true,
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
          visionCapability: true,
          enabled: true,
        },
        {
          modelId: 'second',
          providerId: 'provider-a',
          providerModelId: 'claude-sonnet-4',
          protocol: 'openai-chat',
          visionCapability: true,
          enabled: true,
        },
        {
          modelId: 'third',
          providerId: 'provider-b',
          providerModelId: 'gemini-2.5-pro',
          protocol: 'openai-chat',
          visionCapability: true,
          enabled: true,
        },
        {
          modelId: 'fourth',
          providerId: 'provider-c',
          providerModelId: 'grok-4.5',
          protocol: 'openai-chat',
          visionCapability: true,
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
        visionCapability: true,
        enabled: true,
      },
      {
        modelId: 'same-id',
        providerId: 'right-provider',
        providerModelId: 'vision-model',
        protocol: 'openai-chat',
        visionCapability: true,
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
          visionCapability: true,
          enabled: true,
        },
        {
          modelId: 'default-vision',
          providerId: 'default',
          providerModelId: 'claude-sonnet',
          protocol: 'anthropic-messages',
          visionCapability: true,
          enabled: true,
        },
        {
          modelId: 'other',
          providerId: 'provider-b',
          providerModelId: 'gemini-pro',
          protocol: 'openai-chat',
          visionCapability: true,
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

  it('builds the description prompt from the purpose alone', () => {
    // NewMax issues one request per image: the prompt carries no index and no
    // filename, so the fallback model cannot confuse two attachments.
    const prompt = buildImageDescriptionPrompt('describe');
    expect(prompt).toContain('请用中文详细描述这张图');
    expect(prompt).not.toContain('第 1/2 张');
    expect(prompt).not.toContain('shot.png');
    expect(buildImageDescriptionPrompt('document')).toContain('文档转写');
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

describe('IMAGE_DESCRIBE_TEXT wording', () => {
  it('carries the five NewMax fields for both locales', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      const text = IMAGE_DESCRIBE_TEXT[locale];
      expect(text.prompt.length).toBeGreaterThan(0);
      expect(text.documentPrompt.length).toBeGreaterThan(0);
      expect(text.fallbackNotConfigured.length).toBeGreaterThan(0);
      expect(text.refusal('我看不到这张图')).toContain('我看不到这张图');
      expect(text.fallbackProviderNotFound('p-1')).toContain('p-1');
    }
  });

  it('picks the table by locale, defaulting to zh-CN', () => {
    expect(getImageDescribeText()).toBe(IMAGE_DESCRIBE_TEXT['zh-CN']);
    expect(getImageDescribeText('zh-CN')).toBe(IMAGE_DESCRIBE_TEXT['zh-CN']);
    expect(getImageDescribeText('en-US')).toBe(IMAGE_DESCRIBE_TEXT.en);
    expect(getImageDescribeText('EN')).toBe(IMAGE_DESCRIBE_TEXT.en);
  });

  it('truncates a long body at 200 chars and names an empty one', () => {
    expect(truncateForError('')).toBe('(empty body)');
    expect(truncateForError('short')).toBe('short');
    const long = 'x'.repeat(300);
    expect(truncateForError(long)).toHaveLength(201);
    expect(truncateForError(long).endsWith('…')).toBe(true);
  });
});

describe('refusal detection', () => {
  it('treats an apology about the image as a refusal', () => {
    expect(isLikelyRefusalText('抱歉，我看不到这张图')).toBe(true);
    expect(isLikelyRefusalText('I cannot see the image')).toBe(true);
    expect(isLikelyRefusalText("I don't have access to images")).toBe(true);
  });

  it('leaves a real description alone', () => {
    expect(isLikelyRefusalText('一张白色背景的架构图，左上角写着 SYNC-THINK')).toBe(false);
  });

  it('throws the NewMax refusal wording instead of returning it', () => {
    expect(() => assertNotRefusal('抱歉，我无法查看图片')).toThrow(/道歉文本/);
    expect(assertNotRefusal('一只猫坐在窗台上')).toBe('一只猫坐在窗台上');
  });
});

describe('decideVisionFallback', () => {
  const primary = {
    id: 'provider-a',
    modelCapabilities: { 'text-model': { image: false } },
  };
  const verifiedFallback = {
    id: 'provider-b',
    modelCapabilities: { 'vision-model': { image: true } },
  };

  it('runs only for a definite text-only primary with a verified fallback', () => {
    expect(
      decideVisionFallback(primary, 'provider-a', 'text-model', {
        enabled: true,
        setting: { providerId: 'provider-b', modelId: 'vision-model' },
        providers: [verifiedFallback],
      }),
    ).toMatchObject({
      state: 'unsupported',
      unsupported: true,
      hasFallback: true,
      selfReferencing: false,
      fallbackState: 'supported',
      fallbackUsable: true,
      fallbackIncompatible: false,
      shouldRun: true,
    });
  });

  it('never runs when the primary model is merely unknown', () => {
    const decision = decideVisionFallback(
      { id: 'provider-a', modelCapabilities: { 'mystery-9000': {} } },
      'provider-a',
      'mystery-9000',
      {
        enabled: true,
        setting: { providerId: 'provider-b', modelId: 'vision-model' },
        providers: [verifiedFallback],
      },
    );
    expect(decision.state).toBe('unknown');
    expect(decision.shouldRun).toBe(false);
  });

  it('refuses a fallback that is the primary model describing to itself', () => {
    const decision = decideVisionFallback(primary, 'provider-a', 'text-model', {
      enabled: true,
      setting: { providerId: 'provider-a', modelId: 'text-model' },
      providers: [],
    });
    expect(decision.selfReferencing).toBe(true);
    expect(decision.fallbackUsable).toBe(false);
    expect(decision.shouldRun).toBe(false);
  });

  it('marks a configured but unverified fallback incompatible instead of running it', () => {
    const decision = decideVisionFallback(primary, 'provider-a', 'text-model', {
      enabled: true,
      setting: { providerId: 'provider-b', modelId: 'maybe-vision' },
      providers: [{ id: 'provider-b', modelCapabilities: { 'maybe-vision': {} } }],
    });
    expect(decision.hasFallback).toBe(true);
    expect(decision.fallbackState).toBe('unknown');
    expect(decision.fallbackUsable).toBe(false);
    expect(decision.fallbackIncompatible).toBe(true);
    expect(decision.shouldRun).toBe(false);
  });

  it('treats the built-in default provider as a trusted vision channel', () => {
    const decision = decideVisionFallback(primary, 'provider-a', 'text-model', {
      enabled: true,
      setting: { providerId: 'default', modelId: 'claude-sonnet' },
      providers: [],
    });
    expect(decision.fallbackState).toBe('supported');
    expect(decision.shouldRun).toBe(true);
  });

  it('does not run when the switch is off or no model is selected', () => {
    const off = decideVisionFallback(primary, 'provider-a', 'text-model', {
      enabled: false,
      setting: { providerId: 'provider-b', modelId: 'vision-model' },
      providers: [verifiedFallback],
    });
    expect(off.hasFallback).toBe(false);
    expect(off.shouldRun).toBe(false);

    const unselected = decideVisionFallback(primary, 'provider-a', 'text-model', {
      enabled: true,
      setting: { providerId: null, modelId: null },
      providers: [],
    });
    expect(unselected.hasFallback).toBe(false);
    expect(unselected.shouldRun).toBe(false);
  });
});

describe('decideCatalogVisionFallback', () => {
  const catalog = [
    {
      modelId: 'primary-text',
      providerId: 'provider-a',
      providerModelId: 'deepseek-v4-flash',
      protocol: 'openai-chat',
      visionCapability: false,
      enabled: true,
    },
    {
      modelId: 'fallback-vision',
      providerId: 'provider-b',
      providerModelId: 'gpt-5.2',
      protocol: 'openai-chat',
      visionCapability: true,
      enabled: true,
    },
  ];

  it('keys the primary on its provider-facing id so the known table still applies', () => {
    const decision = decideCatalogVisionFallback(
      {
        modelId: 'named-text',
        providerId: 'provider-a',
        providerModelId: 'deepseek-v3',
        protocol: 'openai-chat',
        enabled: true,
      },
      { enabled: true, providerId: 'provider-b', modelId: 'fallback-vision' },
      [...catalog],
    );
    // No probe ran: only the provider-facing name can settle this one.
    expect(decision.state).toBe('unsupported');
    expect(decision.shouldRun).toBe(true);
  });

  it('resolves the fallback by catalog id and keeps its verified probe result', () => {
    const decision = decideCatalogVisionFallback(
      catalog[0],
      { enabled: true, providerId: 'provider-b', modelId: 'fallback-vision' },
      catalog,
    );
    expect(decision.state).toBe('unsupported');
    expect(decision.fallbackState).toBe('supported');
    expect(decision.fallbackIncompatible).toBe(false);
    expect(decision.shouldRun).toBe(true);
  });

  it('reports an incompatible fallback when the catalog holds no such model', () => {
    const decision = decideCatalogVisionFallback(
      catalog[0],
      { enabled: true, providerId: 'provider-b', modelId: 'missing-model' },
      catalog,
    );
    expect(decision.hasFallback).toBe(true);
    expect(decision.fallbackState).toBe('unknown');
    expect(decision.fallbackIncompatible).toBe(true);
    expect(decision.shouldRun).toBe(false);
  });

  it('does not run for an unknown primary even with a verified fallback', () => {
    const mystery = {
      modelId: 'mystery',
      providerId: 'provider-a',
      providerModelId: 'mystery-model-9000',
      protocol: 'openai-chat',
      enabled: true,
    };
    const decision = decideCatalogVisionFallback(
      mystery,
      { enabled: true, providerId: 'provider-b', modelId: 'fallback-vision' },
      [...catalog, mystery],
    );
    expect(decision.state).toBe('unknown');
    expect(decision.shouldRun).toBe(false);
  });
});

describe('injectDescriptionsIntoContent', () => {
  it('drops the attachment-path block and frames the descriptions under the label', () => {
    const injected = injectDescriptionsIntoContent(
      '看看这张图\n\n附件图片路径：\n1. .attachments/shot.png',
      [{ name: 'shot.png', text: '一只白猫趴在键盘上' }],
      '备用模型',
    );
    expect(injected).not.toContain('.attachments/shot.png');
    expect(injected).not.toContain('附件图片路径：');
    expect(injected).toContain('备用模型');
    expect(injected).toContain('📷 图 1 描述：');
    expect(injected).toContain('一只白猫趴在键盘上');
    expect(injected).toContain('---');
  });

  it('switches the framing to English for an en locale', () => {
    const injected = injectDescriptionsIntoContent(
      'look at this\n\nAttached image paths:\n1. .attachments/shot.png',
      [{ name: 'shot.png', text: 'a white cat on a keyboard' }],
      'fallback model',
      'en-US',
    );
    expect(injected).not.toContain('.attachments/shot.png');
    expect(injected).toContain('secondary model');
    expect(injected).toContain('📷 Image 1 description:');
  });

  it('returns the content untouched when there is nothing to inject', () => {
    expect(injectDescriptionsIntoContent('hello', [], '备用模型')).toBe('hello');
  });
});

describe('getFallbackLabel', () => {
  it('uses the configured provider name and falls back to the generic label', () => {
    expect(
      getFallbackLabel({
        visionFallback: { providerId: 'provider-b' },
        providers: [{ id: 'provider-b', name: 'OpenAI 备用' }],
      }),
    ).toBe('OpenAI 备用');
    expect(getFallbackLabel({ visionFallback: { providerId: 'ghost' }, providers: [] })).toBe(
      '备用模型',
    );
    expect(getFallbackLabel({})).toBe('备用模型');
    expect(getFallbackLabel({}, 'en-US')).toBe('fallback model');
  });
});

describe('manual image override (NewMax manualOverrides.image)', () => {
  const entry = {
    modelId: 'host-model-1',
    providerModelId: 'relay-vision-model',
    providerId: 'relay-provider',
    protocol: 'openai-chat',
  };

  it('makes a model verified even when the probe answered no', () => {
    // 中转站不支持探针图，探针如实答「看不见」；用户手写的答案必须压过它。
    const probed = { ...entry, visionCapability: false, probeReason: '未识别测试图中的校验码' };
    expect(catalogEntryVisionCapable(probed)).toBe(false);
    expect(catalogEntryVisionVerified(probed)).toBe(false);

    const overridden = { ...probed, visionManualOverride: true };
    expect(catalogEntryVisionCapable(overridden)).toBe(true);
    expect(catalogEntryVisionVerified(overridden)).toBe(true);
  });

  it('makes a model verified when nothing was ever probed', () => {
    // 这才是「能力探测做不对」的实际场景：没有任何探测结论落库，
    // 光靠模型名表永远得不到 supported。
    expect(catalogEntryVisionVerified(entry)).toBe(false);
    expect(catalogEntryVisionVerified({ ...entry, visionManualOverride: true })).toBe(true);
  });

  it('lets the user assert text-only as well', () => {
    const textOnly = { ...entry, visionCapability: true, visionManualOverride: false };
    expect(catalogEntryVisionCapable(textOnly)).toBe(false);
    expect(catalogEntryVisionVerified(textOnly)).toBe(false);
  });

  it('feeds the fallback chain so a described run becomes possible', () => {
    const catalog = [
      {
        modelId: 'host-primary',
        providerModelId: 'deepseek-v4-flash',
        providerId: 'relay-provider',
        protocol: 'openai-chat',
      },
      { ...entry, visionManualOverride: true },
    ];
    const setting = {
      enabled: true,
      providerId: 'relay-provider',
      modelId: 'host-model-1',
    };

    // 没有任何探测结论时，副模型选不出来。
    expect(
      resolveVisionDescribeModels(
        catalog.map((item) =>
          item.modelId === 'host-model-1' ? { ...item, visionManualOverride: undefined } : item,
        ),
        'host-model-1',
      ),
    ).toHaveLength(0);

    // 用户勾了「视觉」之后，同一份目录就能选出副模型并触发转写。
    expect(resolveVisionDescribeModels(catalog, 'host-model-1')).toHaveLength(1);
    expect(decideCatalogVisionFallback(catalog[0], setting, catalog).shouldRun).toBe(true);
  });
});

describe('toCatalogModelEntry (the single ModelRecord -> CatalogModelEntry projection)', () => {
  const record: ModelRecord = {
    id: 'host-model-1' as ModelRecord['id'],
    providerId: 'relay-provider' as ModelRecord['providerId'],
    providerModelId: 'relay-vision-model',
    displayName: 'Relay Vision',
    protocol: 'openai-chat',
    capabilities: ['text', 'vision'],
    capabilitiesConfirmed: true,
    visionCapability: false,
    visionProbeReason: '未识别测试图中的校验码',
    visionManualOverride: true,
    priority: 0,
    createdAt: '2026-09-15T00:00:00.000Z',
  };

  it('carries every vision-bearing field, so the manual answer survives the projection', () => {
    // 这条是回归护栏：回退链过滤曾经手工拼 entry 而漏掉 visionManualOverride，
    // 结果用户手写「能看图」的模型被当成不可识图，直接从备用链里被剔掉、任务暂停。
    const entry = toCatalogModelEntry(record);
    expect(entry).toMatchObject({
      modelId: 'host-model-1',
      providerModelId: 'relay-vision-model',
      providerId: 'relay-provider',
      protocol: 'openai-chat',
      visionCapability: false,
      visionManualOverride: true,
      probeReason: '未识别测试图中的校验码',
    });
    // 手写答案压过「探针答看不见」，所以判定必须是能收图。
    expect(catalogEntryVisionCapable(entry)).toBe(true);
    expect(catalogEntryVisionVerified(entry)).toBe(true);
  });

  it('drops no field when the manual answer says text-only', () => {
    const entry = toCatalogModelEntry({ ...record, visionManualOverride: false });
    // 用户手写「不支持」时，连探针的历史正向结论都不算数。
    expect(catalogEntryVisionCapable(entry)).toBe(false);
  });

  it('omits `enabled` unless the caller supplies it, and then honours it', () => {
    // `enabled` 属于 provider 而不是 model，所以默认不出现；显式传入时才带上，
    // 且 false 必须真的让这个条目失去候选资格。
    expect('enabled' in toCatalogModelEntry(record)).toBe(false);
    const enabled = toCatalogModelEntry(record, { enabled: true });
    const disabled = toCatalogModelEntry(record, { enabled: false });
    expect(enabled.enabled).toBe(true);
    expect(disabled.enabled).toBe(false);
    expect(resolveVisionDescribeModels([enabled, disabled], 'host-model-1')).toHaveLength(1);
    expect(resolveVisionDescribeModels([disabled], 'host-model-1')).toHaveLength(0);
  });
});
