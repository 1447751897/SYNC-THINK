import type { FileChangeItem } from '@sync-think/protocol';
import type { ContentPath, DeferredContent, Event } from '@sync-think/shared';
import { describeDeferredContent } from './deferred-content-projection.js';

interface Source {
  text: string;
  reference: DeferredContent['reference'];
  fragment?: boolean;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function projectFileChangeContent(
  changes: readonly FileChangeItem[],
  events: readonly Event[],
  deferAll = false,
): FileChangeItem[] {
  const sources = new Map<string, { after?: Source; before?: Source }>();
  for (const event of events) {
    const payload = event.payload;
    const toolCall = object(payload.toolCall);
    const callId = [
      payload.toolCallId,
      payload.callId,
      toolCall?.id,
      payload.actionDigest,
      event.id,
    ].find((value) => typeof value === 'string' && value.length > 0);
    if (typeof callId !== 'string') continue;
    const previous = sources.get(callId) ?? {};
    const candidates: Array<[unknown, ContentPath]> = [
      [payload.arguments, ['arguments']],
      [payload.args, ['args']],
      [toolCall?.arguments, ['toolCall', 'arguments']],
      [json(toolCall?.argumentsJson), ['toolCall', 'argumentsJson']],
      [json(payload.argumentsJson), ['argumentsJson']],
    ];
    const selected = candidates
      .map(([value, path]) => ({ value: object(value), path }))
      .find((candidate) => candidate.value);
    if (selected) {
      const field = ['content', 'text', 'body', 'new_string', 'newString'].find(
        (field) =>
          Object.hasOwn(selected.value!, field) && typeof selected.value![field] === 'string',
      );
      if (field)
        previous.after = {
          text: selected.value![field] as string,
          reference: { source: 'event', id: event.id, path: [...selected.path, field] },
          fragment: field === 'new_string' || field === 'newString',
        };
    }
    if (typeof payload.previousContent === 'string')
      previous.before = {
        text: payload.previousContent,
        reference: { source: 'event', id: event.id, path: ['previousContent'] },
      };
    sources.set(callId, previous);
  }
  const inlineLimit = Math.min(8192, Math.floor(65536 / Math.max(1, changes.length)));
  const inlineBytes = Math.floor(65536 / (2 * Math.max(1, changes.length)));
  const previewLimit = Math.min(2048, Math.max(16, Math.floor(inlineBytes / 3)));
  return changes.map((change) => {
    const result = { ...change };
    const source = change.toolCallId ? sources.get(change.toolCallId) : undefined;
    if (source?.after?.fragment && source.after.text === change.content)
      result.contentKind = 'replacement-fragment';
    if (
      change.action === 'created' &&
      result.previousContent === undefined &&
      !result.previousContentRef
    )
      result.previousContent = '';
    if (change.action === 'deleted' && result.content === undefined && !result.contentRef)
      result.content = '';
    for (const [field, refField, candidate] of [
      ['content', 'contentRef', source?.after],
      ['previousContent', 'previousContentRef', source?.before],
    ] as const) {
      const text = change[field];
      if (
        text === undefined ||
        (!deferAll &&
          text.length <= inlineLimit &&
          Buffer.byteLength(JSON.stringify(text)) <= inlineBytes) ||
        !candidate ||
        candidate.text !== text
      )
        continue;
      result[refField] = describeDeferredContent(text, candidate.reference);
      delete result[field];
    }
    if (result.preview && result.preview.length > previewLimit) {
      let end = previewLimit;
      const previous = result.preview.charCodeAt(end - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) end--;
      result.preview = result.preview.slice(0, end) + '\n[差异详情按需读取]';
    }
    return result;
  });
}
