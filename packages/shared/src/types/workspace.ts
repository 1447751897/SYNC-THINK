import type { WorkspaceId, PolicyId } from './ids.js';
import type { ExecutionMode } from './enums.js';

export interface Workspace {
  id: WorkspaceId;
  /** Optional absolute, canonical local folder path used as the execution boundary. */
  folderPath?: string;
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  /** Policies scoped to this workspace; resolved most-restrictive wins. */
  policyId?: PolicyId;
  /**
   * Project default Codex execution mode for new root tasks.
   * Explicit Task.executionMode always wins after creation.
   */
  defaultExecutionMode?: ExecutionMode;
  /** User UI prefs (rail collapsed, theme, etc.) — UI-only, not security-relevant. */
  uiPrefs?: WorkspaceUiPrefs;
}

export interface WorkspaceUiPrefs {
  traceCollapsed?: boolean;
  messageLayout?: 'split' | 'single-column';
  theme?: 'light' | 'dark' | 'system';
}