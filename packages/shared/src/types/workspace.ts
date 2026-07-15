import type { WorkspaceId, PolicyId } from './ids.js';

export interface Workspace {
  id: WorkspaceId;
  /** Absolute, canonical local folder path that defines the workspace boundary. */
  folderPath: string;
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  /** Policies scoped to this workspace; resolved most-restrictive wins. */
  policyId?: PolicyId;
  /** User UI prefs (rail collapsed, theme, etc.) — UI-only, not security-relevant. */
  uiPrefs?: WorkspaceUiPrefs;
}

export interface WorkspaceUiPrefs {
  traceCollapsed?: boolean;
  messageLayout?: 'split' | 'single-column';
  theme?: 'light' | 'dark' | 'system';
}
