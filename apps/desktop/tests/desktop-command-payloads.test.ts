import { describe, expect, it } from 'vitest';
import {
  parseCancelDesktopCommandPayload,
  parseContinueDesktopCommandPayload,
  parseListWaitingDesktopCommandsPayload,
} from '../src/desktop-command-payloads.js';

describe('desktop command payloads', () => {
  it('accepts omitted and strictly filtered list payloads', () => {
    expect(parseListWaitingDesktopCommandsPayload(undefined)).toEqual({});
    expect(parseListWaitingDesktopCommandsPayload(null)).toEqual({});
    expect(
      parseListWaitingDesktopCommandsPayload({ workspaceId: 'workspace-1', runId: 'run-1' }),
    ).toEqual({ workspaceId: 'workspace-1', runId: 'run-1' });
  });

  it('strictly parses continue and cancel decisions with an updated-at fence', () => {
    const payload = {
      commandId: 'desktop-command-1',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    };
    expect(parseContinueDesktopCommandPayload(payload)).toEqual(payload);
    expect(parseCancelDesktopCommandPayload(payload)).toEqual(payload);
    expect(() =>
      parseContinueDesktopCommandPayload({ ...payload, expectedUpdatedAt: 'yesterday' }),
    ).toThrow(/Invalid continue-desktop-command/);
    expect(() => parseCancelDesktopCommandPayload({ ...payload, extra: true })).toThrow(
      /Invalid cancel-desktop-command/,
    );
  });

  it.each([
    [],
    { workspaceId: 'workspace 1' },
    { runId: '' },
    { workspaceId: 'workspace-1', unexpected: true },
  ])('rejects invalid list payload %#', (payload) => {
    expect(() => parseListWaitingDesktopCommandsPayload(payload)).toThrow(
      /Invalid list-waiting-desktop-commands/,
    );
  });
});
