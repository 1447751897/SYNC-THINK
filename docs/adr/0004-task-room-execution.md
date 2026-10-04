# ADR 0004 — Task rooms, explicit work intent, and durable continuation

Status: Accepted (implemented). Supersedes the **new group execution** portions of ADR 0002 and ADR 0003. Workspace/cwd isolation is amended by ADR 0006. Existing single-chat/model delegation and historical task records remain readable.

## Decision

One long-lived objective owns one collaboration conversation (`conversation.room`). A Team is reusable configuration, not a shared conversation, provider session, execution, or memory. Two books written by one team use two rooms. Existing chat presentation is retained; the execution contract underneath it changes.

### Roles and execution

- `discussion`: answer a question in the room, read-only. Joining a room or mentioning an Agent in discussion does not create background work or change manuscript files.
- `coordination`: the leader reads the brief and work index, dispatches a bounded batch to current room members, then yields. The host wakes the leader once per completed member batch. No serial/parallel all-member DAG is compiled for new room work.
- `work`: a concrete assignment with its own attempts and deliverable. Workers do not re-delegate. Document delivery is the default; files require an explicit contract and existing write permission.
- A user starts work through `start-workflow`, explicit work intent in the composer, or the task dialog. Merely writing “do it” in discussion does not upgrade the execution purpose.
- Normalized tool catalogues AND native/external execution-time guards enforce these roles. Legacy global delegation/direct-message tools are excluded inside a task room; host-bound same-room consultation is permitted under the separate group-messaging policy. Dispatch must be bound to the currently active coordinator attempt; direct/duplicate-self dispatch and ancestor-team cycles are rejected.
- Work is limited to 64 automatically scheduled nodes per root/continuation allowance. Existing message-loop bounds also apply; reaching the automatic follow-up limit pauses the room. A human continuation replenishes that room's allowance, not another room's allowance.

### Isolation and context

- Messages, work items, attempts, checkpoints, membership and artifacts are scoped to the conversation ID. A provider thread belongs to one room work item; a reused Agent definition does not reuse another room's provider thread.
- Native context is a confirmed brief, bounded checkpoint/work/artifact indices, a bounded recent-message selection, current instructions and role. Long histories are not all injected on each call.
- `collaboration_read_context` provides paginated brief/messages/tasks/artifact reads. There is no caller-supplied room ID; the active host execution supplies the room. Returned IDs must exist in that room. Listed artifact IDs do not imply that their contents have been read.
- The attempt records an initial context manifest (room, trigger boundary, selected message IDs, artifact references, omission count and continuation candidate). Later tool reads remain visible in the existing execution trace.
- Rooms do not automatically load project-wide memory or propose run digests to global/project memory. Agent persona, skills and approved tool configuration remain reusable; book-specific canon belongs in the room brief and artifacts, not in a reusable Agent persona.
- The bound workspace is the project/tool root and execution cwd (ADR 0006). Room archives live under `<effective workspace>/.sync-think/task-rooms/<hash(roomId)>`; they do not replace the project root. Existing ancestor junctions/symlinks are checked before archive directory creation. Submitted project files are copied into per-attempt, content-addressed `.artifacts` versions; old document contents remain in durable attempt records.
- This is application-level context/artifact isolation, not an OS sandbox. Full-access commands or external services still have their configured real privileges. The global external-write claim remains conservative, so two rooms with external writes can queue instead of running simultaneously.

### Lifecycle

`discussion → running → review → completed`, with `pausing → paused` available independently per room.

- Pause blocks further work admission and aborts only active work attempts in that room. Consultations remain available. The UI distinguishes a requested pause from a failed delivery.
- The room is `pausing` until execution acknowledges stopping. It must not show “resumed” while an old writer is still active.
- A checkpoint persists goal revision, completed/pending work, current delivery references, note and time. Streaming output and old attempts are retained.
- Resume creates new attempts for interrupted work, preserves its room-bound thread as a continuation candidate, and releases queued work. Succeeded work is not replayed. Failed work requires explicit retry; already performed filesystem/external effects are not rolled back or guaranteed exactly-once.
- An empty paused room returns to discussion. Work that has settled returns to review; only the user accepts it as completed. Changing an accepted brief reopens discussion.
- Recovery of a lost execution owner pauses the room instead of automatically replaying interrupted side effects. Continuing depends on the application/daemon being running; no future wake-up automation is implied.
- Receipts make user pause/resume/start/brief requests idempotent. Brief edits use optimistic revision checking and append a historical confirmation message.

### Room navigation and invitations

- Teams are reusable roster templates, not conversation identities. Inviting a team always creates a new durable room; opening a room selects an explicit conversation ID.
- Every room appears separately in the sidebar, including empty newly invited rooms and legacy team conversations. Several rooms may use the same team or agent. Joining a team does not hide an agent's existing private chats.
- Navigation only changes the viewed conversation and read subscriptions; it never sends pause/cancel. A shared roster subscription keeps background room status current. Normal runtime concurrency/resource limits can queue work without requiring navigation-time pauses.

