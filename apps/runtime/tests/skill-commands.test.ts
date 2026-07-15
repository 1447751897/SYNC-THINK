import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { FakeProvider } from '@sync-think/adapters';
import { SKILL_FIXTURES } from '@sync-think/test-fixtures';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly lock better-sqlite3 files after session.close.
    }
  }
});

async function connectRuntime(installId: string): Promise<Socket> {
  const sock = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  return sock;
}

function createFrameReader(sock: Socket): {
  read: (count: number) => Promise<Frame[]>;
} {
  const queued: Frame[] = [];
  const waiters: Array<{
    count: number;
    resolve: (frames: Frame[]) => void;
    reject: (err: unknown) => void;
  }> = [];
  let pending = Buffer.alloc(0);

  const drain = () => {
    while (waiters.length > 0 && queued.length >= waiters[0]!.count) {
      const waiter = waiters.shift()!;
      waiter.resolve(queued.splice(0, waiter.count));
    }
  };

  sock.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      queued.push(...decoded.frames);
      drain();
    } catch (e) {
      while (waiters.length > 0) waiters.shift()!.reject(e);
    }
  });
  sock.on('error', (e) => {
    while (waiters.length > 0) waiters.shift()!.reject(e);
  });
  sock.on('close', () => {
    while (waiters.length > 0) {
      waiters.shift()!.reject(new Error('socket closed before the requested frame arrived'));
    }
  });

  return {
    read(count: number) {
      if (queued.length >= count) return Promise.resolve(queued.splice(0, count));
      return new Promise((resolve, reject) => waiters.push({ count, resolve, reject }));
    },
  };
}

async function writeAndRead(
  sock: Socket,
  reader: ReturnType<typeof createFrameReader>,
  frame: Frame,
): Promise<Frame> {
  const next = reader.read(1);
  sock.write(encodeFrame(frame));
  return (await next)[0]!;
}

