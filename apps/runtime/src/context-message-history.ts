import type { ProviderMessage } from '@sync-think/adapters';
import type { Message } from '@sync-think/shared';

export interface CompactContextBoundary {
  summaryText: string;
  compactedAt: string;
}

export interface CurrentContextImage {
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface BuildProviderMessagesInput {
  messages: readonly Message[];
  compact?: CompactContextBoundary;
  currentUserText: string;
  currentImages?: readonly CurrentContextImage[];
  resolveImageDataUrl?: (storageRef: string, mimeType: string) => string | undefined;
}

function textFromMessage(message: Message): string {
  return message.blocks
    .filter((block) => block.type === 'text' || block.type === 'code' || block.type === 'error')
    .map((block) => block.text ?? '')
    .filter(Boolean)
    .join('\n');
}

function commentaryTextsFromMessage(message: Message): string[] {
  const texts: string[] = [];
  for (const block of message.blocks) {
    if (block.type !== 'commentary') continue;
    const payload =
      block.payload && typeof block.payload === 'object'
        ? (block.payload as { commentarySegments?: unknown })
        : undefined;
    const segments = Array.isArray(payload?.commentarySegments)
      ? payload.commentarySegments
      : [];
    let restoredSegment = false;
    for (const segment of segments) {
      if (!segment || typeof segment !== 'object') continue;
      const text = (segment as { text?: unknown }).text;
      if (typeof text !== 'string' || !text.trim()) continue;
      texts.push(text.trim());
      restoredSegment = true;
    }
    if (!restoredSegment && block.text?.trim()) texts.push(block.text.trim());
  }
  return texts;
}

function assistantProviderMessagesFromMessage(message: Message): ProviderMessage[] {
  const messages: ProviderMessage[] = commentaryTextsFromMessage(message).map((content) => ({
    role: 'assistant',
    phase: 'commentary',
    content,
  }));
  const finalAnswer = textFromMessage(message);
  if (finalAnswer) {
    messages.push({
      role: 'assistant',
      phase: 'final_answer',
      content: finalAnswer,
    });
  }
  return messages;
}

function isCancelledAssistantMessage(message: Message): boolean {
  return message.blocks.some((block) => {
    if (block.type !== 'error' || !block.payload || typeof block.payload !== 'object') {
      return false;
    }
    return (block.payload as { terminalState?: unknown }).terminalState === 'cancelled';
  });
}

function providerContentFromMessage(
  message: Message,
  resolveImageDataUrl?: BuildProviderMessagesInput['resolveImageDataUrl'],
): ProviderMessage['content'] | undefined {
  const text = textFromMessage(message);
  if (message.role !== 'user' || !resolveImageDataUrl) return text || undefined;
  const parts: Array<{ type: 'text'; text: string } | { type: 'image'; imageUrl: string }> = [];
  if (text) parts.push({ type: 'text', text });
  for (const block of message.blocks) {
    if (block.type !== 'image' || !block.payload || typeof block.payload !== 'object') continue;
    const payload = block.payload as Record<string, unknown>;
    if (
      typeof payload.storageRef !== 'string' ||
      typeof payload.mimeType !== 'string' ||
      !payload.mimeType.startsWith('image/')
    ) continue;
    const dataUrl = resolveImageDataUrl(payload.storageRef, payload.mimeType);
    if (dataUrl?.startsWith('data:image/')) parts.push({ type: 'image', imageUrl: dataUrl });
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1 && parts[0]!.type === 'text') return parts[0]!.text;
  return parts;
}

function currentUserContent(
  text: string,
  images: readonly CurrentContextImage[] | undefined,
): ProviderMessage['content'] | undefined {
  const safeImages = images?.filter((image) => image.dataUrl.startsWith('data:image/')) ?? [];
  if (safeImages.length === 0) return text || undefined;
  const parts: Array<{ type: 'text'; text: string } | { type: 'image'; imageUrl: string }> = [];
  if (text.trim()) parts.push({ type: 'text', text });
  for (const image of safeImages) parts.push({ type: 'image', imageUrl: image.dataUrl });
  return parts.length > 0 ? parts : undefined;
}

export function buildProviderMessagesFromDurableMessages(
  input: BuildProviderMessagesInput,
): { messages: ProviderMessage[]; compactSummary?: string; compactedAt?: string } {
  const compactedAtMs = input.compact ? Date.parse(input.compact.compactedAt) : Number.NaN;
  const durable = [...input.messages]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((message) => {
      if (!Number.isFinite(compactedAtMs)) return true;
      const createdAtMs = Date.parse(message.createdAt);
      return Number.isFinite(createdAtMs) && createdAtMs > compactedAtMs;
    });
  const messages: ProviderMessage[] = [];
  for (const message of durable) {
    // UI-only compact notices are never sent back to the model.
    if (message.role === 'system' && /^上下文已(?:自动)?压缩/.test(textFromMessage(message))) continue;
    if (message.role === 'assistant') {
      const restored = assistantProviderMessagesFromMessage(message);
      if (restored.length > 0 && isCancelledAssistantMessage(message)) {
        messages.push({
          role: 'system',
          content: '[上一轮回答已被用户中止，以下是中止前产生的部分内容]',
        });
      }
      messages.push(...restored);
      continue;
    }
    const content = providerContentFromMessage(message, input.resolveImageDataUrl);
    if (content === undefined) continue;
    messages.push({ role: message.role, content });
  }

  const current = currentUserContent(input.currentUserText, input.currentImages);
  if (current !== undefined) {
    const last = messages[messages.length - 1];
    const currentHasImages = Array.isArray(current) && current.some((part) => part.type === 'image');
    const lastMatches =
      !currentHasImages &&
      last?.role === 'user' &&
      typeof last.content === 'string' &&
      last.content === current;
    if (currentHasImages && last?.role === 'user') messages[messages.length - 1] = { role: 'user', content: current };
    else if (!lastMatches) messages.push({ role: 'user', content: current });
  }

  return {
    messages,
    ...(input.compact?.summaryText.trim()
      ? { compactSummary: input.compact.summaryText.trim(), compactedAt: input.compact.compactedAt }
      : {}),
  };
}
