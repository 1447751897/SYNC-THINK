import { describe, it, expect } from 'vitest';
// Import via the source tree so src/schema/index.ts is exercised directly
// (vitest resolves through vite; aliases the package root accordingly).
import * as schema from './schema/index.js';

function columnNames(table: unknown): string[] {
  if (!table || typeof table !== 'object') return [];
  const names = Object.keys(table as object).filter((k) => !k.startsWith('__'));
  return names;
}

// Smoke-test column definitions without needing better-sqlite3.
describe('schema columns', () => {
  it('workspace has expected columns', () => {
    const keys = columnNames(schema.workspace);
    expect(keys).toEqual(expect.arrayContaining(['id', 'folderPath', 'name']));
  });

  it('message has stableSequence + role + credentialRefId', () => {
    expect(columnNames(schema.message)).toEqual(
      expect.arrayContaining(['sequence', 'role', 'credentialRefId']),
    );
  });

  it('event has sequence for cursor-based subscriptions', () => {
    expect(columnNames(schema.event)).toContain('sequence');
  });

  it('task carries version for optimistic concurrency', () => {
    expect(columnNames(schema.task)).toContain('version');
  });

  it('credential_ref never exposes a plaintext column directly', () => {
    // The table object exposes logical column keys; a plaintext-column would
    // never appear on this list. Lists the snake_case names too via accessor.
    const cols = columnNames(schema.credentialRef);
    expect(cols).not.toContain('plaintext');
    expect(cols).not.toContain('secret');
    expect(cols).toContain('storeHandle');
    // Snake_case on the underlying column name objects (drizzle exposes .name).
    const snake: string[] = [];
    for (const k of cols) {
      const c = (schema.credentialRef as unknown as Record<string, unknown>)[k] as { name?: string } & object;
      if (c && typeof c === 'object' && typeof c.name === 'string') snake.push(c.name);
    }
    expect(snake).not.toContain('plaintext');
    expect(snake).not.toContain('secret');
    expect(snake).toContain('store_handle');
  });

  it('mcp_server carries tools + trust columns for §9.3', () => {
    const keys = columnNames(schema.mcpServer);
    expect(keys).toEqual(
      expect.arrayContaining(['id', 'name', 'transport', 'endpoint', 'toolsJson', 'trusted']),
    );
  });

  it('agent_version carries the complete immutable definition columns', () => {
    expect(columnNames(schema.agentVersion)).toEqual(
      expect.arrayContaining([
        'description',
        'visualIdentityJson',
        'mcpToolAllowlistJson',
        'permissionsJson',
        'reviewBehaviorJson',
        'artifactRulesJson',
      ]),
    );
  });
});

