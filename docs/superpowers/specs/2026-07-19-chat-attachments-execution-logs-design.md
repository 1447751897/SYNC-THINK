# Chat Attachments And Execution Logs Design

Date: 2026-07-19
Status: Approved by user

## 1. Goal

Extend the Figma Talk conversation surface without changing its direct/group message model:

1. users can send images, supported files, and folders to the selected Agent;
2. execution details show the real model/tool/command/file activity caused by one user turn.

## 2. Attachment Contract

- Entry points: paperclip picker, drag/drop, and clipboard paste.
- Limits: at most 10 attachments; images at most 20 MB each; other files at most 50 MB each.
- Supported files: images, PDF, Word, Excel, text/code, and ZIP.
- Standalone files become hash-addressed immutable snapshots in Desktop-managed storage.
- Runtime IPC and durable events carry metadata and managed references only. They never carry base64 or raw file bytes.
- Image bytes are loaded immediately before a Provider call and translated to the exact OpenAI Chat, OpenAI Responses, or Anthropic multimodal request format.
- A model without confirmed `vision` capability cannot send an image turn; Composer asks the user to switch models.
- OCR is not automatic. Non-image document extraction remains bounded to supported text/code excerpts.
- A selected folder defaults to one-turn read-only context. The user may explicitly bind it to the current project for continuing workspace access.
- Image attachments from the same task remain available in later turns: the latest six image references are retained at their original user-message positions and reloaded from immutable snapshots before each Provider call. Folder references remain one-turn only.
- Agent output creates persisted artifacts/new versions and never overwrites an imported source snapshot.

## 3. Composer Contract

- Attachments appear above the text area with stable dimensions, type/size, preview where available, and remove action.
- Folder chips state `本轮只读` and expose `绑定项目` when a project task is active.
- Attachment-only send is valid and receives a neutral persisted message caption.
- Import errors remain inside Composer and preserve the draft and already staged attachments.
- Direct chat and group chat use the same attachment interaction. Group routing remains lead-by-default and exact `@member` when mentioned.

## 4. Execution Log Contract

- One persisted user message starts one log turn.
- Stages use only the exact AgentVersion, model, Run, and Step recorded by Runtime.
- Model starts, retries, fallback selections, usage, and terminal events remain visible.
- Tool requests and completions are paired by call id.
- Commands show the recorded command, arguments, cwd, duration, exit code, stdout, and stderr.
- File operations show the recorded action, path, bytes/content excerpt, result, and errors.
- Production orchestration tool traces are projected into durable tool events after the Step completes.
- Long technical output is collapsed by default and scrolls inside the turn modal.
- Renderer sanitization and projector-level redaction remove credentials, bearer values, cookies, and known secret patterns.
- Provider reasoning summaries are shown only when explicitly returned and persisted. The product never invents or exposes hidden chain of thought.

## 5. Artifact Presentation Contract

- `文件与产物` is a user-facing deliverable directory, not an orchestration database browser.
- Internal records such as skipped members, tool traces, delegation decisions, review control output, and ordinary Step replies stay in execution logs and persistence but do not appear in the directory.
- A group lead's final summary appears as `最终结果`; explicitly named files and selected, merged, conflicted, or review-approved deliverables remain visible.
- A one-version deliverable opens on readable content. Hashes, opaque Step IDs, parent IDs, left/right selectors, compare, and merge controls are omitted until multiple versions make them useful.
- Dragging files over Composer must show a visible drop target. Image previews remain above the draft and automatically expand the Composer without removing manual resize support.

## 6. Acceptance Criteria

