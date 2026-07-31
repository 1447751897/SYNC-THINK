# NewMax P2: Default Agent Skills, Per-turn Overrides, and Lazy Context Loading

Status: implemented and verified
Date: 2026-07-29
User confirmation: "可以，按照你说的来" / "继续后续任务开发" / "小队里面智能体他们要自动化工作的时候，不是还得一个一个去配置，很奇怪"

## 1. Goal

Make Agent configuration the single place where Skills are normally equipped, while retaining a lightweight per-message override:

1. The Composer exposes only the exact Skill versions equipped by the current Agent.
2. Agent and Team conversations start with the effective Agent's equipped Skills enabled; the user does not reselect them on every message.
3. The Composer can temporarily remove or restore allowlisted Skills for the current conversation without changing Agent configuration.
4. Every automated Step loads the Skills of its own exact AgentVersion; Team members never borrow the coordinator's or another member's Skills.
5. Runtime validation, Context Packet, Provider prompt, Manifest, fallback, and recovery all use the same frozen Skill-version snapshot.
6. Skill scripts remain declarations only; selecting or inheriting a Skill never executes a script or expands tool/MCP permissions.

## 2. Run-bound Contract

`task.appendMessage` is the command that starts the model Run, so `AppendMessagePayload` gains:

```text
skillVersionIds?: string[]
```

Semantics:

- `undefined`: compatibility path for older clients; use the bound Agent's full allowlist.
- `[]`: the caller explicitly selected no Skill for this turn.
- non-empty array: use only these exact immutable SkillVersion IDs.
- IDs are trimmed, deduplicated in first-seen order, and limited to 8 unique versions.
- Runtime rejects a selected version that is not in the effective Agent allowlist, is missing/archived, or lacks permission approval.
- Renderer checks improve UX but are not the authority boundary.
- New Desktop clients initialize the explicit array from the effective Agent allowlist. They do not rely on omission to create the default UX.

## 3. Composer Behavior

- Agent conversations show the bound Agent's equipped Skill versions.
- Team conversations use the coordinator Agent, or the first member when no coordinator is configured.
- Model conversations have no selectable Agent allowlist; the Skill control is disabled with an actionable tooltip and the turn sends `[]`.
- The catalog summary is requested only when the Skill menu opens. Full `SKILL.md` bodies are not fetched by the Renderer.
- Agent/Team drafts initialize to all equipped versions, up to the existing limit of 8. Model drafts initialize to `[]`.
- A successful or failed append keeps the current selection. Sending a message must not make the user reconfigure the next message.
- Switching to another Agent or Team resets the selection to that new effective owner's equipped versions. Switching to model resets it to `[]`.
- Changing only the model override does not clear Agent Skill selection because the effective Skill owner did not change.
- The first successful welcome-page send carries its current override into the newly opened conversation instead of immediately replacing it with a fresh default.
- The trigger shows an active state and selected count without changing the Compose row height.

## 4. Context and Persistence Invariants

- Runtime loads full Skill records only for the resolved per-turn selection and only by exact SkillVersion ID.
- The bounded Skill text represented by a `skill-definition` source is exactly the text injected into the Provider system prompt.
- A Skill excluded or truncated by Context selection cannot still enter the Provider prompt through a second path.
- `ContextManifest.skillVersionIds` and `context.packet.built.skillVersionIds` contain the exact versions actually included in the Provider request.
- The Run freezes those exact IDs at start. Fallback, rebind, retry, checkpoint recovery, and Runtime restart never re-read a later mutable Agent allowlist for that Run.
- Durable Run events/checkpoints store IDs and integrity metadata, not duplicate Skill bodies. Recovery reloads the immutable version from the Skill store when needed.
- No selection path invokes a Skill script or widens tool/MCP permission.

## 5. Automated Team Execution

- A planned Step already freezes an exact `agentVersionId`; that version's `skillVersionIds` are the only Skill candidates for the Step.
- Before any Provider call, Runtime verifies every configured version exists, is not archived, and has valid permission approval.
- Runtime resolves bounded Skill bodies with the same Skill source resolver used by conversation context and appends them to that Step's system prompt.
- Different Team members may therefore receive different Skill prompt blocks in the same Run. The coordinator is relevant only to the Team Composer default, not to member Step execution.
- Provider fallback for the Step keeps the same resolved Skill snapshot. Artifact metadata records the exact `skillVersionIds` actually supplied.
- Missing, archived, or unapproved configured Skills fail the Step before a Provider request is made.

## 6. Deliberate Boundary

This slice does not add project/task temporary Skill attachments, automatic Skill recommendation, script execution, MCP selection, or a Skill marketplace. Agent equipment remains managed in the Agent Library; the Composer only temporarily adjusts that allowlist and never expands it.

## 7. Acceptance

1. Protocol/Main/Runtime accept `undefined`, `[]`, and deduplicated selected IDs, and reject more than 8 unique IDs or malformed entries.
2. Runtime rejects unallowlisted, missing, archived, and unapproved selected versions before persisting a user message or starting a Run.
3. With Agent Skills A/B equipped and only B selected, only B appears in Provider system instructions, Context sources, Manifest IDs, and the frozen Run snapshot.
4. With `[]`, no `skill-definition` source or Skill prompt block is produced.
5. The compatibility `undefined` path still uses the Agent allowlist.
6. A fallback/rebind and a serialized/recovered Run retain the original exact Skill IDs even after the Agent binding changes.
7. Durable Run payloads/checkpoints do not contain the selected Skill body or full `SKILL.md` source.
8. Agent/Team Composer starts with the effective owner's configured versions selected, keeps the selection after success or failure, resets to a new owner's defaults on identity changes, and disables selection for model conversations.
9. A welcome-page override survives the transition into its newly created conversation.
10. Two automated Steps bound to different AgentVersions receive only their own configured Skill bodies and record their own Skill IDs in artifact metadata.
11. Missing, archived, or unapproved automated-Step Skills result in zero Provider calls.
12. Focused tests, full test/typecheck/lint/build gates, and light/dark Electron QA pass.

## 8. Verification

- Original per-turn implementation baseline: Desktop 4 files / 43 tests; Protocol 3/3; Core 3/3; Storage 7/7; Runtime 2/2; full repository test/typecheck/lint/build and light/dark Electron QA passed.
- Default-inheritance focused verification: Desktop 4 files / 47 tests, including Agent and Team welcome drafts across model changes; Desktop full 97 files / 692 tests; Runtime automated-Step/frozen-selection focused 27/27; Runtime single-worker full 54 files / 348 tests.
- Repository gates: root test task summary 20/20; forced typecheck 20/20, lint 11/11, and build 11/11 with zero cache; `git diff --check` passed. One first-pass high-load lease-clock expiry reproduced as a resource race, then passed in isolation 8/8 and in the strict single-worker Runtime suite 348/348 without weakening the assertion.
- Final read-only review found no P0/P1/P2 issue. Latest Electron QA passed at light 1440x900 and dark 1280x720: Agent/Team default selection, Team model switching, model-direct disablement, exact version metadata, menu copy, viewport/element overflow, alerts, console/page/runtime errors, and cleanup all passed.
