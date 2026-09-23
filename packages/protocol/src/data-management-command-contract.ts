import type {
  DataBackupPayload,
  DataBackupResponse,
  DataCleanConversationsPayload,
  DataCleanConversationsResponse,
  DataCleanEmptyAttachmentDirectoriesResponse,
  DataCompactStorageResponse,
  DataExportPayload,
  DataExportResponse,
  DataImportPayload,
  DataImportResponse,
  DataStorageStatsResponse,
} from './data.js';

type EmptyDataPayload = Record<string, never>;

/** Runtime-owned data inspection, transfer, backup and cleanup operations. */
export interface DataManagementCommandContract {
  'data.storageStats': { request: EmptyDataPayload; response: DataStorageStatsResponse };
  'data.export': { request: DataExportPayload; response: DataExportResponse };
  'data.import': { request: DataImportPayload; response: DataImportResponse };
  'data.backup': { request: DataBackupPayload; response: DataBackupResponse };
  'data.compactStorage': { request: EmptyDataPayload; response: DataCompactStorageResponse };
  'data.cleanConversations': {
    request: DataCleanConversationsPayload;
    response: DataCleanConversationsResponse;
  };
  'data.cleanEmptyAttachmentDirectories': {
    request: EmptyDataPayload;
    response: DataCleanEmptyAttachmentDirectoriesResponse;
  };
}

export type DataManagementCommand = keyof DataManagementCommandContract;
export type DataManagementCommandRequest<K extends DataManagementCommand> =
  DataManagementCommandContract[K]['request'];
export type DataManagementCommandResponse<K extends DataManagementCommand> =
  DataManagementCommandContract[K]['response'];