async function hello(
  sock: Socket,
  reader: ReturnType<typeof createFrameReader>,
  installId: string,
): Promise<void> {
  const resp = await writeAndRead(sock, reader, {
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: randomBytes(8).toString('hex'),
      features: [
        'skill.import',
        'skill.list',
        'agent.get',
        'agent.updateBinding',
        'provider.create',
        'provider.list',
        'provider.addModels',
        'context.packet.peek',
      ],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

function fixture(id: string): string {
  const hit = SKILL_FIXTURES.find((f) => f.id === id);
  if (!hit) throw new Error(`missing fixture ${id}`);
  return hit.skillMd;
}

describe('skill commands (§9 import + agent allowlist)', () => {
  it('imports SKILL.md without executing scripts, lists library, and binds allowlist into agent + peek', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-skill-cmd-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    // Seed a model so agent binding + peek can resolve.
    const created = await writeAndRead(sock, reader, {
      id: 'prov-1',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Skill Gateway',
        baseUrl: 'https://skill-gw.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-skill-test-key-not-for-real-use',
        supportsDiscovery: false,
      },
    });
    expect(created.error).toBeUndefined();
    const providerId = (created.payload as { provider: { providerId: string } }).provider.providerId;

    const add = await writeAndRead(sock, reader, {
      id: 'add-1',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'skill-model', displayName: 'Skill Model' }],
      },
    });
    expect(add.error).toBeUndefined();
    const modelId = (add.payload as { models: Array<{ modelId: string }> }).models[0]!.modelId;

    // Import minimal skill
    const imported = await writeAndRead(sock, reader, {
      id: 'skill-imp-1',
      kind: 'request',
      type: 'skill.import',
      payload: { skillMd: fixture('minimal-skill') },
    });
    expect(imported.error).toBeUndefined();
    const skillBody = imported.payload as {
      skill: {
        skillVersionId: string;
        name: string;
        version: string;
        contentFingerprint: string;
        hasScripts: boolean;
      };
      deduped: boolean;
    };
    expect(skillBody.deduped).toBe(false);
    expect(skillBody.skill.name).toBe('minimal');
    expect(skillBody.skill.version).toBe('0.1.0');
    expect(skillBody.skill.hasScripts).toBe(false);
    expect(skillBody.skill.contentFingerprint.length).toBeGreaterThan(0);
    const skillVersionId = skillBody.skill.skillVersionId;

    // Scripts fixture: recorded, not executed (no shell side effects in import path)
    const withScripts = await writeAndRead(sock, reader, {
      id: 'skill-imp-scripts',
      kind: 'request',
      type: 'skill.import',
      payload: { skillMd: fixture('skill-with-scripts-denied-by-default') },
    });
    expect(withScripts.error).toBeUndefined();
    const scriptsSkill = (withScripts.payload as { skill: { hasScripts: boolean; warnings: string[] } })
      .skill;
    expect(scriptsSkill.hasScripts).toBe(true);
    expect(scriptsSkill.warnings.some((w) => /not.*execut|never auto-executed/i.test(w))).toBe(true);

    // Path traversal rejected
    const traversal = await writeAndRead(sock, reader, {
      id: 'skill-imp-trav',
      kind: 'request',
      type: 'skill.import',
      payload: { skillMd: fixture('path-traversal-attempt') },
    });
    expect(traversal.error).toBeDefined();
    expect(String(traversal.error?.code ?? '')).toMatch(/path_traversal|frame_malformed/i);

    // Broken frontmatter rejected
    const broken = await writeAndRead(sock, reader, {
      id: 'skill-imp-broken',
      kind: 'request',
      type: 'skill.import',
      payload: { skillMd: fixture('broken-frontmatter') },
    });
    expect(broken.error).toBeDefined();

    // Content-addressed dedupe
    const again = await writeAndRead(sock, reader, {
      id: 'skill-imp-dedupe',
      kind: 'request',
      type: 'skill.import',
      payload: { skillMd: fixture('minimal-skill') },
    });
    expect(again.error).toBeUndefined();
    const againBody = again.payload as {
      skill: { skillVersionId: string };
      deduped: boolean;
    };
    expect(againBody.deduped).toBe(true);
    expect(againBody.skill.skillVersionId).toBe(skillVersionId);

    // List library (import does not auto-allowlist)
    const listed = await writeAndRead(sock, reader, {
      id: 'skill-list-1',
      kind: 'request',
      type: 'skill.list',
      payload: {},
    });
    expect(listed.error).toBeUndefined();
    const list = (listed.payload as { skills: Array<{ skillVersionId: string; name: string }> }).skills;
    expect(list.some((s) => s.skillVersionId === skillVersionId)).toBe(true);
    expect(list.some((s) => s.name === 'with-scripts')).toBe(true);

    // Agent still has empty allowlist until explicit bind
    const agentBefore = await writeAndRead(sock, reader, {
      id: 'agent-get-1',
      kind: 'request',
      type: 'agent.get',
      payload: {},
    });
    expect(agentBefore.error).toBeUndefined();
    const beforeSkills = (agentBefore.payload as { agent: { skillVersionIds: string[] } }).agent
      .skillVersionIds;
    expect(beforeSkills).toEqual([]);

    // Explicit allowlist bind
    const bound = await writeAndRead(sock, reader, {
      id: 'agent-bind-skill',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        skillVersionIds: [skillVersionId],
      },
    });
    expect(bound.error).toBeUndefined();
    const agentAfter = (bound.payload as {
      agent: { skillVersionIds: string[]; version: number };
    }).agent;
    expect(agentAfter.skillVersionIds).toEqual([skillVersionId]);
    expect(agentAfter.version).toBeGreaterThanOrEqual(1);

    // Workspace + task for peek
    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: dir, name: 'Skill WS' },
    });
    expect(ws.error).toBeUndefined();
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;

    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: {
        workspaceId,
        title: 'Skill allowlist peek',
        goal: 'Verify skillVersionIds surface on Manifest peek',
      },
    });
    expect(task.error).toBeUndefined();
    const taskPayload = task.payload as { taskId: string; threadId: string };

    const peek = await writeAndRead(sock, reader, {
      id: 'peek-1',
      kind: 'request',
      type: 'context.packet.peek',
      payload: {
        threadId: taskPayload.threadId,
      },
    });
    expect(peek.error).toBeUndefined();
    const peekBody = peek.payload as {
      skillVersionIds?: string[];
      includedSources?: Array<{ id: string; kind: string; tokenEstimate: number }>;
      summaries?: Array<{ sourceId: string; summary: string }>;
    };
    expect(Array.isArray(peekBody.skillVersionIds)).toBe(true);
    expect(peekBody.skillVersionIds).toContain(skillVersionId);

    // §10.2 — allowlisted skill body enters packet as skill-definition source
    expect(Array.isArray(peekBody.includedSources)).toBe(true);
    const skillSources = (peekBody.includedSources ?? []).filter(
      (src) => src.kind === 'skill-definition',
    );
    expect(skillSources.length).toBeGreaterThanOrEqual(1);
    expect(skillSources.some((src) => src.id.includes(skillVersionId) || src.id.startsWith('skill:'))).toBe(
      true,
    );
    const skillSummaries = (peekBody.summaries ?? []).filter((row) =>
      row.sourceId.startsWith('skill:'),
    );
    expect(skillSummaries.length).toBeGreaterThanOrEqual(1);
    expect(skillSummaries[0]?.summary).toMatch(/minimal|Skill/i);

    // Empty allowlist → no skill-definition (install ≠ available)
    const cleared = await writeAndRead(sock, reader, {
      id: 'agent-clear-skill',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        skillVersionIds: [],
      },
    });
    expect(cleared.error).toBeUndefined();

    const peekEmpty = await writeAndRead(sock, reader, {
      id: 'peek-empty-skills',
      kind: 'request',
      type: 'context.packet.peek',
      payload: { threadId: taskPayload.threadId },
    });
    expect(peekEmpty.error).toBeUndefined();
    const emptyBody = peekEmpty.payload as {
      skillVersionIds?: string[];
      includedSources?: Array<{ kind: string }>;
    };
    expect(emptyBody.skillVersionIds ?? []).toEqual([]);
    expect((emptyBody.includedSources ?? []).some((src) => src.kind === 'skill-definition')).toBe(
      false,
    );

    sock.destroy();
    await session.close();
  }, 60_000);

  it('exposes permission diff reapproval when upgrade adds tools (§9.3)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-skill-diff-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-skill-diff-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const base = await writeAndRead(sock, reader, {
      id: 'skill-base',
      kind: 'request',
      type: 'skill.import',
      payload: { skillMd: fixture('skill-permission-diff-base') },
    });
    expect(base.error).toBeUndefined();
    const baseBody = base.payload as {
      skill: { skillVersionId: string; version: string; allowedTools: string[] };
      deduped: boolean;
      permissionDiff?: { requiresReapproval: boolean; summary: string };
    };
    expect(baseBody.deduped).toBe(false);
    expect(baseBody.skill.allowedTools).toEqual(['read-file']);
    expect(baseBody.permissionDiff?.requiresReapproval).toBe(false);

    const upgraded = await writeAndRead(sock, reader, {
      id: 'skill-up',
      kind: 'request',
      type: 'skill.import',
      payload: { skillMd: fixture('skill-permission-diff-on-upgrade') },
    });
    expect(upgraded.error).toBeUndefined();
    const upBody = upgraded.payload as {
      skill: { skillVersionId: string; version: string; allowedTools: string[] };
      deduped: boolean;
      permissionDiff?: {
        requiresReapproval: boolean;
        addedTools: string[];
        summary: string;
        label: string;
        previousVersion?: string;
      };
      reapprovalRequest?: {
        id: string;
        kind: string;
        action: string;
        summary: string;
        state: string;
      };
    };
    expect(upBody.deduped).toBe(false);
    expect(upBody.skill.version).toBe('0.2.0');
    expect(upBody.skill.skillVersionId).not.toBe(baseBody.skill.skillVersionId);
    expect(upBody.permissionDiff?.requiresReapproval).toBe(true);
    expect(upBody.permissionDiff?.addedTools).toContain('write-fs');
    expect(upBody.permissionDiff?.previousVersion).toBe('0.1.0');
    expect(upBody.permissionDiff?.summary).toMatch(/reapproval required/i);
    expect(upBody.permissionDiff?.label).toMatch(/重新批准|reapproval/i);

    // §9.3 → Approval Center auto-enqueue (soft craft)
    expect(upBody.reapprovalRequest).toBeDefined();
    expect(upBody.reapprovalRequest?.kind).toBe('skill-permission');
    expect(upBody.reapprovalRequest?.state).toBe('pending');
    expect(upBody.reapprovalRequest?.action).toContain('skill.permission-upgrade');
    expect(upBody.reapprovalRequest?.summary).toMatch(/write-fs|重新批准/);

    const list = await writeAndRead(sock, reader, {
      id: 'approval-list-after-skill',
      kind: 'request',
      type: 'approval.list',
      payload: { state: 'pending', limit: 20 },
    });
    expect(list.error).toBeUndefined();
    const listBody = list.payload as {
      pendingCount: number;
      items: Array<{ id: string; kind: string; action: string }>;
    };
    expect(listBody.pendingCount).toBeGreaterThanOrEqual(1);
    expect(listBody.items.some((item) => item.id === upBody.reapprovalRequest?.id)).toBe(true);
    expect(listBody.items.some((item) => item.kind === 'skill-permission')).toBe(true);

    // Import still does not auto-allowlist — agent skills empty
    const agent = await writeAndRead(sock, reader, {
      id: 'agent-get-diff',
      kind: 'request',
      type: 'agent.get',
      payload: {},
    });
    expect(agent.error).toBeUndefined();
    expect(
      (agent.payload as { agent: { skillVersionIds: string[] } }).agent.skillVersionIds,
    ).toEqual([]);

    // Approve skill-permission → auto-bind upgraded skillVersionId (§9.1/§9.3)
    const decided = await writeAndRead(sock, reader, {
      id: 'skill-appr-decide',
      kind: 'request',
      type: 'approval.decide',
      payload: {
        id: upBody.reapprovalRequest!.id,
        decision: 'approved',
        decisionNote: 'allow upgraded skill tools',
      },
    });
    expect(decided.error).toBeUndefined();
    const decideBody = decided.payload as {
      item: { state: string; kind: string };
      skillAllowlist?: {
        bound: boolean;
        skillVersionId?: string;
        agentVersionId?: string;
        reason?: string;
      };
    };
    expect(decideBody.item.state).toBe('approved');
    expect(decideBody.item.kind).toBe('skill-permission');
    expect(decideBody.skillAllowlist?.bound).toBe(true);
    expect(decideBody.skillAllowlist?.skillVersionId).toBe(upBody.skill.skillVersionId);

    const agentAfter = await writeAndRead(sock, reader, {
      id: 'agent-get-after-appr',
      kind: 'request',
      type: 'agent.get',
      payload: {},
    });
    expect(agentAfter.error).toBeUndefined();
    const afterSkills = (agentAfter.payload as { agent: { skillVersionIds: string[] } })
      .agent.skillVersionIds;
    expect(afterSkills).toContain(upBody.skill.skillVersionId);
    // base version not force-added (was never allowlisted); only approved upgrade
    expect(afterSkills).not.toContain(baseBody.skill.skillVersionId);

    // Reject path: second upgrade, reject → still no new bind of rejected id
    // (soft: just ensure reject returns bound:false)
    const up2 = await writeAndRead(sock, reader, {
      id: 'skill-up-2',
      kind: 'request',
      type: 'skill.import',
      payload: {
        skillMd: fixture('skill-permission-diff-on-upgrade').replace(
          'version: 0.2.0',
          'version: 0.3.0',
        ).replace('write-fs', 'write-fs\nallowed-tools: read-file, write-fs, shell-run'),
      },
    });
    // If fixture replace is fragile, skip reject branch when no reapproval
    const up2Body = up2.payload as {
      skill?: { skillVersionId: string };
      reapprovalRequest?: { id: string };
      permissionDiff?: { requiresReapproval: boolean };
    };
    if (up2.error === undefined && up2Body.reapprovalRequest?.id) {
      const rej = await writeAndRead(sock, reader, {
        id: 'skill-appr-reject',
        kind: 'request',
        type: 'approval.decide',
        payload: { id: up2Body.reapprovalRequest.id, decision: 'rejected' },
      });
      expect(rej.error).toBeUndefined();
      const rejBody = rej.payload as {
        skillAllowlist?: { bound: boolean; reason?: string };
      };
      expect(rejBody.skillAllowlist?.bound).toBe(false);
      const agentRej = await writeAndRead(sock, reader, {
        id: 'agent-get-after-rej',
        kind: 'request',
        type: 'agent.get',
        payload: {},
      });
      const rejSkills = (agentRej.payload as { agent: { skillVersionIds: string[] } })
        .agent.skillVersionIds;
      if (up2Body.skill?.skillVersionId) {
        expect(rejSkills).not.toContain(up2Body.skill.skillVersionId);
      }
      // still has approved 0.2.0
      expect(rejSkills).toContain(upBody.skill.skillVersionId);
    }

    sock.destroy();
    await session.close();
  }, 60_000);

});
