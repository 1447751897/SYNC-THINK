import { describe, expect, it } from 'vitest';
import { parseExportDesktopDiagnosticsPayload } from './diagnostics-export-contract.js';

describe('parseExportDesktopDiagnosticsPayload', () => {
  it('accepts an empty or scoped export request', () => {
    expect(parseExportDesktopDiagnosticsPayload(undefined)).toEqual({});
    expect(parseExportDesktopDiagnosticsPayload({ taskId: 'task-1', runId: 'run-1' })).toEqual({
      taskId: 'task-1',
      runId: 'run-1',
    });
  });

  it('rejects malformed identifiers and unknown primitive payloads', () => {
    expect(() => parseExportDesktopDiagnosticsPayload('task-1')).toThrow();
    expect(() => parseExportDesktopDiagnosticsPayload({ taskId: 'x'.repeat(129) })).toThrow();
    expect(() => parseExportDesktopDiagnosticsPayload({ runId: 'run\n1' })).toThrow();
  });
});
