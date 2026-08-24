import { describe, expect, it } from 'vitest';
import {
  parseDataBackupPayload,
  parseDataCleanConversationsPayload,
  parseDataExportPayload,
  parseDataImportPayload,
  parseEmptyDataPayload,
} from './data.js';

describe('data management protocol payloads', () => {
  it('accepts the exact data-management payload shapes', () => {
    expect(
      parseDataExportPayload({ filePath: 'D:\\export.json', workspaceId: 'workspace-a' }),
    ).toEqual({ filePath: 'D:\\export.json', workspaceId: 'workspace-a' });
    expect(
      parseDataImportPayload({ filePath: 'D:\\export.json', conflictStrategy: 'overwrite' }),
    ).toEqual({ filePath: 'D:\\export.json', conflictStrategy: 'overwrite' });
    expect(parseDataBackupPayload({ targetDirectory: 'D:\\backups' })).toEqual({
      targetDirectory: 'D:\\backups',
    });
    expect(parseDataCleanConversationsPayload({ beforeTimestamp: 42 })).toEqual({
      beforeTimestamp: 42,
    });
    expect(parseEmptyDataPayload({})).toEqual({});
  });

  it('rejects unknown keys and invalid conflict or timestamp values', () => {
    expect(parseDataExportPayload({ filePath: 'x', extra: true })).toBeUndefined();
    expect(parseDataImportPayload({ filePath: 'x', conflictStrategy: 'merge' })).toBeUndefined();
    expect(parseDataBackupPayload({ targetDirectory: '' })).toBeUndefined();
    expect(parseDataCleanConversationsPayload({ beforeTimestamp: -1 })).toBeUndefined();
    expect(parseEmptyDataPayload({ unexpected: true })).toBeUndefined();
  });
});
