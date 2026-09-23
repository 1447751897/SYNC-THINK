import type {
  ArtifactCommand,
  ArtifactCommandRequest,
  ArtifactCommandResponse,
  GetArtifactVersionResponse,
} from '@sync-think/protocol';
import type { ArtifactImagePreviewResponse } from '../artifact-image-preview-contract.js';
import {
  parseArtifactComparePayload,
  parseArtifactConflictListPayload,
  parseArtifactConflictResolutionPayload,
  parseArtifactImagePreviewPayload,
  parseArtifactListPayload,
  parseArtifactMergePayload,
  parseArtifactSelectPayload,
} from '../artifact-payloads.js';
import { ARTIFACT_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface ArtifactHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestArtifact<K extends ArtifactCommand>(
    command: K,
    payload: ArtifactCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ArtifactCommandResponse<K>>;
  registerImagePreview(
    version: GetArtifactVersionResponse['version'],
  ): Promise<ArtifactImagePreviewResponse>;
}

export function registerArtifactHandlers<Event>(host: ArtifactHost<Event>): void {
  host.handle(ARTIFACT_RUNTIME_IPC_CHANNELS.list, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestArtifact('artifact.list', parseArtifactListPayload(value));
  });

  host.handle(ARTIFACT_RUNTIME_IPC_CHANNELS.imagePreview, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    const response = await host.requestArtifact(
      'artifact.getVersion',
      parseArtifactImagePreviewPayload(value),
    );
    return host.registerImagePreview(response.version);
  });

  host.handle(ARTIFACT_RUNTIME_IPC_CHANNELS.compare, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestArtifact('artifact.compare', parseArtifactComparePayload(value));
  });

  host.handle(ARTIFACT_RUNTIME_IPC_CHANNELS.selectVersion, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestArtifact('artifact.selectVersion', parseArtifactSelectPayload(value));
  });

  host.handle(ARTIFACT_RUNTIME_IPC_CHANNELS.merge, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestArtifact('artifact.merge', parseArtifactMergePayload(value));
  });

  host.handle(ARTIFACT_RUNTIME_IPC_CHANNELS.listConflicts, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestArtifact(
      'artifact.listConflicts',
      parseArtifactConflictListPayload(value),
    );
  });

  host.handle(ARTIFACT_RUNTIME_IPC_CHANNELS.resolveConflict, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestArtifact(
      'artifact.resolveConflict',
      parseArtifactConflictResolutionPayload(value),
    );
  });
}
