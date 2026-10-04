# ADR 0005 — Description-guided conversational work handoffs

Status: Accepted by user discussion on 2026-10-03. Supersedes the coordinator-only production handoff and worker-no-redelegation portions of ADR 0004 for new room work. Legacy workflow DAGs, explicit independent batches and historical records remain supported.

## Decision

The team's mission/description and member roles define its collaboration instructions. Explicit approval/return boundaries are included in every member's context; unspecified routing is autonomous within the current user goal. Role names do not mechanically prescribe a universal sequence. Natural-language boundaries guide model decisions; they are not claimed to be a formally compiled authorization policy. Existing host permissions, membership, room isolation, budgets and pause gates remain authoritative.

The public interaction is an addressed @conversation. `collaboration_handoff` records one currently determined next step: `review` examines concrete artifact versions, `report` asks a responsible member to decide, and `work` assigns a bounded document/file contract. The host injects the active sender/task/attempt, requires a current production goal, validates recipients and artifact references, and persists the intent without waking the next member yet.

A producer must submit its own contracted artifact before requesting handoff. Only successful completion commits the addressed result and queues the chosen recipient. Review/report decisions can route onward without manufacturing a review document. A review can therefore assign polish, receive the new version for re-review, and report acceptance to a leader when the description permits that route. Returning to an earlier reviewer is not a waiting-consultation cycle: it is new bounded work after the previous turn has ended.

Ordinary handoff chat, notify and consult retain their read-only/no-production authority. Plain text @names still do not manufacture work; real tool-backed routing produces the visible mention. A completed routed chain does not spawn an extra compulsory leader round. Unrouted or failed production work retains a deduplicated fallback to its responsible member.

## Durability and bounds

One attempt selects one handoff; retries use new attempts and do not inherit an interrupted or failed intent. Intents survive storage/restarts as historical records. No receiver is awakened on failure, pause or cancellation. Production node admission also reserves pending handoffs against the existing 64-node continuation limit. Independent coordinator batches remain available; this is not a global serial lock.

Execution version 13 requires the running daemon to restart. Existing goals and completed work are not replayed. Verification covers real Runtime/tool catalogue guards with SQLite and a scripted provider for strict and autonomous team descriptions, plus service and renderer regressions. Scripted-provider routing does not establish that every external model follows arbitrary prose reliably.