### Membership and migration

- Adding a team snapshots the room roster/roles. Adding an independent Agent affects only that room and triggers no execution. Subsequent @ consultation can read the room's applicable history through the same bounded context API.
- Team-library edits do not silently replace an active room's roster. Remove/re-add a team after resolving active work to adopt a new definition.
- Existing group snapshots are upgraded in place. Conversations, messages, task IDs, attempts, receipts and artifacts are preserved. Old pending work is paused for explicit review; task purposes are assigned from legacy kind before resumption. Historical dependency graphs remain readable and old queued nodes can be continued or explicitly cancelled; they are not expanded into new automatic team graphs.
- Model/standalone legacy delegation settings stay in a clearly labelled separate settings section. They do not secretly control room dispatch. The Team UI no longer offers fixed serial/parallel/dependency editing as the room execution strategy.
- Execution capability version is 5 (same-room messaging and durable consultation joins). A renderer talking to an older daemon blocks work commands and instructs the user to restart the daemon; refreshing a window alone is insufficient.

## Verification

See `docs/testing/task-room-acceptance.md`. Runtime tests cover isolation, pause acknowledgement, late callbacks, restart recovery, quota continuation, file versioning, coordinator dispatch and real native tool dispatch with a fake provider. Desktop tests cover explicit intent, paused consultation, task-room controls and legacy UI regression. No paid live-provider run is claimed by this ADR.


## 2026-10-01 amendment: room messaging and consultation continuation

This amendment supersedes the blanket exclusion of `collaboration_send_message` in task rooms; it does not grant workers work-delegation authority or cross-room access.

- `allowGroupMessages` is separate from `allowPeerDirect`. New rooms permit same-room peer consultation and retain private DMs disabled. Missing legacy group policy is explicitly initialized from the old peer setting; toggling DM permission later does not change it. Coordinator communication stays available. Turning off peer communication rejects queued peer consultations with an explicit result, while already admitted read-only execution may finish.
- Explicit recipients take precedence. A reply without explicit recipients goes to its active author. An unaddressed user discussion goes to the sole active work owner, otherwise the coordinator. It never broadcasts by default; starting unaddressed work retains the coordinator path. This deterministic policy is our implementation, not a claim about Grok's private routing algorithm.
- Runtime injects sender, source task, source attempt and a causal message; IPC/model arguments do not grant source-task binding. Automatic room messages default to notifications (no response). `expectsResponse=true` creates only a read-only consultation, not a new production assignment.
- A consultation records requester task/attempt and inherited room-work lifecycle scope. The source yields, releasing execution/resource capacity. Its next attempt is persisted on the SAME task with a bounded list of consultations to join; it becomes runnable when their current attempts settle. Errors are returned as errors, not silent success. The continuation starts with fresh bounded room context, reads the real replies and does not reuse another room's provider session.
- Source artifact submission and work dispatch are blocked after requesting consultation in that turn. Conversely, new consultation is refused after the source has submitted a deliverable or dispatched child work. This avoids finishing a stage while waiting for information or duplicating already executed work on continuation.
- Consultation results address the actual requester. Completing one consultation is not a new unbounded reply trigger; only its persisted source continuation is released. Self/ancestor requests are rejected; correlation hop/message limits still apply. Notification messages do not create another turn.
- Pause/resume and crash recovery include work-scoped consultations. A queued source keeps waiting for the actual peer result after resume. Failed consultation remains visible but does not by itself block accepting a subsequently resolved source deliverable. Unresolved running/queued work still blocks acceptance.
- Tool responses contain delivery receipts and IDs rather than copying the whole room snapshot into model context. Paginated room task reads also expose consultation records; historical records and artifacts remain preserved.
- The desktop exposes the group setting, visible sender-to-recipient labels and delivery/waiting states. Version-4 daemons are blocked from new send/policy mutations; old history remains readable. Updating the renderer alone does not upgrade the daemon.

Out of scope for this increment: global bot mailboxes, cross-room context sharing, OS-level isolation, and model-based free-form speaker selection. Those are not silently enabled as part of this repair.

## Accepted amendment — chat-first work admission (2026-10-01, execution version 6)

This supersedes the original UI-only work-start restriction, not the requirement for human intent. The product calls every group **群聊**; internal room IDs remain the durable isolation boundary. The sidebar lists conversations and private chats, not reusable team invitation cards. Teams are selected in the new-chat picker or added through membership management. The work-goal editor is optional and initially collapsed.

