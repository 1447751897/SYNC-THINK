import type {
  CapabilityGovernanceListPayload,
  CapabilityGovernanceListResponse,
  CapabilityWorkspaceListPayload,
  CapabilityWorkspaceListResponse,
  CapabilityWorkspaceSetActivePayload,
  CapabilityWorkspaceSetActiveResponse,
  GetLatestCapabilityOrganizePayload,
  GetLatestCapabilityOrganizeResponse,
  GetSkillPublishDraftPayload,
  GetSkillPublishDraftResponse,
  ListSkillPublishDraftsPayload,
  ListSkillPublishDraftsResponse,
  PreviewCapabilityOrganizePayload,
  PreviewCapabilityOrganizeResponse,
  SaveSkillPublishDraftPayload,
  SaveSkillPublishDraftResponse,
  SubmitSkillPublishDraftPayload,
  SubmitSkillPublishDraftResponse,
} from './commands.js';

/** Capability activation, governance, publishing and organization RPCs. */
export interface CapabilityGovernanceCommandContract {
  'capability.workspace.list': {
    request: CapabilityWorkspaceListPayload;
    response: CapabilityWorkspaceListResponse;
  };
  'capability.workspace.setActive': {
    request: CapabilityWorkspaceSetActivePayload;
    response: CapabilityWorkspaceSetActiveResponse;
  };
  'capability.governance.list': {
    request: CapabilityGovernanceListPayload;
    response: CapabilityGovernanceListResponse;
  };
  'capability.publishDraft.save': {
    request: SaveSkillPublishDraftPayload;
    response: SaveSkillPublishDraftResponse;
  };
  'capability.publishDraft.list': {
    request: ListSkillPublishDraftsPayload;
    response: ListSkillPublishDraftsResponse;
  };
  'capability.publishDraft.get': {
    request: GetSkillPublishDraftPayload;
    response: GetSkillPublishDraftResponse;
  };
  'capability.publishDraft.submit': {
    request: SubmitSkillPublishDraftPayload;
    response: SubmitSkillPublishDraftResponse;
  };
  'capability.organize.preview': {
    request: PreviewCapabilityOrganizePayload;
    response: PreviewCapabilityOrganizeResponse;
  };
  'capability.organize.getLatest': {
    request: GetLatestCapabilityOrganizePayload;
    response: GetLatestCapabilityOrganizeResponse;
  };
}

export type CapabilityGovernanceCommand = keyof CapabilityGovernanceCommandContract;
export type CapabilityGovernanceCommandRequest<K extends CapabilityGovernanceCommand> =
  CapabilityGovernanceCommandContract[K]['request'];
export type CapabilityGovernanceCommandResponse<K extends CapabilityGovernanceCommand> =
  CapabilityGovernanceCommandContract[K]['response'];
