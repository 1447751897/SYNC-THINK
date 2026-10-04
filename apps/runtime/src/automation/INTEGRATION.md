# Scheduled automation: integration seam

Import `prepareAutomationRun`, `validateAutomationReadiness`, `compileAutomationPrompt` and dependency types from `D:/projects/SYNC-THINK/apps/runtime/src/automation/index.ts`.

## fireScheduledTask integration

1. Resolve the actual actor/kernel and effective workspace before creating a conversation or dispatching a run. Capture `firedAt` and optional `runId` once.
2. Build `AutomationReadinessDependencies` from live stores and connection state. The arrays are normalized actor-filtered inventories, not discovery requests. `available` includes enabled/provider credentials/kernel support/permissions. Model fallback IDs must be explicitly configured; teams require all members and a member coordinator.
3. Call `prepareAutomationRun(task, deps)`. `ready` gives an immutable `snapshot` and `prompt`; pass that prompt through both run binding and persisted user message. The scheduler owns dispatch and result persistence. `blocked` records all configuration errors without dispatch. `waiting_input` yields and reuses `issues[].dedupeKey` / existing handoff key; it creates no fresh approval requests.
4. Preserve the snapshot in this run's context. Dependency loss after preflight remains a real tool error; this module does not promise atomicity of external connections or classify a started run as successful.
5. Final acceptance is runtime-owned: validate business evidence, actual artifact tool receipts and configured Gmail receipt independently before marking success. An exported file is not a mail receipt.

## Adapter mapping

- Workspace: omitted task workspace uses explicitly supplied `defaultWorkspaceId`; explicit missing/deleted workspace blocks.
- Profile: actual profile record plus known `reauth_required` → `loginState: required`; known missing/pending origin grants → approval waiting. Unknown login state is not treated as confirmed login; execution must yield on an actual challenge.
- Bound Browserflow: task status `enabled`, global scope (`workspaceId` omitted) or matching workspace, exact Profile, actual `publishedVersionId`, matching version record, and `collectStepVariables(version.steps)` mapped to `publishedVersion.requiredVariables`. Replay-capability booleans come from actual exposed tools. No workflow binding means no replay requirement.
- MCP: stored registration is distinct from current connected status. Cached tool names do not establish connectivity. Tools must be available to the resolved actor/kernel. `connector: gmail` and tool capability `gmail.send` are explicit verified adapter assertions, never guessed from arbitrary names. Gmail delivery implicitly includes its explicitly named server in the frozen required server set. Optional `delivery.toolName` must exactly match a real available tool on that server with host-verified `gmail.send` capability. Classify it using the declared connector tool and actual tools/list plus recipient-capable schema; tool-name substring guesses do not establish send capability. Explicit mismatch blocks instead of falling back to another send tool.
- Artifacts: map the exposed builtin `automation_export_artifact` to capabilities `[spreadsheet, presentation]`; no external skill is then required. Alternatively map genuine tool capabilities or approved selected skills with their `requiredToolNames`. Only explicitly selected/connected MCP and task-injected skills satisfy output capabilities.
- For teams, inventory availability must account for the actual actor receiving each capability-chain step; avoid a union that makes member-inaccessible tools appear usable to everyone.

## Boundary

The module is pure and performs no registration, replay, scheduling, email, storage or runtime restart. Test fixtures exist only in `*.test.ts`; production callers must build inventories from live runtime state. No fixed business pipeline is encoded.

## Real artifact export tool

`exportAutomationArtifact(args, context)` is async. The builtin name is `AUTOMATION_EXPORT_ARTIFACT_TOOL_NAME` (`automation_export_artifact`). Bind it in native/external catalogs with capabilities `spreadsheet` and `presentation` only when the actual adapter calls this exporter.

Tool JSON fields: `format`, `fileName`, `title`, optional `columns`/`rows` for spreadsheets or `slides: [{title, bullets}]` for presentations. Tool JSON does not accept paths, overwrite, limits, zip entries or executable content. Strings are escaped data; spreadsheet strings never become formulas. Filenames are leaf-only and have a matching `.xlsx`/`.pptx` extension (added if omitted).

Host context: `workspaceRoot` and `workingDirectory` are required absolute existing directories captured for this run; optional `runId`, `overwrite` and lower `limits` are host-only policy. Keep that host-owned directory stable through export; Node pathname APIs do not provide an openat directory capability. The exporter checks containment and directory aliases before writing and again before publication. It rejects existing aliases and non-file targets. Production uses Node builtins only, fixed ZIP STORE entries and OfficeXML; there are no bundled-runtime production imports.

Receipt: `{format, fileName, title, path, size, sha256, overwritten, runId?}`; `path` is the canonical actual workspace/run-directory file path. Default no-clobber publication uses an exclusive sibling temp file, fsync and atomic hard-link publication. Explicit overwrite uses atomic rename. Concurrent no-clobber calls produce one whole file and a conflict for the other; temp files are cleaned. Filesystem must support same-directory hardlinks/rename; errors are surfaced, not converted to success. Hard ceilings: 10,000 rows, 128 columns, 200,000 cells, 100 slides, 30 bullets/slide, 8MB input and 16MB file, 32,767 characters/text. Host limits can only lower these values.

Acceptance integration must recheck the actual file/path/hash and associate the tool receipt with this run. This receipt proves file export only; it does not claim business acceptance or mail delivery. Configured Gmail requires its separate actual send confirmation. Tests read back ZIP central-directory data, worksheet/slide XML, CRCs and relationships; all fixtures are temporary and never wired into live runtime inventories.

## Execution policy and send-receipt evidence boundary

`automation.executionMode` accepts `ask`, `workspace`, `full-access`; omitted means `workspace`. It is frozen in `snapshot.executionMode` and does not bypass any actor, workspace, connection, Profile, published-version, output or Gmail requirement. Known login/approval waits remain waiting input even in full-access.

The host-owned `toSendReceipt` evidence adapter should consume only the current run's confirmed send-call result for the frozen server/tool/recipient. When `delivery.toolName` is declared, the frozen snapshot retains it and `sendToolNames` contains only that exact tool; match receipts to it. Whitelist known connector payload mappings for a nonempty provider message id; bind the normalized receipt to this run and exact request arguments. Bare success flags, narrative text, exported-file receipts, previous-run receipts and outputs containing errors are not confirmed mail delivery. Missing id/error/timeout stays unconfirmed; check stored receipt/idempotency state before retrying instead of blindly sending another message. No mail is sent or parsed by the readiness/export modules.

Admission results expose `reasons: readonly string[]` (the human messages from `issues`) for direct handoff to `failAutomationAdmission`. Ready admission has `reasons: []`; waiting/configuration failures keep their stable issue codes and dedupe keys.

Optional parser verification uses a test-only `SYNC_THINK_OFFICE_VERIFY_PYTHON` interpreter path with openpyxl/python-pptx. This is independent reverse validation of exported files, not a production dependency or a runtime capability inventory.
