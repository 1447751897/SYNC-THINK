import { describe, expect, it } from 'vitest';
import {
  buildContextPacket,
  selectContextSources,
  PROTECTED_SOURCE_KINDS,
  resolveCrossTaskRefs,
  resolveProjectMemorySources,
  applyUserContextAmendments,
  isProtectedSourceKind,
  resolveAllowedSkillSources,
  resolveAllowedMcpToolSources,
} from './context-packet.js';
import type { AgentVersionId, ModelId, TaskId } from '@sync-think/shared';

describe('buildContextPacket', () => {
  it('builds packet + inspectable manifest with proof hash', () => {
    const { packet, manifest } = buildContextPacket({
      packetId: 'pkt-1',
      taskId: 'task-1' as TaskId,
      agentVersionId: 'agent-v1' as AgentVersionId,
      modelId: 'model-1' as ModelId,
      createdAt: '2026-07-12T00:00:00.000Z',
      included: [
        { id: 'src-goal', kind: 'task-goal', tokenEstimate: 40 },
        { id: 'src-msg', kind: 'message-excerpt', tokenEstimate: 120 },
      ],
      excluded: [{ id: 'src-old', kind: 'file-excerpt', tokenEstimate: 900 }],
    });

    expect(packet.id).toBe('pkt-1');
    expect(packet.tokenEstimate).toBe(160);
    expect(packet.proofHash).toMatch(/^[a-f0-9]{32}$/);
    expect(manifest.packetId).toBe('pkt-1');
    expect(manifest.included).toHaveLength(2);
    expect(manifest.excluded).toHaveLength(1);
    expect(manifest.summaries[0]?.sourceId).toBe('src-goal');
  });
});

