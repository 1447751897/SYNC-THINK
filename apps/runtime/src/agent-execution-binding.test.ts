import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteGlobalAgentStore,
  SqliteTeamStore,
  SqliteEventCheckpointStore,
} from '@sync-think/storage';
import type { AgentId, ModelId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import {
  parseCreateGlobalAgentPayload,
  parseUpdateGlobalAgentPayload,
} from './validation/agent.js';

describe('agent-owned execution configuration', () => {
  it('validates kernel IDs on create and update', () => {
    expect(
      parseCreateGlobalAgentPayload({
        name: 'A',
        defaultModelId: 'fake-mini',
        defaultKernelId: 'codex',
      })?.defaultKernelId,
    ).toBe('codex');
    expect(
      parseUpdateGlobalAgentPayload({ agentId: 'a', defaultKernelId: 'claude-code' })
        ?.defaultKernelId,
    ).toBe('claude-code');
    for (const invalid of ['', 123, 'x'.repeat(65)]) {
      expect(
        parseUpdateGlobalAgentPayload({ agentId: 'a', defaultKernelId: invalid }),
      ).toBeUndefined();
    }
  });
  it.each(['agent', 'team'] as const)(
    'uses the %s agent settings instead of composer overrides',
    async (track) => {
      const directory = mkdtempSync(join(tmpdir(), 'sync-think-agent-binding-'));
      const path = join(directory, 'test.db');
      await runMigrations(path);
      const connection = await openDatabaseAsync({ path });
      const agents = new SqliteGlobalAgentStore(connection.raw);
      const teams = new SqliteTeamStore(connection.raw);
      const agent = agents.create({
        id: 'bound-agent' as AgentId,
        name: 'Bound',
        defaultModelId: 'fake-mini' as ModelId,
        defaultKernelId: 'codex',
        reasoningEffort: 'high',
      });
      const team = teams.create({
        name: 'Team',
        members: [{ agentId: agent.id }],
        coordinatorAgentId: agent.id,
      });
      const runtime = new Runtime({
        installId: 'agent-binding',
        allowNoToken: true,
        globalAgentStore: agents,
        teamStore: teams,
        stateStore: new SqliteEventCheckpointStore(connection.raw),
      });
      try {
        const binding = runtime as unknown as {
          prepareRunBinding(input: object): {
            run: { kernelId: string; modelId: string; reasoningEffort: string };
          };
        };
        const input = {
          runId: 'run-bound',
          threadId: 'thread-bound',
          userText: 'hello',
          track,
          ...(track === 'agent' ? { globalAgentId: agent.id } : { teamId: team.id }),
          kernelId: 'pi',
          modelId: 'stale-model',
          reasoningEffort: 'off',
        };
        expect(binding.prepareRunBinding(input).run).toMatchObject({
          kernelId: 'codex',
          modelId: 'fake-mini',
          reasoningEffort: 'high',
        });
        agents.update({
          agentId: agent.id,
          defaultKernelId: 'claude-code',
          reasoningEffort: 'low',
        });
        expect(binding.prepareRunBinding({ ...input, runId: 'run-next' }).run).toMatchObject({
          kernelId: 'claude-code',
          reasoningEffort: 'low',
        });
      } finally {
        await runtime.stop();
        connection.raw.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
