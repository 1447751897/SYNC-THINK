import type { SetParticipationModePayload, SetParticipationModeResponse } from './commands.js';

/** Task execution-participation policy RPCs, separate from task directory lifecycle. */
export interface ParticipationModeCommandContract {
  'task.setParticipationMode': {
    request: SetParticipationModePayload;
    response: SetParticipationModeResponse;
  };
}

export type ParticipationModeCommand = keyof ParticipationModeCommandContract;
export type ParticipationModeCommandRequest<K extends ParticipationModeCommand> =
  ParticipationModeCommandContract[K]['request'];
export type ParticipationModeCommandResponse<K extends ParticipationModeCommand> =
  ParticipationModeCommandContract[K]['response'];