describe('selectContextSources — protected goals/decisions/acceptance', () => {
  const taskGoal = { id: 'src-goal', kind: 'task-goal' as const, tokenEstimate: 80 };
  const acceptance = { id: 'src-accept', kind: 'acceptance-criteria' as const, tokenEstimate: 60 };
  const decision = { id: 'src-decision', kind: 'decision' as const, tokenEstimate: 40 };
  const message = { id: 'src-msg', kind: 'message-excerpt' as const, tokenEstimate: 500 };
  const file = { id: 'src-file', kind: 'file-excerpt' as const, tokenEstimate: 400 };
  const agent = { id: 'src-agent', kind: 'agent-instructions' as const, tokenEstimate: 32 };

  it('exports protected kinds including goal, decision, acceptance', () => {
    expect(PROTECTED_SOURCE_KINDS.has('task-goal')).toBe(true);
    expect(PROTECTED_SOURCE_KINDS.has('decision')).toBe(true);
    expect(PROTECTED_SOURCE_KINDS.has('acceptance-criteria')).toBe(true);
    expect(PROTECTED_SOURCE_KINDS.has('message-excerpt')).toBe(false);
  });

  it('keeps all sources when under budget', () => {
    const result = selectContextSources({
      candidates: [taskGoal, acceptance, decision, message, agent],
      tokenBudget: 10_000,
    });
    expect(result.overflow).toBe(false);
    expect(result.included.map((s) => s.id)).toEqual([
      'src-goal',
      'src-accept',
      'src-decision',
      'src-msg',
      'src-agent',
    ]);
    expect(result.excluded).toHaveLength(0);
    expect(result.protectedPreserved).toBe(true);
  });

  it('never silently drops protected sources when over budget', () => {
    const result = selectContextSources({
      candidates: [taskGoal, acceptance, decision, message, file, agent],
      tokenBudget: 220,
    });
    expect(result.overflow).toBe(true);
    expect(result.protectedPreserved).toBe(true);
    const kinds = result.included.map((s) => s.kind);
    expect(kinds).toContain('task-goal');
    expect(kinds).toContain('acceptance-criteria');
    expect(kinds).toContain('decision');
    expect(result.excluded.some((s) => s.kind === 'task-goal')).toBe(false);
    expect(result.excluded.some((s) => s.kind === 'decision')).toBe(false);
    expect(result.excluded.some((s) => s.kind === 'acceptance-criteria')).toBe(false);
    expect(
      result.excluded.some((s) => s.kind === 'file-excerpt' || s.kind === 'message-excerpt'),
    ).toBe(true);
  });

  it('keeps protected even when they alone exceed budget (visible overflow)', () => {
    const fatGoal = { id: 'fat-goal', kind: 'task-goal' as const, tokenEstimate: 900 };
    const fatDecision = { id: 'fat-dec', kind: 'decision' as const, tokenEstimate: 900 };
    const result = selectContextSources({
      candidates: [fatGoal, fatDecision, message],
      tokenBudget: 100,
    });
    expect(result.overflow).toBe(true);
    expect(result.included.map((s) => s.id).sort()).toEqual(['fat-dec', 'fat-goal']);
    expect(result.excluded.map((s) => s.id)).toEqual(['src-msg']);
    expect(result.protectedPreserved).toBe(true);
  });

  it('records truncation metadata for compressible sources when budget shrinks them', () => {
    const result = selectContextSources({
      candidates: [
        taskGoal,
        { id: 'long-msg', kind: 'message-excerpt' as const, tokenEstimate: 1000 },
      ],
      tokenBudget: 200,
      allowSoftTruncateKinds: ['message-excerpt'],
    });
    expect(result.included.some((s) => s.id === 'src-goal')).toBe(true);
    const msg = result.included.find((s) => s.id === 'long-msg');
    expect(msg).toBeTruthy();
    expect(msg!.tokenEstimate).toBeLessThan(1000);
    expect(result.truncations.length).toBeGreaterThan(0);
    expect(result.truncations[0]?.sourceId).toBe('long-msg');
    expect(result.truncations[0]?.reason).toMatch(/budget|protect|truncat/i);
  });

  it('feeds protected selection into buildContextPacket manifest', () => {
    const selected = selectContextSources({
      candidates: [taskGoal, message, file],
      tokenBudget: 120,
    });
    const { packet, manifest } = buildContextPacket({
      packetId: 'pkt-protect',
      taskId: 'task-1' as TaskId,
      agentVersionId: 'agent-v1' as AgentVersionId,
      modelId: 'model-1' as ModelId,
      createdAt: '2026-07-12T00:00:00.000Z',
      included: selected.included,
      excluded: selected.excluded,
      truncations: selected.truncations,
    });
    expect(packet.includedSources.some((s) => s.kind === 'task-goal')).toBe(true);
    expect(manifest.excluded.some((s) => s.kind === 'task-goal')).toBe(false);
    expect(packet.tokenEstimate).toBe(
      selected.included.reduce((n, s) => n + s.tokenEstimate, 0),
    );
  });
});


