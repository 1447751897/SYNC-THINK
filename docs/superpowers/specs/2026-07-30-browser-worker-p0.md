# Browser Worker P0: System Browser Host, Runtime Execution, Permissions, and Handoff

Status: P0.1/P0.2 verified; P0.3 minimal persistent chat-Run permission loop implemented; P0.4/P0.5 pending
Date: 2026-07-30
User confirmation: "可以"

## 1. Goal

Replace the current Renderer `<webview>` command executor with a Runtime-owned Browser Worker that controls a visible system Edge/Chrome through Playwright CDP. The final feature must preserve login state, isolate tabs by task owner, survive UI loss, enforce website permissions in Runtime, support Team automation, and pause durably for human takeover.

The `<webview>` remains a preview/navigation surface. It is not an authority or automation boundary.

## 2. Architecture

```text
Agent or Team Step
  -> Sync-Think Runtime
  -> durable browser command + permission decision
  -> shared BrowserHost
  -> restricted BrowserWorker action
  -> playwright-core connectOverCDP
  -> visible system Edge/Chrome
  -> dedicated persistent Profile directory
```

Core ownership rules:

1. Runtime owns command identity, permission, status, retry, and recovery.
2. BrowserHost owns browser processes, CDP sessions, Profiles, Pages, and leases.
3. One active process exists per `profileId`.
4. One lease belongs to one conversation, Run, or Step owner and maps to one Page.
5. Commands on one lease execute serially. Commands on different leases may execute concurrently.
6. Renderer may display the current URL but does not run selectors or page JavaScript for the Worker.

## 3. P0.1 Browser Host Foundation

Scope:

- Discover an explicit executable override or an installed Edge/Chrome executable.
- Create a safe Profile directory below a configured Profile root.
- reserve a loopback CDP port and launch a visible external browser process;
- wait for the CDP endpoint and attach through `chromium.connectOverCDP`;
- reuse one browser process per active Profile;
- acquire, reuse, release, and close Page leases by exact owner;
- serialize commands per Page while preserving concurrency across Pages;
- expose `navigate`, `click`, `fill`, `read`, `wait`, and `screenshot`;
- enforce cancellation/start fence, bounded read output, URL-origin allowlist, popup/redirect origin blocking, safe Profile paths, and safe screenshot paths;
- shut down owned Playwright connections and browser processes explicitly.

P0.1 deliberately excludes SQLite state, chat tool routing, Team Steps, and UI handoff. Its interfaces must leave those additions possible without changing the process/Page ownership model.

## 4. P0.2 Runtime Chat Integration

1. Inject one shared BrowserHost/Worker service into Runtime.
2. Route `browser_open`, `browser_click`, `browser_type`, `browser_read`, and `browser_screenshot` through that service.
3. Stop publishing `browser.command_requested` on the real path.
4. Continue publishing the final navigated URL so the right-side `<webview>` can preview it.
5. Keep the old Renderer result command only as temporary migration compatibility.

## 5. P0.3 Persistence and Permissions

Persist before external execution:

- command ID and idempotency key;
- owner, Profile, lease, action, target origin, and sanitized arguments;
- requested/approved/running/completed/failed/waiting_user status;
- bounded result metadata, screenshot Artifact reference, and error classification.

Permission model:

- website grants are origin based, not substring based;
- grants may be scoped to user, Workspace, AgentVersion, workflow, or Run;
- the most restrictive applicable rule wins;
- navigation to a new origin requires a new decision;
- credential entry, payment, public publishing, external messaging, identity/policy changes, irreversible deletion, and sensitive export remain human-only;
- page content never grants itself more permission.

Restart recovery must not repeat a completed side effect. An unknown in-flight result pauses for inspection instead of blindly retrying.

## 6. P0.4 Team Automation

- Production Step tool schemas include the Browser Worker actions.
- Each Step uses the exact browser permissions frozen on its `AgentVersion` and Run snapshot.
- A Team may reuse a Profile for login continuity, but each active member/Step has its own Page lease.
- One member cannot address another member's lease.
- Artifact and trace metadata records the acting AgentVersion, owner, Profile, lease, origin, and command ID.

## 7. P0.5 Human Handoff

When automation reaches login, CAPTCHA, payment, device confirmation, or another policy/manual checkpoint:

1. persist the command and Run/Step as `waiting_user`;
2. keep the external browser and leased Page visible;
3. show Continue and Cancel controls with the site and requested outcome;
4. let the user operate the system browser directly;
5. Continue revalidates Page/Profile/lease ownership and resumes from a checkpoint;
6. Cancel closes or preserves the lease according to the explicit lifecycle choice;
7. no fixed 15-second Renderer timeout converts handoff into failure.

## 8. Result Contract

All actions return a bounded structured result containing at least:

```text
ok, message, profileId, leaseId, pageId, url, title
```

Action-specific fields:

