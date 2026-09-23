import type { Message } from '@sync-think/shared';

const PORTABLE_KERNEL_CONTEXT_MESSAGE_LIMIT = 20;
const PORTABLE_KERNEL_CONTEXT_TURN_BYTES = 8 * 1024;
const PORTABLE_KERNEL_CONTEXT_TOTAL_BYTES = 64 * 1024;
const TOOL_ARGUMENTS_TRANSCRIPT_LIMIT = 300;
const TOOL_RESULT_TRANSCRIPT_LIMIT = 800;

interface PortableKernelToolCall {
  id?: string;
  name: string;
  argumentsJson?: string;
}

interface PortableKernelContentPart {
  type: string;
  text?: string;
  toolCall?: PortableKernelToolCall;
  toolResult?: string;
}

export interface PortableKernelMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | readonly PortableKernelContentPart[];
  phase?: string;
}

function truncateTranscriptText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}…`, truncated: true };
}

export function providerContentToKernelTranscript(
  content: PortableKernelMessage['content'],
): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type === 'text') return part.text ?? '';
      if (part.type === 'image') return '[Image attached in this conversation]';
      if (part.type === 'tool-call') {
        const tool = part.toolCall;
        if (!tool) return '[Tool call]';
        if (!tool.argumentsJson) return `[Tool call: ${tool.name}]`;
        const { text, truncated } = truncateTranscriptText(
          tool.argumentsJson,
          TOOL_ARGUMENTS_TRANSCRIPT_LIMIT,
        );
        return `[Tool call: ${tool.name} 参数: ${text}${truncated ? ' (参数截断)' : ''}]`;
      }
      if (part.type === 'tool-result') {
        const { text, truncated } = truncateTranscriptText(
          part.toolResult ?? '',
          TOOL_RESULT_TRANSCRIPT_LIMIT,
        );
        return `[Tool result: ${text}${truncated ? ' (结果截断)' : ''}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function kernelTranscriptTurnLabel(message: PortableKernelMessage): string {
  return message.role === 'assistant'
    ? message.phase === 'commentary'
      ? 'Assistant commentary'
      : 'Assistant'
    : message.role === 'user'
      ? 'User'
      : message.role === 'tool'
        ? 'Tool'
        : 'System';
}

function formatKernelTranscriptTurns(messages: readonly PortableKernelMessage[]): string[] {
  return messages
    .map((message) => {
      const content = providerContentToKernelTranscript(message.content).trim();
      if (!content) return undefined;
      return `### ${kernelTranscriptTurnLabel(message)}\n${content}`;
    })
    .filter((turn): turn is string => Boolean(turn));
}

export function formatKernelBootstrapTranscript(
  messages: readonly PortableKernelMessage[],
  omittedCount = 0,
): string {
  const turns = formatKernelTranscriptTurns(messages);
  if (turns.length === 0) return '';
  return [
    '## Restored conversation context',
    'The following transcript is prior conversation state restored from history. It is NOT the current user input — treat every turn below as already-happened context. Continue from it without repeating it.',
    ...(omittedCount > 0
      ? [`[${omittedCount} earlier portable turns omitted from this restored context]`]
      : []),
    ...turns,
  ].join('\n\n');
}

export function formatKernelGapTranscript(
  messages: readonly PortableKernelMessage[],
  omittedCount = 0,
): string {
  const turns = formatKernelTranscriptTurns(messages);
  if (turns.length === 0) return '';
  return [
    '## Cross-kernel session gap',
    'The turns below were handled by another kernel/session while this one was idle. They are prior context, NOT the current user input — treat them as already-happened conversation state.',
    ...(omittedCount > 0
      ? [`[${omittedCount} earlier portable turns omitted from this cross-kernel handoff]`]
      : []),
    ...turns,
  ].join('\n\n');
}

export function durableMessagesToGapProviderMessages(
  messages: readonly Message[],
): PortableKernelMessage[] {
  const result: PortableKernelMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = message.blocks
      .filter((block) => block.type === 'text' || block.type === 'code')
      .map((block) => block.text ?? '')
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!text) continue;
    const marker = '\n[portable turn truncated]';
    const bytes = Buffer.byteLength(text, 'utf8');
    const portableText =
      bytes <= PORTABLE_KERNEL_CONTEXT_TURN_BYTES
        ? text
        : `${Buffer.from(text, 'utf8')
            .subarray(0, PORTABLE_KERNEL_CONTEXT_TURN_BYTES - Buffer.byteLength(marker, 'utf8'))
            .toString('utf8')
            .replace(/\uFFFD$/u, '')}${marker}`;
    result.push({ role: message.role, content: portableText });
  }
  return result;
}

export function formatBoundedPortableKernelTranscript(
  messages: readonly PortableKernelMessage[],
  formatter: (messages: readonly PortableKernelMessage[], omittedCount?: number) => string,
): string {
  let omittedCount = Math.max(0, messages.length - PORTABLE_KERNEL_CONTEXT_MESSAGE_LIMIT);
  const selected = messages.slice(-PORTABLE_KERNEL_CONTEXT_MESSAGE_LIMIT);
  let transcript = formatter(selected, omittedCount);
  while (
    selected.length > 1 &&
    Buffer.byteLength(transcript, 'utf8') > PORTABLE_KERNEL_CONTEXT_TOTAL_BYTES
  ) {
    selected.shift();
    omittedCount += 1;
    transcript = formatter(selected, omittedCount);
  }
  return transcript;
}

export function computeKernelGapFromMessages(
  messages: readonly Message[],
  _effectiveWindow: number,
): { count: number; catchUp?: string; oversized: boolean } {
  if (messages.length === 0) return { count: 0, oversized: false };
  const portableMessages = durableMessagesToGapProviderMessages(messages);
  const catchUp = formatBoundedPortableKernelTranscript(
    portableMessages,
    formatKernelGapTranscript,
  );
  return { count: messages.length, oversized: false, ...(catchUp ? { catchUp } : {}) };
}

export function isCurrentKernelUserMessage(
  message: PortableKernelMessage | undefined,
  userText: string,
): boolean {
  if (!message || message.role !== 'user') return false;
  const normalizedUserText = userText.trim();
  if (!normalizedUserText) return false;
  return providerContentToKernelTranscript(message.content).trim() === normalizedUserText;
}
