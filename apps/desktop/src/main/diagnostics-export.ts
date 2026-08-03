import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const DIAGNOSTICS_EXPORT_SCHEMA_VERSION = 1;
export const DEFAULT_CRASH_RETENTION_DAYS = 14;
export const DEFAULT_CRASH_RETENTION_COUNT = 20;
export const MAX_CRASH_RECORD_BYTES = 256 * 1024;

export const DEFAULT_KNOWN_LIMITATIONS = [
  'Windows closed beta only; macOS, Linux, cloud execution, and multi-user collaboration are outside this release.',
  'External provider availability, model compatibility, image output, and rate limits depend on the configured provider.',
  'Computer Use requires the plugin to be enabled and operates through the isolated Windows UI Automation worker.',
  'Offline database compaction creates a verified candidate database but never switches the active database automatically.',
  'Crash evidence is local, scrubbed, bounded by retention, and is not uploaded automatically.',
] as const;

export const DEFAULT_RECOVERY_INSTRUCTIONS = [
  'Retry only failures marked retryable; authentication, permission, protocol, and acceptance failures require configuration or human action.',
  'If the Renderer closes, reopen the window; the independent Runtime may still hold the active task.',
  'If Runtime connectivity is lost, restart the desktop app and verify the named pipe, installation identity, and database readiness diagnostics.',
  'For updater failures, keep the current installed version, review updater recovery evidence, then retry check or download.',
  'For database recovery, preserve the source database and verified backup before any manual switch or rollback.',
] as const;

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(authorization|api[-_]?key|token|secret|password|cookie|credential|private[-_]?key|session)/i;
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi,
  /\b(?:api[-_]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
];

export interface DesktopCrashRecord {
  schemaVersion: 1;
  id: string;
  recordedAt: string;
  source: 'main' | 'renderer' | 'runtime' | 'worker' | 'updater';
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
}

export interface DesktopDiagnosticsBundle {
  schemaVersion: 1;
  generatedAt: string;
  exportId: string;
  privacy: {
    scrubbed: true;
    secretValuesIncluded: false;
    rawPromptsIncluded: false;
    rawMessageContentIncluded: false;
    retentionDays: number;
    crashRecordLimit: number;
  };
  application: Record<string, unknown>;
  runtime: Record<string, unknown> | null;
  updater: Record<string, unknown> | null;
  diagnostics: unknown[];
  crashReports: DesktopCrashRecord[];
  knownLimitations: readonly string[];
  recoveryInstructions: readonly string[];
}

export interface CreateDesktopDiagnosticsBundleInput {
  now?: Date;
  homeDirectory?: string;
  application: Record<string, unknown>;
  runtime?: Record<string, unknown> | null;
  updater?: Record<string, unknown> | null;
  diagnostics?: readonly unknown[];
  crashReports?: readonly DesktopCrashRecord[];
  knownLimitations?: readonly string[];
  recoveryInstructions?: readonly string[];
  crashRetentionDays?: number;
  crashRecordLimit?: number;
}

function scrubString(value: string, homeDirectory?: string): string {
  let output = value;
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, REDACTED);
  if (homeDirectory) {
    const normalizedHome = resolve(homeDirectory);
    output = output.replaceAll(normalizedHome, '%USERPROFILE%');
    output = output.replaceAll(normalizedHome.replaceAll('\\', '/'), '%USERPROFILE%');
  }
  return output.slice(0, 64_000);
}

