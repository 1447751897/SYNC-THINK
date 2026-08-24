import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

const channels = [
  'runtime:data-storage-stats',
  'desktop:data-export',
  'desktop:data-import',
  'runtime:data-backup',
  'runtime:data-compact-storage',
  'runtime:data-clean-conversations',
  'runtime:data-clean-empty-attachment-directories',
  'desktop:data-open-directory',
] as const;

describe('data management desktop wiring', () => {
  it('registers every data operation in the trusted main-process IPC boundary', () => {
    for (const channel of channels) {
      const channelStart = mainSource.indexOf(`'${channel}'`);
      const handlerStart = mainSource.lastIndexOf('ipcMain.handle(', channelStart);
      expect(handlerStart, channel).toBeGreaterThan(-1);
      const nextHandler = mainSource.indexOf('ipcMain.handle(', handlerStart + 1);
      const handler = mainSource.slice(
        handlerStart,
        nextHandler === -1 ? mainSource.length : nextHandler,
      );
      expect(handler, channel).toContain('assertRuntimeIpcSource(event)');
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
    expect(preloadSource).not.toContain("from 'node:fs'");
  });
});
