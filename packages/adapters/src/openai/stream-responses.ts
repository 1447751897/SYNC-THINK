import type {
  AdapterEvent,
  ProviderCallRequest,
  ProviderMessage,
  VisibleAssistantMessagePhase,
} from '../types.js';
import { normalizeOpenAICompatibleBaseUrl, scrubSecrets } from './discover-models.js';
import {
  normalizeReasoningEffort,
  shouldOmitReasoningEffort,
  wireReasoningEffort,
} from '../reasoning.js';
import {
  closeResponseReader,
  createProviderCallControl,
  providerAbortEvent,
} from '../call-control.js';
import { openAIPromptCacheBodyFields } from './prompt-cache.js';
import {
  degradeRequestBody,
  pickDegradableParameters,
  RESPONSES_DEGRADABLE_PARAMETERS,
} from './gateway-degrade.js';

export interface StreamOpenAIResponsesOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ResponsesParseState {
  sawTextDelta: boolean;
  sawReasoningDelta: boolean;
  finished: boolean;
  emittedToolCallIds: Set<string>;
  assistantItems: Map<string, AssistantMessageParseState>;
  assistantItemIdsByOutputIndex: Map<number, string>;
  activeAnonymousAssistantItemKey?: string;
  emittedAssistantTextByPhase: Map<VisibleAssistantMessagePhase, string>;
  assistantPhasesWithLiveDelta: Set<VisibleAssistantMessagePhase>;
  hostedToolStartedIds: Set<string>;
  hostedToolCompletedIds: Set<string>;
  emittedCitationUrls: Set<string>;
}

interface AssistantMessageParseState {
  phase?: VisibleAssistantMessagePhase;
  defaultedPhase: boolean;
  started: boolean;
  sawDelta: boolean;
  ended: boolean;
  emittedText: string;
}

export function joinResponsesUrl(baseUrl: string): string {
  const root = normalizeOpenAICompatibleBaseUrl(baseUrl);
  if (/\/responses$/i.test(root)) return root;
  return `${root}/responses`;
}

function messageContentToString(message: ProviderMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
}

function toResponsesInput(request: ProviderCallRequest): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const message of request.messages) {
    const content = messageContentToString(message);
    if (message.role === 'system') continue;
    if (message.role === 'tool' && message.toolCallId) {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: content,
      });
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type !== 'tool-call' || !part.toolCall) continue;
        input.push({
          type: 'function_call',
          call_id: part.toolCall.id,
          name: part.toolCall.name,
          arguments: part.toolCall.argumentsJson,
        });
      }
      if (!content) continue;
    }
    if (message.role === 'user' && Array.isArray(message.content)) {
      const parts: Array<Record<string, unknown>> = [];
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          parts.push({ type: 'input_text', text: part.text });
        } else if (part.type === 'image') {
          const imageUrl = part.imageUrl || part.imageRef;
          if (imageUrl) parts.push({ type: 'input_image', image_url: imageUrl });
        }
      }
      if (parts.length > 0) {
        input.push({ role: 'user', content: parts });
        continue;
      }
    }
    if (!content && message.role !== 'assistant') continue;
    input.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
      ...(message.role === 'assistant' && message.phase ? { phase: message.phase } : {}),
    });
  }
  return input;
}

function resolveInstructions(request: ProviderCallRequest): string | undefined {
  const sections = [request.systemPrompt?.trim() ?? ''];
  for (const message of request.messages) {
    if (message.role !== 'system') continue;
    const content = messageContentToString(message).trim();
    if (content) sections.push(content);
  }
  const instructions = sections.filter(Boolean).join('\n\n');
  return instructions || undefined;
}

function classifyHttpFailure(
  status: number,
  snippet: string,
): Extract<AdapterEvent, { type: 'error' }> {
  if (status === 401 || status === 403) {
    return {
      type: 'error',
      failureClass: 'auth',
      message: `Provider auth failed (${status})${snippet}`,
    };
  }
  if (status === 429) {
    return {
      type: 'error',
      failureClass: 'rate-limit',
      message: `Provider rate limited (${status})${snippet}`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      type: 'error',
      failureClass: 'protocol',
      message: `Provider Responses call rejected (${status})${snippet}`,
    };
  }
  return {
    type: 'error',
    failureClass: 'transient',
    message: `Provider Responses call failed (${status})${snippet}`,
  };
}