export function scrubDiagnosticValue(
  value: unknown,
  options: { homeDirectory?: string; depth?: number; seen?: WeakSet<object> } = {},
): unknown {
  const depth = options.depth ?? 0;
  if (depth > 12) return '[TRUNCATED_DEPTH]';
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'string') return scrubString(value, options.homeDirectory);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: scrubString(value.name, options.homeDirectory),
      message: scrubString(value.message, options.homeDirectory),
      stack: value.stack ? scrubString(value.stack, options.homeDirectory) : undefined,
    };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `[BINARY ${value.byteLength} bytes]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((entry) =>
      scrubDiagnosticValue(entry, {
        homeDirectory: options.homeDirectory,
        depth: depth + 1,
        seen: options.seen,
      }),
    );
  }
  if (typeof value === 'object') {
    const seen = options.seen ?? new WeakSet<object>();
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 500)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? REDACTED
        : scrubDiagnosticValue(entry, {
            homeDirectory: options.homeDirectory,
            depth: depth + 1,
            seen,
          });
    }
    seen.delete(value);
    return output;
  }
  return scrubString(String(value), options.homeDirectory);
}

export function createDesktopDiagnosticsBundle(
  input: CreateDesktopDiagnosticsBundleInput,
): DesktopDiagnosticsBundle {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const crashRecordLimit = Math.min(Math.max(input.crashRecordLimit ?? DEFAULT_CRASH_RETENTION_COUNT, 1), 100);
  const crashRetentionDays = Math.min(Math.max(input.crashRetentionDays ?? DEFAULT_CRASH_RETENTION_DAYS, 1), 90);
  const scrub = (value: unknown) => scrubDiagnosticValue(value, { homeDirectory: input.homeDirectory });
  return {
    schemaVersion: DIAGNOSTICS_EXPORT_SCHEMA_VERSION,
    generatedAt,
    exportId: createHash('sha256')
      .update(`${generatedAt}:${randomUUID()}`)
      .digest('hex')
      .slice(0, 24),
    privacy: {
      scrubbed: true,
      secretValuesIncluded: false,
      rawPromptsIncluded: false,
      rawMessageContentIncluded: false,
      retentionDays: crashRetentionDays,
      crashRecordLimit,
    },
    application: (scrub(input.application) as Record<string, unknown>) ?? {},
    runtime: input.runtime ? (scrub(input.runtime) as Record<string, unknown>) : null,
    updater: input.updater ? (scrub(input.updater) as Record<string, unknown>) : null,
    diagnostics: (scrub(input.diagnostics ?? []) as unknown[]) ?? [],
    crashReports: ((scrub(input.crashReports ?? []) as DesktopCrashRecord[]) ?? []).slice(0, crashRecordLimit),
    knownLimitations: ((scrub(input.knownLimitations ?? []) as string[]) ?? []).slice(0, 100),
    recoveryInstructions: ((scrub(input.recoveryInstructions ?? []) as string[]) ?? []).slice(0, 100),
  };
}

export async function writeDesktopDiagnosticsBundle(
  targetPath: string,
  bundle: DesktopDiagnosticsBundle,
): Promise<void> {
  const absolute = resolve(targetPath);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = join(dirname(absolute), `.${basename(absolute)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export class DesktopCrashJournal {
  readonly root: string;
  readonly retentionDays: number;
  readonly maxRecords: number;
  private readonly now: () => Date;
  private readonly homeDirectory?: string;

  constructor(input: {
    root: string;
    retentionDays?: number;
    maxRecords?: number;
    now?: () => Date;
    homeDirectory?: string;
  }) {
    this.root = resolve(input.root);
    this.retentionDays = Math.min(Math.max(input.retentionDays ?? DEFAULT_CRASH_RETENTION_DAYS, 1), 90);
    this.maxRecords = Math.min(Math.max(input.maxRecords ?? DEFAULT_CRASH_RETENTION_COUNT, 1), 100);
    this.now = input.now ?? (() => new Date());
    this.homeDirectory = input.homeDirectory;
  }

  async append(input: Omit<DesktopCrashRecord, 'schemaVersion' | 'id' | 'recordedAt'>): Promise<DesktopCrashRecord> {
    const recordedAt = this.now().toISOString();
    const record = scrubDiagnosticValue(
      {
        schemaVersion: 1,
        id: randomUUID(),
        recordedAt,
        source: input.source,
        kind: String(input.kind || 'unknown').slice(0, 96),
        summary: String(input.summary || 'Desktop failure').slice(0, 2_000),
        detail: input.detail ?? {},
      },
      { homeDirectory: this.homeDirectory },
    ) as DesktopCrashRecord;
    const encoded = `${JSON.stringify(record, null, 2)}\n`;
    if (Buffer.byteLength(encoded) > MAX_CRASH_RECORD_BYTES) {
      record.detail = { truncated: true, reason: 'record-exceeded-byte-budget' };
    }
    await mkdir(this.root, { recursive: true });
    const safeStamp = recordedAt.replace(/[:.]/g, '-');
    const target = join(this.root, `${safeStamp}-${record.id}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
    await this.prune();
    return record;
  }

  async list(): Promise<DesktopCrashRecord[]> {
    await this.prune();
    let names: string[];
    try {
      names = (await readdir(this.root)).filter((name) => name.endsWith('.json')).sort().reverse();
    } catch {
      return [];
    }
    const records: DesktopCrashRecord[] = [];
    for (const name of names.slice(0, this.maxRecords)) {
      try {
        const raw = await readFile(join(this.root, name), 'utf8');
        const value = JSON.parse(raw) as DesktopCrashRecord;
        if (value.schemaVersion === 1 && typeof value.recordedAt === 'string') records.push(value);
      } catch {
        // Corrupt diagnostic evidence is ignored instead of entering an export.
      }
    }
    return records;
  }

  async prune(): Promise<void> {
    let names: string[];
    try {
      names = (await readdir(this.root)).filter((name) => name.endsWith('.json')).sort().reverse();
    } catch {
      return;
    }
    const cutoff = this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    await Promise.all(
      names.map(async (name, index) => {
        const target = join(this.root, name);
        try {
          const info = await stat(target);
          if (index >= this.maxRecords || info.mtimeMs < cutoff) await rm(target, { force: true });
        } catch {
          // Best-effort retention cleanup; capture must never break app startup.
        }
      }),
    );
  }
}
