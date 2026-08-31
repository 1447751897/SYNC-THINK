import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteCapabilityStore,
  SqliteEventCheckpointStore,
  SqliteMcpStore,
  SqliteSkillStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
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

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function createFrameInbox(socket: Socket) {
  const waiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (!waiter) continue;
      waiters.delete(frame.id);
      waiter(frame);
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolve) => waiters.set(frame.id, resolve));
      socket.write(encodeFrame(frame));
      return response;
    },
  };
}

describe('capability governance pipe commands', () => {
  it('manages workspace activation, usage, local publish drafts and read-only organize reports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-capability-commands-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `capability-${randomBytes(5).toString('hex')}`;
    const workspaceId = 'workspace-capability' as WorkspaceId;
    const otherWorkspaceId = 'workspace-without-capability' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const skillStore = new SqliteSkillStore(connection.raw);
    const mcpStore = new SqliteMcpStore(connection.raw);
    const capabilityStore = new SqliteCapabilityStore(connection.raw);
    workspaceStore.createWorkspace({
      id: workspaceId,
      name: 'Capability Workspace',
      folderPath: dir,
      allowedRoots: [dir],
    });
    workspaceStore.createWorkspace({
      id: otherWorkspaceId,
      name: 'Workspace Without Capability',
      folderPath: join(dir, 'other'),
      allowedRoots: [join(dir, 'other')],
    });
    const skill = skillStore.importVersion({
      name: 'governed-skill',
      description: 'Governed Skill',
      version: '1.0.0',
      sourceMd: '---\nname: governed-skill\n---\n# Governed Skill',
      body: '# Governed Skill',
      contentFingerprint: 'governed-skill-v1',
    });
    const mcp = mcpStore.register({
      name: 'governed-mcp',
      endpoint: 'stdio://governed-mcp',
      tools: [{ name: 'inspect', description: 'Inspect the fixture' }],
    });
    capabilityStore.appendUsageEvent({
      capabilityType: 'skill',
      capabilityId: skill.id,
      workspaceId,
      outcome: 'success',
      contextTokens: 120,
      occurredAt: '2026-08-08T08:00:00.000Z',
    });
    capabilityStore.appendUsageEvent({
      capabilityType: 'mcp',
      capabilityId: mcp.id,
      workspaceId,
      outcome: 'failed',
      contextTokens: 80,
      occurredAt: '2026-08-08T09:00:00.000Z',
    });

    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      stateStore,
      workspaceStore,
      skillStore,
      mcpStore,
      capabilityStore,
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);
    try {
      const hello = await inbox.send({
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: [
            'skill.list',
            'skill.setEnabled',
            'capability.workspace.list',
            'capability.workspace.setActive',
            'capability.governance.list',
            'capability.publishDraft.save',
            'capability.publishDraft.list',
            'capability.publishDraft.get',
            'capability.publishDraft.submit',
            'capability.organize.preview',
            'capability.organize.getLatest',
          ],
        },
      });
      expect(hello.error).toBeUndefined();

      for (const [index, capability] of [
        { capabilityType: 'skill', capabilityId: skill.id },
        { capabilityType: 'mcp', capabilityId: mcp.id },
      ].entries()) {
        const response = await inbox.send({
          id: `activate-${index}`,
          kind: 'request',
          type: 'capability.workspace.setActive',
          payload: {
            ...capability,
            workspaceId,
            active: true,
          },
        });
        expect(response.error).toBeUndefined();
        expect(response.payload).toMatchObject({
          activation: { ...capability, workspaceId, active: true },
        });
      }

      const activations = await inbox.send({
        id: 'list-activations',
        kind: 'request',
        type: 'capability.workspace.list',
        payload: { workspaceId },
      });
      expect(
        (activations.payload as { activations: Array<{ capabilityId: string }> }).activations.map(
          (activation) => activation.capabilityId,
        ),
      ).toEqual(expect.arrayContaining([skill.id, mcp.id]));

      const activeWorkspaceSkills = await inbox.send({
        id: 'list-active-workspace-skills',
        kind: 'request',
        type: 'skill.list',
        payload: { workspaceId },
      });
      expect(activeWorkspaceSkills.error).toBeUndefined();
      expect(
        (activeWorkspaceSkills.payload as { skills: Array<{ skillVersionId: string }> }).skills,
      ).toEqual([expect.objectContaining({ skillVersionId: skill.id })]);

      const inactiveWorkspaceSkills = await inbox.send({
        id: 'list-inactive-workspace-skills',
        kind: 'request',
        type: 'skill.list',
        payload: { workspaceId: otherWorkspaceId },
      });
      expect(inactiveWorkspaceSkills.error).toBeUndefined();
      expect((inactiveWorkspaceSkills.payload as { skills: unknown[] }).skills).toEqual([]);

      const otherWorkspaceSkillActivation = await inbox.send({
        id: 'activate-skill-in-other-workspace',
        kind: 'request',
        type: 'capability.workspace.setActive',
        payload: {
          capabilityType: 'skill',
          capabilityId: skill.id,
          workspaceId: otherWorkspaceId,
          active: true,
        },
      });
      expect(otherWorkspaceSkillActivation.error).toBeUndefined();

      const disabled = await inbox.send({
        id: 'disable-active-skill',
        kind: 'request',
        type: 'skill.setEnabled',
        payload: { skillVersionId: skill.id, enabled: false },
      });
      expect(disabled.error).toBeUndefined();
      const disabledWorkspaceSkills = await inbox.send({
        id: 'list-disabled-workspace-skills',
        kind: 'request',
        type: 'skill.list',
        payload: { workspaceId },
      });
      expect((disabledWorkspaceSkills.payload as { skills: unknown[] }).skills).toEqual([]);

      const reenabled = await inbox.send({
        id: 'reenable-active-skill',
        kind: 'request',
        type: 'skill.setEnabled',
        payload: { skillVersionId: skill.id, enabled: true },
      });
      expect(reenabled.error).toBeUndefined();

      const governance = await inbox.send({
        id: 'list-governance',
        kind: 'request',
        type: 'capability.governance.list',
        payload: { workspaceId, now: '2026-08-09T00:00:00.000Z' },
      });
      expect(governance.error).toBeUndefined();
      expect(governance.payload).toMatchObject({
        workspaceId,
        windowDays: 45,
        skills: [
          {
            workspaceActive: true,
            activeWorkspaceNames: expect.arrayContaining([
              'Capability Workspace',
              'Workspace Without Capability',
            ]),
            usage: { callCount: 1, successCount: 1, contextTokens: 120 },
          },
        ],
        mcpServers: [
          {
            workspaceActive: true,
            usage: { callCount: 1, failedCount: 1, problemCount: 1, contextTokens: 80 },
          },
        ],
      });

      const saved = await inbox.send({
        id: 'save-draft',
        kind: 'request',
        type: 'capability.publishDraft.save',
        payload: {
          skillVersionId: skill.id,
          skillId: skill.skillId,
          displayName: 'Governed Skill',
          description: 'Local publish draft',
          skillMd: skill.sourceMd,
          category: '开发工具',
          version: '1.0.0',
          icon: 'sparkles',
          attachments: [{ name: 'README.md', size: 128 }],
        },
      });
      expect(saved.error).toBeUndefined();
      const draftId = (saved.payload as { draft: { id: string } }).draft.id;
      expect(draftId).toBeTruthy();

      const listed = await inbox.send({
        id: 'list-drafts',
        kind: 'request',
        type: 'capability.publishDraft.list',
        payload: { skillId: skill.skillId },
      });
      expect(listed.payload).toMatchObject({
        drafts: [{ id: draftId, displayName: 'Governed Skill' }],
      });

      const fetched = await inbox.send({
        id: 'get-draft',
        kind: 'request',
        type: 'capability.publishDraft.get',
        payload: { id: draftId },
      });
      expect(fetched.payload).toMatchObject({
        draft: { id: draftId, attachments: [{ name: 'README.md', size: 128 }] },
      });

      const submitted = await inbox.send({
        id: 'submit-draft',
        kind: 'request',
        type: 'capability.publishDraft.submit',
        payload: { id: draftId },
      });
      expect(submitted.payload).toMatchObject({
        submitted: false,
        reason: 'channel-unavailable',
        message: '市场发布渠道暂未开放',
        draft: { id: draftId },
      });

      const beforeSkill = skillStore.getVersion(skill.id);
      const beforeMcp = mcpStore.get(mcp.id);
      const report = await inbox.send({
        id: 'organize-preview',
        kind: 'request',
        type: 'capability.organize.preview',
        payload: {
          workspaceId,
          contextBudgetTokens: 100,
          now: '2026-08-09T00:00:00.000Z',
        },
      });
      expect(report.error).toBeUndefined();
      expect(report.payload).toMatchObject({
        readOnly: true,
        report: {
          workspaceId,
          contextBudgetTokens: 100,
          categories: {
            contextWarning: expect.arrayContaining([skill.id, mcp.id]),
            highContext: expect.arrayContaining([skill.id]),
            problematic: expect.arrayContaining([mcp.id]),
          },
        },
      });
      expect(skillStore.getVersion(skill.id)?.enabled).toBe(beforeSkill?.enabled);
      expect(mcpStore.get(mcp.id)?.enabled).toBe(beforeMcp?.enabled);

      const latest = await inbox.send({
        id: 'organize-latest',
        kind: 'request',
        type: 'capability.organize.getLatest',
        payload: { workspaceId },
      });
      expect(latest.payload).toMatchObject({
        report: {
          id: (report.payload as { report: { id: string } }).report.id,
          workspaceId,
        },
      });
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  }, 30_000);
});
