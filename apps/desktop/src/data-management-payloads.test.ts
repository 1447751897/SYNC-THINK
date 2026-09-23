import { describe, expect, it } from 'vitest';
import {
  parseExportDesktopDataPayload,
  parseImportDesktopDataPayload,
} from './data-management-payloads.js';

describe('Desktop data management payloads', () => {
  it('preserves the optional export scope behavior', () => {
    expect(parseExportDesktopDataPayload(undefined)).toEqual({});
    expect(parseExportDesktopDataPayload('legacy-empty')).toEqual({});
    expect(parseExportDesktopDataPayload({ workspaceId: ' workspace-1 ' })).toEqual({
      workspaceId: 'workspace-1',
    });
  });

  it('accepts both supported import conflict strategies', () => {
    expect(parseImportDesktopDataPayload({ conflictStrategy: 'skip' })).toEqual({
      conflictStrategy: 'skip',
    });
    expect(parseImportDesktopDataPayload({ conflictStrategy: 'overwrite' })).toEqual({
      conflictStrategy: 'overwrite',
    });
  });

  it('rejects invalid export scopes', () => {
    expect(() => parseExportDesktopDataPayload({ workspaceId: '   ' })).toThrow(
      /Invalid data export payload/,
    );
    expect(() => parseExportDesktopDataPayload({ extra: true })).toThrow(
      /Invalid data export payload/,
    );
  });

  it('rejects invalid import strategies and extra fields', () => {
    expect(() => parseImportDesktopDataPayload(undefined)).toThrow(/Invalid data import payload/);
    expect(() => parseImportDesktopDataPayload({ conflictStrategy: 'merge' })).toThrow(
      /Invalid data import payload/,
    );
    expect(() =>
      parseImportDesktopDataPayload({ conflictStrategy: 'skip', extra: true }),
    ).toThrow(/Invalid data import payload/);
  });
});
