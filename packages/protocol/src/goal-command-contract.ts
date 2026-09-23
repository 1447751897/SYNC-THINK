import type {
  GoalClearPayload,
  GoalClearResponse,
  GoalGetPayload,
  GoalGetResponse,
  GoalPausePayload,
  GoalPauseResponse,
  GoalResumePayload,
  GoalResumeResponse,
  GoalSetPayload,
  GoalSetResponse,
} from './commands.js';

/** Conversation-scoped Goal lifecycle RPCs. */
export interface GoalCommandContract {
  'goal.set': { request: GoalSetPayload; response: GoalSetResponse };
  'goal.get': { request: GoalGetPayload; response: GoalGetResponse };
  'goal.clear': { request: GoalClearPayload; response: GoalClearResponse };
  'goal.pause': { request: GoalPausePayload; response: GoalPauseResponse };
  'goal.resume': { request: GoalResumePayload; response: GoalResumeResponse };
}

export type GoalCommand = keyof GoalCommandContract;
export type GoalCommandRequest<K extends GoalCommand> = GoalCommandContract[K]['request'];
export type GoalCommandResponse<K extends GoalCommand> = GoalCommandContract[K]['response'];