- A new user-message intent, `chat`, is the default composer mode. Ordinary discussion/status remains conversational; the coordinator may use `collaboration_start_workflow` for a current human request to start or approve real work. The model interprets natural language; historical/quoted instructions are not new approval. Explicit discussion-only mode retains the previous no-work authority.
- Only the host issues `workflowStartAllowed` to the coordinator's human chat reply. Model task drafts reject this field. Start admission binds the live task/attempt, current coordinator and human origin. Peer consultations, foreign actors and stale attempts cannot start a workflow. One human turn yields at most one start despite different tool-call IDs.
- The host persists a goal with bounded scope and creates the real coordinating task. That task dispatches member work; notifications and read-only consultations remain distinct. Existing pause/acceptance gates and work limits apply; a chat command does not silently unpause a group.
- Explicit small work addressed to a multi-member group's coordinator is coordination, not a document-writing assignment. Other members still receive concrete work. The composer returns to chat after one successful work assignment, so a subsequent progress question is not accidentally another deliverable.
- Long recent messages retain bounded excerpts with message IDs and full-text read-back instructions instead of being silently omitted wholesale. Storage remains complete and group-scoped.
- Version 5 daemons must be restarted before using the new chat intent. Existing conversations, goals, memberships and group/private permissions are preserved. Historical approvals and live user work are not automatically replayed during upgrade.

Verification includes a native Runtime + SQLite + simulated provider flow: discussion-only rejected start → human chat approval → idempotent workflow start → coordinator dispatch → dependency-ordered artifacts → automatic review → progress-only reply. This verifies execution and permission boundaries, not every real model's tool-selection behavior.


## Accepted amendment — lightweight chat handoffs and explicit production contracts (2026-10-01, execution version 10)

This supersedes the consultation-only wake semantics of the version-5 amendment, while preserving legacy `expectsResponse` behavior and all production admission gates.

- `collaboration_send_message.deliveryMode` explicitly distinguishes `notify` (no wake), `handoff` (wake the recipient for read-only chat, without joining or resuming the sender), and `consult` (read-only response plus a durable source continuation). Legacy true/false still means consult/notify. Conflicting mode/boolean values are rejected before side effects.
- Handoffs remain conversation-scoped, host-bound, idempotent and bounded by existing message/hop/cycle policies. They inherit neither workflow-start nor artifact/dispatch authority. Handoff tasks are not production children and do not block later legitimate work dispatch as if they were deliverables.
- A successful discussion turn that has explicitly answered its requester or handed the request onward has one public output. Its final model prose stays in the attempt trace instead of generating another acknowledgement. Failed/cancelled turns retain visible terminal results. Final replies address the actual message sender and do not wake that sender.
- Casual discussion context preserves current request, member IDs and bounded room history, with read-back access to the brief and artifacts. Production goal/checkpoint/delivery/word-count instructions are injected only for the appropriate work scope, rather than treating a greeting or relay as manuscript verification. Exact-text chat requests must not add confirmations or reports.
- Production coordination, real peer consultations, artifact validation, durable continuation, pause/recovery and multi-room isolation remain unchanged. Execution version 10 requires a daemon restart; historical messages and completed work are not replayed.

- Model-issued production assignments to individual room members must explicitly specify their document/file contract. An omitted contract is rejected before any message, task, child receipt or work state mutation. Human/legacy defaults remain readable. A request for a one-line opinion or read-only inspection uses `consult`, not a silently synthesized document contract; this prevents contradictory no-document instructions from producing `deliverable_missing` retry loops.


## Accepted amendment — user media attachments (2026-10-04, execution version 14)

- Group and team chat send commands accept images and workspace/local file references, including media-only messages. Desktop selection, image paste and drag/drop share the composer attachment pipeline; member mentions keep their routing semantics. The legacy composer again exposes a dedicated @ workspace-file button alongside its existing plus menu.
- The host stages images before IPC, validates conversation-scoped paths, and imports selected external files into the conversation's managed folder under the bound workspace. Existing project files remain project-relative references. Stored messages retain image/file blocks; context excerpts describe their names and durable paths without embedding base64. Context manifests still restrict admitted messages.
- Native executions receive admitted image bytes as real provider image parts, with workspace and conversation trust checks. Audio and other files are durable workspace inputs for tools; file upload does not itself imply automatic transcription or a model's native audio support. Projectless chats use their existing managed workspace.
- Attachment transport retries reuse the receipt and frozen media metadata, even if the original external file has subsequently been removed; changes to the logical message or attachment identity with the same request ID are rejected. File size/count limits and existing execution/permission gates still apply. No historical user message is automatically replayed.
- Execution version 14 requires both the updated desktop and runtime daemon. Native Runtime + SQLite + fake-provider tests verify actual image parts, imported audio bytes, project/projectless roots and receipt recovery. Browser fixture checks cover visible attachment controls, previews, @ pickers and custom scrollbars; these are not paid live-model acceptance claims.
