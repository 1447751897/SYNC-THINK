import {
  parseDataBackupPayload,
  parseDataCleanConversationsPayload,
  parseEmptyDataPayload,
  type DataManagementCommand,
  type DataManagementCommandRequest,
  type DataManagementCommandResponse,
} from '@sync-think/protocol';
import {
  type ExportDesktopDataResponse,
  type ImportDesktopDataResponse,
  type OpenDesktopDataDirectoryResponse,
} from '../data-management-contract.js';
import {
  parseExportDesktopDataPayload,
  parseImportDesktopDataPayload,
} from '../data-management-payloads.js';
import { DATA_MANAGEMENT_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface DataManagementHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestDataManagement<K extends DataManagementCommand>(
    command: K,
    payload: DataManagementCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<DataManagementCommandResponse<K>>;
  defaultExportFileName(): string;
  selectExportFile(event: Event, defaultFileName: string): Promise<string | undefined>;
  selectImportFile(event: Event): Promise<string | undefined>;
  openPath(path: string): Promise<string>;
}

export function registerDataManagementHandlers<Event>(host: DataManagementHost<Event>): void {
  host.handle(DATA_MANAGEMENT_IPC_CHANNELS.storageStats, async (event, value) => {
    host.assertSource(event);
    const payload = parseEmptyDataPayload(value ?? {});
    if (!payload) throw new Error('Invalid data storage stats payload');
    await host.ensureConnection();
    return host.requestDataManagement('data.storageStats', payload);
  });

  host.handle(DATA_MANAGEMENT_IPC_CHANNELS.export, async (event, value) => {
    host.assertSource(event);
    const payload = parseExportDesktopDataPayload(value);
    const filePath = await host.selectExportFile(event, host.defaultExportFileName());
    if (!filePath) return { status: 'cancelled' } satisfies ExportDesktopDataResponse;
    await host.ensureConnection();
    const response = await host.requestDataManagement('data.export', { filePath, ...payload });
    return { status: 'saved', ...response } satisfies ExportDesktopDataResponse;
  });

  host.handle(DATA_MANAGEMENT_IPC_CHANNELS.import, async (event, value) => {
    host.assertSource(event);
    const payload = parseImportDesktopDataPayload(value);
    const filePath = await host.selectImportFile(event);
    if (!filePath) return { status: 'cancelled' } satisfies ImportDesktopDataResponse;
    await host.ensureConnection();
    const response = await host.requestDataManagement('data.import', { filePath, ...payload });
    return { status: 'imported', ...response } satisfies ImportDesktopDataResponse;
  });

  host.handle(DATA_MANAGEMENT_IPC_CHANNELS.backup, async (event, value) => {
    host.assertSource(event);
    const payload = parseDataBackupPayload(value);
    if (!payload) throw new Error('Invalid data backup payload');
    await host.ensureConnection();
    return host.requestDataManagement('data.backup', payload);
  });

  host.handle(DATA_MANAGEMENT_IPC_CHANNELS.compactStorage, async (event, value) => {
    host.assertSource(event);
    const payload = parseEmptyDataPayload(value ?? {});
    if (!payload) throw new Error('Invalid data compact payload');
    await host.ensureConnection();
    return host.requestDataManagement('data.compactStorage', payload);
  });

  host.handle(DATA_MANAGEMENT_IPC_CHANNELS.cleanConversations, async (event, value) => {
    host.assertSource(event);
    const payload = parseDataCleanConversationsPayload(value ?? {});
    if (!payload) throw new Error('Invalid data cleanup payload');
    await host.ensureConnection();
    return host.requestDataManagement('data.cleanConversations', payload);
  });

  host.handle(DATA_MANAGEMENT_IPC_CHANNELS.cleanEmptyAttachmentDirectories, async (event, value) => {
    host.assertSource(event);
    const payload = parseEmptyDataPayload(value ?? {});
    if (!payload) throw new Error('Invalid empty attachment directory cleanup payload');
    await host.ensureConnection();
    return host.requestDataManagement('data.cleanEmptyAttachmentDirectories', payload);
  });

  host.handle(DATA_MANAGEMENT_IPC_CHANNELS.openDirectory, async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    const stats = await host.requestDataManagement('data.storageStats', {});
    const error = await host.openPath(stats.dataDirectory);
    return {
      opened: error.length === 0,
      path: stats.dataDirectory,
      ...(error ? { error } : {}),
    } satisfies OpenDesktopDataDirectoryResponse;
  });
}
