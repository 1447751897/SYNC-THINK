import type {
  DeleteSkillPayload,
  DeleteSkillResponse,
  GetSkillPayload,
  GetSkillResponse,
  ImportRemoteSkillPayload,
  ImportRemoteSkillResponse,
  ImportSkillPayload,
  ImportSkillResponse,
  ListSkillsPayload,
  ListSkillsResponse,
  SetSkillEnabledPayload,
  SetSkillEnabledResponse,
} from './commands.js';

/** Installed Skill library lifecycle RPCs. */
export interface SkillCommandContract {
  'skill.import': { request: ImportSkillPayload; response: ImportSkillResponse };
  'skill.importRemote': {
    request: ImportRemoteSkillPayload;
    response: ImportRemoteSkillResponse;
  };
  'skill.list': { request: ListSkillsPayload; response: ListSkillsResponse };
  'skill.get': { request: GetSkillPayload; response: GetSkillResponse };
  'skill.delete': { request: DeleteSkillPayload; response: DeleteSkillResponse };
  'skill.setEnabled': { request: SetSkillEnabledPayload; response: SetSkillEnabledResponse };
}

export type SkillCommand = keyof SkillCommandContract;
export type SkillCommandRequest<K extends SkillCommand> = SkillCommandContract[K]['request'];
export type SkillCommandResponse<K extends SkillCommand> = SkillCommandContract[K]['response'];
