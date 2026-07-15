import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';

// McpServer — connection + trust configuration (§9.3 / §11 McpServer).
// Registering a server does not grant every Agent access; Agents use mcpServerIds allowlist.
// Tool schemas are stored as JSON metadata for Context Packet tool-schema injection.
// Process spawn / remote call is NOT performed at register time (M1 soft craft stub).
export const mcpServer = sqliteTable(
  'mcp_server',
  {
    id: idColumn('id'),
    name: text('name').notNull(),
    /** local-stdio | remote-http (stub transport; no real process spawn required). */
    transport: text('transport').notNull().default('local-stdio'),
    /** Command or URL descriptor for the server (never executed on register). */
    endpoint: text('endpoint').notNull().default(''),
    /** JSON array of tool schema stubs: { name, description?, inputSchema? }[] */
    toolsJson: text('tools_json').notNull().default('[]'),
    /** Explicit trust flag recorded for audit; default untrusted. */
    trusted: integer('trusted', { mode: 'boolean' }).notNull().default(false),
    /** Size/timeout policy stubs (documented; not enforced on real spawn yet). */
    maxOutputBytes: integer('max_output_bytes').notNull().default(65536),
    timeoutMs: integer('timeout_ms').notNull().default(15000),
    notes: text('notes').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    byName: index('mcp_server_name_idx').on(t.name),
  }),
);
export type McpServerRow = typeof mcpServer.$inferSelect;
