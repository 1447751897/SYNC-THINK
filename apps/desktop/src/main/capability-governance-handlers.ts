import type {
  CapabilityGovernanceCommand,
  CapabilityGovernanceCommandRequest,
  CapabilityGovernanceCommandResponse,
} from '@sync-think/protocol';
import {
  parseCapabilityGovernanceListPayload,
  parseCapabilityWorkspaceListPayload,
  parseCapabilityWorkspaceSetActivePayload,
  parseGetLatestCapabilityOrganizePayload,
  parseGetSkillPublishDraftPayload,
  parseListSkillPublishDraftsPayload,
  parsePreviewCapabilityOrganizePayload,
  parseSaveSkillPublishDraftPayload,
  parseSubmitSkillPublishDraftPayload,
} from '../capability-payloads.js';
import { CAPABILITY_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface CapabilityGovernanceHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestCapabilityGovernance<K extends CapabilityGovernanceCommand>(
    command: K,
    payload: CapabilityGovernanceCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<CapabilityGovernanceCommandResponse<K>>;
}

export function registerCapabilityGovernanceHandlers<Event>(
  host: CapabilityGovernanceHost<Event>,
): void {
  host.handle(CAPABILITY_RUNTIME_IPC_CHANNELS.listWorkspaceActivations, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestCapabilityGovernance(
      'capability.workspace.list',
      parseCapabilityWorkspaceListPayload(value),
    );
  });

  host.handle(CAPABILITY_RUNTIME_IPC_CHANNELS.setWorkspaceActive, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestCapabilityGovernance(
      'capability.workspace.setActive',
      parseCapabilityWorkspaceSetActivePayload(value),
    );
  });

  host.handle(CAPABILITY_RUNTIME_IPC_CHANNELS.listGovernance, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestCapabilityGovernance(
      'capability.governance.list',
      parseCapabilityGovernanceListPayload(value),
    );
  });

  host.handle(CAPABILITY_RUNTIME_IPC_CHANNELS.savePublishDraft, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestCapabilityGovernance(
      'capability.publishDraft.save',
      parseSaveSkillPublishDraftPayload(value),
    );
  });

  host.handle(CAPABILITY_RUNTIME_IPC_CHANNELS.listPublishDrafts, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestCapabilityGovernance(
      'capability.publishDraft.list',
      parseListSkillPublishDraftsPayload(value),
    );
  });

  host.handle(CAPABILITY_RUNTIME_IPC_CHANNELS.getPublishDraft, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestCapabilityGovernance(
      'capability.publishDraft.get',
      parseGetSkillPublishDraftPayload(value),
    );
  });

  host.handle(CAPABILITY_RUNTIME_IPC_CHANNELS.submitPublishDraft, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestCapabilityGovernance(
      'capability.publishDraft.submit',
      parseSubmitSkillPublishDraftPayload(value),
    );
  });

  host.handle(CAPABILITY_RUNTIME_IPC_CHANNELS.previewOrganize, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestCapabilityGovernance(
      'capability.organize.preview',
      parsePreviewCapabilityOrganizePayload(value),
    );
  });

  host.handle(CAPABILITY_RUNTIME_IPC_CHANNELS.getLatestOrganize, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestCapabilityGovernance(
      'capability.organize.getLatest',
      parseGetLatestCapabilityOrganizePayload(value),
    );
  });
}
