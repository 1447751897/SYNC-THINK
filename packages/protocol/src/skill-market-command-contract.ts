import type {
  InstallSkillMarketPayload,
  InstallSkillMarketResponse,
  ListSkillMarketResponse,
} from './commands.js';

export type SkillMarketEmptyPayload = Record<string, never>;

/** Curated Skill marketplace catalog and installation RPCs. */
export interface SkillMarketCommandContract {
  'skill.market.list': {
    request: SkillMarketEmptyPayload;
    response: ListSkillMarketResponse;
  };
  'skill.market.install': {
    request: InstallSkillMarketPayload;
    response: InstallSkillMarketResponse;
  };
}

export type SkillMarketCommand = keyof SkillMarketCommandContract;
export type SkillMarketCommandRequest<K extends SkillMarketCommand> =
  SkillMarketCommandContract[K]['request'];
export type SkillMarketCommandResponse<K extends SkillMarketCommand> =
  SkillMarketCommandContract[K]['response'];
