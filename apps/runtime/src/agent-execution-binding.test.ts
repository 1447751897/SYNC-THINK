import { REASONING_EFFORT_LEVELS } from '@sync-think/shared';
import { CHAT_AGENT_TOOL_SCHEMAS } from './chat-tools.js';
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
  it.each(['create_agent', 'update_agent'])('offers the full reasoning ladder through %s', name => {
    const schema = CHAT_AGENT_TOOL_SCHEMAS.find(tool => tool.name === name)!.inputSchema as { properties: { reasoningEffort: { enum: string[] } } };
    expect(schema.properties.reasoningEffort.enum).toEqual([...REASONING_EFFORT_LEVELS]);
  });

  it.each(REASONING_EFFORT_LEVELS)('accepts %s on agent create and update', reasoningEffort => {
    expect(parseCreateGlobalAgentPayload({ name: 'Agent', defaultModelId: 'model', reasoningEffort })?.reasoningEffort).toBe(reasoningEffort);
    expect(parseUpdateGlobalAgentPayload({ agentId: 'a', reasoningEffort })?.reasoningEffort).toBe(reasoningEffort);
  });

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
        for (const kernelId of ['native', 'codex'] as const) {
          for (const reasoningEffort of REASONING_EFFORT_LEVELS) {
            agents.update({ agentId: agent.id, defaultKernelId: kernelId, reasoningEffort });
            expect(agents.get(agent.id)?.reasoningEffort).toBe(reasoningEffort);
            expect(binding.prepareRunBinding({ ...input, runId: `run-${kernelId}-${reasoningEffort}` }).run).toMatchObject({ kernelId, reasoningEffort });
          }
        }
      } finally {
        await runtime.stop();
        connection.raw.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
