# Codex Three-Mode Permission Design

Date: 2026-07-20  
Status: Approved for implementation  
Branch: `codex/talk-mention-progress-logs`  
Worktree: `D:\projects\MYSELF\SYNC-THINK-talk-mention-progress-logs`

## 1. Decision

SYNC-THINK collapses the current multi-scope permission and approval maze into **one Codex-style execution mode**.

Users choose exactly one of:

| Mode | Product label | Codex equivalent |
|---|---|---|
| `read-only` | 只读 | Read Only |
| `workspace` | 工作区 | Default / Workspace Write |
| `full-access` | 完全访问 | Full Access |

Rules locked by product intent:

1. Agent definitions no longer configure fine-grained file/command/browser/desktop/network permission matrices.
2. The selected mode is the only user-facing authority for what an Agent may do and whether approval is required.
3. `full-access` never enqueues approval for currently available actions. Runtime still audits.
4. Task/Run keep an effective-mode snapshot for audit and resume. They are not a multi-layer policy inheritance tree.
5. Group is not a permission scope. Child tasks inherit the parent task's live mode.
6. Project folder binding is the execution root. No root means no local file/shell/browser/desktop tools.

## 2. Why the old model is rejected

The previous stack mixed four different problems:

1. collaboration ACL
2. execution sandbox
3. approval routing
4. run/task identity

That produced:

- `AgentPermissions` string lists
- `ApprovalMode` (`request|delegate|full|custom`)
- scoped policy chains (`user/workspace/project/task/agent/workflow/run`)
- capability grants
- worker tokens

Users could not answer a simple question: "If I pick one mode, what happens?"

## 3. Canonical model

### 3.1 Execution mode

```ts
type ExecutionMode = 'read-only' | 'workspace' | 'full-access'
```

### 3.2 Effective execution snapshot

Every Run materializes one immutable snapshot:

```ts
interface EffectiveExecution {
  mode: ExecutionMode
  legacyApprovalMode: 'request' | 'delegate' | 'full' | 'custom'
  workspaceRoot?: string
  filesystem: 'read' | 'write-workspace' | 'unrestricted'
  network: 'deny' | 'ask' | 'allow'
  approval: 'ask-protected' | 'never'
  approvalRouting: 'user' | 'delegate-agent'
  toolNames: string[]
  requiresWorkspaceRoot: boolean
  labelZh: string
}
```

### 3.3 Mode semantics

#### 只读 (`read-only`)

- Filesystem: project root read-only
- Network: deny by default / ask if escalated later
- Auto tools: read inspection only (`read_file`, `list_files`, `git_status`, `git_diff`)
- Writes, shell, browser, desktop: not auto-available
- Approval: required for protected or unavailable actions

#### 工作区 (`workspace`) — default

- Filesystem: project root read/write
- Network: ask on external access
- Auto tools: all local execution tools inside the project root
- Boundary crossings and sensitive actions: ask user (or delegate agent when configured)
- This is the normal daily mode

#### 完全访问 (`full-access`)

- Filesystem: unrestricted relative to currently available workers
- Network: allow
- Tools: every currently registered / bound tool
- Approval: never
- Audit: always

## 4. Scope and precedence

Only three configuration layers remain:

```text
Install default
  └─ Project default
       └─ Task override (live)
            └─ Run snapshot (read-only audit)
```

Resolution:

```text
effectiveMode =
  Task.mode
  ?? Project.mode
  ?? Install.mode
  ?? 'workspace'
```

No "most restrictive rule table" across agent/group/workflow/run.

Legacy `ApprovalMode` values map as:

| Legacy | ExecutionMode | Notes |
|---|---|---|
| `request` | `workspace` | default daily mode |
| `delegate` | `workspace` | same sandbox; approval routing = delegate-agent |
| `full` | `full-access` | no approval prompts |
| `custom` | `workspace` | custom rule UI deferred |

Wire compatibility keeps `ApprovalMode` on existing payloads while Runtime/core prefer `ExecutionMode`.

