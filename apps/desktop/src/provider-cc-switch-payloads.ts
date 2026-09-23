import type { ImportCcSwitchPayload, PreviewCcSwitchImportPayload } from '@sync-think/protocol';
import { isRecord } from './provider-payload-validation.js';

export function parsePreviewCcSwitchImportPayload(value: unknown): PreviewCcSwitchImportPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid preview-cc-switch payload');
  if (value.dbPath !== undefined && typeof value.dbPath !== 'string') {
    throw new Error('Invalid preview-cc-switch payload');
  }
  return { dbPath: value.dbPath as string | undefined };
}

export function parseImportCcSwitchPayload(value: unknown): ImportCcSwitchPayload {
  if (!isRecord(value)) throw new Error('Invalid import-cc-switch payload');
  if (!Array.isArray(value.sourceIds) || value.sourceIds.length === 0) {
    throw new Error('Invalid import-cc-switch payload');
  }
  if (!value.sourceIds.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new Error('Invalid import-cc-switch payload');
  }
  if (value.dbPath !== undefined && typeof value.dbPath !== 'string') {
    throw new Error('Invalid import-cc-switch payload');
  }
  return {
    sourceIds: value.sourceIds as string[],
    dbPath: value.dbPath as string | undefined,
  };
}
