import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA_MANAGEMENT_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/data-management-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('data management desktop wiring', () => {
  it('registers every data operation through the injected typed boundary', () => {
    expect(mainSource).toContain('registerDataManagementHandlers({');
    expect(mainSource).toContain('requestDataManagement:');
    expect(mainSource).toContain('selectExportFile:');
    expect(mainSource).toContain('selectImportFile:');
    expect(mainSource).toContain('openPath:');
    for (const command of [
      'data.storageStats',
      'data.export',
      'data.import',
      'data.backup',
      'data.compactStorage',
      'data.cleanConversations',
      'data.cleanEmptyAttachmentDirectories',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request<${command}`);
    }
  });

  it('exposes narrow typed preload methods without renderer filesystem access', () => {
    for (const method of [
      'getDataStorageStats',
      'exportData',
      'importData',
      'backupData',
      'compactDataStorage',
      'cleanConversations',
      'cleanEmptyAttachmentDirectories',
      'openDataDirectory',
    ]) {
      expect(preloadSource).toContain(`${method}:`);
      expect(globalSource).toContain(`${method}(`);
    }
    expect(preloadSource).toContain('DATA_MANAGEMENT_IPC_CHANNELS,');
    for (const key of Object.keys(DATA_MANAGEMENT_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`DATA_MANAGEMENT_IPC_CHANNELS.${key}`);
    }
    expect(preloadSource).not.toContain("from 'node:fs'");
  });
});
