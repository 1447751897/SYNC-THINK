import { describe, expect, it } from 'vitest';
import { createDemoRun, parseDemoRuns, serializeDemoRuns } from './demo-run.js';

describe('DemoRun Skill snapshot persistence', () => {
  it('persists exact ids and fingerprints without duplicating Skill bodies', () => {
    const run = createDemoRun('run-skill-snapshot' as never, 'thread-1', 'hello', {
      globalAgentId: 'agent-1',
      globalAgentName: 'Builder',
      persona: 'Stable persona',
      skillVersionIds: ['skill-v2'],
      skillSnapshots: [
        { skillVersionId: 'skill-v2', contentFingerprint: 'fingerprint-v2' },
      ],
      skillPromptBlocks: ['### Skill: selected\nSECRET_SKILL_BODY_SHOULD_NOT_BE_DUPLICATED'],
      contextSources: [
        {
          id: 'skill:skill-v2',
          kind: 'skill-definition',
          section: 'agent',
          disposition: 'included',
          content: 'SECRET_SKILL_BODY_SHOULD_NOT_BE_DUPLICATED',
          tokens: 42,
        },
      ],
    });

    const serialized = serializeDemoRuns(new Map([[run.runId, run]]));
    expect(JSON.stringify(serialized)).not.toContain('SECRET_SKILL_BODY_SHOULD_NOT_BE_DUPLICATED');

    const restored = parseDemoRuns(serialized)[0]!;
    expect(restored.skillVersionIds).toEqual(['skill-v2']);
    expect(restored.skillSnapshots).toEqual([
      { skillVersionId: 'skill-v2', contentFingerprint: 'fingerprint-v2' },
    ]);
    expect(restored.globalAgentId).toBe('agent-1');
    expect(restored.globalAgentName).toBe('Builder');
    expect(restored.persona).toBe('Stable persona');
    expect(restored.skillPromptBlocks).toBeUndefined();
  });
});