describe('resolveCrossTaskRefs — explicit parent only (§10.1)', () => {
  it('returns empty when task has no parent', () => {
    const result = resolveCrossTaskRefs({
      taskId: 'child-1',
      parentTaskId: undefined,
    });
    expect(result.crossTaskRefs).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.summaries).toEqual([]);
  });

  it('includes parent goal as cross-task-ref only when parent is resolved', () => {
    const result = resolveCrossTaskRefs({
      taskId: 'child-1',
      parentTaskId: 'parent-9',
      parent: {
        id: 'parent-9',
        title: 'Parent plan',
        goal: 'Ship multi-model conversation alpha',
        status: 'active',
        acceptanceCriteria: ['Manifest inspectable'],
      },
    });
    expect(result.crossTaskRefs).toEqual(['parent-9']);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.kind).toBe('cross-task-ref');
    expect(result.sources[0]?.id).toContain('parent-9');
    expect(result.summaries[0]?.summary).toMatch(/Parent plan|Ship multi-model/);
  });

  it('does not invent refs when parentTaskId is set but parent record is missing', () => {
    const result = resolveCrossTaskRefs({
      taskId: 'child-1',
      parentTaskId: 'missing-parent',
      parent: undefined,
    });
    expect(result.crossTaskRefs).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it('feeds cross-task sources into packet selection + manifest', () => {
    const xref = resolveCrossTaskRefs({
      taskId: 'child-1',
      parentTaskId: 'parent-9',
      parent: {
        id: 'parent-9',
        title: 'M1 parent',
        goal: 'Hold binding precedence',
        status: 'active',
        acceptanceCriteria: [],
      },
    });
    const selected = selectContextSources({
      candidates: [
        { id: 'src-goal', kind: 'task-goal', tokenEstimate: 40 },
        ...xref.sources,
        { id: 'src-msg', kind: 'message-excerpt', tokenEstimate: 80 },
      ],
      tokenBudget: 10_000,
    });
    const { packet, manifest } = buildContextPacket({
      packetId: 'pkt-xref',
      taskId: 'child-1' as TaskId,
      agentVersionId: 'agent-v1' as AgentVersionId,
      modelId: 'model-1' as ModelId,
      createdAt: '2026-07-12T00:00:00.000Z',
      included: selected.included,
      excluded: selected.excluded,
      crossTaskRefs: xref.crossTaskRefs,
      summaries: xref.summaries,
    });
    expect(packet.crossTaskRefs).toEqual(['parent-9']);
    expect(manifest.crossTaskRefs).toEqual(['parent-9']);
    expect(packet.includedSources.some((s) => s.kind === 'cross-task-ref')).toBe(true);
  });
});


describe('resolveProjectMemorySources — design §10.1 layer 2', () => {
  it('maps active entries to project-memory sources + summaries + evidence', () => {
    const result = resolveProjectMemorySources({
      entries: [
        {
          id: 'mem-1',
          key: 'binding-precedence',
          value: 'run override beats agent default',
          scope: 'task',
          taskId: 'task-a',
        },
        {
          id: 'mem-2',
          key: 'theme',
          value: 'Continuum Bench, no orbs',
          scope: 'project',
        },
      ],
    });
    expect(result.sources).toHaveLength(2);
    expect(result.sources.every((s) => s.kind === 'project-memory')).toBe(true);
    expect(result.sources[0]?.id).toBe('memory:mem-1');
    expect(result.summaries[0]?.summary).toMatch(/binding-precedence|run override/);
    expect(result.evidenceRefs).toEqual(expect.arrayContaining(['memory:mem-1', 'memory:mem-2']));
    expect(result.sources[0]!.tokenEstimate).toBeGreaterThan(0);
  });

  it('caps entries and prefers task scope over project/global', () => {
    const result = resolveProjectMemorySources({
      maxEntries: 2,
      entries: [
        { id: 'g1', key: 'global-pref', value: 'zh-CN', scope: 'global' },
        { id: 'p1', key: 'project-note', value: 'alpha cut', scope: 'project' },
        { id: 't1', key: 'task-fact', value: 'must keep goal', scope: 'task', taskId: 't' },
        { id: 't2', key: 'task-fact-2', value: 'second', scope: 'task', taskId: 't' },
      ],
    });
    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((s) => s.id)).toEqual(['memory:t1', 'memory:t2']);
  });

  it('skips empty keys/values and never invents sources from empty list', () => {
    const result = resolveProjectMemorySources({
      entries: [
        { id: 'bad', key: '  ', value: 'x', scope: 'task' },
        { id: 'bad2', key: 'k', value: '  ', scope: 'project' },
      ],
    });
    expect(result.sources).toEqual([]);
    expect(result.summaries).toEqual([]);
    expect(result.evidenceRefs).toEqual([]);
  });

  it('scrubs secret-like substrings from summaries', () => {
    const result = resolveProjectMemorySources({
      entries: [
        {
          id: 'sec',
          key: 'note',
          value: 'gateway uses sk-abcdefghijklmnopqrstuvwxyz123456 and ok',
          scope: 'task',
        },
      ],
    });
    expect(result.summaries[0]?.summary).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
    expect(result.summaries[0]?.summary).toMatch(/\[redacted\]|note/);
  });

  it('project-memory is compressible under selectContextSources budget', () => {
    const mem = resolveProjectMemorySources({
      entries: [
        { id: 'm1', key: 'a', value: 'x'.repeat(400), scope: 'project' },
        { id: 'm2', key: 'b', value: 'y'.repeat(400), scope: 'project' },
      ],
    });
    const selected = selectContextSources({
      candidates: [
        { id: 'src-goal', kind: 'task-goal', tokenEstimate: 40 },
        ...mem.sources,
        { id: 'src-msg', kind: 'message-excerpt', tokenEstimate: 20 },
      ],
      tokenBudget: 80,
      allowSoftTruncateKinds: ['project-memory', 'message-excerpt'],
    });
    expect(selected.included.some((s) => s.kind === 'task-goal')).toBe(true);
    // memory may be excluded or truncated, but goal stays
    expect(selected.protectedPreserved).toBe(true);
  });
});


