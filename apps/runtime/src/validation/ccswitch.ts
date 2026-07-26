// ccswitch command payload parsers (extracted from command-validation.ts).
import type { PreviewCcSwitchImportPayload, ImportCcSwitchPayload } from '@sync-think/protocol';
import { isRecord } from './shared.js';

export function parsePreviewCcSwitchImportPayload(
  value: unknown,
): PreviewCcSwitchImportPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.dbPath !== undefined) {
    if (typeof value.dbPath !== 'string' || value.dbPath.length > 4096) return undefined;
  }
  return value as unknown as PreviewCcSwitchImportPayload;
}

export function parseImportCcSwitchPayload(value: unknown): ImportCcSwitchPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length === 0 ||
    value.sourceIds.length > 64
  ) {
    return undefined;
  }
  if (!value.sourceIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)) {
    return undefined;
  }
  if (value.dbPath !== undefined) {
    if (typeof value.dbPath !== 'string' || value.dbPath.length > 4096) return undefined;
  }
  return value as unknown as ImportCcSwitchPayload;
}
