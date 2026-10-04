# ADR 0007 — Group-local conversation planning and audience projection

Status: Accepted for the generic group collaboration implementation. Supplements ADR 0004–0006; does not replace the production handoff workflow.

## Decision

Keep the SYNC-THINK desktop, agent definitions, local runtime and configured providers. Borrow the decision/execution separation reviewed in `docs/engineering/douchat-group-collaboration-source-review.md`; do not mount the DouChat application or require its account/model hosting.

Each group owns a description and a revisioned compare-and-swap configuration command. This is separate from a reusable team's mission and an individual agent's identity/memory. New groups enable `coordinateDiscussion`; legacy groups require explicit opt-in. Changing the switch affects new routing, not already admitted work; use room pause to stop execution.

An unaddressed public discussion enters one tool-free coordinator routing step. The output is validated against the active roster, mode and budget, then committed as real member reply tasks: single, parallel, sequential, or explicit silence. Sequential tasks depend on actual successful predecessors, whose result is prioritized in the successor context. Routing JSON is internal state, never a participant answer or a streamed public bubble. An invalid plan falls back once to a real coordinator contribution, not a fabricated answer. A specific single @ or reply target still routes directly.

The group description, original request, public message history and bounded progress index are available to each contribution. The host sees every committed status transition; messages need not be rewritten by a leader. Members can use existing notify/handoff/consult tools. A final public discussion answer may additionally contain a line-leading exact @name to request bounded continuation. Prose references, fenced code, ambiguous names and private text do not trigger parsing. This does not manufacture production work: artifact-bearing work retains the typed, success-committed handoffs of ADR 0005.

One failed automatic discussion chain receives one coordinator recovery contribution. Sequential dependents are cancelled rather than impersonated; independent parallel contributions continue. Failed attempts remain history. Pause wins over late routing results; resume creates a new attempt without replaying completed contributions. Room goals and uncertain external actions retain existing production recovery semantics.

## Private audience boundary

`recipientMemberIds` alone is routing, not confidentiality. Only explicit `visibility=private` restricts a message to its sender and recipients. Replies inherit the private audience class. Private work-intent messages are rejected so the shared goal does not absorb secret content. Notify delivers information without awakening a member; handoff awakens one; consult joins the requesting task after an answer.

The same host-owned projection is used for model inputs, model context reads, command responses, sidebar previews and collaboration activity. It removes inaccessible messages, tasks, attempts, artifacts, deliveries and references; internal routing steps never read private inboxes. Public traces from a member with a hidden private inbox are redacted for nonparticipants. The SQLite store retains full host state.

This is application message-audience isolation, **not** encryption or an operating-system sandbox. The local account owner can inspect its database, raw execution/task APIs or files. A participant can intentionally disclose its private information in public prose. Generic tool-bearing agents are consequently not a strict hidden-information game boundary. Individual identity/memory configuration is retained; this change does not introduce global shared memory.

## Explicit non-goals

No who-is-undercover/werewolf dealing, voting, elimination, round adjudication or anti-out-of-turn action state machine is included. Those need separate host-private game state, individually projected player views, a controlled no-tools model transport and a user action UI. They must not be advertised as complete merely because discussion order and private messages exist. Natural-language descriptions guide model choices; they are not a formal game rule engine or permission escalation mechanism.

## Compatibility and verification

Execution version 15 requires the running runtime to be refreshed. Existing conversations, production DAGs, deliverables, checkpoints and agent providers are retained. Tests use scripted executors and local SQLite, not paid provider calls; they verify host behavior and UI commands, not the obedience of every configured model. See `docs/engineering/group-collaboration-testing.md` for the manual acceptance path.
