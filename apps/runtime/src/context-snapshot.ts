import type { ProviderMessage, ProviderToolSchema } from '@sync-think/adapters';
import type { ContextSourceRef } from '@sync-think/shared';
import {
  estimateTextTokens,
  estimateProviderMessageTokens,
  estimateJsonTokens,
  measureContextRequest,
  type ContextUsageAnchor,
} from './context-token-meter.js';
export { estimateTextTokens, estimateProviderMessageTokens } from './context-token-meter.js';

import { CONTEXT_COMPACT_THRESHOLD, resolveContextBudget } from './context-policy.js';
export { CONTEXT_COMPACT_THRESHOLD } from './context-policy.js';
export type ContextStatusSectionType =
  'system' | 'agent' | 'project' | 'summary' | 'messages' | 'tools';
export type ContextSourceDisposition = 'included' | 'audit-only';

export interface ContextSnapshotSection {
  type: ContextStatusSectionType;
  tokens: number;
}

export interface ContextSnapshotStatus {
  modelId: string;
  /** Internal cache discriminator; omitted from the public protocol response. */
  kernelId?: string;
  contextWindow: number;
  modelContextWindow: number;
  contextWindowOverride?: number;
  contextWindowSource: 'model-default' | 'conversation-override' | 'kernel-limit';
  kernelContextWindowLimit?: number;
  /** True when the model record has no configured window and 128k was assumed. */
  contextWindowEstimated?: boolean;
  estimatedUsedTokens: number;
  usageRatio: number;
  compactThreshold: number;
  budget: import('./context-policy.js').ContextBudget;
  measurement?: {
    source: 'estimate' | 'provider-calibrated';
    estimatedTokens: number;
    providerInputTokens?: number;
  };
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
  kernelId?: string;
  contextWindow: number;
  modelContextWindow?: number;
  contextWindowOverride?: number;
  contextWindowSource?: 'model-default' | 'conversation-override' | 'kernel-limit';
  kernelContextWindowLimit?: number;
  contextWindowEstimated?: boolean;
  systemInstructions: readonly string[];
  agentInstructions: readonly string[];
  projectContext: readonly string[];
  compactSummary?: string;
  messages: readonly ProviderMessage[];
  tools?: readonly ProviderToolSchema[];
  sources: readonly ContextSnapshotSource[];
  compactedAt?: string;
  reservedOutputTokens?: number;
  modelMaxOutputTokens?: number;
  meterBindingKey?: string;
  usageAnchor?: ContextUsageAnchor;
  safetyMarginTokens?: number;
}

export class ContextSnapshotInvariantError extends Error {
  readonly failureClass = 'protocol' as const;

  constructor(sourceId: string) {
    super(`included source is absent from provider payload: ${sourceId}`);
    this.name = 'ContextSnapshotInvariantError';
  }
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

/**
 * Stable language policy shared by native and external kernels. The UI exposes
 * provider reasoning/commentary directly, so the policy must describe those
 * sections explicitly instead of relying on the model's language heuristic.
 */
export const LANGUAGE_FOLLOW_PROMPT = [
  '## Language Rules',
  'This is the Chinese-language SYNC-THINK workspace. Perform reasoning in Simplified Chinese when the provider exposes it, and write all visible thinking/reasoning, progress commentary, and natural-language answers in Simplified Chinese by default.',
  'Do not switch to English because the user message, tool output, code, technical term, or file content contains English. Keep code, commands, API names, file paths, identifiers, and proper nouns in their original form.',
  '这是中文工作区：模型暴露出来的思考/推理、过程说明和自然语言回答默认必须使用简体中文。即使用户消息、工具输出或技术内容含有英文，也不得因此切换为英文；代码、命令、API 名、文件路径、标识符和专有名词保留原文。',
  'If the user explicitly requests an English response, use English for that requested final response, but keep visible reasoning and tool commentary in Simplified Chinese unless the user explicitly asks those sections to be English too.',
].join('\n');

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
    // Account for the actual serialized system block, including section separators.
    const blockTokens = sections
      .filter((section) => section.type !== 'messages' && section.type !== 'tools')
      .reduce((sum, section) => sum + section.tokens, 0);
    const framingSection =
      sections.find(
        (section) => section.type !== 'messages' && section.type !== 'tools' && section.tokens > 0,
      ) ?? sections[0]!;
    framingSection.tokens += estimateTextTokens(systemPrompt) - blockTokens;
    const measurement = measureContextRequest(
      { systemPrompt, messages, tools },
      input.meterBindingKey ?? input.modelId,
      input.usageAnchor,
    );
    const rawTotal = sections.reduce((sum, section) => sum + section.tokens, 0);
    if (rawTotal !== measurement.usedTokens) {
      let assigned = 0;
      const fixedSections = sections.filter((section) => section.type !== 'messages');
      const rawFixed = fixedSections.reduce((sum, section) => sum + section.tokens, 0);
      fixedSections.forEach((section, index) => {
        section.tokens =
          index === fixedSections.length - 1
            ? measurement.fixedInputTokens - assigned
            : rawFixed
              ? Math.floor((section.tokens * measurement.fixedInputTokens) / rawFixed)
              : 0;
        assigned += section.tokens;
      });
      sections.find((section) => section.type === 'messages')!.tokens = measurement.messageTokens;
    }
    const estimatedUsedTokens = measurement.usedTokens;
    const budget = resolveContextBudget({
      contextWindow,
      modelMaxOutputTokens: input.modelMaxOutputTokens,
      reservedOutputTokens: input.reservedOutputTokens,
      safetyMarginTokens: input.safetyMarginTokens,
      fixedInputTokens:
        estimatedUsedTokens - sections.find((section) => section.type === 'messages')!.tokens,
    });
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
        ...(input.kernelId ? { kernelId: input.kernelId } : {}),
        contextWindow,
        modelContextWindow: Math.max(
          1,
          Math.round(input.modelContextWindow ?? input.contextWindow),
        ),
        ...(input.contextWindowOverride !== undefined
          ? { contextWindowOverride: input.contextWindowOverride }
          : {}),
        contextWindowSource: input.contextWindowSource ?? 'model-default',
        ...(input.kernelContextWindowLimit !== undefined
          ? { kernelContextWindowLimit: input.kernelContextWindowLimit }
          : {}),
        ...(input.contextWindowEstimated === true ? { contextWindowEstimated: true } : {}),
        estimatedUsedTokens,
        measurement: {
          source: measurement.source,
          estimatedTokens: measurement.estimatedTokens,
          ...(measurement.providerInputTokens !== undefined
            ? { providerInputTokens: measurement.providerInputTokens }
            : {}),
        },
        usageRatio: estimatedUsedTokens / contextWindow,
        compactThreshold: Math.min(
          CONTEXT_COMPACT_THRESHOLD,
          budget.compactTriggerTokens / contextWindow,
        ),
        budget,
        shouldAutoCompact: estimatedUsedTokens >= budget.compactTriggerTokens,
        ...(input.compactedAt ? { compactedAt: input.compactedAt } : {}),
        sections,
      },
      sources,
    };
  }
}
