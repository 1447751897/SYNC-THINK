import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteCapabilityStore,
  SqliteGlobalAgentStore,
  SqliteMcpStore,
  SqliteSkillStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { DemoRunState } from '../src/demo-run.js';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly retain a native SQLite handle.
    }
  }
});

describe('capability execution governance', () => {
  it('uses the conversation workspace for Skill and MCP three-layer intersection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-capability-execution-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
    const skillStore = new SqliteSkillStore(connection.raw);
    const mcpStore = new SqliteMcpStore(connection.raw);
    const capabilityStore = new SqliteCapabilityStore(connection.raw);
    const defaultWorkspaceId = 'workspace-default' as WorkspaceId;
    const conversationWorkspaceId = 'workspace-conversation' as WorkspaceId;
    workspaceStore.createWorkspace({
      id: defaultWorkspaceId,
      name: 'Default Workspace',
      folderPath: join(dir, 'default'),
      allowedRoots: [join(dir, 'default')],
    });
    workspaceStore.createWorkspace({
      id: conversationWorkspaceId,
      name: 'Conversation Workspace',
      folderPath: join(dir, 'conversation'),
      allowedRoots: [join(dir, 'conversation')],
    });
    const task = workspaceStore.createTask({
      workspaceId: conversationWorkspaceId,
      title: 'Conversation workspace task',
      goal: 'Use the task workspace rather than the Runtime default',
    });
    const skill = skillStore.importVersion({
      name: 'workspace-skill',
      description: 'Workspace Skill',
      version: '1.0.0',
      sourceMd: '# Workspace Skill\nFollow the workspace rule.',
      body: 'Follow the workspace rule.',
      contentFingerprint: 'workspace-skill-v1',
    });
    const composeSkill = skillStore.importVersion({
      name: 'compose-skill',
      description: 'Compose-only Skill',
      version: '1.0.0',
      sourceMd: '# Compose Skill\nFollow the explicit workspace selection.',
      body: 'Follow the explicit workspace selection.',
      contentFingerprint: 'compose-skill-v1',
    });
    const boundMcp = mcpStore.register({
      name: 'bound-mcp',
      endpoint: 'stdio://bound-mcp',
      tools: [{ name: 'inspect', description: 'Inspect the workspace fixture' }],
    });
    const unboundMcp = mcpStore.register({
      name: 'unbound-mcp',
      endpoint: 'stdio://unbound-mcp',
      tools: [{ name: 'hidden', description: 'Must stay hidden' }],
    });
    const agent = globalAgentStore.create({
      name: 'Governed Agent',
      defaultModelId: 'fake-mini' as never,
      skillIds: [skill.id],
      mcpServerIds: [boundMcp.id],
    });

    capabilityStore.setWorkspaceActivation({
      capabilityType: 'skill',
      capabilityId: skill.id,
      workspaceId: defaultWorkspaceId,
      active: true,
    });
    capabilityStore.setWorkspaceActivation({
      capabilityType: 'mcp',
      capabilityId: boundMcp.id,
      workspaceId: defaultWorkspaceId,
      active: true,
    });
    capabilityStore.setWorkspaceActivation({
      capabilityType: 'mcp',
      capabilityId: unboundMcp.id,
      workspaceId: conversationWorkspaceId,
      active: true,
    });

    const runtime = new Runtime({
      installId: 'capability-execution-governance',
      allowNoToken: true,
      workspaceId: defaultWorkspaceId,
      checkpointRunId: 'runtime-capability-execution-governance' as RunId,
      workspaceStore,
      globalAgentStore,
      skillStore,
      mcpStore,
      capabilityStore,
    });
    const internal = runtime as unknown as {
      authorizeRunSkillSelection(input: {
        workspaceId: string;
        globalAgentId: string;
        skillVersionIds: string[];
      }): void;
      prepareRunBinding(input: {
        runId: RunId;
        threadId: string;
        userText: string;
        globalAgentId: string;
        skillVersionIds: string[];
      }): { run: DemoRunState; skillVersionIds: string[]; mcpServerIds: string[] };
      executeChatMcpCatalogTool(run: DemoRunState): string;
      executeChatBoundMcpTool(input: {
        run: DemoRunState;
        mcpServerId: string;
        toolName: string;
        toolCallId: string;
      }): Promise<string>;
      openProviderStream(
        run: DemoRunState,
        options: {
          messages: Array<{ role: 'user'; content: string }>;
          toolsEnabled: boolean;
        },
      ): Promise<unknown>;
    };

    try {
      expect(() =>
        internal.authorizeRunSkillSelection({
          workspaceId: conversationWorkspaceId,
          globalAgentId: agent.id,
          skillVersionIds: [skill.id],
        }),
      ).toThrow(/allowlist|allowlisted/i);

      capabilityStore.setWorkspaceActivation({
        capabilityType: 'skill',
        capabilityId: skill.id,
        workspaceId: conversationWorkspaceId,
        active: true,
      });
      capabilityStore.setWorkspaceActivation({
        capabilityType: 'skill',
        capabilityId: composeSkill.id,
        workspaceId: conversationWorkspaceId,
        active: true,
      });
      capabilityStore.setWorkspaceActivation({
        capabilityType: 'mcp',
        capabilityId: boundMcp.id,
        workspaceId: conversationWorkspaceId,
        active: true,
      });
      expect(() =>
        internal.authorizeRunSkillSelection({
          workspaceId: conversationWorkspaceId,
          globalAgentId: agent.id,
          skillVersionIds: [composeSkill.id],
        }),
      ).not.toThrow();

      const prepared = internal.prepareRunBinding({
        runId: 'run-capability-execution' as RunId,
        threadId: task.threadId,
        userText: 'Use governed capabilities',
        globalAgentId: agent.id,
        skillVersionIds: [],
      });
      expect(prepared.skillVersionIds).toEqual([skill.id]);

      const preparedWithExtraSkill = internal.prepareRunBinding({
        runId: 'run-capability-execution-extra' as RunId,
        threadId: task.threadId,
        userText: 'Use an extra explicit Skill',
        globalAgentId: agent.id,
        skillVersionIds: [composeSkill.id],
      });
      expect(preparedWithExtraSkill.skillVersionIds).toEqual([skill.id, composeSkill.id]);
      expect(preparedWithExtraSkill.mcpServerIds).toEqual([boundMcp.id]);

      const catalog = JSON.parse(internal.executeChatMcpCatalogTool(preparedWithExtraSkill.run)) as {
        servers: Array<{ mcpServerId: string }>;
      };
      expect(catalog.servers.map((server) => server.mcpServerId)).toEqual([boundMcp.id]);

      await internal.openProviderStream(preparedWithExtraSkill.run, {
        messages: [{ role: 'user', content: 'Use governed capabilities' }],
        toolsEnabled: true,
      });
      await internal.openProviderStream(preparedWithExtraSkill.run, {
        messages: [{ role: 'user', content: 'Use governed capabilities' }],
        toolsEnabled: true,
      });

      const failedCall = JSON.parse(
        await internal.executeChatBoundMcpTool({
          run: preparedWithExtraSkill.run,
          mcpServerId: boundMcp.id,
          toolName: 'inspect',
          toolCallId: 'tool-call-1',
        }),
      ) as { ok: boolean };
      expect(failedCall.ok).toBe(false);

      const deniedCall = JSON.parse(
        await internal.executeChatBoundMcpTool({
          run: { ...preparedWithExtraSkill.run, mcpServerIds: [] },
          mcpServerId: boundMcp.id,
          toolName: 'inspect',
          toolCallId: 'tool-call-denied',
        }),
      ) as { ok: boolean; error: string };
      expect(deniedCall).toMatchObject({
        ok: false,
        error: expect.stringMatching(/allowlist/i),
      });

      expect(
        capabilityStore.summarizeUsage({
          capabilityType: 'skill',
          capabilityIds: [skill.id, composeSkill.id],
          workspaceId: conversationWorkspaceId,
        }),
      ).toMatchObject([
        {
          capabilityId: skill.id,
          callCount: 1,
          successCount: 1,
          failedCount: 0,
        },
        {
          capabilityId: composeSkill.id,
          callCount: 1,
          successCount: 1,
          failedCount: 0,
        },
      ]);
      expect(
        capabilityStore.summarizeUsage({
          capabilityType: 'mcp',
          capabilityIds: [boundMcp.id],
          workspaceId: conversationWorkspaceId,
        }),
      ).toMatchObject([
        {
          capabilityId: boundMcp.id,
          callCount: 2,
          successCount: 1,
          failedCount: 1,
        },
      ]);
    } finally {
      connection.raw.close();
    }
  });
});
