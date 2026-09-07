# Context Map

This repo is a multi-context monorepo. Each package/app is its own context with its own `CONTEXT.md` (created lazily by `/domain-modeling` when terms or decisions get resolved). Root-level `docs/adr/` holds system-wide decisions; each package may hold its own `docs/adr/` for context-scoped decisions.

## Contexts

### Apps

- **`apps/website/`** — public product website, cloud account UI, and isolated embeddable demo
- **`apps/cloud/`** — self-hosted account service, SMTP lifecycle, and public website HTTP host

- **`apps/cli/`** — CLI entrypoints
- **`apps/desktop/`** — desktop application
- **`apps/mcp-server/`** — MCP server
- **`apps/runtime/`** — runtime layer

### Packages

- **`packages/adapters/`** — external integrations / adapters
- **`packages/core/`** — core domain logic
- **`packages/protocol/`** — protocol definitions
- **`packages/secure-store/`** — secure credential storage
- **`packages/shared/`** — shared utilities and types
- **`packages/storage/`** — persistence
- **`packages/test-fixtures/`** — test fixtures and helpers
- **`packages/ui-kit/`** — legacy UI component kit (styles removed 2026-08-18; only type-only imports remain)
- **`packages/workers/`** — background workers

## Rules

- Read the `CONTEXT.md` of every context you touch before working in it. If a context's `CONTEXT.md` doesn't exist yet, proceed silently — don't flag its absence; `/domain-modeling` creates it lazily when a term or decision actually gets resolved.
- Use the glossary vocabulary from each context's `CONTEXT.md` when naming domain concepts (issue titles, refactor proposals, test names, etc.).
- Surface ADR conflicts explicitly rather than silently overriding them.