1. Picker, drag/drop, and clipboard image paste all create removable previews.
2. A sent attachment survives Desktop restart as event metadata and remains named in the conversation.
3. Image bytes are absent from `task.appendMessage`, event payloads, and Runtime checkpoints.
4. Vision-capable models receive native multimodal content for all three supported protocols.
5. Text/code excerpts and bounded folder listings enter only the current turn context.
6. A non-vision model cannot send an image turn and receives an actionable model-switch prompt.
7. Execution details show real command/file/tool facts grouped under the Agent that ran them.
8. Secrets are redacted and arbitrary event payload fields are not rendered.
9. Existing direct/group routing, streaming, project binding, artifacts, provider fallback, and conversation layout do not regress.
10. Pasted and dropped images remain visible in an expanded Composer before send.
11. Internal orchestration artifacts do not appear in `文件与产物`, while the same facts remain inspectable in execution logs.
12. Opening a one-version deliverable shows its content without exposing implementation IDs or version-comparison controls.
13. A later message in the same task can refer to a prior image without re-uploading it; changed snapshots fail with a visible attachment-integrity error.
14. Switching between tasks preserves each task's unsent text and staged attachment snapshot; sending clears only that task's draft.
15. Persisted image attachments reload through a Desktop-managed, path-validated preview bridge and render as clickable thumbnails with an accessible zoom viewer.
16. Explicit child tasks are visible in the parent task's progress rail; parent and child tasks provide direct navigation to each other.

## 7. Automatic Child Task Contract

- `@Agent` routes one immediate turn inside the current conversation and never creates a child task by itself.
- `sync_think.subtask.delegate` creates one first-level child task, pins the exact AgentVersion, inherits the parent task policy and project binding, and starts automatically.
- Delegations without dependencies run in parallel up to each Agent's `maxConcurrency`; `dependsOnTaskIds` creates a durable serial dependency.
- A child task cannot delegate another child task in this phase.
- A failed child Run is retried up to five times after the initial attempt. Exhaustion pauses the child and reports failure to the parent.
- A child whose prerequisite reaches `subtask.failed` does not wait forever: it terminates as failed without execution and reports the failed dependency to the parent.
- Child completion records a structured handoff, marks the child complete, and wakes the parent lead once all children in the same delegation batch reach terminal state.
- The parent receives concise Agent-attributed handoff messages; full logs and artifacts remain in the child task.
- `messageAgentVersionId` controls only the handoff message avatar. It must never replace the parent task's primary Agent identity.

## 8. Child Task Acceptance Criteria

17. Independent children start concurrently up to the assigned Agent's `maxConcurrency`.
18. A child with `dependsOnTaskIds` starts only after every prerequisite completes.
19. A failed prerequisite terminates its dependents and still allows the parent batch to finish.
20. The initial child attempt may be followed by at most five automatic retries.
21. Exactly one `subtask.parent-resumed` event is emitted after one delegation batch reaches terminal state.
22. Runtime and storage both reject attempts to create a grandchild task.
23. Parent task identity remains stable while each delegated handoff message uses the exact child Agent avatar.

## 9. Codex-Aligned Effective Permissions And Recoverable Work

- Every Run receives an explicit effective permission snapshot produced from the intersection of the Agent capability ceiling, the parent task's live permission override, the project sandbox, and the delegated task's `allowedTools` when present.
- Tool registration, sandbox boundaries, and approval policy are separate. Selecting an approval mode cannot create tools that were not registered for the Run.
- Conversation Runs and child-task Runs may use the same project file, full shell, Git, network, browser, and desktop execution gateway as production Steps.
- `request` maps to project workspace access with user approval on boundary crossings. `delegate` uses the same sandbox and routes eligible approval requests to an approval Agent. `full` maps to unrestricted execution with no approval prompts. `custom` persists explicit per-capability choices.
- Browser, network, and desktop tools are available by default. Their approval behavior follows the current task mode; `full` never prompts.
- Child tasks inherit the parent's live permission override. A later permission change is reapplied to running and blocked children without creating a new Agent version or child task.
- Agent definition edits affect future tasks. Existing tasks keep their exact AgentVersion while receiving live task permission overrides, matching Codex subagent inheritance.
- A permission or missing-tool stop is `blocked`, not `failed`, and does not consume the five ordinary failure retries. After permissions change, Runtime creates a new Run attempt in the same child thread and preserves prior context/logs.
- `run.completed` means only that one Provider turn ended. Business completion requires a structured outcome of `completed`; `blocked`, `failed`, `needs-input`, and `cancelled` remain distinct.
- An implementation child cannot complete without durable execution evidence such as a file operation, command, Git result, test result, or named artifact. A text-only claim is projected as blocked and returned to the parent as incomplete.
- Duplicate delegation with the same parent, Agent, and normalized goal reuses an existing `active` or `paused` child. Re-executing a completed child requires an explicit new-run action.
- The Composer permission control exposes the selected task mode, Agent capability ceiling, project sandbox, and final effective permissions. Execution details persist the exact effective tool list and sandbox root for each Run.

