import { describe, expect, it } from 'vitest';
import {
  projectContinuumEvidence,
  shouldShowContinuumStrip,
} from '../src/renderer/continuum-evidence.js';

describe('continuum evidence projection', () => {
  it('stays empty without an active task', () => {
    const entries = projectContinuumEvidence({
      hasActiveTask: false,
      memoryEntries: [
        {
          id: 'm1',
          key: 'stack',
          value: 'Next.js',
          scope: 'project',
          active: true,
        },
      ],
    });
    expect(entries).toEqual([]);
    expect(shouldShowContinuumStrip(entries)).toBe(false);
  });

  it('surfaces durable memory and artifacts only', () => {
    const entries = projectContinuumEvidence({
      hasActiveTask: true,
      memoryEntries: [
        {
          id: 'm1',
          key: 'tone',
          value: '简洁',
          scope: 'project',
          active: true,
        },
        {
          id: 'm2',
          key: 'old',
          value: 'deprecated',
          scope: 'task',
          active: false,
        },
      ],
      artifacts: [{ id: 'a1', name: '首页稿', versionLabel: 'v2' }],
      approvalPendingCount: 1,
      messageCount: 4,
    });

    expect(entries.map((entry) => entry.kind)).toEqual(['memory', 'artifact', 'review']);
    expect(entries[0]?.label).toBe('tone');
    expect(entries[1]?.label).toMatch(/首页稿/);
    expect(entries[2]?.label).toMatch(/待确认/);
    expect(shouldShowContinuumStrip(entries)).toBe(true);
  });

  it('adds a quiet context chip only when conversation has momentum and no other evidence', () => {
    const quiet = projectContinuumEvidence({
      hasActiveTask: true,
      messageCount: 1,
    });
    expect(quiet).toEqual([]);

    const live = projectContinuumEvidence({
      hasActiveTask: true,
      messageCount: 2,
    });
    expect(live).toHaveLength(1);
    expect(live[0]?.kind).toBe('context-transfer');
  });
});
