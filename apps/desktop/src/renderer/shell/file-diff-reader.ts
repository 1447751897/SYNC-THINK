import type {
  ConversationReadFileDiffPayload,
  ConversationReadFileDiffResponse,
} from '@sync-think/protocol';
import { DeferredRequestReader } from './deferred-request-reader.js';

export function validateFileDiffResponse(
  payload: ConversationReadFileDiffPayload,
  response: ConversationReadFileDiffResponse,
): void {
  const diff = response?.diff;
  const version = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (
    !diff ||
    !Array.isArray(diff.rows) ||
    diff.rows.length > (payload.limit ?? 80) ||
    !Number.isSafeInteger(diff.offset) ||
    diff.offset < 0 ||
    (payload.offset !== undefined && diff.offset !== payload.offset) ||
    !Number.isSafeInteger(diff.totalRows) ||
    diff.totalRows < diff.offset + diff.rows.length ||
    !version(diff.version) ||
    !version(diff.beforeVersion) ||
    !version(diff.afterVersion) ||
    !['exact', 'replacement'].includes(diff.mode) ||
    typeof diff.formatChanged !== 'boolean' ||
    !Number.isSafeInteger(diff.added) ||
    diff.added < 0 ||
    !Number.isSafeInteger(diff.removed) ||
    diff.removed < 0
  )
    throw new Error('content.invalid-response');
  const end = diff.offset + diff.rows.length;
  if (
    end < diff.totalRows
      ? diff.nextOffset !== end || end <= diff.offset
      : diff.nextOffset !== undefined
  )
    throw new Error('content.invalid-response');
  for (const row of diff.rows) {
    if (
      !row ||
      !['ctx', 'add', 'del'].includes(row.kind) ||
      typeof row.text !== 'string' ||
      row.text.length > 512 ||
      (row.truncated !== undefined && typeof row.truncated !== 'boolean')
    )
      throw new Error('content.invalid-response');
    for (const field of ['oldLine', 'newLine', 'oldOffset', 'newOffset'] as const)
      if (
        row[field] !== undefined &&
        (!Number.isSafeInteger(row[field]) || row[field]! < (field.endsWith('Line') ? 1 : 0))
      )
        throw new Error('content.invalid-response');
    if (
      (row.kind !== 'add' && (row.oldLine === undefined || row.oldOffset === undefined)) ||
      (row.kind !== 'del' && (row.newLine === undefined || row.newOffset === undefined))
    )
      throw new Error('content.invalid-response');
  }
  if (payload.version && payload.version !== diff.version)
    throw new Error('content.version-changed');
}

export const fileDiffReader = new DeferredRequestReader<
  ConversationReadFileDiffPayload,
  ConversationReadFileDiffResponse
>(async (payload) => {
  const runtime = window.syncThink?.runtime;
  if (!runtime?.readConversationFileDiff) throw new Error('content.unavailable');
  return runtime.readConversationFileDiff(payload);
}, validateFileDiffResponse);
