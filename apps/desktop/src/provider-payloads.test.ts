import { describe, expect, it } from 'vitest';
import { parseConfirmCapabilitiesPayload } from './provider-payloads.js';

/**
 * 回归锚点：`CAPABILITY_TAGS` 白名单曾漏掉 document / video / thinking，
 * 导致「能力支持」区勾选这三项后保存直接被 IPC 边界拒掉
 * （界面文案：保存失败：当前勾选的能力无法提交）。
 *
 * 这里逐项覆盖 `CapabilityTag` 的全部成员，白名单再次漂移会立刻失败。
 */
const ALL_CAPABILITY_TAGS = [
  'text',
  'vision',
  'document',
  'video',
  'thinking',
  'tool-calling',
  'web-search',
  'image-generation',
  'embeddings',
] as const;

describe('Desktop Provider IPC payloads: confirmCapabilities', () => {
  it('accepts every capability tag exposed by the capability dialog', () => {
    const parsed = parseConfirmCapabilitiesPayload({
      modelId: 'deepseek-flash',
      capabilities: [...ALL_CAPABILITY_TAGS],
      confirmed: true,
    });
    expect(parsed.capabilities).toEqual([...ALL_CAPABILITY_TAGS]);
    expect(parsed.confirmed).toBe(true);
  });

  it('accepts the exact selection from the reported failure (vision + thinking)', () => {
    const parsed = parseConfirmCapabilitiesPayload({
      modelId: 'deepseek-flash',
      capabilities: ['vision', 'thinking'],
      confirmed: true,
    });
    expect(parsed.capabilities).toEqual(['vision', 'thinking']);
  });

  it('accepts the three input modalities added for NewMax parity', () => {
    for (const tag of ['document', 'video', 'thinking'] as const) {
      expect(
        parseConfirmCapabilitiesPayload({
          modelId: 'model-1',
          capabilities: [tag],
        }).capabilities,
      ).toEqual([tag]);
    }
  });

  it('still rejects unknown tags, empty lists and non-boolean confirmed', () => {
    expect(() =>
      parseConfirmCapabilitiesPayload({ modelId: 'model-1', capabilities: ['audio'] }),
    ).toThrow(/Invalid confirm-capabilities payload/);
    // NewMax 内部名 `image` 不是本仓库的标签名（本仓库用 `vision`），不应被放行。
    expect(() =>
      parseConfirmCapabilitiesPayload({ modelId: 'model-1', capabilities: ['image'] }),
    ).toThrow(/Invalid confirm-capabilities payload/);
    expect(() =>
      parseConfirmCapabilitiesPayload({ modelId: 'model-1', capabilities: [] }),
    ).toThrow(/Invalid confirm-capabilities payload/);
    expect(() =>
      parseConfirmCapabilitiesPayload({
        modelId: 'model-1',
        capabilities: ['vision'],
        confirmed: 'yes',
      }),
    ).toThrow(/Invalid confirm-capabilities payload/);
  });
});
