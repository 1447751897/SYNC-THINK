# ADR 0006 — Group workspace binding and room artifact storage

Status: Accepted (implemented).
Date: 2026-10-04.
Amends the workspace/cwd isolation portion of ADR 0004.

## Context

A group created in a workspace already persists that workspace ID, and its backing tasks inherit the same ID. However, substituting a room archive directory for the project root hid existing project assets and source files from filesystem tools and external kernels. An empty archive was presented to the model as an empty project.

## Decision

- The group's persisted workspace binding supplies the project/tool root and execution cwd. All groups in that workspace can use its existing assets and source files. Switching the selected workspace does not rebind an existing group.
- Workspace resource claims use the canonical project key across rooms, so a shared-project writer conflicts with other readers/writers rather than acquiring a room-only lock.
- File deliverable paths and pre-write hashes are relative to the bound project root. Existing conversation permissions and discussion/coordination read-only guards still apply; workspace binding grants no additional write permissions.
- Room messages, provider threads, work items, checkpoints and artifact IDs remain conversation-scoped. Submitted documents and immutable file versions are archived under `<effective workspace>/.sync-think/task-rooms/<hash(roomId)>/.artifacts/`. The archive location is separate from the source file's project location.
- A projectless group continues to use its existing managed conversation directory as its effective root, with its own room archive beneath it. Missing project folders retain the existing unavailable-filesystem behavior.
- Existing conversation IDs, workspace bindings, histories and stored artifact paths are retained. No database migration or group recreation is required. Subsequent executions use the bound project root.

## Consequences

The project filesystem is intentionally shared by groups bound to that project; it is not a separate sandbox per room. Existing resource claims and execution permission fences remain in force. Room archive isolation prevents later working-file edits from changing a previously submitted version. Models receive explicit guidance distinguishing the project root from the archive directory.
