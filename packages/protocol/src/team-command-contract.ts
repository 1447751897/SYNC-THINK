import type {
  CreateTeamPayload,
  DeleteTeamPayload,
  ListTeamsResponse,
  SetTeamRunStatusPayload,
  StartTeamRunPayload,
  TeamResponse,
  TeamRunResponse,
  UpdateTeamPayload,
} from './commands.js';

export type TeamEmptyPayload = Record<string, never>;

/** Team catalog and run-control RPCs bind each command to its request and response payload. */
export interface TeamCommandContract {
  'team.list': {
    request: TeamEmptyPayload;
    response: ListTeamsResponse;
  };
  'team.create': {
    request: CreateTeamPayload;
    response: TeamResponse;
  };
  'team.update': {
    request: UpdateTeamPayload;
    response: TeamResponse;
  };
  'team.delete': {
    request: DeleteTeamPayload;
    response: TeamEmptyPayload;
  };
  'team.startRun': {
    request: StartTeamRunPayload;
    response: TeamRunResponse;
  };
  'team.setRunStatus': {
    request: SetTeamRunStatusPayload;
    response: TeamRunResponse;
  };
}

export type TeamCommand = keyof TeamCommandContract;
export type TeamCommandRequest<K extends TeamCommand> = TeamCommandContract[K]['request'];
export type TeamCommandResponse<K extends TeamCommand> = TeamCommandContract[K]['response'];
