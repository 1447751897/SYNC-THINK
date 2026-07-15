import type { Event } from '@sync-think/shared';
import { mergeEventHistory } from '../event-history.js';
import type {
  RuntimeConnectFailure,
  RuntimeConnectResult,
} from '../runtime-bridge-contract.js';
import { projectM0EventHistory } from './m0-projection.js';

export type RuntimeConnectionState = 'preview' | 'connecting' | 'online' | 'offline';

export interface RuntimeViewState {
  readonly eventHistory: readonly Event[];
  readonly connectionState: RuntimeConnectionState;
  readonly taskVersion: number;
  /** Last connect failure (cleared on successful connect / reconnect attempt start). */
  readonly lastConnectFailure: RuntimeConnectFailure | null;
}

export type RuntimeViewAction =
  | { type: 'event-received'; event: Event; threadId: string }
  | { type: 'connect-succeeded'; result: RuntimeConnectResult; threadId: string }
  | { type: 'connect-failed'; error?: RuntimeConnectFailure | null }
  | { type: 'reconnect-requested' }
  | { type: 'append-succeeded'; taskVersion: number };

export function createInitialRuntimeViewState(hasRuntime: boolean): RuntimeViewState {
  return {
    eventHistory: [],
    connectionState: hasRuntime ? 'connecting' : 'preview',
    taskVersion: 0,
    lastConnectFailure: null,
  };
}

export function runtimeViewReducer(
  state: RuntimeViewState,
  action: RuntimeViewAction,
): RuntimeViewState {
  if (action.type === 'connect-failed') {
    return {
      ...state,
      connectionState: 'offline',
      lastConnectFailure: action.error ?? state.lastConnectFailure,
    };
  }
  if (action.type === 'reconnect-requested') {
    return {
      ...state,
      connectionState: 'connecting',
      // keep lastConnectFailure visible until next success/fail for observability
    };
  }
  if (action.type === 'append-succeeded') {
    return { ...state, taskVersion: Math.max(state.taskVersion, action.taskVersion) };
  }

  const incoming =
    action.type === 'event-received' ? [action.event] : action.result.snapshot;
  const eventHistory = mergeEventHistory(state.eventHistory, incoming);
  const projection = projectM0EventHistory(eventHistory, action.threadId);
  return {
    eventHistory,
    taskVersion: Math.max(state.taskVersion, projection.taskVersion),
    lastConnectFailure:
      action.type === 'connect-succeeded' ? null : state.lastConnectFailure,
    connectionState:
      action.type === 'connect-succeeded'
        ? action.result.health.ok
          ? 'online'
          : 'offline'
        : state.connectionState,
  };
}

export function canSendRuntimeMessage(state: RuntimeConnectionState): boolean {
  return state === 'preview' || state === 'online';
}
