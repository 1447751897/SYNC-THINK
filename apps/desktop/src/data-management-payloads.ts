import type {
  ExportDesktopDataPayload,
  ImportDesktopDataPayload,
} from './data-management-contract.js';

export function parseExportDesktopDataPayload(value: unknown): ExportDesktopDataPayload {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (
    Object.keys(record).some((key) => key !== 'workspaceId') ||
    (record.workspaceId !== undefined &&
      (typeof record.workspaceId !== 'string' || record.workspaceId.trim().length === 0))
  ) {
    throw new Error('Invalid data export payload');
  }
  return typeof record.workspaceId === 'string'
    ? { workspaceId: record.workspaceId.trim() }
    : {};
}

export function parseImportDesktopDataPayload(value: unknown): ImportDesktopDataPayload {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  if (
    !record ||
    Object.keys(record).some((key) => key !== 'conflictStrategy') ||
    (record.conflictStrategy !== 'skip' && record.conflictStrategy !== 'overwrite')
  ) {
    throw new Error('Invalid data import payload');
  }
  return { conflictStrategy: record.conflictStrategy };
}
