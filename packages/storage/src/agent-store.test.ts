import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgentId,
  AgentVersionId,
  CredentialGroupId,
  CredentialRefId,
  ModelId,
} from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import {
  AgentDataError,
  DEFAULT_CONVERSATION_AGENT_ID,
  SqliteAgentStore,
  toModelBinding,
} from './agent-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-agent-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStore() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    dbPath,
    store: new SqliteAgentStore(connection.raw),
    raw: connection.raw,
    close: () => connection.raw.close(),
  };
}

describe('SqliteAgentStore', () => {
  it('seeds the default conversation agent once and is idempotent', async () => {
    const { store, close } = await openStore();
    try {
      const first = store.ensureConversationAgent({
        defaultModelId: 'model-a' as ModelId,
        fallbackModelIds: ['model-b' as ModelId, 'model-c' as ModelId],
        pauseOnFailure: true,
        now: '2026-07-12T00:00:00.000Z',
      });

      expect(first.agentId).toBe(DEFAULT_CONVERSATION_AGENT_ID);
      expect(first.version).toBe(1);
      expect(first.defaultModelId).toBe('model-a');
      expect(first.fallbackModelIds).toEqual(['model-b', 'model-c']);
      expect(first.pauseOnFailure).toBe(true);
      expect(first.name).toBe('Conversation');

      const second = store.ensureConversationAgent({
        defaultModelId: 'model-should-not-replace' as ModelId,
      });
      expect(second.id).toBe(first.id);
      expect(second.defaultModelId).toBe('model-a');
      expect(store.listVersions(DEFAULT_CONVERSATION_AGENT_ID)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('rejects empty default model on ensure and update', async () => {
    const { store, close } = await openStore();
    try {
      expect(() => store.ensureConversationAgent({ defaultModelId: '   ' as ModelId })).toThrow(
        /defaultModelId/,
      );

      store.ensureConversationAgent({ defaultModelId: 'model-a' as ModelId });
      expect(() =>
        store.updateBinding({
          agentId: DEFAULT_CONVERSATION_AGENT_ID,
          defaultModelId: '' as ModelId,
          fallbackModelIds: [],
        }),
      ).toThrow(/defaultModelId/);
    } finally {
      close();
    }
  });

  it('creates a new immutable version when binding changes', async () => {
    const { store, close } = await openStore();
    try {
      const v1 = store.ensureConversationAgent({
        defaultModelId: 'model-a' as ModelId,
        fallbackModelIds: ['model-b' as ModelId],
        now: '2026-07-12T01:00:00.000Z',
      });

      const v2 = store.updateBinding({
        agentId: DEFAULT_CONVERSATION_AGENT_ID,
        defaultModelId: 'model-z' as ModelId,
        fallbackModelIds: ['model-b' as ModelId, 'model-c' as ModelId, 'model-z' as ModelId],
        pauseOnFailure: false,
        now: '2026-07-12T02:00:00.000Z',
      });

      expect(v2.id).not.toBe(v1.id);
      expect(v2.version).toBe(2);
      expect(v2.defaultModelId).toBe('model-z');
      // default stripped from fallback chain; duplicates collapsed
      expect(v2.fallbackModelIds).toEqual(['model-b', 'model-c']);
      expect(v2.pauseOnFailure).toBe(false);
      // contracts / role preserved from prior version
      expect(v2.role).toBe(v1.role);
      expect(v2.developerInstructions).toBe(v1.developerInstructions);

      const versions = store.listVersions(DEFAULT_CONVERSATION_AGENT_ID);
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      expect(versions[0]?.defaultModelId).toBe('model-a');
      expect(store.getLatestVersion(DEFAULT_CONVERSATION_AGENT_ID)?.id).toBe(v2.id);
      expect(store.getVersion(v1.id)?.defaultModelId).toBe('model-a');
    } finally {
      close();
    }
  });

  it('does not substitute latest when an exact AgentVersion id is missing', async () => {
    const { store, close } = await openStore();
    try {
      const latest = store.ensureConversationAgent({
        defaultModelId: 'model-latest' as ModelId,
      });

      expect(store.getLatestVersion(DEFAULT_CONVERSATION_AGENT_ID)?.id).toBe(latest.id);
      expect(() => store.getRequiredAgentVersion('missing-version' as AgentVersionId)).toThrow(
        'AgentVersion not found',
      );
    } finally {
      close();
    }
  });

  it('creates complete definitions and preserves immutable history on update', async () => {
    const { store, close } = await openStore();
    try {
      const agentId = 'agent-planner' as AgentId;
      const v1 = store.createAgent({
        agentId,
        name: 'Planner v1',
        role: 'planner',
        developerInstructions: 'Plan against the acceptance criteria.',
        inputContract: 'task goal',
        outputContract: 'approved plan',
        defaultModelId: 'model-planner' as ModelId,
        defaultCredentialGroupId: 'credential-group-planner' as CredentialGroupId,
        pinnedCredentialRefId: 'credential-planner-primary' as CredentialRefId,
        pauseOnFailure: false,
        fallbackModelIds: ['model-reviewer' as ModelId],
        memoryScope: 'project',
        skillVersionIds: ['skill-plan-v1'],
        mcpServerIds: ['mcp-files'],
        policyId: 'policy-planner',
        approvalMode: 'delegate',
        now: '2026-07-13T01:00:00.000Z',
      });

      expect(v1).toMatchObject({
        agentId,
        version: 1,
        name: 'Planner v1',
        role: 'planner',
        developerInstructions: 'Plan against the acceptance criteria.',
        inputContract: 'task goal',
        outputContract: 'approved plan',
        defaultModelId: 'model-planner',
        defaultCredentialGroupId: 'credential-group-planner',
        pinnedCredentialRefId: 'credential-planner-primary',
        pauseOnFailure: false,
        fallbackModelIds: ['model-reviewer'],
        memoryScope: 'project',
        skillVersionIds: ['skill-plan-v1'],
        mcpServerIds: ['mcp-files'],
        policyId: 'policy-planner',
        approvalMode: 'delegate',
      });

      const v2 = store.updateDefinition({
        agentId,
        name: 'Planner v2',
        now: '2026-07-13T02:00:00.000Z',
      });

      expect(v2.id).not.toBe(v1.id);
      expect(v2.version).toBe(2);
      expect(v2.name).toBe('Planner v2');
      expect(v2.developerInstructions).toBe(v1.developerInstructions);
      expect(v2.defaultModelId).toBe(v1.defaultModelId);

      const historical = store.getRequiredAgentVersion(v1.id);
      expect(historical.name).toBe('Planner v1');
      expect(historical.createdAt).toBe('2026-07-13T01:00:00.000Z');
      expect(store.listAgentVersions(agentId).map((version) => version.id)).toEqual([v1.id, v2.id]);
    } finally {
      close();
    }
  });

  it('defaults, versions, validates, and persists maximum task concurrency', async () => {
    const { dbPath, store, close } = await openStore();
    const agentId = 'agent-concurrency' as AgentId;
    let v1: AgentVersionId;
    let v2: AgentVersionId;
    try {
      const defaulted = store.createAgent({
        agentId: 'agent-concurrency-default' as AgentId,
        name: 'Default concurrency',
        role: 'executor',
        developerInstructions: 'Execute.',
        inputContract: 'task',
        outputContract: 'result',
        defaultModelId: 'model-concurrency' as ModelId,
      });
      expect(defaulted.maxConcurrency).toBe(3);

      const created = store.createAgent({
        agentId,
        name: 'Concurrent executor',
        role: 'executor',
        developerInstructions: 'Execute independent tasks.',
        inputContract: 'task',
        outputContract: 'result',
        maxConcurrency: 8,
        defaultModelId: 'model-concurrency' as ModelId,
      });
      v1 = created.id;
      expect(created.maxConcurrency).toBe(8);

      const updated = store.updateDefinition({ agentId, maxConcurrency: 5 });
      v2 = updated.id;
      expect(updated.version).toBe(2);
      expect(updated.maxConcurrency).toBe(5);
      expect(store.getRequiredAgentVersion(v1).maxConcurrency).toBe(8);

      for (const invalid of [0, 17, 1.5]) {
        expect(() =>
          store.createAgent({
            agentId: `agent-concurrency-invalid-${invalid}` as AgentId,
            name: 'Invalid concurrency',
            role: 'executor',
            developerInstructions: 'Execute.',
            inputContract: 'task',
            outputContract: 'result',
            maxConcurrency: invalid,
            defaultModelId: 'model-concurrency' as ModelId,
          }),
        ).toThrow('maxConcurrency must be an integer between 1 and 16');
        expect(() => store.updateDefinition({ agentId, maxConcurrency: invalid })).toThrow(
          'maxConcurrency must be an integer between 1 and 16',
        );
      }
    } finally {
      close();
    }

    const reopened = await openDatabaseAsync({ path: dbPath, fileMustExist: true });
    try {
      const reopenedStore = new SqliteAgentStore(reopened.raw);
      expect(reopenedStore.getRequiredAgentVersion(v1!).maxConcurrency).toBe(8);
      expect(reopenedStore.getRequiredAgentVersion(v2!).maxConcurrency).toBe(5);
      expect(reopenedStore.getLatestVersion(agentId)?.id).toBe(v2!);
    } finally {
      reopened.raw.close();
    }
  });

  it('lists exactly the latest immutable version for every agent lineage', async () => {
    const { store, close } = await openStore();
    try {
      const conversationV1 = store.ensureConversationAgent({
        defaultModelId: 'model-conversation' as ModelId,
      });
      const conversationV2 = store.updateDefinition({
        agentId: conversationV1.agentId,
        name: 'Conversation v2',
      });
      const planner = store.createAgent({
        agentId: 'agent-planner-list' as AgentId,
        name: 'Planner',
        role: 'planner',
        developerInstructions: 'Plan.',
        inputContract: 'goal',
        outputContract: 'plan',
        defaultModelId: 'model-planner' as ModelId,
      });

      expect(store.listLatestVersions().map((item) => [item.agentId, item.id])).toEqual([
        [conversationV2.agentId, conversationV2.id],
        [planner.agentId, planner.id],
      ]);
    } finally {
      close();
    }
  });

  it('toModelBinding projects only resolution fields for core', async () => {
    const { store, close } = await openStore();
    try {
      const record = store.ensureConversationAgent({
        defaultModelId: 'model-a' as ModelId,
        fallbackModelIds: ['model-b' as ModelId],
      });
      const binding = toModelBinding(record);
      expect(binding).toEqual({
        agentVersionId: record.id,
        defaultModelId: 'model-a',
        fallbackModelIds: ['model-b'],
        pauseOnFailure: true,
        defaultCredentialGroupId: record.defaultCredentialGroupId,
        pinnedCredentialRefId: undefined,
      });
    } finally {
      close();
    }
  });

  it('updateBinding can start a new agent lineage without prior seed', async () => {
    const { store, close } = await openStore();
    try {
      const agentId = 'agent-custom' as AgentId;
      const created = store.updateBinding({
        agentId,
        defaultModelId: 'model-x' as ModelId,
        fallbackModelIds: [],
      });
      expect(created.agentId).toBe(agentId);
      expect(created.version).toBe(1);
      expect(store.getLatestVersion(agentId)?.defaultModelId).toBe('model-x');
    } finally {
      close();
    }
  });

  it('persists every AgentVersion definition field across immutable binding edits', async () => {
    const { store, close } = await openStore();
    try {
      const v1 = store.createAgent({
        agentId: 'agent-complete' as AgentId,
        name: 'Complete agent',
        description: 'Coordinates implementation and review.',
        visualIdentity: { icon: 'workflow', color: '#227755' },
        role: 'executor-reviewer',
        developerInstructions: 'Implement against the approved plan.',
        inputContract: 'Approved plan and context.',
        outputContract: 'Reviewed artifacts and evidence.',
        defaultModelId: 'model-primary' as ModelId,
        defaultCredentialGroupId: 'credential-group-complete' as CredentialGroupId,
        pinnedCredentialRefId: 'credential-complete' as CredentialRefId,
        pauseOnFailure: false,
        fallbackModelIds: ['model-fallback' as ModelId],
        memoryScope: 'project',
        skillVersionIds: ['skill-complete-v1'],
        mcpServerIds: ['mcp-files'],
        mcpToolAllowlist: ['read_file', 'write_file'],
        permissions: {
          file: ['workspace:read', 'workspace:write'],
          command: ['pnpm test'],
          browser: ['localhost'],
          desktop: ['focus-window'],
          network: ['api.example.test'],
        },
        policyId: 'policy-complete',
        approvalMode: 'delegate',
        reviewBehavior: {
          role: 'executor-reviewer',
          maxIterations: 3,
          onLimitReached: 'reassign',
        },
        artifactRules: {
          retainVersions: true,
          requireReview: true,
          defaultStatus: 'final',
        },
        now: '2026-07-14T01:00:00.000Z',
      });

      const v2 = store.updateBinding({
        agentId: v1.agentId,
        defaultModelId: 'model-next' as ModelId,
        fallbackModelIds: ['model-primary' as ModelId],
        now: '2026-07-14T02:00:00.000Z',
      });

      expect(v2.id).not.toBe(v1.id);
      expect(v2.version).toBe(2);
      expect(v2).toMatchObject({
        description: v1.description,
        visualIdentity: v1.visualIdentity,
        mcpToolAllowlist: v1.mcpToolAllowlist,
        permissions: v1.permissions,
        reviewBehavior: v1.reviewBehavior,
        artifactRules: v1.artifactRules,
      });
      expect(store.getRequiredAgentVersion(v1.id)).toMatchObject({
        defaultModelId: 'model-primary',
        description: 'Coordinates implementation and review.',
        visualIdentity: { icon: 'workflow', color: '#227755' },
      });
    } finally {
      close();
    }
  });

  it('requires an exact reviewer-capable configured backup AgentVersion', async () => {
    const { store, close } = await openStore();
    try {
      const nonReviewer = store.createAgent({
        agentId: 'agent-non-reviewer-backup' as AgentId,
        name: 'Non-reviewer backup',
        role: 'worker',
        developerInstructions: 'Execute.',
        inputContract: 'input',
        outputContract: 'output',
        defaultModelId: 'model-backup-validation' as ModelId,
      });
      const reviewerBackup = store.createAgent({
        agentId: 'agent-reviewer-backup' as AgentId,
        name: 'Reviewer backup',
        role: 'reviewer',
        developerInstructions: 'Review.',
        inputContract: 'artifacts',
        outputContract: 'review outcome',
        defaultModelId: 'model-backup-validation' as ModelId,
        reviewBehavior: {
          role: 'reviewer',
          maxIterations: 0,
          onLimitReached: 'pause',
        },
      });
      const primary = store.createAgent({
        agentId: 'agent-primary-with-backup' as AgentId,
        name: 'Primary reviewer',
        role: 'reviewer',
        developerInstructions: 'Review.',
        inputContract: 'artifacts',
        outputContract: 'review outcome',
        defaultModelId: 'model-backup-validation' as ModelId,
        reviewBehavior: {
          role: 'reviewer',
          maxIterations: 0,
          onLimitReached: 'reassign',
          backupAgentVersionId: reviewerBackup.id,
        },
      });
      expect(primary.reviewBehavior.backupAgentVersionId).toBe(reviewerBackup.id);

      expect(() =>
        store.createAgent({
          agentId: 'agent-primary-missing-backup' as AgentId,
          name: 'Missing backup',
          role: 'reviewer',
          developerInstructions: 'Review.',
          inputContract: 'artifacts',
          outputContract: 'review outcome',
          defaultModelId: 'model-backup-validation' as ModelId,
          reviewBehavior: {
            role: 'reviewer',
            maxIterations: 0,
            onLimitReached: 'reassign',
            backupAgentVersionId: 'missing-backup-version' as AgentVersionId,
          },
        }),
      ).toThrow('AgentVersion not found: missing-backup-version');
      expect(() =>
        store.createAgent({
          agentId: 'agent-primary-invalid-backup' as AgentId,
          name: 'Invalid backup',
          role: 'reviewer',
          developerInstructions: 'Review.',
          inputContract: 'artifacts',
          outputContract: 'review outcome',
          defaultModelId: 'model-backup-validation' as ModelId,
          reviewBehavior: {
            role: 'reviewer',
            maxIterations: 0,
            onLimitReached: 'reassign',
            backupAgentVersionId: nonReviewer.id,
          },
        }),
      ).toThrow('reviewBehavior.backup_reviewer_invalid');
    } finally {
      close();
    }
  });

  it('rejects review behavior above the authoritative iteration limit', async () => {
    const { store, close } = await openStore();
    try {
      expect(() =>
        store.createAgent({
          agentId: 'agent-review-limit' as AgentId,
          name: 'Review limit',
          role: 'reviewer',
          developerInstructions: 'Review.',
          inputContract: 'artifacts',
          outputContract: 'review outcome',
          defaultModelId: 'model-review-limit' as ModelId,
          reviewBehavior: {
            role: 'reviewer',
            maxIterations: 101,
            onLimitReached: 'pause',
          },
        }),
      ).toThrow('reviewBehavior.maxIterations exceeds 100');
    } finally {
      close();
    }
  });

  it('fails closed with a structured error when immutable AgentVersion data is corrupt', async () => {
    const { store, raw, close } = await openStore();
    const corruptions = [
      ['fallback_model_ids_json', '{'],
      ['skill_version_ids_json', '[1]'],
      ['mcp_server_ids_json', '{}'],
      ['mcp_tool_allowlist_json', '[""]'],
      ['visual_identity_json', '"invalid"'],
      ['permissions_json', '{"file":[]}'],
      ['review_behavior_json', '{"role":"reviewer","maxIterations":"2","onLimitReached":"pause"}'],
      [
        'artifact_rules_json',
        '{"retainVersions":true,"requireReview":"yes","defaultStatus":"candidate"}',
      ],
      ['memory_scope', 'invalid-scope'],
      ['approval_mode', 'invalid-mode'],
      ['version', 0],
      ['version', -1],
      ['version', 1.5],
      ['version', 9007199254740992],
      ['pause_on_failure', -1],
      ['pause_on_failure', 2],
    ] as const;

    try {
      for (const [index, [column, value]] of corruptions.entries()) {
        const agentId = `agent-corrupt-${index}` as AgentId;
        const version = store.createAgent({
          agentId,
          name: `Corrupt fixture ${index}`,
          role: 'executor',
          developerInstructions: 'Execute.',
          inputContract: 'input',
          outputContract: 'output',
          defaultModelId: 'model-corrupt-fixture' as ModelId,
        });
        raw.prepare(`UPDATE agent_version SET ${column} = ? WHERE id = ?`).run(value, version.id);

        let caught: unknown;
        try {
          store.getRequiredAgentVersion(version.id);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(AgentDataError);
        expect(caught).toMatchObject({
          code: 'agent.invalid_version',
          path: expect.stringContaining(column),
        });
        expect(() => store.listAgentVersions(agentId)).toThrowError(AgentDataError);
      }
    } finally {
      close();
    }
  });
});
