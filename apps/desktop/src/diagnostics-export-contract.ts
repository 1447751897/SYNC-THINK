export interface ExportDesktopDiagnosticsPayload {
  taskId?: string;
  runId?: string;
}

export type ExportDesktopDiagnosticsResponse =
  | {
      status: 'saved';
      path: string;
      diagnosticCount: number;
      crashReportCount: number;
      generatedAt: string;
    }
  | {
      status: 'cancelled';
      diagnosticCount: number;
      crashReportCount: number;
      generatedAt: string;
    };

export function parseExportDesktopDiagnosticsPayload(
  value: unknown,
): ExportDesktopDiagnosticsPayload {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid diagnostics export payload');
  }
  const input = value as Record<string, unknown>;
  const taskId = optionalId(input.taskId, 'taskId');
  const runId = optionalId(input.runId, 'runId');
  return { ...(taskId ? { taskId } : {}), ...(runId ? { runId } : {}) };
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128 || [...normalized].some((character) => character.charCodeAt(0) <= 0x1f)) {
    throw new Error(`Invalid ${field}`);
  }
  return normalized;
}
