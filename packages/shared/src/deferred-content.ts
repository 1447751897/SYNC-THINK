import type { RunId } from './types/ids.js';

export type ContentPath = Array<string | number>;

export type ContentReference =
  | { source: 'event' | 'message' | 'event-display' | 'event-prose'; id: string; path: ContentPath }
  | { source: 'timeline'; id: string; runId: RunId; path: ContentPath };

export interface DeferredContent {
  reference: ContentReference;
  utf8Bytes: number;
  utf16Length: number;
  format: 'text' | 'json';
}

export interface ContentChunk {
  text: string;
  offset: number;
  nextOffset?: number;
  utf16Length: number;
  utf8Bytes: number;
  version: string;
  format: 'text' | 'json';
}

export const DEFAULT_CONTENT_CHUNK_LENGTH = 16_384;
export const MAX_CONTENT_CHUNK_LENGTH = 32_768;
export const CONTENT_PREVIEW_LENGTH = 2_048;

function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\0')
  );
}

export function parseContentReference(value: unknown): ContentReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    !keys.includes('source') ||
    !keys.includes('id') ||
    !keys.includes('path') ||
    !identifier(input.id)
  )
    return undefined;
  const path = input.path;
  if (
    !Array.isArray(path) ||
    !path.length ||
    path.length > 16 ||
    !path.every(
      (part) =>
        (typeof part === 'string' &&
          part.length > 0 &&
          part.length <= 128 &&
          !['__proto__', 'prototype', 'constructor'].includes(part)) ||
        (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0),
    )
  )
    return undefined;
  if (input.source === 'timeline') {
    if (
      keys.some((key) => !['source', 'id', 'runId', 'path'].includes(key)) ||
      !keys.includes('runId') ||
      !identifier(input.runId)
    )
      return undefined;
    if (!['output', 'argumentsJson', 'text'].includes(path[0])) return undefined;
    return { source: 'timeline', id: input.id, runId: input.runId as RunId, path: [...path] };
  }
  if (keys.some((key) => !['source', 'id', 'path'].includes(key))) return undefined;
  if (input.source === 'event-prose') {
    if (
      !(path.length === 1 && path[0] === 'assistantText') &&
      !(path.length === 2 && path[0] === 'run' && path[1] === 'assistantText')
    )
      return undefined;
    return { source: 'event-prose', id: input.id, path: [...path] };
  }
  if (input.source === 'event-display') {
    if (path.length !== 1 || path[0] !== 'payload') return undefined;
    return { source: 'event-display', id: input.id, path: ['payload'] };
  }
  if (input.source === 'event') {
    if (
      ![
        'result',
        'output',
        'error',
        'argumentsJson',
        'arguments',
        'args',
        'toolCall',
        'previousContent',
      ].includes(path[0])
    )
      return undefined;
    if (path[0] === 'toolCall' && !['argumentsJson', 'arguments'].includes(path[1]))
      return undefined;
    return { source: 'event', id: input.id, path: [...path] };
  }
  if (input.source === 'message') {
    if (
      path[0] !== 'blocks' ||
      typeof path[1] !== 'number' ||
      !['text', 'payload', 'reasoningText'].includes(path[2])
    )
      return undefined;
    return { source: 'message', id: input.id, path: [...path] };
  }
  return undefined;
}

export function parseDeferredContent(value: unknown): DeferredContent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Partial<DeferredContent>;
  const reference = parseContentReference(input.reference);
  if (
    !reference ||
    !Number.isSafeInteger(input.utf16Length) ||
    input.utf16Length! < 0 ||
    !Number.isSafeInteger(input.utf8Bytes) ||
    input.utf8Bytes! < input.utf16Length! ||
    (input.format !== 'text' && input.format !== 'json')
  )
    return undefined;
  return {
    reference,
    utf16Length: input.utf16Length!,
    utf8Bytes: input.utf8Bytes!,
    format: input.format,
  };
}