- `read`: visible text plus bounded link/button/input summaries;
- `click` / `fill` / `wait`: matched state and resulting URL;
- `screenshot`: absolute path plus `sync-think-image://screenshot/<encoded-path>`;
- errors: stable code, failure class, and actionable message without page secrets.

## 9. Acceptance

P0.1 acceptance:

1. Browser discovery prefers an explicit valid executable, then Edge, then Chrome.
2. Invalid/traversing Profile IDs and screenshot paths are rejected before filesystem/process work.
3. Concurrent acquisition for one Profile creates one process/session.
4. The same owner/Profile reuses its lease; different owners receive different Pages.
5. Commands on one Page never overlap; two Pages can run concurrently.
6. Navigate/click/fill/read/wait/screenshot return bounded structured results.
7. A target origin outside the allowlist is rejected before side effects, including direct navigation, 3xx Location redirects, and `target=_blank` popup navigations.
8. Abort, timeout, start-fence rejection, Page crash, Browser disconnect, release, and shutdown produce deterministic outcomes.
9. Unit tests run without launching a real browser. A gated local Edge/Chrome smoke test verifies the actual CDP path.
10. `@sync-think/workers` tests, typecheck, and build pass.

Full P0 acceptance:

1. Chat browser tools execute without a mounted Renderer or open `<webview>`.
2. Restart restores command state and never repeats a known completed action.
3. Website and sensitive-action decisions are auditable and enforced in Runtime.
4. Team Steps use their own frozen permissions and Page leases.
5. Human takeover persists until Continue/Cancel and survives UI restart.
6. External browser login survives Sync-Think restart through its dedicated Profile.

## 10. Rollback

P0.1 can be rolled back by removing BrowserHost and `playwright-core`; dedicated Profile data remains isolated and may be deleted separately by an explicit user action. The existing `<webview>` executor and `conversation.submitBrowserResult` command remain as migration compatibility, but the real Runtime path no longer publishes `browser.command_requested`.

## 11. Implemented Verification (2026-07-30)

- P0.1 unit tests: Browser discovery, safe Profile/screenshot paths, one-session-per-Profile, owner lease reuse, release/acquire race, per-Page serialization, cross-Page concurrency, origin denial, release, action bounds, Host hard deadline, timeout/crash mapping, Worker fence/capability/symlink boundaries: Browser focused 15/15.
- P0.1 real smoke: installed system Edge, dedicated temporary Profile, loopback CDP, navigate/fill/click/wait/read/screenshot, shutdown cleanup, and denied-origin 3xx/popup pre-effect blocking: 2/2 with `SYNC_THINK_BROWSER_SMOKE=1`; denied local server request count stays 0.
- Workers package: 9 files passed, 67 tests passed, gated smoke skipped by default; typecheck, lint, and build passed.
- P0.2 controller/chat validation remains covered by Runtime focused/full tests. Runtime Browser tool-loop integration: Provider tool call -> durable scrubbed intent -> fake Host -> Provider tool result -> completion, with zero `browser.command_requested` events; Browser failures persist only fixed summaries, code, and failureClass.
- Runtime single-worker full regression: 56 files / 354 tests passed; Runtime typecheck, lint, and build passed.
- Root final gates: Turbo test 20/20 tasks, typecheck 20/20, lint 11/11, and build 11/11 all passed after the security fixes.
- `git diff --check` passed with exit code 0. Desktop migration compatibility still uses the previously verified browser bridge 13/13 + Desktop typecheck/build because this security patch did not modify Desktop paths.

## 12. P0.3 Minimal Persistent Permission Loop (2026-07-31)

- Migration `0030_browser_persistence_permissions` adds durable `browser_command` and `browser_origin_grant` state with exact scope/origin/action identity, bounded sanitized payloads, stable command states, expiry/revocation metadata, and append-safe identity guards.
- Runtime now evaluates persisted grants before Browser Worker execution and rechecks them inside `RuntimeBrowserController`. Missing grants use the existing Approval Center; allow/deny decisions are persisted at exact Run scope before any browser side effect.
- Navigate/read/screenshot grants may be reused within the exact Run/origin/action scope. Click/fill grants include a tool-call idempotency digest so one approval cannot authorize unlimited repeated sensitive actions.
- Completed commands replay their persisted result for the same idempotency key and input. Mismatched reuse is rejected. Commands left in `running` across restart become `browser.command-inspection-required` and are not blindly re-executed.
- Verification: Storage full 22 files / 248 tests; P0.3 migration/Artifact/Store focused 69/69; Runtime Browser Controller/tool loop 8/8; repository typecheck 20/20, lint 11/11, and build 11/11.
- Deliberate remaining boundary: P0.4 Team Step exact grants and member Page-lease isolation, plus P0.5 durable `waiting_user` human takeover, remain pending. The full Browser Worker roadmap item is not complete yet.
