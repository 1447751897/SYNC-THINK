import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/sqlite-core';

// SQLite only has TEXT/INTEGER/BLOB/REAL. We store branded IDs as plain TEXT
// and re-brand on the read path. The helper here is only for column convention.

export function idColumn(name: string) {
  return text(name).primaryKey();
}

// created_at / updated_at columns use ISO 8601 text for sortability and portability.
export function tsColumns() {
  return {
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  };
}
export const tsNowExpr = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
