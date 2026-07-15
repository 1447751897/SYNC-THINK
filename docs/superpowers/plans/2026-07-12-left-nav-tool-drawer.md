# Left Navigation Tool Drawer Implementation Plan

> **Status: completed in soft craft #64 (2026-07-12).** All Tasks 1-5 implemented and verified. M1 remains open (external hand-test + dogfood are user hard gates, not this plan).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded left-column instrument stack with a Codex-style persistent task navigator and one temporary overlay drawer.

**Architecture:** Keep `WorkspaceNav` responsible for folder/task navigation and make its footer optionally hidden in the desktop product composition. Extend the existing pure left-instrument projector with drawer state transitions, then assemble the toolbar, Runtime row, backdrop, and one dialog drawer in `index.tsx`; existing instrument panels remain the drawer bodies.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Lucide React, CSS, Electron 33

---

### Task 1: Pure drawer state

**Files:**
- Modify: `apps/desktop/src/renderer/left-instrument-switch.ts`
- Modify: `apps/desktop/tests/left-instrument-switch.test.ts`

- [x] **Step 1: Write the failing transition tests**

Add assertions equivalent to:

```ts
expect(resolveLeftInstrumentDrawer({ active: 'providers', open: false }, 'providers'))
  .toEqual({ active: 'providers', open: true });
expect(resolveLeftInstrumentDrawer({ active: 'providers', open: true }, 'providers'))
  .toEqual({ active: 'providers', open: false });
expect(resolveLeftInstrumentDrawer({ active: 'providers', open: true }, 'agent'))
  .toEqual({ active: 'agent', open: true });
expect(closeLeftInstrumentDrawer('agent')).toEqual({ active: 'agent', open: false });
```

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @sync-think/desktop test -- left-instrument-switch.test.ts`

Expected: FAIL because the transition helpers are not exported.

- [x] **Step 3: Implement minimal pure transitions**

Add `LeftInstrumentDrawerState`, `resolveLeftInstrumentDrawer`, and `closeLeftInstrumentDrawer`. Update the projector summary to describe a temporary drawer and increment its soft craft round without changing `claimsM1Closed: false`.

- [x] **Step 4: Verify GREEN**

Run the same focused test and expect all left-instrument tests to pass.

### Task 2: Workspace footer composition

**Files:**
- Modify: `packages/ui-kit/src/components/WorkspaceNav.tsx`
- Modify: `packages/ui-kit/tests/WorkspaceNav.test.tsx`

- [x] **Step 1: Write the failing footer-visibility test**

Render `<WorkspaceNav hideFooter ... />` and assert `queryByTestId('workspace-nav-footer')` is null while the default render still contains it.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @sync-think/ui-kit test -- WorkspaceNav.test.tsx`

Expected: FAIL because `hideFooter` is not part of `WorkspaceNavProps`.

- [x] **Step 3: Implement `hideFooter?: boolean`**

Wrap the current footer with `props.hideFooter ? null : (...)`. Do not change the default footer copy or tests.

- [x] **Step 4: Verify GREEN**

Run the same focused UI Kit test and expect all WorkspaceNav tests to pass.

### Task 3: Desktop drawer assembly

**Files:**
- Modify: `apps/desktop/src/renderer/index.tsx`
- Create: `apps/desktop/tests/left-tool-drawer-layout.test.ts`

- [x] **Step 1: Add a failing source-contract test**

Read `index.tsx` and assert it contains stable contracts for:

```ts
data-testid="left-tool-drawer"
data-testid="left-tool-drawer-backdrop"
data-testid="left-runtime-status"
role="dialog"
aria-modal="true"
```

Also assert the old `st-demo-nav-stack__switch-head` markup is absent.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @sync-think/desktop test -- left-tool-drawer-layout.test.ts`

Expected: FAIL because the drawer contracts are absent.

- [x] **Step 3: Assemble state and interactions**

Add `leftDrawerOpen`, toolbar button refs, `Escape` dismissal, same-button toggle, programmatic jump-open behavior, task-selection dismissal, backdrop dismissal, and close-button dismissal. Add Lucide icons for each tool and the close control. Render exactly one active instrument body inside the dialog drawer.

- [x] **Step 4: Verify GREEN**

Run the focused desktop test and the existing `left-instrument-switch.test.ts`.

### Task 4: Codex-style left rail CSS

**Files:**
- Modify: `apps/desktop/src/renderer/renderer.css`
- Modify: `packages/ui-kit/src/styles/components.css`

- [x] **Step 1: Replace the old split-stack styles**

Make `.st-demo-nav-stack__workspaces` the only flexible region, convert the switch into a fixed icon toolbar, add fixed drawer/backdrop/header/body styles, and add the compact Runtime row. Remove card-tab label/short layout and permanent instrument flex sizing.

- [x] **Step 2: Constrain ownership of scrolling**

Set `.st-app-shell__nav` to `overflow: hidden`; retain internal WorkspaceNav tree scrolling and drawer-body scrolling. Ensure the drawer width uses `clamp(336px, 28vw, 420px)` and does not resize AppShell grid columns.

- [x] **Step 3: Add interaction and accessibility states**

Style hover, focus-visible, pressed, badge, backdrop, close button, and reduced-motion behavior. Keep radius at 8px or less and use existing color tokens.

### Task 5: Verification and project records

**Files:**
- Modify: `docs/product/15-frontend-design.md`
- Modify: `docs/development/03-feature-changelog.md`
- Modify: `docs/development/10-current-status.md`
- Modify: `docs/development/11-implementation-plan.md`
- Modify: `docs/development/12-test-log.md`
- Modify: `docs/development/13-plain-selftest-log.md`

- [x] **Step 1: Run focused verification**

Run desktop left-switch/drawer tests and UI Kit WorkspaceNav tests, then desktop typecheck/build.

- [x] **Step 2: Run root verification**

Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm selftest:m1-soft:quick`. Expected: all commands exit 0 and quick soft explicitly keeps `claimsM1Closed=false`.

- [x] **Step 3: Verify the real Electron surface**

Restart the desktop process against the current Runtime. At 1427x894 verify default closed drawer, each tool replacement, backdrop/close/Escape dismissal, one task-tree scrollbar, no content overlap bug, and Runtime/Provider/task recovery. Capture screenshots for closed and open states.

- [x] **Step 4: Update records without closing M1**

Record the change as the next soft craft round. Keep external gateway UI hand-test at 0/18, dogfood at 0/3 real days, M1 open, and M2 not started.

## Self-review

- Spec coverage: all default-rail, drawer, close, jump, scrolling, accessibility, and M1-boundary requirements map to Tasks 1-5.
- Placeholder scan: no TBD, TODO, deferred implementation, or unnamed test remains.
- Type consistency: `LeftInstrumentDrawerState`, `resolveLeftInstrumentDrawer`, `closeLeftInstrumentDrawer`, `hideFooter`, and all test IDs use one spelling throughout.
- Repository constraint: this workspace is not initialized as Git, so execution must not create commits or initialize Git.