function responseErrorEvent(
  value: unknown,
  apiKey: string,
): Extract<AdapterEvent, { type: 'error' }> {
  const error =
    value && typeof value === 'object'
      ? (value as { error?: { message?: unknown; code?: unknown }; message?: unknown }).error
      : undefined;
  const rawMessage =
    typeof error?.message === 'string'
      ? error.message
      : value &&
          typeof value === 'object' &&
          typeof (value as { message?: unknown }).message === 'string'
        ? String((value as { message: string }).message)
        : 'Provider Responses error';
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  const lower = rawMessage.toLowerCase();
  const failureClass = /rate.?limit|quota|429/.test(`${code} ${lower}`)
    ? 'rate-limit'
    : /auth|api.?key|unauthorized|forbidden|401|403/.test(`${code} ${lower}`)
      ? 'auth'
      : 'protocol';
  return {
    type: 'error',
    failureClass,
    message: scrubSecrets(rawMessage, [apiKey]),
  };
}

function extractOutputText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const typed = part as { type?: unknown; text?: unknown };
      if (
        (typed.type === 'output_text' || typed.type === 'text') &&
        typeof typed.text === 'string'
      ) {
        parts.push(typed.text);
      }
    }
  }
  return parts.join('');
}

function visibleAssistantMessagePhase(value: unknown): VisibleAssistantMessagePhase | undefined {
  return value === 'commentary' || value === 'final_answer' ? value : undefined;
}

function outputItemText(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const content = (item as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const typed = part as { type?: unknown; text?: unknown };
    if ((typed.type === 'output_text' || typed.type === 'text') && typeof typed.text === 'string') {
      parts.push(typed.text);
    }
  }
  return parts.join('');
}

function outputItemAnnotations(item: unknown): unknown[] {
  if (!item || typeof item !== 'object') return [];
  const content = (item as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') return [];
    const annotations = (part as { annotations?: unknown }).annotations;
    return Array.isArray(annotations) ? annotations : [];
  });
}

function citationMarkdown(state: ResponsesParseState, annotations: unknown): string {
  if (!Array.isArray(annotations)) return '';
  const lines: string[] = [];
  for (const value of annotations) {
    if (!value || typeof value !== 'object') continue;
    const item = value as { type?: unknown; url?: unknown; title?: unknown };
    if (item.type !== 'url_citation' || typeof item.url !== 'string') continue;
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      continue;
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      state.emittedCitationUrls.has(url.href)
    ) {
      continue;
    }
    state.emittedCitationUrls.add(url.href);
    const title = (typeof item.title === 'string' && item.title.trim() ? item.title : url.hostname)
      .replaceAll('[', '')
      .replaceAll(']', '')
      .trim();
    lines.push(`- [${title}](${url.href})`);
  }
  return lines.length > 0 ? `\n\nSources:\n${lines.join('\n')}` : '';
}

function outputItemId(item: unknown, outputIndex?: number): string | undefined {
  if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
    return (item as { id: string }).id;
  }
  return outputIndex !== undefined ? `output-${outputIndex}` : undefined;
}

function webSearchCallId(item: unknown, fallback?: string): string {
  if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
    return (item as { id: string }).id;
  }
  return fallback || 'web-search-call';
}

function webSearchAction(item: unknown): Record<string, unknown> | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const action = (item as { action?: unknown }).action;
  return action && typeof action === 'object' && !Array.isArray(action)
    ? (action as Record<string, unknown>)
    : undefined;
}

function hostedWebSearchStart(
  state: ResponsesParseState,
  id: string,
  item?: unknown,
): AdapterEvent[] {
  if (state.hostedToolStartedIds.has(id)) return [];
  state.hostedToolStartedIds.add(id);
  const action = webSearchAction(item);
  const query =
    typeof action?.query === 'string'
      ? action.query
      : Array.isArray(action?.queries)
        ? action.queries.filter((entry): entry is string => typeof entry === 'string')
        : undefined;
  return [
    {
      type: 'hosted-tool-call',
      toolCall: {
        id,
        name: 'web_search',
        argumentsJson: JSON.stringify({
          ...(query ? { query } : {}),
          ...(typeof action?.type === 'string' ? { action: action.type } : {}),
        }),
      },
    },
  ];
}

