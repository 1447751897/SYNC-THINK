import type {
  DataConflictStrategy,
  DataExportResponse,
  DataImportResponse,
} from '@sync-think/protocol';

export interface ExportDesktopDataPayload {
  workspaceId?: string;
}

export type ExportDesktopDataResponse =
  { status: 'cancelled' } | ({ status: 'saved' } & DataExportResponse);

export interface ImportDesktopDataPayload {
  conflictStrategy: DataConflictStrategy;
}

export type ImportDesktopDataResponse =
  { status: 'cancelled' } | ({ status: 'imported' } & DataImportResponse);

export interface OpenDesktopDataDirectoryResponse {
  opened: boolean;
  path: string;
  error?: string;
}
