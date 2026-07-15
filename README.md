# SYNC-THINK

Local-first, user-controlled multi-model Agent desktop workspace.

## Status

Phase 0 / M0 foundations. See:

- `docs/superpowers/specs/2026-07-11-sync-think-product-design.md`
- `docs/development/11-implementation-plan.md`
- `docs/development/10-current-status.md`

## Requirements

- Node.js >= 20
- pnpm 11+

## Setup

```bash
pnpm install
pnpm test
pnpm typecheck
```

## Dev

```bash
# Terminal 1 — Agent Runtime (named pipe server)
pnpm dev:runtime

# Terminal 2 — Desktop shell (when ready)
pnpm dev:desktop
```

## Principles

1. Context continuity first
2. User-controlled model routing
3. UI restart must not kill Runtime
4. No plaintext secrets in DB/logs