function hostedWebSearchResult(
  state: ResponsesParseState,
  id: string,
  item?: unknown,
): AdapterEvent[] {
  if (state.hostedToolCompletedIds.has(id)) return [];
  state.hostedToolCompletedIds.add(id);
  return [
    {
      type: 'hosted-tool-result',
      toolCallId: id,
      result: JSON.stringify({
        ok: true,
        provider: 'openai',
        status: 'completed',
        ...(webSearchAction(item) ? { action: webSearchAction(item) } : {}),
      }),
    },
  ];
}

function ensureAssistantItem(
  state: ResponsesParseState,
  input: {
    itemId?: string;
    outputIndex?: number;
    phase?: VisibleAssistantMessagePhase;
  },
): { key: string; itemId?: string; item: AssistantMessageParseState } {
  const indexedId =
    input.outputIndex !== undefined
      ? state.assistantItemIdsByOutputIndex.get(input.outputIndex)
      : undefined;
  const key =
    indexedId ??
    input.itemId ??
    (input.outputIndex !== undefined
      ? `output-${input.outputIndex}`
      : (state.activeAnonymousAssistantItemKey ?? `anonymous-${state.assistantItems.size}`));
  if (input.outputIndex === undefined && !input.itemId && !indexedId) {
    state.activeAnonymousAssistantItemKey = key;
  }
  const current = state.assistantItems.get(key) ??
    (input.itemId ? state.assistantItems.get(input.itemId) : undefined) ?? {
      defaultedPhase: false,
      emittedText: '',
      started: false,
      sawDelta: false,
      ended: false,
    };
  if (input.phase && (!current.phase || !current.started || current.phase === input.phase)) {
    current.phase = input.phase;
    current.defaultedPhase = false;
  }
  state.assistantItems.set(key, current);
  if (input.itemId && input.itemId !== key) {
    state.assistantItems.set(input.itemId, current);
  }
  if (input.outputIndex !== undefined) {
    state.assistantItemIdsByOutputIndex.set(input.outputIndex, key);
  }
  return {
    key,
    itemId: key.startsWith('anonymous-') ? undefined : key,
    item: current,
  };
}

function defaultAssistantItemToFinalAnswer(item: AssistantMessageParseState): void {
  if (item.phase) return;
  item.phase = 'final_answer';
  item.defaultedPhase = true;
}

function missingSnapshotSuffix(
  snapshot: string,
  emitted: string,
  allowContainedSnapshot = false,
): string {
  if (!snapshot) return '';
  if (!emitted) return snapshot;
  if (snapshot.startsWith(emitted)) return snapshot.slice(emitted.length);
  if (emitted.endsWith(snapshot)) return '';
  if (allowContainedSnapshot && emitted.includes(snapshot)) return '';
  const maxOverlap = Math.min(snapshot.length, emitted.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (emitted.endsWith(snapshot.slice(0, overlap))) {
      return snapshot.slice(overlap);
    }
  }
  return snapshot;
}

function assistantMessageStartEvents(
  itemId: string | undefined,
  item: AssistantMessageParseState,
): AdapterEvent[] {
  if (!item.phase || item.started) return [];
  item.started = true;
  return [
    {
      type: 'assistant-message-start',
      phase: item.phase,
      ...(itemId ? { itemId } : {}),
    },
  ];
}

function assistantMessageDeltaEvents(
  state: ResponsesParseState,
  itemId: string | undefined,
  item: AssistantMessageParseState,
  text: string,
  source: 'live' | 'snapshot' = 'live',
): AdapterEvent[] {
  if (!item.phase || !text) return [];
  const events = assistantMessageStartEvents(itemId, item);
  item.sawDelta = true;
  item.emittedText += text;
  state.emittedAssistantTextByPhase.set(
    item.phase,
    (state.emittedAssistantTextByPhase.get(item.phase) ?? '') + text,
  );
  if (source === 'live') {
    state.assistantPhasesWithLiveDelta.add(item.phase);
  }
  events.push({
    type: 'assistant-message-delta',
    phase: item.phase,
    ...(itemId ? { itemId } : {}),
    text,
  });
  return events;
}

function assistantMessageSnapshotEvents(
  state: ResponsesParseState,
  itemId: string | undefined,
  item: AssistantMessageParseState,
  text: string,
): AdapterEvent[] {
  if (!item.phase || !text) return [];
  const phaseHadLiveDelta = state.assistantPhasesWithLiveDelta.has(item.phase);
  const phaseBaseline = phaseHadLiveDelta
    ? (state.emittedAssistantTextByPhase.get(item.phase) ?? '')
    : '';
  const baseline = item.emittedText || phaseBaseline;
  const suffix = missingSnapshotSuffix(text, baseline, phaseHadLiveDelta && !item.emittedText);
  const events = suffix ? assistantMessageDeltaEvents(state, itemId, item, suffix, 'snapshot') : [];
  item.sawDelta = true;
  item.emittedText = text;
  return events;
}

