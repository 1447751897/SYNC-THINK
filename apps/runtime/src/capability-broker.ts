/**
 * NewMax `capability-broker`: the model searches deferred capabilities, then
 * invokes one with an opaque per-run `ref`. Image generation is the first
 * deferred target (`mcp__image-generation__generate_image`).
 */
import { randomBytes } from 'node:crypto';
import {
  GENERATE_IMAGE_INPUT_SCHEMA,
  GENERATE_IMAGE_TOOL_DESCRIPTION,
  GENERATE_IMAGE_TOOL_NAME,
  IMAGE_GENERATION_SERVER_NAME,
  isGenerateImageToolName,
} from './generate-image-tool.js';

export const CAPABILITY_BROKER_SERVER_NAME = 'capability-broker';
export const SEARCH_CAPABILITY_TOOL_NAME = 'search_capability';
export const USE_CAPABILITY_TOOL_NAME = 'use_capability';

export const SEARCH_CAPABILITY_TOOL_DESCRIPTION =
  '搜索当前可按需加载的能力。返回本轮有效的 ref、capabilityId、label、toolName、description 和 inputSchema。';

export const USE_CAPABILITY_TOOL_DESCRIPTION =
  '调用 search_capability 返回的一项能力。不要猜测或复用其他轮次的 ref。参数必须严格符合该 ref 返回的 inputSchema。';

export const SEARCH_CAPABILITY_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      description: '简洁描述需要的能力或动作。',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      description: '返回条数，默认 5，最大 10。',
    },
  },
};

export const USE_CAPABILITY_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['ref'],
  properties: {
    ref: {
      type: 'string',
      minLength: 1,
      description: '本轮 search_capability 返回的不透明引用。',
    },
    arguments: {
      type: 'object',
      additionalProperties: true,
      description: '与该 ref 返回的 inputSchema 一致的参数。也可以是 JSON 字符串。',
    },
  },
};

export const DEFAULT_CAPABILITY_SEARCH_LIMIT = 5;
export const MAX_CAPABILITY_SEARCH_LIMIT = 10;
export const CAPABILITY_REF_TTL_MS = 15 * 60_000;

export const IMAGE_GENERATION_CAPABILITY_KEYWORDS = [
  '图像生成',
  '生图',
  '画图',
  '图片生成',
  'image',
  'gpt-image',
  '图片模型',
  'generate',
  'draw',
  'illustration',
  '海报',
  '头像',
  '插画',
  'logo',
  '封面',
  '壁纸',
  '绘图',
] as const;

export type CapabilityTarget = {
  capabilityId: string;
  toolName: string;
  label: string;
  description: string;
  keywords: readonly string[];
  instructions?: string;
  inputSchema: Record<string, unknown>;
  hostOwned: boolean;
};

export type CapabilitySearchHit = {
  ref: string;
  capabilityId: string;
  label: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  instructions?: string;
};

export type CapabilitySearchResult = {
  query: string;
  results: CapabilitySearchHit[];
};

export type ResolvedCapabilityUse = {
  capabilityId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  hostOwned: boolean;
};

type StoredRef = {
  target: CapabilityTarget;
  expiresAt: number;
};

export function tokenizeCapabilityQuery(query: string): string[] {
  const lowered = query.toLocaleLowerCase().trim();
  if (!lowered) return [];
  const split = lowered.split(/[^a-z0-9\u4e00-\u9fff_-]+/i).filter(Boolean);
  const grams = Array.from(lowered.matchAll(/[\u4e00-\u9fff]{2,}/g)).flatMap((match) => {
    const run = match[0] ?? '';
    const parts = [run];
    for (let index = 0; index < run.length - 1; index += 1) {
      parts.push(run.slice(index, index + 2));
    }
    return parts;
  });
  return [...new Set([...split, ...grams])];
}

export function rankCapabilityTarget(target: CapabilityTarget, query: string): number {
  const lowered = query.toLocaleLowerCase();
  const haystack = [target.capabilityId, target.toolName, target.label, target.description, ...target.keywords]
    .join(' ')
    .toLocaleLowerCase();
  let score = haystack.includes(lowered) && lowered.length > 1 ? 20 : 0;
  for (const token of tokenizeCapabilityQuery(query)) {
    if (target.capabilityId.toLocaleLowerCase().includes(token)) score += 8;
    if (target.toolName.toLocaleLowerCase().includes(token)) score += 6;
    if (target.label.toLocaleLowerCase().includes(token)) score += 5;
    if (target.keywords.some((keyword) => keyword.toLocaleLowerCase().includes(token))) score += 4;
    if (target.description.toLocaleLowerCase().includes(token)) score += 2;
  }
  return score;
}

