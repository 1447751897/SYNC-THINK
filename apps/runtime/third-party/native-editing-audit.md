# Native editing adapter audit (2026-09-24)

The standalone native Codex 0.155.0 was tested against a loopback Responses fixture using the requested provider model `deepseek-flash`. Before the fix it exposed `exec_command` but no `apply_patch`, and its base instructions contained only the host context.

## Codex

- Keep SYNC-THINK context in `developerInstructions`; preserve native base instructions for cataloged models.
- Query the running binary's `model/list` rather than guessing model capabilities by a name prefix.
- For explicit API-provider models absent from that catalog, create a private temporary model catalog enabling native `apply_patch`. Keep the requested model identifier and configured context size.
- Codex 0.155.0 initializes model metadata at process startup. The catalog is supplied as an app-server startup override; a thread-only config override does not expose the tool.
- Known native models and local-login sessions retain their native catalog. Catalog files contain no credentials and are cleaned up when the adapter stops.
- Unknown models require baseline instructions in their descriptor. `codex-fallback-prompt.ts` vendors the fallback prompt from `openai/codex` tag `rust-v0.155.0`, `codex-rs/models-manager/prompt.md`, under Apache-2.0. The full license is included in its emitted JavaScript as well as `codex.LICENSE`.
- Resumed custom-model sessions restore this baseline (older sessions persisted host context as their entire base prompt), retaining their history and passing current host context separately.
- The native patch tool uses the Responses custom-tool format. Third-party gateways must support that format; a loopback test proves local adapter execution, not a gateway's compatibility or a live model's tool choice.

## Claude

- Retain the native `claude_code` preset and native Read/Edit/Write tools.
- Preserve SDK `tool_use_result` on single-result messages. Never attach one structured object to several unrelated tool IDs.
- Use SDK `originalFile` and actual Write/Edit output to record complete historical snapshots. Validate file identity and replacement cardinality; keep literal replacement characters and line endings.
- Do not treat a replacement fragment, ambiguous replacement, user-modified proposal or failed operation as a complete successful file write. Never reread the current filesystem to invent an old snapshot.
- Persist snapshots at the real runtime event boundary, then project them into the existing file-change UI. Large snapshots use stable event references and bounded IPC previews.

## Validation

146 targeted runtime tests passed, including SDK and app-server adapters, captured stream replay, runtime persistence, snapshot projection and deferred content. Runtime typecheck/build passed.

The actual local Codex binary executed a patch supplied by a loopback Responses fixture and emitted native `file_change` events. The actual Claude SDK/CLI read and edited a scratch file using a loopback Messages fixture, returned `originalFile` and a structured patch, and produced correct before/after snapshots. These tests used no paid provider calls and did not edit the user's workspace files.

For acceptance, create a new conversation in a scratch workspace, select Codex with the same model, and request a small file edit. Verify that the provider receives `apply_patch`, the timeline shows file editing when that tool is chosen, and expanding the entry displays the real diff. Repeat using Claude. Intentional shell commands should remain command entries. Older records whose snapshots were never saved retain their recorded information.

## Windows managed-launcher regression (2026-09-24)

The application actually selected its managed Codex 0.154.0 npm installation, whose entry point is `codex.cmd`. The initial audit used the desktop's native 0.155.0 executable and missed this launch path. Persisted failures showed that the embedded JSON quotes in the `model_catalog_json` override were rejected by the Windows shim argument guard before the configured process could start. Provider connectivity tests call the provider probe separately and therefore did not catch this local launch error.

- Pass the catalog path as Codex's literal CLI override value with forward slashes. Keep the common Windows shim safety guard intact.
- Wrap synchronous spawn and asynchronous initialize failures in a local `KernelStartupError`. Preserve sanitized stderr in pending initialization errors.
- Terminate the run with its original model and a durable diagnostic instead of retrying or exhausting provider/model fallbacks for local startup failures. Provider 503 failures continue through the existing fallback policy.
- 134 regression tests passed, including a real Windows cmd wrapper with spaces and Unicode in both launcher and catalog paths, a durable error message, and the existing Claude editing tests. Runtime typecheck/build passed.
- The actual managed 0.154.0 `codex.cmd` executed a patch against a local Responses fixture and emitted native `file_change` events. No paid model call was made.
- The development renderer was rebuilt and the application/runtime relaunched successfully. The separate production renderer build hit the existing initial-JS budget (2,172,089 bytes versus 2,150,000); no budget override or installer was produced.
