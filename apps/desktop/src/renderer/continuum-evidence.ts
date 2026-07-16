import type { ContinuumRailEntry } from '@sync-think/ui-kit';
import type { MemoryEntryView } from '@sync-think/ui-kit';

export interface ContinuumArtifactSummary {
  id: string;
  name: string;
  versionLabel?: string;
}

export interface ProjectContinuumEvidenceInput {
  hasActiveTask: boolean;
  taskTitle?: string | null;
  workspaceName?: string | null;
  memoryEntries?: readonly MemoryEntryView[];
  artifacts?: readonly ContinuumArtifactSummary[];
  approvalPendingCount?: number;
  messageCount?: number;
}

/**
 * Product continuum: only durable / actionable evidence.
 * Scaffold (folder/task/thread) is intentionally omitted so the strip stays quiet
 * until there is something worth inspecting.
 */
export function projectContinuumEvidence(
  input: ProjectContinuumEvidenceInput,
): ContinuumRailEntry[] {
  if (!input.hasActiveTask) return [];

  const entries: ContinuumRailEntry[] = [];

  const memories = (input.memoryEntries ?? []).filter((entry) => entry.active);
  for (const entry of memories.slice(0, 6)) {
    entries.push({
      id: `memory:${entry.id}`,
      kind: 'memory',
      label: entry.key || entry.value.slice(0, 32) || '记忆',
    });
  }

  for (const artifact of (input.artifacts ?? []).slice(0, 6)) {
    entries.push({
      id: `artifact:${artifact.id}`,
      kind: 'artifact',
      label: artifact.versionLabel
        ? `${artifact.name} · ${artifact.versionLabel}`
        : artifact.name,
    });
  }

  if ((input.approvalPendingCount ?? 0) > 0) {
    entries.push({
      id: 'review:pending-approvals',
      kind: 'review',
      label: `${input.approvalPendingCount} 项待确认`,
    });
  }

  // A short lived "context" chip once the task has conversation momentum.
  if ((input.messageCount ?? 0) >= 2 && entries.length === 0) {
    entries.push({
      id: 'context:active-thread',
      kind: 'context-transfer',
      label: '任务上下文已连续',
    });
  }

  return entries;
}

export function shouldShowContinuumStrip(entries: readonly ContinuumRailEntry[]): boolean {
  return entries.length > 0;
}
