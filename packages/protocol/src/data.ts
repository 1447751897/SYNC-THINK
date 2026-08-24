export const SYNC_THINK_DATA_EXPORT_FORMAT = 'sync-think-data-export' as const;
export const SYNC_THINK_DATA_EXPORT_VERSION = 1 as const;

export type DataConflictStrategy = 'skip' | 'overwrite';

export interface DataStorageStatsResponse {
  success: true;
  dataDirectory: string;
  dbSizeBytes: number;
  conversationFilesSizeBytes: number;
  conversationCount: number;
  messageCount: number;
}

export interface DataExportPayload {
  filePath: string;
  workspaceId?: string;
}

export interface DataOperationCount {
  workspaces: number;
  conversations: number;
  messages: number;
}

export interface DataExportResponse {
  success: true;
  filePath: string;
  count: DataOperationCount;
}

export interface DataImportPayload {
  filePath: string;
  conflictStrategy: DataConflictStrategy;
}

export interface DataImportResponse {
  success: true;
  imported: DataOperationCount;
  skipped: number;
}

export interface DataBackupPayload {
  targetDirectory: string;
}

export interface DataBackupResponse {
  success: true;
  backupPath: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DataCompactStorageResponse {
  success: true;
  reclaimedBytes: number;
  compacted: number;
}

export interface DataCleanConversationsPayload {
  /** Unix epoch milliseconds. Omit to clear every conversation. */
  beforeTimestamp?: number;
}

export interface DataCleanConversationsResponse {
  success: true;
  deletedConversations: number;
  deletedMessages: number;
}

export interface DataCleanEmptyAttachmentDirectoriesResponse {
  success: true;
  removedConversationDirs: number;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

export function parseDataExportPayload(value: unknown): DataExportPayload | undefined {
  const record = recordOf(value);
  if (
    !record ||
    !hasOnlyKeys(record, ['filePath', 'workspaceId']) ||
    typeof record.filePath !== 'string' ||
    record.filePath.trim().length === 0 ||
    (record.workspaceId !== undefined &&
      (typeof record.workspaceId !== 'string' || record.workspaceId.trim().length === 0))
  ) {
    return undefined;
  }
  return {
    filePath: record.filePath,
    ...(typeof record.workspaceId === 'string' ? { workspaceId: record.workspaceId } : {}),
  };
}

export function parseDataImportPayload(value: unknown): DataImportPayload | undefined {
  const record = recordOf(value);
  if (
    !record ||
    !hasOnlyKeys(record, ['filePath', 'conflictStrategy']) ||
    typeof record.filePath !== 'string' ||
    record.filePath.trim().length === 0 ||
    (record.conflictStrategy !== 'skip' && record.conflictStrategy !== 'overwrite')
  ) {
    return undefined;
  }
  return {
    filePath: record.filePath,
    conflictStrategy: record.conflictStrategy,
  };
}

export function parseDataBackupPayload(value: unknown): DataBackupPayload | undefined {
  const record = recordOf(value);
  if (
    !record ||
    !hasOnlyKeys(record, ['targetDirectory']) ||
    typeof record.targetDirectory !== 'string' ||
    record.targetDirectory.trim().length === 0
  ) {
    return undefined;
  }
  return { targetDirectory: record.targetDirectory };
}

export function parseDataCleanConversationsPayload(
  value: unknown,
): DataCleanConversationsPayload | undefined {
  const record = recordOf(value);
  if (!record || !hasOnlyKeys(record, ['beforeTimestamp'])) return undefined;
  if (
    record.beforeTimestamp !== undefined &&
    (typeof record.beforeTimestamp !== 'number' ||
      !Number.isFinite(record.beforeTimestamp) ||
      record.beforeTimestamp < 0)
  ) {
    return undefined;
  }
  return typeof record.beforeTimestamp === 'number'
    ? { beforeTimestamp: record.beforeTimestamp }
    : {};
}

export function parseEmptyDataPayload(value: unknown): Record<string, never> | undefined {
  const record = recordOf(value ?? {});
  return record && Object.keys(record).length === 0 ? {} : undefined;
}
