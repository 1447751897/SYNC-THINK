import type { Config } from 'drizzle-kit';

// Used by `pnpm db:generate` to materialize SQL migrations from the schema.
// Generated SQL is checked into src/migrations/ for review before apply.

export default {
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: ':memory:' },
} satisfies Config;