describe('applyUserContextAmendments — design §10.3', () => {
  const goal = { id: 'task-goal:t1', kind: 'task-goal' as const, tokenEstimate: 40 };
  const accept = { id: 'acceptance:t1', kind: 'acceptance-criteria' as const, tokenEstimate: 20 };
  const msg = { id: 'msg:1', kind: 'message-excerpt' as const, tokenEstimate: 80 };
  const mem = { id: 'memory:m1', kind: 'project-memory' as const, tokenEstimate: 24 };
  const status = { id: 'task-status:t1', kind: 'task-status' as const, tokenEstimate: 8 };

  it('force-excludes non-protected sources and recomputes tokens', () => {
    const result = applyUserContextAmendments({
      included: [goal, accept, msg, mem, status],
      excluded: [],
      forceExcludeSourceIds: ['msg:1', 'memory:m1'],
      summaries: [
        { sourceId: 'msg:1', summary: 'user said hi' },
        { sourceId: 'memory:m1', summary: 'binding rule' },
        { sourceId: 'task-goal:t1', summary: 'ship it' },
      ],
      evidenceRefsForMemory: ['memory:m1'],
    });
    expect(result.amended).toBe(true);
    expect(result.appliedExcludeIds.sort()).toEqual(['memory:m1', 'msg:1']);
    expect(result.refusedProtectedIds).toEqual([]);
    expect(result.included.map((s) => s.id)).toEqual(['task-goal:t1', 'acceptance:t1', 'task-status:t1']);
    expect(result.excluded.map((s) => s.id).sort()).toEqual(['memory:m1', 'msg:1']);
    expect(result.tokenEstimate).toBe(40 + 20 + 8);
    expect(result.evidenceRefsForMemory).toEqual([]);
  });

  it('refuses protected kinds without dropping them (§20.9)', () => {
    const result = applyUserContextAmendments({
      included: [goal, accept, msg],
      forceExcludeSourceIds: ['task-goal:t1', 'acceptance:t1', 'msg:1'],
    });
    expect(result.refusedProtectedIds.sort()).toEqual(['acceptance:t1', 'task-goal:t1']);
    expect(result.appliedExcludeIds).toEqual(['msg:1']);
    expect(result.included.map((s) => s.id)).toEqual(['task-goal:t1', 'acceptance:t1']);
    expect(result.excluded.map((s) => s.id)).toEqual(['msg:1']);
    expect(isProtectedSourceKind('task-goal')).toBe(true);
    expect(isProtectedSourceKind('project-memory')).toBe(false);
  });

  it('is idempotent for already-excluded ids and ignores unknown ids', () => {
    const result = applyUserContextAmendments({
      included: [goal, msg],
      excluded: [mem],
      forceExcludeSourceIds: ['memory:m1', 'ghost:x', 'msg:1'],
    });
    expect(result.appliedExcludeIds).toEqual(['msg:1']);
    expect(result.excluded.map((s) => s.id).sort()).toEqual(['memory:m1', 'msg:1']);
    expect(result.included.map((s) => s.id)).toEqual(['task-goal:t1']);
  });

  it('feeds amended selection into buildContextPacket proof', () => {
    const baseIncluded = [goal, msg, mem];
    const amended = applyUserContextAmendments({
      included: baseIncluded,
      forceExcludeSourceIds: ['msg:1'],
    });
    const { packet, manifest } = buildContextPacket({
      packetId: 'pkt-amend',
      taskId: 'task-1' as TaskId,
      agentVersionId: 'agent-v1' as AgentVersionId,
      modelId: 'model-1' as ModelId,
      createdAt: '2026-07-12T00:00:00.000Z',
      included: amended.included,
      excluded: amended.excluded,
    });
    expect(packet.includedSources.map((s) => s.id)).toEqual(['task-goal:t1', 'memory:m1']);
    expect(packet.excludedSources.some((s) => s.id === 'msg:1')).toBe(true);
    expect(manifest.excluded.some((s) => s.id === 'msg:1')).toBe(true);
    expect(packet.proofHash).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('resolveAllowedSkillSources — allowlist only (§9.1 / §10.2)', () => {
  const catalog = new Map([
    [
      'skv-alpha',
      {
        id: 'skv-alpha',
        name: 'minimal',
        version: '0.1.0',
        description: 'A minimal skill for import.',
        body: 'This is a minimal skill body with structured guidance for the agent.',
        allowedTools: [] as string[],
        hasScripts: false,
      },
    ],
    [
      'skv-scripts',
      {
        id: 'skv-scripts',
        name: 'with-scripts',
        version: '0.1.0',
        description: 'Has scripts that must not execute by default.',
        body: 'This skill declares a script.\nscripts/check.sh: echo no',
        allowedTools: ['shell-exec'],
        hasScripts: true,
      },
    ],
  ]);

  it('maps only allowlisted skills into skill-definition sources', () => {
    const result = resolveAllowedSkillSources({
      skillVersionIds: ['skv-alpha', 'skv-scripts'],
      getSkill: (id) => catalog.get(id),
    });
    expect(result.sources).toHaveLength(2);
    expect(result.sources.every((s) => s.kind === 'skill-definition')).toBe(true);
    expect(result.resolvedSkillVersionIds).toEqual(['skv-alpha', 'skv-scripts']);
    expect(result.missingSkillVersionIds).toEqual([]);
    expect(result.summaries[0]?.summary).toMatch(/minimal@0\.1\.0/);
    expect(result.summaries[1]?.summary).toMatch(/脚本|scripts|shell/i);
    expect(JSON.stringify(result.summaries)).not.toContain('structured guidance for the agent');
  });

  it('skips missing library entries and reports them', () => {
    const result = resolveAllowedSkillSources({
      skillVersionIds: ['skv-alpha', 'skv-gone'],
      getSkill: (id) => catalog.get(id),
    });
    expect(result.sources).toHaveLength(1);
    expect(result.resolvedSkillVersionIds).toEqual(['skv-alpha']);
    expect(result.missingSkillVersionIds).toEqual(['skv-gone']);
  });

  it('dedupes allowlist ids and respects an optional maxSkills cap', () => {
    const result = resolveAllowedSkillSources({
      skillVersionIds: ['skv-alpha', 'skv-alpha', 'skv-scripts'],
      getSkill: (id) => catalog.get(id),
      maxSkills: 1,
    });
    expect(result.sources).toHaveLength(1);
    expect(result.resolvedSkillVersionIds).toEqual(['skv-alpha']);
  });

  it('includes every allowlisted Skill when maxSkills is omitted', () => {
    const ids = Array.from({ length: 9 }, (_, index) => `skv-${index}`);
    const result = resolveAllowedSkillSources({
      skillVersionIds: ids,
      getSkill: (id) => ({
        id,
        name: id,
        version: '1.0.0',
        description: id,
        body: `${id} body`,
        contentFingerprint: `fp-${id}`,
      }),
    });
    expect(result.resolvedSkillVersionIds).toEqual(ids);
    expect(result.sources).toHaveLength(9);
  });

  it('returns the same bounded exact content used for Provider prompt assembly', () => {
    const body = 'B'.repeat(500);
    const result = resolveAllowedSkillSources({
      skillVersionIds: ['skv-bounded'],
      getSkill: () => ({
        id: 'skv-bounded',
        name: 'bounded',
        version: '2.0.0',
        description: 'bounded prompt',
        body,
        contentFingerprint: 'fingerprint-bounded',
      }),
      bodyMaxChars: 200,
    });
    expect(result.resolvedSkills).toEqual([
      {
        sourceId: 'skill:skv-bounded',
        skillVersionId: 'skv-bounded',
        name: 'bounded',
        version: '2.0.0',
        body: 'B'.repeat(200),
        contentFingerprint: 'fingerprint-bounded',
      },
    ]);
    expect(result.truncations).toEqual([
      expect.objectContaining({ sourceId: 'skill:skv-bounded', reason: 'skill-body-limit' }),
    ]);
  });

  it('returns empty when allowlist is empty (install ≠ available)', () => {
    const result = resolveAllowedSkillSources({
      skillVersionIds: [],
      getSkill: (id) => catalog.get(id),
    });
    expect(result.sources).toEqual([]);
    expect(result.summaries).toEqual([]);
  });

  it('feeds skill-definition into selection + manifest', () => {
    const skills = resolveAllowedSkillSources({
      skillVersionIds: ['skv-alpha'],
      getSkill: (id) => catalog.get(id),
    });
    const selected = selectContextSources({
      candidates: [
        { id: 'src-goal', kind: 'task-goal', tokenEstimate: 40 },
        ...skills.sources,
        { id: 'src-msg', kind: 'message-excerpt', tokenEstimate: 80 },
      ],
      tokenBudget: 10_000,
    });
    const { packet, manifest } = buildContextPacket({
      packetId: 'pkt-skill',
      taskId: 'task-1' as TaskId,
      agentVersionId: 'agent-v1' as AgentVersionId,
      modelId: 'model-1' as ModelId,
      createdAt: '2026-07-12T00:00:00.000Z',
      included: selected.included,
      excluded: selected.excluded,
      skillVersionIds: skills.resolvedSkillVersionIds as never,
      summaries: skills.summaries,
    });
    expect(packet.includedSources.some((s) => s.kind === 'skill-definition')).toBe(true);
    expect(manifest.skillVersionIds).toEqual(['skv-alpha']);
    expect(manifest.summaries.some((s) => s.sourceId.startsWith('skill:'))).toBe(true);
  });

  it('skill-definition is compressible under tight budget (not protected)', () => {
    const skills = resolveAllowedSkillSources({
      skillVersionIds: ['skv-alpha'],
      getSkill: (id) => catalog.get(id),
    });
    const fatSkill = {
      ...skills.sources[0]!,
      tokenEstimate: 900,
    };
    const result = selectContextSources({
      candidates: [
        { id: 'src-goal', kind: 'task-goal', tokenEstimate: 80 },
        fatSkill,
      ],
      tokenBudget: 100,
    });
    expect(result.protectedPreserved).toBe(true);
    expect(result.included.some((s) => s.kind === 'task-goal')).toBe(true);
    // skill may be excluded when budget is tight
    expect(
      result.excluded.some((s) => s.kind === 'skill-definition') ||
        result.included.some((s) => s.kind === 'skill-definition' && s.tokenEstimate < 900),
    ).toBe(true);
  });
});

describe('resolveAllowedMcpToolSources — allowlist only (§9.3 / §10.2)', () => {
  const servers = new Map([
    [
      'mcp-fs',
      {
        id: 'mcp-fs',
        name: 'filesystem',
        transport: 'local-stdio',
        trusted: false,
        tools: [
          {
            name: 'read_file',
            description: 'Read a path',
            inputSchemaJson: '{"type":"object","properties":{"path":{"type":"string"}}}',
          },
          { name: 'list_dir', description: 'List dir' },
        ],
      },
    ],
    [
      'mcp-search',
      {
        id: 'mcp-search',
        name: 'search',
        transport: 'remote-http',
        trusted: true,
        tools: [{ name: 'web_search', description: 'Search the web' }],
      },
    ],
  ]);

  const getServer = (id: string) => servers.get(id);

  it('maps only allowlisted servers into tool-schema sources', () => {
    const result = resolveAllowedMcpToolSources({
      mcpServerIds: ['mcp-fs', 'mcp-missing'],
      getServer,
    });
    expect(result.sources.every((s) => s.kind === 'tool-schema')).toBe(true);
    expect(result.toolSchemaCount).toBe(2);
    expect(result.resolvedMcpServerIds).toEqual(['mcp-fs']);
    expect(result.missingMcpServerIds).toEqual(['mcp-missing']);
    expect(result.sources.map((s) => s.id)).toEqual([
      'tool:mcp-fs:read_file',
      'tool:mcp-fs:list_dir',
    ]);
  });

  it('empty allowlist yields no tool-schema', () => {
    const result = resolveAllowedMcpToolSources({
      mcpServerIds: [],
      getServer,
    });
    expect(result.sources).toHaveLength(0);
    expect(result.toolSchemaCount).toBe(0);
  });

  it('respects maxTools cap', () => {
    const result = resolveAllowedMcpToolSources({
      mcpServerIds: ['mcp-fs', 'mcp-search'],
      getServer,
      maxTools: 1,
    });
    expect(result.sources).toHaveLength(1);
  });

  it('feeds tool-schema into selection + manifest', () => {
    const tools = resolveAllowedMcpToolSources({
      mcpServerIds: ['mcp-search'],
      getServer,
    });
    const selected = selectContextSources({
      candidates: [
        { id: 'task-goal:t1', kind: 'task-goal', tokenEstimate: 20 },
        ...tools.sources,
      ],
      tokenBudget: 8_000,
      allowSoftTruncateKinds: ['tool-schema'],
    });
    const { packet } = buildContextPacket({
      packetId: 'p-mcp',
      taskId: 'task-1' as never,
      agentVersionId: 'av-1' as never,
      modelId: 'm-1' as never,
      createdAt: '2026-07-12T00:00:00.000Z',
      included: selected.included,
      excluded: selected.excluded,
      summaries: tools.summaries,
    });
    expect(packet.includedSources.some((s) => s.kind === 'tool-schema')).toBe(true);
    expect(tools.summaries[0]?.summary).toMatch(/MCP · search\/web_search/);
  });

  it('tool-schema is compressible under tight budget (not protected)', () => {
    const tools = resolveAllowedMcpToolSources({
      mcpServerIds: ['mcp-fs'],
      getServer,
    });
    // inflate estimates
    const inflated = tools.sources.map((s) => ({ ...s, tokenEstimate: 900 }));
    const result = selectContextSources({
      candidates: [
        { id: 'task-goal:t1', kind: 'task-goal', tokenEstimate: 40 },
        ...inflated,
      ],
      tokenBudget: 80,
      allowSoftTruncateKinds: ['tool-schema'],
    });
    expect(
      result.excluded.some((s) => s.kind === 'tool-schema') ||
        result.included.some((s) => s.kind === 'tool-schema' && s.tokenEstimate < 900),
    ).toBe(true);
  });
});
