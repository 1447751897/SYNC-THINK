import { describe, expect, it } from 'vitest';
import {
  CapabilityBroker,
  buildImageGenerationCapability,
  parseSearchCapabilityArgs,
  parseUseCapabilityArgs,
  rankCapabilityTarget,
  tokenizeCapabilityQuery,
} from './capability-broker.js';

describe('capability-broker ranking', () => {
  it('tokenizes CJK bigrams so a pasted image prompt still hits 图片生成', () => {
    const tokens = tokenizeCapabilityQuery(
      '生成一张产品级写实图片：白底透明玻璃质感元素周期表墙面展览',
    );
    expect(tokens).toEqual(expect.arrayContaining(['生成', '图片']));
    const target = buildImageGenerationCapability();
    expect(rankCapabilityTarget(target, '生成一张产品级写实图片')).toBeGreaterThan(0);
    expect(rankCapabilityTarget(target, 'browser screenshot')).toBe(0);
  });
});

describe('CapabilityBroker', () => {
  it('returns opaque refs that only work for this broker instance', () => {
    const broker = new CapabilityBroker({
      getTargets: () => [buildImageGenerationCapability()],
      randomId: () => 'fe04243eb2b4',
    });
    const found = broker.search('图片生成');
    expect(found.results).toHaveLength(1);
    const hit = found.results[0]!;
    expect(hit.capabilityId).toBe('image-generation');
    expect(hit.label).toBe('图片生成');
    expect(hit.toolName).toBe('mcp__image-generation__generate_image');
    expect(hit.ref).toMatch(/^cap_fe04243eb2b4_1_/);
    expect(hit.inputSchema).toMatchObject({ required: ['prompt'] });

    const used = broker.resolveUse(hit.ref, { prompt: '湖边小屋' });
    expect(used).toMatchObject({
      capabilityId: 'image-generation',
      arguments: { prompt: '湖边小屋' },
    });

    const other = new CapabilityBroker({
      getTargets: () => [buildImageGenerationCapability()],
      randomId: () => 'aaaaaaaaaaaa',
    });
    expect(other.resolveUse(hit.ref, { prompt: 'x' })).toEqual({
      error: 'ref 无效或已过期。请在本轮重新调用 search_capability。',
    });
  });

  it('keeps refs from earlier searches in the same turn', () => {
    const broker = new CapabilityBroker({
      getTargets: () => [buildImageGenerationCapability()],
      randomId: () => 'aaaaaaaaaaaa',
    });
    const first = broker.search('生图').results[0]!;
    const second = broker.search('图片生成').results[0]!;
    expect(first.ref).not.toBe(second.ref);
    expect(broker.resolveUse(first.ref, { prompt: 'a' })).toMatchObject({
      capabilityId: 'image-generation',
    });
  });

  it('expires refs after the NewMax TTL', () => {
    let now = 1_000;
    const broker = new CapabilityBroker({
      getTargets: () => [buildImageGenerationCapability()],
      now: () => now,
      ttlMs: 15 * 60_000,
      randomId: () => 'bbbbbbbbbbbb',
    });
    const hit = broker.search('画图').results[0]!;
    now += 15 * 60_000 + 1;
    expect(broker.resolveUse(hit.ref, { prompt: 'x' })).toEqual({
      error: 'ref 无效或已过期。请在本轮重新调用 search_capability。',
    });
  });
});

describe('capability-broker argument parsing', () => {
  it('accepts use_capability arguments as an object or JSON string', () => {
    expect(parseSearchCapabilityArgs({})).toEqual({
      error: '缺少 query。请简洁描述需要的能力或动作。',
    });
    expect(parseUseCapabilityArgs({ ref: 'cap_1', arguments: { prompt: 'a' } })).toEqual({
      ref: 'cap_1',
      arguments: { prompt: 'a' },
    });
    expect(parseUseCapabilityArgs({ ref: 'cap_1', arguments: '{"prompt":"a"}' })).toEqual({
      ref: 'cap_1',
      arguments: { prompt: 'a' },
    });
  });
});