export function stableCapabilitySchemaHash(schema: unknown): string {
  const json = JSON.stringify(schema);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildImageGenerationCapability(): CapabilityTarget {
  return {
    capabilityId: IMAGE_GENERATION_SERVER_NAME,
    toolName: `mcp__${IMAGE_GENERATION_SERVER_NAME}__${GENERATE_IMAGE_TOOL_NAME}`,
    label: '图片生成',
    description: GENERATE_IMAGE_TOOL_DESCRIPTION,
    keywords: IMAGE_GENERATION_CAPABILITY_KEYWORDS,
    inputSchema: GENERATE_IMAGE_INPUT_SCHEMA,
    hostOwned: true,
  };
}

export function parseSearchCapabilityArgs(
  input: Record<string, unknown>,
): { query: string; limit?: number } | { error: string } {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) return { error: '缺少 query。请简洁描述需要的能力或动作。' };
  const limitRaw = input.limit;
  if (limitRaw === undefined) return { query };
  if (typeof limitRaw !== 'number' || !Number.isInteger(limitRaw)) {
    return { error: 'limit 必须是 1 到 10 的整数。' };
  }
  return { query, limit: limitRaw };
}

export function parseUseCapabilityArgs(
  input: Record<string, unknown>,
): { ref: string; arguments: Record<string, unknown> } | { error: string } {
  const ref = typeof input.ref === 'string' ? input.ref.trim() : '';
  if (!ref) return { error: '缺少 ref。请先调用 search_capability。' };
  let args: unknown = input.arguments ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      return { error: 'arguments 不是合法 JSON。' };
    }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { error: 'arguments 必须是对象或 JSON 字符串。' };
  }
  return { ref, arguments: args as Record<string, unknown> };
}

export function isCapabilityBrokerToolName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === SEARCH_CAPABILITY_TOOL_NAME || trimmed === USE_CAPABILITY_TOOL_NAME) return true;
  return (
    /^mcp__[a-z0-9-]+__search_capability$/i.test(trimmed) ||
    /^mcp__[a-z0-9-]+__use_capability$/i.test(trimmed)
  );
}

export function isUseCapabilityToolName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === USE_CAPABILITY_TOOL_NAME) return true;
  return /^mcp__[a-z0-9-]+__use_capability$/i.test(trimmed);
}

export function capabilityUsesGenerateImage(toolName: string): boolean {
  return isGenerateImageToolName(toolName);
}

export class CapabilityBroker {
  private readonly refs = new Map<string, StoredRef>();
  private readonly sessionId: string;
  private counter = 0;

  constructor(
    private readonly options: {
      getTargets: () => readonly CapabilityTarget[];
      now?: () => number;
      ttlMs?: number;
      defaultLimit?: number;
      randomId?: () => string;
    },
  ) {
    this.sessionId = (options.randomId?.() ?? randomBytes(6).toString('hex')).slice(0, 12);
  }

  search(query: string, limit?: number): CapabilitySearchResult {
    const cap = Math.min(
      Math.max(limit ?? this.options.defaultLimit ?? DEFAULT_CAPABILITY_SEARCH_LIMIT, 1),
      MAX_CAPABILITY_SEARCH_LIMIT,
    );
    const ranked = this.options
      .getTargets()
      .map((target) => ({ target, score: rankCapabilityTarget(target, query) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.target.toolName.localeCompare(right.target.toolName),
      )
      .slice(0, cap);
    const now = this.options.now?.() ?? Date.now();
    const ttl = this.options.ttlMs ?? CAPABILITY_REF_TTL_MS;
    const results = ranked.map(({ target }) => {
      this.counter += 1;
      const ref = `cap_${this.sessionId}_${this.counter.toString(36)}_${stableCapabilitySchemaHash(target.inputSchema)}`;
      this.refs.set(ref, { target, expiresAt: now + ttl });
      return {
        ref,
        capabilityId: target.capabilityId,
        label: target.label,
        toolName: target.toolName,
        description: target.description,
        inputSchema: target.inputSchema,
        ...(target.instructions ? { instructions: target.instructions } : {}),
      };
    });
    return { query, results };
  }

  resolveUse(
    ref: string,
    args: Record<string, unknown>,
  ): ResolvedCapabilityUse | { error: string } {
    const now = this.options.now?.() ?? Date.now();
    const stored = this.refs.get(ref);
    if (!stored || stored.expiresAt < now) {
      if (stored) this.refs.delete(ref);
      return { error: 'ref 无效或已过期。请在本轮重新调用 search_capability。' };
    }
    return {
      capabilityId: stored.target.capabilityId,
      toolName: stored.target.toolName,
      arguments: args,
      hostOwned: stored.target.hostOwned,
    };
  }
}