function assistantMessageEndEvents(
  state: ResponsesParseState,
  key: string,
  itemId: string | undefined,
  item: AssistantMessageParseState,
): AdapterEvent[] {
  if (!item.phase || item.ended) return [];
  if (!item.started && item.sawDelta) {
    item.ended = true;
    if (state.activeAnonymousAssistantItemKey === key) {
      state.activeAnonymousAssistantItemKey = undefined;
    }
    return [];
  }
  const events = assistantMessageStartEvents(itemId, item);
  item.ended = true;
  if (state.activeAnonymousAssistantItemKey === key) {
    state.activeAnonymousAssistantItemKey = undefined;
  }
  events.push({
    type: 'assistant-message-end',
    phase: item.phase,
    ...(itemId ? { itemId } : {}),
  });
  return events;
}

function openAssistantMessageEndEvents(state: ResponsesParseState): AdapterEvent[] {
  const events: AdapterEvent[] = [];
  const visited = new Set<AssistantMessageParseState>();
  for (const [key, item] of state.assistantItems) {
    if (visited.has(item)) continue;
    visited.add(item);
    if (!item.started || item.ended || !item.phase) continue;
    events.push(
      ...assistantMessageEndEvents(
        state,
        key,
        key.startsWith('anonymous-') ? undefined : key,
        item,
      ),
    );
  }
  return events;
}

function textFromReasoningField(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  const parts: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const typed = entry as {
      text?: unknown;
      summary?: unknown;
      content?: unknown;
    };
    if (typeof typed.text === 'string') parts.push(typed.text);
    else {
      const nested = textFromReasoningField(typed.summary ?? typed.content);
      if (nested) parts.push(nested);
    }
  }
  return parts.join('');
}

