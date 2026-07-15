import { describe, expect, it } from 'vitest';
import {
  checkMcpTimeout,
  enforceMcpOutputLimit,
  formatMcpPolicyLabel,
  normalizeMcpProcessPolicy,
  previewMcpOutput,
  DEFAULT_MCP_MAX_OUTPUT_BYTES,
  DEFAULT_MCP_TIMEOUT_MS,
} from './mcp-policy.js';
import { FakeMcpWorker } from './mcp-worker.js';
import { collect } from '../support.js';

describe('normalizeMcpProcessPolicy', () => {
  it('applies design defaults', () => {
    const p = normalizeMcpProcessPolicy({});
    expect(p.maxOutputBytes).toBe(DEFAULT_MCP_MAX_OUTPUT_BYTES);
    expect(p.timeoutMs).toBe(DEFAULT_MCP_TIMEOUT_MS);
    expect(p.trusted).toBe(false);
  });

  it('clamps absurd limits', () => {
    const p = normalizeMcpProcessPolicy({ maxOutputBytes: 99_999_999, timeoutMs: 1, trusted: true });
    expect(p.maxOutputBytes).toBe(1_048_576);
    expect(p.timeoutMs).toBe(100);
    expect(p.trusted).toBe(true);
  });
});

describe('enforceMcpOutputLimit', () => {
  it('marks untrusted by default and truncates oversize output', () => {
    const raw = 'x'.repeat(2000);
    const result = enforceMcpOutputLimit(
      raw,
      { maxOutputBytes: 500, timeoutMs: 5000, trusted: false },
      {
        mcpServerId: 'mcp-1',
        toolName: 'read_file',
        now: '2026-07-12T08:00:00.000Z',
      },
    );
    expect(result.truncated).toBe(true);
    expect(result.rawBytes).toBe(2000);
    expect(result.keptBytes).toBeLessThanOrEqual(500);
    expect(result.contentTrust).toBe('untrusted');
    expect(result.audit.truncated).toBe(true);
    expect(result.audit.note).toMatch(/untrusted/);
    expect(result.audit.mcpServerId).toBe('mcp-1');
  });

  it('keeps full output under the cap and can mark trusted', () => {
    const result = enforceMcpOutputLimit('hello', {
      maxOutputBytes: 1000,
      timeoutMs: 1000,
      trusted: true,
    });
    expect(result.truncated).toBe(false);
    expect(result.keptBytes).toBe(5);
    expect(result.contentTrust).toBe('trusted');
    expect(result.text).toBe('hello');
  });

  it('does not split multi-byte UTF-8 sequences', () => {
    // euro sign is 3 bytes in UTF-8; 200 chars = 600B, cap 256 => truncate on char boundary
    const raw = '\u20ac'.repeat(200);
    const result = enforceMcpOutputLimit(raw, {
      maxOutputBytes: 256,
      timeoutMs: 1000,
      trusted: false,
    });
    expect(result.truncated).toBe(true);
    expect(result.keptBytes).toBeLessThanOrEqual(256);
    expect(result.keptBytes % 3).toBe(0);
    expect(result.text.includes('\uFFFD')).toBe(false);
  });
});

describe('checkMcpTimeout', () => {
  it('flags elapsed beyond timeout', () => {
    expect(checkMcpTimeout(16000, 15000).timedOut).toBe(true);
    expect(checkMcpTimeout(100, 15000).timedOut).toBe(false);
  });
});

describe('preview + label', () => {
  it('scrubs secret-like previews', () => {
    expect(previewMcpOutput('key=sk-abcdefghijklmnopqrstuvwxyz')).toMatch(/redacted/);
  });
  it('formats policy label', () => {
    expect(
      formatMcpPolicyLabel({ maxOutputBytes: 65536, timeoutMs: 15000, trusted: false }),
    ).toBe('15s · 64KB · untrusted');
  });
});

describe('FakeMcpWorker', () => {
  const token = { token: 't', allowedRoot: 'D:/proj', timeoutMs: 30_000 };

  it('completes probe with untrusted audit and no spawn', async () => {
    const w = new FakeMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: 'D:/proj',
          action: { kind: 'probe-policy', toolName: 'echo', simulatedOutput: 'ok-body' },
          policy: { maxOutputBytes: 1000, timeoutMs: 5000, trusted: false },
          mcpServerId: 'mcp-demo',
          transport: 'local-stdio',
          now: '2026-07-12T08:01:00.000Z',
        },
        token,
      ),
    );
    expect(events.some((e) => e.type === 'stdout' && e.text === 'ok-body')).toBe(true);
    const completed = events.find((e) => e.type === 'completed');
    expect(completed).toBeTruthy();
    if (completed?.type === 'completed') {
      const out = completed.output as unknown as {
        ok: boolean;
        contentTrust: string;
        truncated: boolean;
        timedOut: boolean;
        audit: { note: string };
      };
      expect(out.ok).toBe(true);
      expect(out.contentTrust).toBe('untrusted');
      expect(out.truncated).toBe(false);
      expect(out.timedOut).toBe(false);
      expect(out.audit.note).toMatch(/untrusted/);
    }
  });

  it('fails on simulated timeout', async () => {
    const w = new FakeMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: 'D:/proj',
          action: {
            kind: 'call-tool',
            toolName: 'slow',
            simulatedOutput: 'late',
            simulatedElapsedMs: 20_000,
          },
          policy: { maxOutputBytes: 1000, timeoutMs: 1000, trusted: false },
        },
        token,
      ),
    );
    const failed = events.find((e) => e.type === 'failed');
    expect(failed).toMatchObject({ type: 'failed', failureClass: 'timeout' });
  });

  it('truncates oversized simulated output', async () => {
    const w = new FakeMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: 'D:/proj',
          action: {
            kind: 'probe-policy',
            simulatedOutput: 'Z'.repeat(5000),
          },
          policy: { maxOutputBytes: 300, timeoutMs: 5000, trusted: true },
        },
        token,
      ),
    );
    const completed = events.find((e) => e.type === 'completed');
    expect(completed?.type).toBe('completed');
    if (completed?.type === 'completed') {
      const out = completed.output as unknown as {
        truncated: boolean;
        keptBytes: number;
        contentTrust: string;
      };
      expect(out.truncated).toBe(true);
      expect(out.keptBytes).toBeLessThanOrEqual(300);
      expect(out.contentTrust).toBe('trusted');
    }
  });
});
