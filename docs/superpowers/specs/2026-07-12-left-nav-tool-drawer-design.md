# SYNC-THINK Left Navigation Tool Drawer Design

> Status: approved by the user from visual companion option C on 2026-07-12
> Scope: desktop left rail only; M1 remains open

## 1. Goal

Make the left rail read like a Codex-style task navigator instead of a stack of unrelated dashboards. Preserve the locked local-folder/task hierarchy while moving Provider, Agent, memory, and approval details into one temporary drawer.

## 2. Locked boundaries

- The product keeps the locked three-column IA: local folders/tasks on the left, conversation and Compose in the center, Run trace on the right.
- The task tree remains visible while a tool drawer is open.
- Provider, Agent, memory, and approval behavior and data contracts do not change.
- This is M1 soft craft. It does not claim external gateway hand-test or dogfood evidence and cannot close M1 or start M2.

## 3. Default left rail

The default rail contains, from top to bottom:

1. Brand header.
2. Task search.
3. The local workspace and nested task tree. This is the only flexible, scrolling region.
4. A fixed four-button icon toolbar for Providers, Agent/tools, memory/diagnostics, and approvals. Every button has an accessible name, tooltip, count badge when relevant, and visible selected state.
5. A compact fixed Runtime connection row.

Remove the large `本地 Runtime` section heading, the four text-card tabs, permanently mounted instrument panels below the task tree, and competing nested scroll regions.

## 4. Drawer behavior

- Clicking a tool button opens a fixed drawer from the right edge of the left rail.
- Drawer width is responsive between 336px and 420px and overlays the center column without changing the AppShell grid tracks.
- The task tree remains visible. A restrained backdrop covers the rest of the application while the drawer is open.
- Clicking the currently selected tool toggles the drawer closed.
- Clicking another tool replaces the drawer content in place; drawers never stack.
- The close icon, backdrop, and `Escape` close the drawer.
- Programmatic jumps to Providers, Agent, memory, approvals, or settings select the matching tool, open the drawer, then flash the requested content.
- Selecting a task continues to open the task normally; it also closes the temporary drawer so conversation regains focus.

## 5. Drawer anatomy

The drawer owns one scroll region:

- Fixed header: tool icon, localized title, optional badge, close icon.
- Scrolling body: the existing ProvidersPanel, AgentBindingPanel, MemoryDiagnosticsPanel, or ApprovalCenterPanel.
- Existing forms, errors, loading states, and actions remain functional.

The existing instrument components are visually flattened inside the drawer: no outer top border, no redundant page-level header card, and no additional drawer or modal layer introduced by this change.

## 6. Accessibility and motion

- Toolbar buttons expose `aria-label`, `aria-pressed`, `title`, and stable test IDs.
- Drawer uses `role="dialog"`, an accessible title, and `aria-modal="true"` while the backdrop prevents interaction with covered content.
- Close controls are keyboard reachable; `Escape` closes from any descendant control.
- Drawer transition uses transform/opacity only and is disabled under `prefers-reduced-motion`.
- Focus returns to the selected tool button after keyboard or close-button dismissal when practical; no focus trap is added in this scoped change.

## 7. Testing

- Pure state tests cover same-tool toggle, different-tool replacement, dismissal, invalid input fallback, badges, and jump mapping.
- WorkspaceNav component tests cover the optional hidden footer used by the product composition while preserving the default footer contract.
- Desktop source contract tests cover toolbar, drawer dialog, backdrop, close action, and Runtime row assembly.
- Desktop, UI Kit, root typecheck/build, M1 quick soft regression, and a real Electron screenshot at the current 1427x894 viewport must pass.

## 8. Non-goals

- No Provider protocol, credential, model discovery, Agent binding, memory, or approval logic changes.
- No right trace or center conversation redesign.
- No M2 collaboration or automatic mode work.
- No new persistent preference for drawer-open state; the drawer starts closed after launch.

