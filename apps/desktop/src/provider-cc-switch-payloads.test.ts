import { describe, expect, it } from 'vitest';
import {
  parseImportCcSwitchPayload,
  parsePreviewCcSwitchImportPayload,
} from './provider-cc-switch-payloads.js';

describe('Provider CC Switch payloads', () => {
  it('preserves the optional preview path semantics', () => {
    expect(parsePreviewCcSwitchImportPayload(undefined)).toEqual({});
    expect(parsePreviewCcSwitchImportPayload(null)).toEqual({});
    expect(parsePreviewCcSwitchImportPayload({ dbPath: 'D:/cc-switch.db' })).toEqual({
      dbPath: 'D:/cc-switch.db',
    });
    expect(parsePreviewCcSwitchImportPayload({ extra: true })).toEqual({ dbPath: undefined });
  });

  it('parses selected source ids without changing the existing values', () => {
    expect(
      parseImportCcSwitchPayload({
        sourceIds: ['source-1', ' source-2 '],
        dbPath: '',
        extra: true,
      }),
    ).toEqual({ sourceIds: ['source-1', ' source-2 '], dbPath: '' });
  });

  it('rejects invalid preview and import payloads', () => {
    expect(() => parsePreviewCcSwitchImportPayload('bad')).toThrow(
      /Invalid preview-cc-switch payload/,
    );
    expect(() => parsePreviewCcSwitchImportPayload({ dbPath: 1 })).toThrow(
      /Invalid preview-cc-switch payload/,
    );
    expect(() => parseImportCcSwitchPayload({ sourceIds: [] })).toThrow(
      /Invalid import-cc-switch payload/,
    );
    expect(() => parseImportCcSwitchPayload({ sourceIds: [''] })).toThrow(
      /Invalid import-cc-switch payload/,
    );
    expect(() => parseImportCcSwitchPayload({ sourceIds: ['source-1'], dbPath: 1 })).toThrow(
      /Invalid import-cc-switch payload/,
    );
  });
});
