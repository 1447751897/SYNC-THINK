import { describe, expect, it, vi } from 'vitest';
import { ARTIFACT_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import { registerArtifactHandlers, type ArtifactHost } from './artifact-handlers.js';

const ids = {
  workspaceId: '01J00000000000000000000001',
  taskId: '01J00000000000000000000002',
  runId: '01J00000000000000000000003',
  artifactId: '01J00000000000000000000004',
  versionId: '01J00000000000000000000005',
  baseVersionId: '01J00000000000000000000006',
  leftVersionId: '01J00000000000000000000007',
  rightVersionId: '01J00000000000000000000008',
  operationId: '01J00000000000000000000009',
  conflictId: '01J0000000000000000000000A',
};
const scope = { workspaceId: ids.workspaceId, taskId: ids.taskId, runId: ids.runId };

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { ok: true };
  const version = {
    id: ids.versionId,
    contentRef: 'D:/artifacts/preview.png',
    contentHash: 'hash-1',
    mimeType: 'image/png',
  };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return command === 'artifact.getVersion' ? { version } : response;
  });
  const preview = {
    artifactVersionId: ids.versionId,
    previewUrl: 'sync-think-image://artifact/token',
    mimeType: 'image/png' as const,
    byteLength: 12,
    contentHash: 'hash-1',
  };
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestArtifact: request as ArtifactHost<string>['requestArtifact'],
    registerImagePreview: vi.fn(async () => preview),
  };
  registerArtifactHandlers(host);
  return { handlers, host, order, preview, request, response, version };
}

describe('Artifact IPC boundary', () => {
  it('registers the seven artifact commands', () => {
    expect([...fixture().handlers.keys()]).toEqual(Object.values(ARTIFACT_RUNTIME_IPC_CHANNELS));
  });

  it.each([
    [ARTIFACT_RUNTIME_IPC_CHANNELS.list, { ...scope, limit: 8 }, 'artifact.list'],
    [
      ARTIFACT_RUNTIME_IPC_CHANNELS.compare,
      { ...scope, leftVersionId: ids.leftVersionId, rightVersionId: ids.rightVersionId },
      'artifact.compare',
    ],
    [
      ARTIFACT_RUNTIME_IPC_CHANNELS.selectVersion,
      {
        ...scope,
        artifactId: ids.artifactId,
        artifactVersionId: ids.versionId,
        operationId: ids.operationId,
        expectedTaskVersion: 2,
      },
      'artifact.selectVersion',
    ],
    [
      ARTIFACT_RUNTIME_IPC_CHANNELS.merge,
      {
        ...scope,
        artifactId: ids.artifactId,
        baseVersionId: ids.baseVersionId,
        leftVersionId: ids.leftVersionId,
        rightVersionId: ids.rightVersionId,
        sourceStepId: 'merge-step',
        operationId: ids.operationId,
        expectedTaskVersion: 2,
      },
      'artifact.merge',
    ],
    [ARTIFACT_RUNTIME_IPC_CHANNELS.listConflicts, scope, 'artifact.listConflicts'],
    [
      ARTIFACT_RUNTIME_IPC_CHANNELS.resolveConflict,
      {
        ...scope,
        conflictId: ids.conflictId,
        strategy: 'left',
        operationId: ids.operationId,
        expectedTaskVersion: 3,
      },
      'artifact.resolveConflict',
    ],
  ])('forwards %s through its typed command', async (channel, payload, command) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', payload)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('turns the requested artifact version into a host preview grant', async () => {
    const { handlers, host, order, preview, request, version } = fixture();
    const payload = { ...scope, artifactVersionId: ids.versionId };
    await expect(
      handlers.get(ARTIFACT_RUNTIME_IPC_CHANNELS.imagePreview)!('trusted', payload),
    ).resolves.toBe(preview);
    expect(request).toHaveBeenCalledWith('artifact.getVersion', payload);
    expect(host.registerImagePreview).toHaveBeenCalledWith(version);
    expect(order).toEqual(['source', 'connect', 'request:artifact.getVersion']);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get(ARTIFACT_RUNTIME_IPC_CHANNELS.list)!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [ARTIFACT_RUNTIME_IPC_CHANNELS.list, { ...scope, limit: 0 }],
    [ARTIFACT_RUNTIME_IPC_CHANNELS.imagePreview, scope],
    [
      ARTIFACT_RUNTIME_IPC_CHANNELS.compare,
      { ...scope, leftVersionId: ids.leftVersionId, rightVersionId: ids.leftVersionId },
    ],
    [ARTIFACT_RUNTIME_IPC_CHANNELS.selectVersion, scope],
    [ARTIFACT_RUNTIME_IPC_CHANNELS.merge, scope],
    [ARTIFACT_RUNTIME_IPC_CHANNELS.listConflicts, { runId: ids.runId }],
    [ARTIFACT_RUNTIME_IPC_CHANNELS.resolveConflict, scope],
  ])('connects before rejecting invalid %s payloads without transport', async (channel, payload) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', payload)).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(ARTIFACT_RUNTIME_IPC_CHANNELS.list)!('trusted', scope),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(ARTIFACT_RUNTIME_IPC_CHANNELS.list)!('trusted', scope),
    ).rejects.toBe(failure);
  });
});
