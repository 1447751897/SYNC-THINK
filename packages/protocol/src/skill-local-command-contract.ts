import type {
  SkillLocalImportPayload,
  SkillLocalImportResponse,
  SkillLocalInspectPayload,
  SkillLocalInspectResponse,
  SkillLocalScanPayload,
  SkillLocalScanResponse,
} from './commands.js';

/** Local Skill discovery, inspection, and installation RPCs. */
export interface SkillLocalCommandContract {
  'skill.local.scan': { request: SkillLocalScanPayload; response: SkillLocalScanResponse };
  'skill.local.inspect': { request: SkillLocalInspectPayload; response: SkillLocalInspectResponse };
  'skill.local.import': { request: SkillLocalImportPayload; response: SkillLocalImportResponse };
}

export type SkillLocalCommand = keyof SkillLocalCommandContract;
export type SkillLocalCommandRequest<K extends SkillLocalCommand> =
  SkillLocalCommandContract[K]['request'];
export type SkillLocalCommandResponse<K extends SkillLocalCommand> =
  SkillLocalCommandContract[K]['response'];
