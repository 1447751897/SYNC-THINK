import { CODEX_FALLBACK_PROMPT } from './codex-fallback-prompt.js';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Codex's unknown-model metadata disables apply_patch. Supply only the missing
 * tool capability, keeping the requested provider/model and context limit intact.
 * The catalog is isolated to this adapter process; known vendor models keep their metadata. */
export function createCodexEditingCatalog(
  model: string,
  contextWindow: number,
): {
  path: string;
  dispose(): void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-codex-model-'));
  const path = join(directory, 'model.json');
  const metadata = {
    slug: model,
    display_name: model,
    description: null,
    base_instructions: CODEX_FALLBACK_PROMPT,
    supported_reasoning_levels: [],
    shell_type: 'unified_exec',
    visibility: 'hide',
    supported_in_api: true,
    priority: 99,
    availability_nux: null,
    upgrade: null,
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: 'freeform',
    truncation_policy: { mode: 'bytes', limit: 10000 },
    context_window: contextWindow,
    experimental_supported_tools: [],
    // Preserve Codex fallback defaults, without inventing model reasoning/image support.
    include_apps_usage_instructions: false,
  };
  const dispose = () => {
    try {
      unlinkSync(path);
    } catch {}
    try {
      rmdirSync(directory);
    } catch {}
  };
  try {
    writeFileSync(path, JSON.stringify({ models: [metadata] }), { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    dispose();
    throw error;
  }
  return { path, dispose };
}
