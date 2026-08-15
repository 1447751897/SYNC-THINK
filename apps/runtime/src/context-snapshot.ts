import type { ProviderMessage, ProviderToolSchema } from '@sync-think/adapters';
import type { ContextSourceRef } from '@sync-think/shared';

export const CONTEXT_COMPACT_THRESHOLD = 0.7 as const;
export type ContextStatusSectionType =
  'system' | 'agent' | 'project' | 'summary' | 'messages' | 'tools';
export type ContextSourceDisposition = 'included' | 'audit-only';

export interface ContextSnapshotSection {
  type: ContextStatusSectionType;
  tokens: number;
}

export interface ContextSnapshotStatus {
  modelId: string;
  contextWindow: number;
  /** True when the model record has no configured window and 128k was assumed. */
  contextWindowEstimated?: boolean;
  estimatedUsedTokens: number;
  usageRatio: number;
  compactThreshold: typeof CONTEXT_COMPACT_THRESHOLD;
  shouldAutoCompact: boolean;
  compactedAt?: string;
  sections: ContextSnapshotSection[];
}

export interface ContextSnapshotSource {
  id: string;
  kind: ContextSourceRef['kind'];
  section: ContextStatusSectionType;
  disposition: ContextSourceDisposition;
  content?: string;
  toolName?: string;
  tokens?: number;
}

export interface ContextSnapshot {
  providerRequest: {
    systemPrompt: string;
    messages: ProviderMessage[];
    tools?: ProviderToolSchema[];
  };
  status: ContextSnapshotStatus;
  sources: Array<ContextSnapshotSource & { tokens: number }>;
}

export interface BuildContextSnapshotInput {
  modelId: string;
  contextWindow: number;
  contextWindowEstimated?: boolean;
  systemInstructions: readonly string[];
  agentInstructions: readonly string[];
  projectContext: readonly string[];
  compactSummary?: string;
  messages: readonly ProviderMessage[];
  tools?: readonly ProviderToolSchema[];
  sources: readonly ContextSnapshotSource[];
  compactedAt?: string;
}

export class ContextSnapshotInvariantError extends Error {
  readonly failureClass = 'protocol' as const;

  constructor(sourceId: string) {
    super(`included source is absent from provider payload: ${sourceId}`);
    this.name = 'ContextSnapshotInvariantError';
  }
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}

function estimateJsonTokens(value: unknown): number {
  return estimateTextTokens(JSON.stringify(value));
}

export function estimateProviderMessageTokens(message: ProviderMessage): number {
  if (typeof message.content === 'string') {
    return estimateTextTokens(message.content) + 1;
  }
  let tokens = 1;
  for (const part of message.content) {
    if (part.type === 'image') {
      // Stable bounded estimate used by both the request snapshot and the ring.
      tokens += 1024;
    } else if (part.text) {
      tokens += estimateTextTokens(part.text);
    } else {
      tokens += estimateJsonTokens(part);
    }
  }
  return tokens;
}

export function selectRecentMessagesWithinBudget(
  messages: readonly ProviderMessage[],
  tokenBudget: number,
): ProviderMessage[] {
  const budget = Math.max(0, Math.floor(tokenBudget));
  if (budget <= 0 || messages.length === 0) return [];
  let used = 0;
  let start = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const tokens = estimateProviderMessageTokens(messages[index]!);
    if (start < messages.length && used + tokens > budget) break;
    if (start === messages.length && tokens > budget) {
      start = index;
      break;
    }
    used += tokens;
    start = index;
  }
  return messages.slice(start);
}

function sectionText(title: string, values: readonly string[]): string | undefined {
  const content = values.map((value) => value.trim()).filter(Boolean);
  if (content.length === 0) return undefined;
  return [`## ${title}`, ...content].join('\n\n');
}

function sourceIncludedInRequest(
  source: ContextSnapshotSource,
  systemPrompt: string,
  messages: readonly ProviderMessage[],
  tools: readonly ProviderToolSchema[],
): boolean {
  if (source.toolName) return tools.some((tool) => tool.name === source.toolName);
  if (!source.content) return source.section === 'messages';
  if (source.section === 'messages') {
    return messages.some((message) => {
      if (typeof message.content === 'string') {
        return message.content.includes(source.content!);
      }
      return message.content.some(
        (part) => typeof part.text === 'string' && part.text.includes(source.content!),
      );
    });
  }
  if (source.section === 'tools') return JSON.stringify(tools).includes(source.content);
  return systemPrompt.includes(source.content);
}

export class ContextSnapshotBuilder {
  build(input: BuildContextSnapshotInput): ContextSnapshot {
    const contextWindow = Math.max(1, Math.round(input.contextWindow));
    const systemBlock = sectionText('System instructions', input.systemInstructions);
    const agentBlock = sectionText('Agent / Team instructions', input.agentInstructions);
    const projectBlock = sectionText('Project context', input.projectContext);
    const summaryBlock = input.compactSummary?.trim()
      ? sectionText('Compact summary', [input.compactSummary])
      : undefined;
    const systemPrompt = [systemBlock, agentBlock, projectBlock, summaryBlock]
      .filter((value): value is string => Boolean(value))
      .join('\n\n');
    const messages = input.messages.map((message) => ({
      ...message,
      content: Array.isArray(message.content)
        ? message.content.map((part) => ({ ...part }))
        : message.content,
    }));
    const tools =
      input.tools?.map((tool) => ({
        ...tool,
        inputSchema: structuredClone(tool.inputSchema),
      })) ?? [];

    for (const source of input.sources) {
      if (
        source.disposition === 'included' &&
        !sourceIncludedInRequest(source, systemPrompt, messages, tools)
      ) {
        throw new ContextSnapshotInvariantError(source.id);
      }
    }

    const sections: ContextSnapshotSection[] = [
      { type: 'system', tokens: systemBlock ? estimateTextTokens(systemBlock) : 0 },
      { type: 'agent', tokens: agentBlock ? estimateTextTokens(agentBlock) : 0 },
      { type: 'project', tokens: projectBlock ? estimateTextTokens(projectBlock) : 0 },
      { type: 'summary', tokens: summaryBlock ? estimateTextTokens(summaryBlock) : 0 },
      {
        type: 'messages',
        tokens: messages.reduce((sum, message) => sum + estimateProviderMessageTokens(message), 0),
      },
      { type: 'tools', tokens: tools.length > 0 ? estimateJsonTokens(tools) : 0 },
    ];
    const estimatedUsedTokens = sections.reduce((sum, section) => sum + section.tokens, 0);
    const sources = input.sources.map((source) => ({
      ...source,
      tokens:
        source.tokens ??
        (source.disposition === 'audit-only'
          ? 0
          : source.toolName
            ? estimateJsonTokens(tools.find((tool) => tool.name === source.toolName) ?? {})
            : source.content
              ? estimateTextTokens(source.content)
              : 0),
    }));

    return {
      providerRequest: {
        systemPrompt,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      },
      status: {
        modelId: input.modelId,
        contextWindow,
        ...(input.contextWindowEstimated === true ? { contextWindowEstimated: true } : {}),
        estimatedUsedTokens,
        usageRatio: estimatedUsedTokens / contextWindow,
        compactThreshold: CONTEXT_COMPACT_THRESHOLD,
        shouldAutoCompact: estimatedUsedTokens / contextWindow >= CONTEXT_COMPACT_THRESHOLD,
        ...(input.compactedAt ? { compactedAt: input.compactedAt } : {}),
        sections,
      },
      sources,
    };
  }
}