## 5. Agent definition changes

Agent keeps:

- identity, instructions, role
- model / credential binding
- skill allowlist
- MCP server binding
- review/artifact behavior

Agent no longer owns user-facing permission matrices.

Legacy `AgentPermissions`:

- empty lists = legacy default = "follow execution mode"
- explicit disabled markers may still deny a category during migration
- new UI must not edit these fields

Creating an Agent is a local configuration action for the install owner. It is not an execution-permission grant.

## 6. Runtime behavior

### 6.1 Tool registration

```text
availableTools =
  system-implemented tools
  ∩ mode-allowed tools
  ∩ optional delegated allowlist
```

`AgentPermissions` category filters are removed from the happy path.

### 6.2 Approval gate

```text
if mode == full-access:
  auto-approve every currently available action
else if action is protected / out-of-boundary:
  ask user or delegate agent
else:
  auto-approve in-mode action
```

Sensitive action labels remain for audit metadata. They do not reintroduce approval under `full-access`.

### 6.3 Worker token

Workers receive only the resolved snapshot:

- `allowedRoot = workspaceRoot` for read-only / workspace
- unrestricted token policy for full-access when product workers support it
- no unrelated credentials

### 6.4 Live mode switch

1. User changes Task mode in Composer.
2. Runtime writes Task override.
3. Blocked approval waits are re-evaluated under the new mode.
4. Same task/thread continues; no new AgentVersion required.
5. Child tasks inherit the parent task's live mode.

## 7. User flows

### A. Normal chat task

1. Open project
2. Bind folder if local tools are needed
3. Composer shows mode: 只读 / 工作区 / 完全访问
4. Send message
5. Runtime snapshots effective execution on the Run
6. Tools execute according to mode

### B. Switch to full access

1. User selects 完全访问
2. Task override updates
3. Pending approval gates auto-clear for available actions
4. Later tool calls skip Approval Center

### C. Unbound project

1. User asks for file/shell work
2. Runtime has no workspace root
3. No silent full filesystem access
4. UI asks to bind a folder or continue as pure conversation

### D. Create Agent

1. Name, instructions, model, skills, MCP
2. No read/write permission form
3. Runtime authority comes only from the task mode when the Agent runs

## 8. UI contract

Composer control:

```text
[ 只读 | 工作区 | 完全访问 ]
```

Details popover shows only:

- execution location
- current mode
- one-line effect summary

Do not show:

- file/command/network checkbox matrices
- Run > Task > Group > Agent permission chains
- custom rule builders in v1

Approval Center remains for non-full modes only.

## 9. Implementation phases

### Phase 1 — foundation (this change set)

1. Design doc
2. `ExecutionMode` + legacy mapping helpers
3. `resolveEffectiveExecution`
4. approval evaluation remains compatible with legacy modes and full-access auto
5. Runtime conversation tool binding prefers mode over AgentPermissions matrix
6. unit tests for mapping and resolution

### Phase 2 — product wiring

1. Composer three-mode control
2. Task/Project persistence for mode
3. remove Agent permission matrix from UI
4. Group follows task mode

### Phase 3 — cleanup

1. retire scoped multi-policy as primary path
2. retire authorization-grant tree as primary path for ordinary tools
3. docs/tests fully on three-mode vocabulary

## 10. Acceptance criteria

1. Users can only need to understand three modes.
2. Same Agent under full-access never opens approval prompts for available actions.
3. Workspace mode auto-runs in-project reads/writes/commands; boundary crossings ask.
4. Read-only mode auto-runs inspection tools only.
5. Creating/editing an Agent does not require a permission matrix.
6. Child tasks inherit parent live mode.
7. Each Run stores mode + execution root for audit.

## 11. Non-goals (Phase 1)

1. Multi-user RBAC
2. Custom per-path/per-command rule editor
3. Full deletion of legacy DB columns
4. Redesign of MCP grant storage beyond execution-mode consumption
