import { describe, expect, it, vi } from 'vitest';
import { registerSkillLocalHandlers, type SkillLocalHost } from './skill-local-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { candidates: [] };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestSkillLocal: request as SkillLocalHost<string>['requestSkillLocal'],
  };
  registerSkillLocalHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Skill Local IPC boundary', () => {
  it('registers the local Skill command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:skill-local-scan',
      'runtime:skill-local-inspect',
      'runtime:skill-local-import',
    ]);
  });

  it.each([
    ['runtime:skill-local-scan', { refresh: true }, 'skill.local.scan', { refresh: true }],
    [
      'runtime:skill-local-inspect',
      { path: ' C:\\skills\\reviewer ' },
      'skill.local.inspect',
      { path: 'C:\\skills\\reviewer' },
    ],
    [
      'runtime:skill-local-import',
      {
        path: ' C:\\skills\\reviewer.zip ',
        scope: { type: 'workspace', workspaceId: ' workspace-1 ' },
        overwrite: true,
      },
      'skill.local.import',
      {
        path: 'C:\\skills\\reviewer.zip',
        scope: { type: 'workspace', workspaceId: 'workspace-1' },
        overwrite: true,
      },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('preserves the permissive empty scan payload', async () => {
    const { handlers, request } = fixture();
    await handlers.get('runtime:skill-local-scan')!('trusted', null);
    expect(request).toHaveBeenCalledWith('skill.local.scan', {});
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:skill-local-import')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['runtime:skill-local-inspect', { path: ' ' }],
    [
      'runtime:skill-local-import',
      { path: 'C:\\skills\\reviewer', scope: { type: 'workspace', workspaceId: '' } },
    ],
  ])('connects before rejecting invalid %s payloads without transport', async (channel, value) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(/Invalid skill-local-/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:skill-local-scan')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:skill-local-inspect')!('trusted', {
        path: 'C:\\skills',
      }),
    ).rejects.toBe(failure);
  });
});
