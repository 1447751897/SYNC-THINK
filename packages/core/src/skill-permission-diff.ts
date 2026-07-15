/**
 * Skill version permission diffs (§9.2 / §9.3 / §19).
 *
 * Design rules:
 * - Skill and MCP version changes expose permission diffs.
 * - A Skill version that adds new tools or permissions requires a new approval.
 * - Import does not execute scripts; this module only compares declared allow-lists.
 */

export interface SkillPermissionSnapshot {
  skillVersionId?: string;
  skillId?: string;
  name?: string;
  version?: string;
  allowedTools?: readonly string[];
  hasScripts?: boolean;
}

export interface SkillPermissionDiff {
  /** True when any tool/script permission surface grew. */
  requiresReapproval: boolean;
  addedTools: string[];
  removedTools: string[];
  unchangedTools: string[];
  scriptsAdded: boolean;
  scriptsRemoved: boolean;
  /** Human-readable one-line summary for UI status bars. */
  summary: string;
  previous?: {
    skillVersionId?: string;
    version?: string;
    allowedTools: string[];
    hasScripts: boolean;
  };
  next: {
    skillVersionId?: string;
    version?: string;
    allowedTools: string[];
    hasScripts: boolean;
  };
}

function normalizeTools(tools: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tools ?? []) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function formatList(items: string[], empty = 'none'): string {
  if (items.length === 0) return empty;
  if (items.length <= 4) return items.join(', ');
  return items.slice(0, 4).join(', ') + ' +' + (items.length - 4);
}

/**
 * Compare two skill permission surfaces.
 * When previous is missing, treat as first install: no reapproval (allowlist still explicit).
 */
export function diffSkillPermissions(
  previous: SkillPermissionSnapshot | null | undefined,
  next: SkillPermissionSnapshot,
): SkillPermissionDiff {
  const prevTools = normalizeTools(previous?.allowedTools);
  const nextTools = normalizeTools(next.allowedTools);
  const prevSet = new Set(prevTools.map((t) => t.toLowerCase()));
  const nextSet = new Set(nextTools.map((t) => t.toLowerCase()));

  const addedTools = nextTools.filter((t) => !prevSet.has(t.toLowerCase()));
  const removedTools = prevTools.filter((t) => !nextSet.has(t.toLowerCase()));
  const unchangedTools = nextTools.filter((t) => prevSet.has(t.toLowerCase()));

  const prevScripts = Boolean(previous?.hasScripts);
  const nextScripts = Boolean(next.hasScripts);
  const scriptsAdded = !prevScripts && nextScripts;
  const scriptsRemoved = prevScripts && !nextScripts;

  const isFirst = !previous;
  // Reapproval only when an existing version's permission surface expands.
  const requiresReapproval = !isFirst && (addedTools.length > 0 || scriptsAdded);

  const parts: string[] = [];
  if (isFirst) {
    parts.push('first import');
    if (nextTools.length > 0) parts.push('tools ' + formatList(nextTools));
    if (nextScripts) parts.push('scripts recorded');
  } else if (requiresReapproval) {
    parts.push('reapproval required');
    if (addedTools.length > 0) parts.push('+' + formatList(addedTools));
    if (scriptsAdded) parts.push('+scripts');
    if (removedTools.length > 0) parts.push('-' + formatList(removedTools));
  } else if (removedTools.length > 0 || scriptsRemoved) {
    parts.push('permissions narrowed');
    if (removedTools.length > 0) parts.push('-' + formatList(removedTools));
    if (scriptsRemoved) parts.push('-scripts');
  } else {
    parts.push('permissions unchanged');
  }

  return {
    requiresReapproval,
    addedTools,
    removedTools,
    unchangedTools,
    scriptsAdded,
    scriptsRemoved,
    summary: parts.join(' · '),
    previous: previous
      ? {
          skillVersionId: previous.skillVersionId,
          version: previous.version,
          allowedTools: prevTools,
          hasScripts: prevScripts,
        }
      : undefined,
    next: {
      skillVersionId: next.skillVersionId,
      version: next.version,
      allowedTools: nextTools,
      hasScripts: nextScripts,
    },
  };
}

/** Format a compact label for skill list rows. */
export function formatSkillPermissionDiffLabel(diff: SkillPermissionDiff): string {
  if (diff.requiresReapproval) {
    const add =
      diff.addedTools.length > 0
        ? '+' + diff.addedTools.length + ' tool' + (diff.addedTools.length === 1 ? '' : 's')
        : '';
    const scripts = diff.scriptsAdded ? '+scripts' : '';
    return ['需重新批准', add, scripts].filter(Boolean).join(' · ');
  }
  if (diff.previous && (diff.removedTools.length > 0 || diff.scriptsRemoved)) {
    return '权限收窄 · 无需加批';
  }
  if (diff.previous) return '权限未变';
  return diff.next.allowedTools.length > 0
    ? '新导入 · ' + diff.next.allowedTools.length + ' tools'
    : '新导入';
}
