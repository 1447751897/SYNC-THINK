import type { TeamCommand, TeamCommandRequest, TeamCommandResponse } from '@sync-think/protocol';
import {
  parseCreateTeamPayload,
  parseDeleteTeamPayload,
  parseSetTeamRunStatusPayload,
  parseStartTeamRunPayload,
  parseUpdateTeamPayload,
} from '../team-payloads.js';

export interface TeamHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestTeam<K extends TeamCommand>(
    command: K,
    payload: TeamCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<TeamCommandResponse<K>>;
}

export function registerTeamHandlers<Event>(host: TeamHost<Event>): void {
  host.handle('runtime:team-list', async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTeam('team.list', {});
  });

  host.handle('runtime:team-create', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTeam('team.create', parseCreateTeamPayload(value));
  });

  host.handle('runtime:team-update', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTeam('team.update', parseUpdateTeamPayload(value));
  });

  host.handle('runtime:team-delete', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTeam('team.delete', parseDeleteTeamPayload(value));
  });

  host.handle('runtime:team-start-run', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTeam('team.startRun', parseStartTeamRunPayload(value));
  });

  host.handle('runtime:team-set-run-status', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTeam('team.setRunStatus', parseSetTeamRunStatusPayload(value));
  });
}
