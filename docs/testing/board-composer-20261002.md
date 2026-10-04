# BoardUI-style attachment composer — 2026-10-02

## Scope

Independent implementation based on the official public Composer Attachments preview. No BoardUI Pro source or license-only assets were installed. Uses the existing CodeMirror editor, real attachment preparation, and existing run APIs; the reference's simulated upload queue was not copied.

- New chat, existing model chat and agent private chat now use the attachment-panel presentation: tiles above the text, controls inside the footer, separate microphone and send/stop actions.
- Group chat shares the rounded panel, footer treatment, compact intent controls and responsive spacing. Its existing text/@ protocol is unchanged; this change does not add group attachment upload support.
- Workspace/Git context remains outside the input surface. Permission, Skill, model/kernel selection, actual context occupancy, drafts and IME handling retain existing semantics.
- Narrow layouts fold permission/Skill controls into the existing + action sheet and simplify informational labels; action buttons remain visible. Group send stays right-aligned.

## Validation

- Desktop regression: 9 test files, 227/227 passed. Covers ShellApp, ChatView, collaboration composer, frame geometry, attachment tiles, editor, image processing, add menu, paired voice/send/stop and queued-send actions.
- Desktop typecheck and production build passed. Production CSS includes the attachment presentation via the root stylesheet import.
- Browser QA: 16/16 checks passed, 0 renderer page errors. Real renderer components were exercised with isolated, in-memory runtime fixtures; no real user conversations or backend jobs were modified.
- Verified: image-only send enablement, removing an image, typed workspace-file tile, permissions/model menu interaction, private-chat send/clear, group mention selection/send/clear, light/dark, 1440px desktop, 600px workbench and 390px group viewport.
- The offline fixture does not emit the authoritative active-run lifecycle. Stop and voice state transitions are verified by component tests, not claimed as a live-backend browser run.
- In-app browser blocked localhost; visual QA used a fresh headless Chrome session with no user login profile.

## Evidence

Local evidence directory: D:/projects/SYNC-THINK/.data/verify/composer-attachments-20261002.

- test-results-final.json: final regression report.
- visual-results.json: browser assertions and renderer errors.
- build-production-final.log: production build result.
- composer-dark-attachment.png: implemented attachment input.
- composer-dark-file.png: workspace-file tile.
- workbench-narrow-final.png and group-narrow-final.png: responsive verification.

## Rollout

The frontend production bundle has been rebuilt. Existing application windows may still hold the old loaded bundle; reload the frontend to view the change. The task runtime was not restarted or stopped.

## Follow-up: missing top backplate (2026-10-02)

The attachment-presentation override had erased the Git context background and border. The top line is now an opaque, inset, rounded backplate attached to the input surface. Desktop inset is 24px; narrow panes use 16px and wrap safely. Existing workspace, work-copy, branch and review controls retain their original behavior.

Visual inspection also exposed a legacy approval-card overlap that covered the header in an existing conversation. Attachment composers now separate approval/mode cards from the backplate. Plan/Goal mode cards precede the backplate so the latter stays directly above the input; default/pill layouts are unchanged.

Validation:
- 11 regression test files: 241/241 passed, including new header-menu and Plan/Goal ordering cases.
- 70/70 browser assertions passed for light/dark, new/existing chats, Plan/Goal, narrow panes, long branch names and 196-change fixture data. Hit-testing verifies header buttons are visible and not covered by approval cards.
- UI-kit build and desktop production build (including TypeScript compilation) passed. Checked that the production stylesheet includes both the backplate and overlap fix.
- Browser plugin is not listed in this session; isolated Playwright/Chrome QA used in-memory runtime fixtures. No production conversations, repository state or backend tasks were altered by the browser tests.

Evidence directory: D:/projects/SYNC-THINK/.data/verify/composer-context-backplate-20261002
Key files: after-dark-conversation.png, after-light-empty.png, after-dark-narrow.png, after-dark-plan.png, after-results.json, test-results-final.json, build-production.log.

The frontend has been rebuilt. Refresh an existing application window to load the updated bundle. The task runtime was not restarted.