## 10. Effective Permission Acceptance Criteria

24. A project-bound conversation Run receives real file, shell, Git, network, browser, and desktop tools according to its effective permission snapshot.
25. The model-facing permission mode is resolved from the latest task policy, not stale Agent or group defaults.
26. A Provider response that reports missing tools or lacks required implementation evidence cannot emit `subtask.completed`.
27. Updating task permissions resumes the same blocked child thread with a new attempt and no duplicate task.
28. Duplicate active/blocked delegations return the existing child task id and an explicit `reused` marker.
29. Permission blocks do not consume ordinary retry attempts; execution failures still allow five retries after the initial attempt.
30. The permission popover and execution details show the same effective mode, sandbox root, and tool set persisted by Runtime.

## 11. Project Resources, Execution Profiles, And Managed Worktrees

- Product copy uses `访问范围` and `执行位置`; the user-facing product never requires the term `sandbox`.
- A Project remains the stable top-level container. Its existing optional `folderPath` is preserved for compatibility, while typed Project Resources describe executable code sources.
- `local_directory` points at an existing folder on this machine. Non-Git folders execute in place and allow at most one write-capable task at a time.
- `git_repository` points at either a bound local checkout or a remote repository URL. New tasks default to a managed Git worktree created from the configured base ref.
- A managed worktree belongs to exactly one conversation task and is reused by later Runs in that task.
- Parallel write-capable child tasks receive separate managed worktrees. A child is based on the parent task's current checkout snapshot and reports its commit/diff/evidence back to the parent lead for integration.
- Read-only child work may share a parent execution location only when its effective tools contain no write, command, or Git mutation capability.
- Managed worktrees start detached and do not create user-visible branches until the user or Agent explicitly requests one.
- Project Execution Profiles are independent reusable records. They define execution mode, base ref, setup commands, environment references, cleanup retention, and a default Browser Identity reference.
- Browser Identities are independent from Agents and model bindings. They persist browser profile data under the Desktop application data directory; tasks pin one identity and children inherit it by default.
- Completing or archiving a task sets a managed worktree cleanup deadline seven days later. Cleanup is skipped while the worktree has uncommitted changes or an active Run/lease.
- Required ignored setup files may be copied into a managed worktree only through an explicit project include list. No broad copy of ignored files is allowed.
- Runtime writes a structured execution-context snapshot for each task and injects a compact Project Context into Provider context: project identity, resource identity, execution path, Git base/ref, Browser Identity, and effective access scope.

## 12. Project Execution Acceptance Criteria

31. Binding an existing folder preserves current project/task history and creates one typed Project Resource without duplicating the folder.
32. A Git-backed new task receives one persisted managed worktree; reopening or retrying the task reuses the same path.
33. Two parallel write children never receive the same managed worktree path.
34. A non-Git local directory never has two concurrent write leases; the later task remains queued/blocked without consuming a failure retry.
35. A child completion handoff contains the exact base ref, head ref, changed-file summary, durable evidence refs, and integration status.
36. Worktree cleanup after seven days refuses to remove dirty or leased worktrees and records the reason.
37. Composer and Project UI show Project, execution location, base branch/ref, and Browser Identity without exposing internal path-policy terminology.
38. Terminal, Files, Browser, and side-task entry points all resolve the same persisted task execution context.
