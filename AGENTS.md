# AGENTS.md

This file provides guidance to Codex (and NewMax) when working in this repository.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout: root `CONTEXT-MAP.md` points to per-package `CONTEXT.md` files; system-wide decisions live in `docs/adr/`, context-scoped decisions in each package's `docs/adr/`. See `docs/agents/domain.md`.

### Desktop releases and updates

- When preparing a release, use `docs/releases/CHANGELOG.md` as the single source of user-facing notes; keep its newest entry, root `package.json`, and `apps/desktop/package.json` versions aligned.
- Remember the existing in-app update workflow: with a configured feed and automatic checks enabled (default), startup checks for updates; users can also check, download, and confirm restart/install in Settings → About. Automatic checks do not mean automatic downloads or restarts. Verify behavior in `apps/desktop/src/main/desktop-update-preferences.ts`, `index.ts`, and `electron-updater-driver.ts` before changing this guidance.
- When asked about update availability, query the configured feed rather than assuming a cached version is current. Distinguish locally prepared notes/builds from a published update. Do not publish a release or restart/install the running app merely because release notes were requested.
