import type { BetterSQLite3Raw } from './connection.js';
import { ulid } from '@sync-think/shared';
import type { McpServerId } from '@sync-think/shared';

export type McpTransport = 'local-stdio' | 'remote-http';

export interface McpToolSchemaRecord {
  name: string;
  description: string;
  /** Opaque JSON schema fragment; never executed. */
  inputSchemaJson?: string;
}

export interface McpServerRecord {
  id: McpServerId;
  name: string;
  transport: McpTransport;
  endpoint: string;
  tools: McpToolSchemaRecord[];
  trusted: boolean;
  enabled: boolean;
  maxOutputBytes: number;
  timeoutMs: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterMcpServerInput {
  name: string;
  transport?: McpTransport | string;
  endpoint?: string;
  tools?: readonly McpToolSchemaRecord[];
  trusted?: boolean;
  maxOutputBytes?: number;
  timeoutMs?: number;
  notes?: string;
  id?: McpServerId;
  now?: string;
}

interface McpServerRow {
  id: string;
  name: string;
  transport: string;
  endpoint: string;
  tools_json: string;
  trusted: number;
  enabled: number;
  max_output_bytes: number;
  timeout_ms: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

function parseTools(raw: string): McpToolSchemaRecord[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const out: McpToolSchemaRecord[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const name = typeof rec.name === 'string' ? rec.name.trim() : '';
      if (!name) continue;
      const description =
        typeof rec.description === 'string' ? rec.description.trim() : '';
      const inputSchemaJson =
        typeof rec.inputSchemaJson === 'string'
          ? rec.inputSchemaJson
          : rec.inputSchema !== undefined
            ? JSON.stringify(rec.inputSchema)
            : undefined;
      out.push({ name, description, inputSchemaJson });
    }
    return out;
  } catch {
    return [];
  }
}

function normalizeTransport(value: unknown): McpTransport {
  const t = String(value ?? '').trim().toLowerCase();
  if (t === 'remote-http' || t === 'http' || t === 'remote') return 'remote-http';
  return 'local-stdio';
}

function mapRow(row: McpServerRow): McpServerRecord {
  return {
    id: row.id as McpServerId,
    name: row.name,
    transport: normalizeTransport(row.transport),
    endpoint: row.endpoint ?? '',
    tools: parseTools(row.tools_json),
    trusted: row.trusted === 1,
    enabled: row.enabled === 1,
    maxOutputBytes: row.max_output_bytes || 65536,
    timeoutMs: row.timeout_ms || 15000,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function slugServerId(name: string): McpServerId {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return (`mcp-${slug || 'unnamed'}-${ulid().slice(-8).toLowerCase()}`) as McpServerId;
}

/**
 * SQLite-backed MCP server registry (§9.3).
 * Register is metadata-only: no process spawn, no network call, no tool execution.
 * Tool schemas are recorded for Context Packet injection when Agent allowlists the server.
 */
export class SqliteMcpStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  get(id: McpServerId | string): McpServerRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, name, transport, endpoint, tools_json, trusted,
                enabled, max_output_bytes, timeout_ms, notes, created_at, updated_at
         FROM mcp_server WHERE id = ?`,
      )
      .get(String(id)) as McpServerRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(limit = 100): McpServerRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT id, name, transport, endpoint, tools_json, trusted,
                enabled, max_output_bytes, timeout_ms, notes, created_at, updated_at
         FROM mcp_server
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(500, limit))) as McpServerRow[];
    return rows.map(mapRow);
  }

  listEnabled(limit = 100): McpServerRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT id, name, transport, endpoint, tools_json, trusted,
                enabled, max_output_bytes, timeout_ms, notes, created_at, updated_at
         FROM mcp_server
         WHERE enabled = 1
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(500, limit))) as McpServerRow[];
    return rows.map(mapRow);
  }

  setEnabled(
    mcpServerId: McpServerId | string,
    enabled: boolean,
    now = new Date().toISOString(),
  ): McpServerRecord | undefined {
    const id = String(mcpServerId ?? '').trim();
    if (!id || !this.get(id)) return undefined;
    this.raw
      .prepare(`UPDATE mcp_server SET enabled = ?, updated_at = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, now, id);
    return this.get(id);
  }

  /** Remove a registry row. Callers must ensure no authorization/binding references exist. */
  delete(mcpServerId: McpServerId | string): boolean {
    const id = String(mcpServerId ?? '').trim();
    if (!id) return false;
    return this.raw.prepare(`DELETE FROM mcp_server WHERE id = ?`).run(id).changes > 0;
  }

  /**
   * Register (or update tools of) an MCP server stub.
   * When the same name+endpoint exists, updates tools/trust metadata in place
   * (id stable) — register is not content-addressed like Skills.
   */
  register(input: RegisterMcpServerInput): McpServerRecord {
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('mcp server name must not be empty');
    const transport = normalizeTransport(input.transport);
    const endpoint = String(input.endpoint ?? '').trim();
    const tools = [...(input.tools ?? [])]
      .map((t) => ({
        name: String(t.name ?? '').trim(),
        description: String(t.description ?? '').trim(),
        inputSchemaJson: t.inputSchemaJson
          ? String(t.inputSchemaJson)
          : undefined,
      }))
      .filter((t) => t.name.length > 0);
    const trusted = Boolean(input.trusted);
    // Align with packages/workers mcp-policy clamps (§9.3).
    const maxOutputBytes = Math.min(
      Math.max(Number(input.maxOutputBytes) || 65536, 256),
      1_048_576,
    );
    const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 15000, 100), 120_000);
    const notes = String(input.notes ?? '').trim();
    const now = input.now ?? new Date().toISOString();

    // Prefer explicit id; else reuse same name+endpoint row; else mint.
    let id = (input.id as string | undefined)?.trim();
    if (!id) {
      const existing = this.raw
        .prepare(
          `SELECT id FROM mcp_server WHERE name = ? AND endpoint = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(name, endpoint) as { id: string } | undefined;
      id = existing?.id ?? (slugServerId(name) as string);
    }

    const current = this.get(id);
    if (current) {
      this.raw
        .prepare(
          `UPDATE mcp_server SET
             name = ?, transport = ?, endpoint = ?, tools_json = ?, trusted = ?,
             max_output_bytes = ?, timeout_ms = ?, notes = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          name,
          transport,
          endpoint,
          JSON.stringify(tools),
          trusted ? 1 : 0,
          maxOutputBytes,
          timeoutMs,
          notes,
          now,
          id,
        );
    } else {
      this.raw
        .prepare(
          `INSERT INTO mcp_server (
             id, name, transport, endpoint, tools_json, trusted,
             enabled, max_output_bytes, timeout_ms, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          name,
          transport,
          endpoint,
          JSON.stringify(tools),
          trusted ? 1 : 0,
          maxOutputBytes,
          timeoutMs,
          notes,
          now,
          now,
        );
    }

    const created = this.get(id);
    if (!created) throw new Error('Failed to register mcp server');
    return created;
  }
}
