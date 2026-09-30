/** Expansion is a navigation preference, independent of the active workspace. */
const KEY = 'sync-think.sidebar.workspace-expansion.v1';
export type WorkspaceExpansion = Readonly<Record<string, boolean>>;
export function readWorkspaceExpansion(storage?: Pick<Storage, 'getItem'>): WorkspaceExpansion {
  try {
    const value: unknown = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([id, expanded]) => id.trim() && typeof expanded === 'boolean'),
    );
  } catch {
    return {};
  }
}
export function writeWorkspaceExpansion(
  value: WorkspaceExpansion,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify(value));
  } catch {
    /* Browsing still works when persistence is unavailable. */
  }
}
