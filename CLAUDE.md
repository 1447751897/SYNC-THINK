# CLAUDE.md

This file provides guidance to Claude Code (and NewMax) when working in this repository.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout: root `CONTEXT-MAP.md` points to per-package `CONTEXT.md` files; system-wide decisions live in `docs/adr/`, context-scoped decisions in each package's `docs/adr/`. See `docs/agents/domain.md`.
