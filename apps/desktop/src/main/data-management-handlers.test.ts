import { describe, expect, it, vi } from 'vitest';
import { DATA_MANAGEMENT_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerDataManagementHandlers,
  type DataManagementHost,
} from './data-management-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    if (command === 'data.storageStats') return { dataDirectory: 'D:/sync-think-data' };
    if (command === 'data.export') return { success: true, filePath: 'D:/export.json', count: {} };
    if (command === 'data.import') return { success: true, imported: {}, skipped: 0 };
    return { success: true };
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestDataManagement: request as DataManagementHost<string>['requestDataManagement'],
    defaultExportFileName: vi.fn(() => 'sync-think-export-2026-09-20.json'),
    selectExportFile: vi.fn(async (): Promise<string | undefined> => 'D:/export.json'),
    selectImportFile: vi.fn(async (): Promise<string | undefined> => 'D:/import.json'),
    openPath: vi.fn(async () => ''),
  };
  registerDataManagementHandlers(host);
  return { handlers, host, order, request };
}

describe('Data Management IPC boundary', () => {
  it('registers every data operation', () => {
    expect([...fixture().handlers.keys()]).toEqual(Object.values(DATA_MANAGEMENT_IPC_CHANNELS));
  });

  it('forwards Runtime-owned inspection and maintenance commands', async () => {
    const { handlers, request } = fixture();
    await handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.storageStats)!('trusted', {});
    await handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.backup)!('trusted', {
      targetDirectory: 'D:/backups',
    });
    await handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.compactStorage)!('trusted', {});
    await handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.cleanConversations)!('trusted', {
      beforeTimestamp: 42,
    });
    await handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.cleanEmptyAttachmentDirectories)!(
      'trusted',
      {},
    );
    expect(request).toHaveBeenNthCalledWith(1, 'data.storageStats', {});
    expect(request).toHaveBeenNthCalledWith(2, 'data.backup', {
      targetDirectory: 'D:/backups',
    });
    expect(request).toHaveBeenNthCalledWith(3, 'data.compactStorage', {});
    expect(request).toHaveBeenNthCalledWith(4, 'data.cleanConversations', {
      beforeTimestamp: 42,
    });
    expect(request).toHaveBeenNthCalledWith(5, 'data.cleanEmptyAttachmentDirectories', {});
  });

  it('selects an export path before connecting and returns the desktop envelope', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.export)!('trusted', {
        workspaceId: ' workspace-1 ',
      }),
    ).resolves.toEqual({
      status: 'saved',
      success: true,
      filePath: 'D:/export.json',
      count: {},
    });
    expect(host.selectExportFile).toHaveBeenCalledWith(
      'trusted',
      'sync-think-export-2026-09-20.json',
    );
    expect(request).toHaveBeenCalledWith('data.export', {
      filePath: 'D:/export.json',
      workspaceId: 'workspace-1',
    });
    expect(order).toEqual(['source', 'connect', 'request:data.export']);
  });

  it('selects an import path and returns the desktop envelope', async () => {
    const { handlers, host, request } = fixture();
    await expect(
      handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.import)!('trusted', {
        conflictStrategy: 'overwrite',
      }),
    ).resolves.toEqual({ status: 'imported', success: true, imported: {}, skipped: 0 });
    expect(host.selectImportFile).toHaveBeenCalledWith('trusted');
    expect(request).toHaveBeenCalledWith('data.import', {
      filePath: 'D:/import.json',
      conflictStrategy: 'overwrite',
    });
  });

  it.each([
    ['export', DATA_MANAGEMENT_IPC_CHANNELS.export],
    ['import', DATA_MANAGEMENT_IPC_CHANNELS.import],
  ])('returns cancelled without connecting when %s selection is dismissed', async (kind, channel) => {
    const { handlers, host, request } = fixture();
    if (kind === 'export') host.selectExportFile.mockResolvedValue(undefined);
    else host.selectImportFile.mockResolvedValue(undefined);
    const value = kind === 'export' ? {} : { conflictStrategy: 'skip' };
    await expect(handlers.get(channel)!('trusted', value)).resolves.toEqual({
      status: 'cancelled',
    });
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('opens the Runtime-owned data directory and preserves shell errors', async () => {
    const { handlers, host } = fixture();
    await expect(
      handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.openDirectory)!('trusted', undefined),
    ).resolves.toEqual({ opened: true, path: 'D:/sync-think-data' });
    expect(host.openPath).toHaveBeenCalledWith('D:/sync-think-data');

    host.openPath.mockResolvedValue('access denied');
    await expect(
      handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.openDirectory)!('trusted', undefined),
    ).resolves.toEqual({
      opened: false,
      path: 'D:/sync-think-data',
      error: 'access denied',
    });
  });

  it('rejects untrusted senders before parsing or host effects', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.export)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.selectExportFile).not.toHaveBeenCalled();
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [DATA_MANAGEMENT_IPC_CHANNELS.storageStats, { extra: true }, /storage stats/],
    [DATA_MANAGEMENT_IPC_CHANNELS.export, { workspaceId: '' }, /data export/],
    [DATA_MANAGEMENT_IPC_CHANNELS.import, { conflictStrategy: 'merge' }, /data import/],
    [DATA_MANAGEMENT_IPC_CHANNELS.backup, { targetDirectory: '' }, /data backup/],
    [DATA_MANAGEMENT_IPC_CHANNELS.compactStorage, { extra: true }, /data compact/],
    [DATA_MANAGEMENT_IPC_CHANNELS.cleanConversations, { beforeTimestamp: -1 }, /data cleanup/],
    [
      DATA_MANAGEMENT_IPC_CHANNELS.cleanEmptyAttachmentDirectories,
      { extra: true },
      /empty attachment directory cleanup/,
    ],
  ])('rejects invalid payload on %s before connecting', async (channel, value, message) => {
    const { handlers, host, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(message);
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.storageStats)!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(DATA_MANAGEMENT_IPC_CHANNELS.backup)!('trusted', {
        targetDirectory: 'D:/backups',
      }),
    ).rejects.toBe(failure);
  });
});