function extractReasoningSummary(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const typed = item as {
      type?: unknown;
      text?: unknown;
      summary?: unknown;
      content?: unknown;
    };
    if (typed.type === 'reasoning' || typed.type === 'reasoning_summary') {
      const text =
        textFromReasoningField(typed.summary) ||
        textFromReasoningField(typed.content) ||
        (typeof typed.text === 'string' ? typed.text : '');
      if (text) parts.push(text);
      continue;
    }
    if (!Array.isArray(typed.content)) continue;
    for (const content of typed.content) {
      if (!content || typeof content !== 'object') continue;
      const reasoningPart = content as { type?: unknown; text?: unknown };
      if (
        (reasoningPart.type === 'reasoning' ||
          reasoningPart.type === 'reasoning_text' ||
          reasoningPart.type === 'summary_text') &&
        typeof reasoningPart.text === 'string'
      ) {
        parts.push(reasoningPart.text);
      }
    }
  }
  return parts.join('');
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function usageEvent(response: unknown): AdapterEvent | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const usage = (response as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const typed = usage as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
    input_tokens_details?: {
      cached_tokens?: unknown;
      cache_write_tokens?: unknown;
    };
    output_tokens_details?: { reasoning_tokens?: unknown };
  };
  const cachedTokensHit = nonNegativeNumber(typed.input_tokens_details?.cached_tokens);
  const cachedTokensCreated = nonNegativeNumber(typed.input_tokens_details?.cache_write_tokens);
  const reasoningTokens = nonNegativeNumber(typed.output_tokens_details?.reasoning_tokens);
  const totalTokens = nonNegativeNumber(typed.total_tokens);
  return {
    type: 'usage',
    tokensIn: nonNegativeNumber(typed.input_tokens) ?? 0,
    tokensOut: nonNegativeNumber(typed.output_tokens) ?? 0,
    ...(cachedTokensHit !== undefined ? { cachedTokensHit } : {}),
    ...(cachedTokensCreated !== undefined ? { cachedTokensCreated } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function parseResponseEvent(
  value: unknown,
  apiKey: string,
  state: ResponsesParseState,
): AdapterEvent[] {
  if (!value || typeof value !== 'object') return [];
  const root = value as {
    type?: unknown;
    delta?: unknown;
    text?: unknown;
    response?: unknown;
    item?: unknown;
    item_id?: unknown;
    output_index?: unknown;
    name?: unknown;
    arguments?: unknown;
    call_id?: unknown;
    id?: unknown;
    error?: unknown;
    annotations?: unknown;
    choices?: Array<{
      delta?: { content?: unknown };
      finish_reason?: unknown;
    }>;
  };

  if (root.error || root.type === 'error' || root.type === 'response.failed') {
    state.finished = true;
    return [responseErrorEvent(root.response ?? root, apiKey)];
  }

  if (
    root.type === 'response.reasoning_summary_text.delta' ||
    root.type === 'response.reasoning.delta' ||
    root.type === 'response.reasoning_text.delta'
  ) {
    if (typeof root.delta !== 'string' || root.delta.length === 0) return [];
    state.sawReasoningDelta = true;
    return [{ type: 'reasoning-delta', text: root.delta }];
  }

  if (
    root.type === 'response.reasoning_summary_text.done' ||
    root.type === 'response.reasoning.done' ||
    root.type === 'response.reasoning_text.done'
  ) {
    if (state.sawReasoningDelta || typeof root.text !== 'string' || root.text.length === 0)
      return [];
    state.sawReasoningDelta = true;
    return [{ type: 'reasoning-delta', text: root.text }];
  }

  if (root.type === 'response.output_item.added') {
    const item =
      root.item && typeof root.item === 'object'
        ? (root.item as { type?: unknown; role?: unknown; phase?: unknown })
        : undefined;
    if (item?.type === 'web_search_call') {
      return hostedWebSearchStart(
        state,
        webSearchCallId(root.item, typeof root.item_id === 'string' ? root.item_id : undefined),
        root.item,
      );
    }
    if (item?.type !== 'message' || item.role !== 'assistant') return [];
    const outputIndex =
      typeof root.output_index === 'number' && Number.isInteger(root.output_index)
        ? root.output_index
        : undefined;
    const tracked = ensureAssistantItem(state, {
      itemId: outputItemId(root.item, outputIndex),
      outputIndex,
      phase: visibleAssistantMessagePhase(item.phase),
    });
    return assistantMessageStartEvents(tracked.itemId, tracked.item);
  }

  if (
    root.type === 'response.web_search_call.in_progress' ||
    root.type === 'response.web_search_call.searching' ||
    root.type === 'response.web_search_call.completed'
  ) {
    const id = typeof root.item_id === 'string' ? root.item_id : 'web-search-call';
    return hostedWebSearchStart(state, id);
  }

  if (root.type === 'response.output_text.delta' || root.type === 'response.refusal.delta') {
    if (typeof root.delta !== 'string' || root.delta.length === 0) return [];
    const outputIndex =
      typeof root.output_index === 'number' && Number.isInteger(root.output_index)
        ? root.output_index
        : undefined;
    const tracked = ensureAssistantItem(state, {
      itemId: typeof root.item_id === 'string' ? root.item_id : undefined,
      outputIndex,
    });
    defaultAssistantItemToFinalAnswer(tracked.item);
    return assistantMessageDeltaEvents(state, tracked.itemId, tracked.item, root.delta);
  }

  if (root.type === 'response.output_text.done') {
    const outputIndex =
      typeof root.output_index === 'number' && Number.isInteger(root.output_index)
        ? root.output_index
        : undefined;
    const tracked = ensureAssistantItem(state, {
      itemId: typeof root.item_id === 'string' ? root.item_id : undefined,
      outputIndex,
    });
    if (typeof root.text !== 'string' || root.text.length === 0) return [];
    defaultAssistantItemToFinalAnswer(tracked.item);
    const events = assistantMessageSnapshotEvents(state, tracked.itemId, tracked.item, root.text);
    const citations = citationMarkdown(state, root.annotations);
    if (citations) {
      events.push(
        ...assistantMessageDeltaEvents(state, tracked.itemId, tracked.item, citations, 'snapshot'),
      );
    }
    return events;
  }

  if (root.type === 'response.output_item.done') {
    const item =
      root.item && typeof root.item === 'object'
        ? (root.item as { type?: unknown; role?: unknown; phase?: unknown })
        : undefined;
    if (item?.type === 'web_search_call') {
      const id = webSearchCallId(
        root.item,
        typeof root.item_id === 'string' ? root.item_id : undefined,
      );
      return [
        ...hostedWebSearchStart(state, id, root.item),
        ...hostedWebSearchResult(state, id, root.item),
      ];
    }
    if (item?.type !== 'message' || item.role !== 'assistant') return [];
    const outputIndex =
      typeof root.output_index === 'number' && Number.isInteger(root.output_index)
        ? root.output_index
        : undefined;
    const tracked = ensureAssistantItem(state, {
      itemId: outputItemId(root.item, outputIndex),
      outputIndex,
      phase: visibleAssistantMessagePhase(item.phase),
    });
    const events: AdapterEvent[] = [];
    const text = outputItemText(root.item);
    if (!tracked.item.phase && text) defaultAssistantItemToFinalAnswer(tracked.item);
    if (!tracked.item.phase) return [];
    if (text) {
      events.push(...assistantMessageSnapshotEvents(state, tracked.itemId, tracked.item, text));
    }
    const citations = citationMarkdown(state, outputItemAnnotations(root.item));
    if (citations) {
      events.push(
        ...assistantMessageDeltaEvents(state, tracked.itemId, tracked.item, citations, 'snapshot'),
      );
    }
    events.push(...assistantMessageEndEvents(state, tracked.key, tracked.itemId, tracked.item));
    return events;
  }

  if (root.type === 'response.function_call_arguments.done') {
    const id =
      typeof root.call_id === 'string'
        ? root.call_id
        : typeof root.id === 'string'
          ? root.id
          : 'function-call';
    if (state.emittedToolCallIds.has(id) || typeof root.name !== 'string') return [];
    state.emittedToolCallIds.add(id);
    return [
      {
        type: 'tool-call',
        toolCall: {
          id,
          name: root.name,
          argumentsJson: typeof root.arguments === 'string' ? root.arguments : '{}',
        },
      },
    ];
  }

  if (root.type === 'response.completed' || root.type === 'response.incomplete') {
    const response = root.response ?? root;
    const events: AdapterEvent[] = [];
    if (!state.sawReasoningDelta) {
      const reasoningText = extractReasoningSummary(response);
      if (reasoningText) {
        state.sawReasoningDelta = true;
        events.push({ type: 'reasoning-delta', text: reasoningText });
      }
    }
    const output =
      response && typeof response === 'object'
        ? (response as { output?: unknown }).output
        : undefined;
    if (Array.isArray(output)) {
      for (const [outputIndex, item] of output.entries()) {
        if (!item || typeof item !== 'object') continue;
        const typed = item as {
          type?: unknown;
          role?: unknown;
          phase?: unknown;
          id?: unknown;
          call_id?: unknown;
          name?: unknown;
          arguments?: unknown;
        };
        if (typed.type === 'message' && (typed.role === undefined || typed.role === 'assistant')) {
          const phase = visibleAssistantMessagePhase(typed.phase);
          const tracked = ensureAssistantItem(state, {
            itemId: outputItemId(item, outputIndex),
            outputIndex,
            phase,
          });
          const text = outputItemText(item);
          if (!tracked.item.phase && text) defaultAssistantItemToFinalAnswer(tracked.item);
          if (tracked.item.phase) {
            if (text) {
              events.push(
                ...assistantMessageSnapshotEvents(state, tracked.itemId, tracked.item, text),
              );
            }
            const citations = citationMarkdown(state, outputItemAnnotations(item));
            if (citations) {
              events.push(
                ...assistantMessageDeltaEvents(
                  state,
                  tracked.itemId,
                  tracked.item,
                  citations,
                  'snapshot',
                ),
              );
            }
            events.push(
              ...assistantMessageEndEvents(state, tracked.key, tracked.itemId, tracked.item),
            );
          }
          continue;
        }
        if (typed.type === 'web_search_call') {
          const id = webSearchCallId(item, `web-search-${outputIndex + 1}`);
          events.push(
            ...hostedWebSearchStart(state, id, item),
            ...hostedWebSearchResult(state, id, item),
          );
          continue;
        }
        if (typed.type !== 'function_call' || typeof typed.name !== 'string') continue;
        const id =
          typeof typed.call_id === 'string'
            ? typed.call_id
            : typeof typed.id === 'string'
              ? typed.id
              : `call-${outputIndex + 1}`;
        if (state.emittedToolCallIds.has(id)) continue;
        state.emittedToolCallIds.add(id);
        events.push({
          type: 'tool-call',
          toolCall: {
            id,
            name: typed.name,
            argumentsJson: typeof typed.arguments === 'string' ? typed.arguments : '{}',
          },
        });
      }
    } else if (!state.sawTextDelta) {
      const text = extractOutputText(response);
      if (text) {
        const tracked = ensureAssistantItem(state, {});
        defaultAssistantItemToFinalAnswer(tracked.item);
        events.push(
          ...assistantMessageSnapshotEvents(state, tracked.itemId, tracked.item, text),
          ...assistantMessageEndEvents(state, tracked.key, tracked.itemId, tracked.item),
        );
      }
    }
    for (const id of state.hostedToolStartedIds) {
      events.push(...hostedWebSearchResult(state, id));
    }
    events.push(...openAssistantMessageEndEvents(state));
    const usage = usageEvent(response);
    if (usage) events.push(usage);
    state.finished = true;
    events.push({
      type: 'finished',
      reason:
        state.emittedToolCallIds.size > 0
          ? 'tool-requests'
          : root.type === 'response.incomplete'
            ? 'length'
            : 'stop',
    });
    return events;
  }

  // Compatibility for gateways that emit Chat Completions chunks at /responses.
  const choice = root.choices?.[0];
  if (choice) {
    const content = choice.delta?.content;
    if (typeof content === 'string' && content.length > 0) {
      state.sawTextDelta = true;
      return [{ type: 'text-delta', text: content }];
    }
    if (choice.finish_reason) {
      state.finished = true;
      return [
        {
          type: 'finished',
          reason: choice.finish_reason === 'length' ? 'length' : 'stop',
        },
      ];
    }
  }

  return [];
}

async function* emitFromJsonResponse(text: string, apiKey: string): AsyncIterable<AdapterEvent> {
  let response: unknown;
  try {
    response = JSON.parse(text);
  } catch {
    yield { type: 'error', failureClass: 'protocol', message: 'Provider returned non-JSON body' };
    return;
  }
  if (response && typeof response === 'object' && 'error' in response) {
    yield responseErrorEvent(response, apiKey);
    return;
  }
  const status =
    response && typeof response === 'object'
      ? (response as { status?: unknown }).status
      : undefined;
  const state = createResponsesParseState();
  for (const event of parseResponseEvent(
    {
      type: status === 'incomplete' ? 'response.incomplete' : 'response.completed',
      response,
    },
    apiKey,
    state,
  )) {
    yield event;
  }
}

function createResponsesParseState(): ResponsesParseState {
  return {
    sawTextDelta: false,
    sawReasoningDelta: false,
    finished: false,
    emittedToolCallIds: new Set(),
    assistantItems: new Map(),
    assistantItemIdsByOutputIndex: new Map(),
    emittedAssistantTextByPhase: new Map(),
    assistantPhasesWithLiveDelta: new Set(),
    hostedToolStartedIds: new Set(),
    hostedToolCompletedIds: new Set(),
    emittedCitationUrls: new Set(),
  };
}

export async function* streamOpenAIResponses(
  request: ProviderCallRequest,
  options: StreamOpenAIResponsesOptions = {},
): AsyncIterable<AdapterEvent> {
  const apiKey = request.apiKey;
  if (!apiKey?.trim()) {
    yield { type: 'error', failureClass: 'auth', message: 'API key is required for Responses' };
    return;
  }
  if (!request.modelId?.trim()) {
    yield { type: 'error', failureClass: 'protocol', message: 'modelId is required' };
    return;
  }
  if (!request.idempotencyKey?.trim() || request.idempotencyKey.length > 256) {
    yield { type: 'error', failureClass: 'protocol', message: 'idempotencyKey is required' };
    return;
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    yield {
      type: 'error',
      failureClass: 'protocol',
      message: 'Fetch is not available in this runtime',
    };
    return;
  }

  const control = createProviderCallControl(request.signal, options.timeoutMs ?? 120_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const instructions = resolveInstructions(request);
  const input = toResponsesInput(request);
  let body: Record<string, unknown> = {
    model: request.modelId,
    input,
    stream: true,
    ...openAIPromptCacheBodyFields(request),
  };
  if (instructions) body.instructions = instructions;
  if (request.maxOutputTokens !== undefined) body.max_output_tokens = request.maxOutputTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  // Responses API uses nested `reasoning` config (o-series / gpt-5); the flat
  // chat-completions style `reasoning_effort` / `enable_thinking` is rejected.
  {
    const level = normalizeReasoningEffort(request.reasoningEffort);
    if (level && !shouldOmitReasoningEffort(level)) {
      body.reasoning = {
        effort: wireReasoningEffort(level),
        summary: 'auto',
      };
    }
  }
  const tools: Array<Record<string, unknown>> = [];
  if (request.hostedTools?.length) {
    tools.push(
      ...request.hostedTools.map((tool) => ({
        type: tool.type,
        ...(tool.searchContextSize ? { search_context_size: tool.searchContextSize } : {}),
      })),
    );
    body.include = ['web_search_call.action.sources'];
  }
  if (request.tools?.length) {
    tools.push(
      ...request.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    );
  }
  if (tools.length > 0) {
    body.tools = tools;
    if (request.toolChoice) body.tool_choice = request.toolChoice;
  }

  let degradedForGateway = false;
  try {
    let response: Response;
    const attemptFetch = (payload: Record<string, unknown>): Promise<Response> =>
      fetchImpl(joinResponsesUrl(request.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: control.signal,
      });
    try {
      response = await attemptFetch(body);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield providerAbortEvent(control, 'Provider Responses call');
        return;
      }
      const raw = error instanceof Error ? error.message : 'network error';
      yield {
        type: 'error',
        failureClass: 'transient',
        message: `Provider Responses network error: ${scrubSecrets(raw, [apiKey])}`,
      };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const snippetRaw = scrubSecrets(text.slice(0, 240), [apiKey]);
      // Some relays reject optional compatibility params with a 400
      // "Unsupported parameter(s)". Degrade once, like stream-chat does
      // (audit #13): drop only the rejected optional fields and retry.
      const rejectedOptionalParameters = pickDegradableParameters(
        snippetRaw,
        body,
        RESPONSES_DEGRADABLE_PARAMETERS,
      );
      if (!degradedForGateway && response.status === 400 && rejectedOptionalParameters.length > 0) {
        degradedForGateway = true;
        body = degradeRequestBody(body, rejectedOptionalParameters);
        try {
          response = await attemptFetch(body);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            yield providerAbortEvent(control, 'Provider Responses call');
            return;
          }
          const raw = error instanceof Error ? error.message : 'network error';
          yield {
            type: 'error',
            failureClass: 'transient',
            message: `Provider Responses network error: ${scrubSecrets(raw, [apiKey])}`,
          };
          return;
        }
      }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const scrubbed = scrubSecrets(text.slice(0, 240), [apiKey]);
      const snippet = scrubbed ? ` - ${scrubbed}` : '';
      const error = classifyHttpFailure(response.status, snippet);
      yield { ...error, message: scrubSecrets(error.message, [apiKey]) };
      return;
    }

    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      yield* emitFromJsonResponse(await response.text(), apiKey);
      return;
    }

    if (!response.body) {
      const text = await response.text();
      if (!text.includes('data:')) {
        yield* emitFromJsonResponse(text, apiKey);
        return;
      }
      const state = createResponsesParseState();
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          for (const event of parseResponseEvent(JSON.parse(data), apiKey, state)) yield event;
        } catch {
          // Ignore malformed keepalive/event fragments.
        }
      }
      if (!state.finished) yield { type: 'finished', reason: 'stop' };
      return;
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state = createResponsesParseState();
    let buffer = '';
    while (!state.finished) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          yield providerAbortEvent(control, 'Provider Responses call');
          return;
        }
        throw error;
      }
      if (done) break;
      buffer += decoder.decode(value!, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          state.finished = true;
          yield { type: 'finished', reason: 'stop' };
          break;
        }
        try {
          for (const event of parseResponseEvent(JSON.parse(data), apiKey, state)) yield event;
        } catch {
          // Ignore malformed keepalive/event fragments.
        }
        if (state.finished) break;
      }
    }
    if (!state.finished) {
      const remaining = buffer.trim();
      if (remaining.startsWith('data:')) {
        const data = remaining.slice(5).trim();
        if (data && data !== '[DONE]') {
          try {
            for (const event of parseResponseEvent(JSON.parse(data), apiKey, state)) yield event;
          } catch {
            // Ignore malformed tail.
          }
        }
      }
    }
    if (!state.finished) yield { type: 'finished', reason: 'stop' };
  } finally {
    control.cleanup();
    await closeResponseReader(reader);
  }
}
