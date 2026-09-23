import { describe, expect, it, vi } from 'vitest';
import { registerSkillHandlers, type SkillHost } from './skill-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { skills: [] };
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
    requestSkill: request as SkillHost<string>['requestSkill'],
  };
  registerSkillHandlers(host);
  return { handlers, host, order, request, response };
}

describe('installed Skill IPC boundary', () => {
  it('registers the installed Skill lifecycle command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:skill-import',
      'runtime:skill-import-remote',
      'runtime:skill-list',
      'runtime:skill-delete',
      'runtime:skill-get',
      'runtime:skill-set-enabled',
    ]);
  });

  it.each([
    [
      'runtime:skill-import',
      {
        skillMd: '---\nname: reviewer\n---\nReview changes.',
        originType: 'derived',
        originRef: ' source/ref ',
        derivedFromSkillVersionId: ' version-1 ',
        skillId: ' skill-1 ',
      },
      'skill.import',
      {
        skillMd: '---\nname: reviewer\n---\nReview changes.',
        originType: 'derived',
        originRef: 'source/ref',
        derivedFromSkillVersionId: 'version-1',
        skillId: 'skill-1',
      },
      undefined,
    ],
    [
      'runtime:skill-import-remote',
      {
        url: ' https://example.com/SKILL.md ',
        originRef: ' source/ref ',
        skillId: ' skill-1 ',
      },
      'skill.importRemote',
      { url: 'https://example.com/SKILL.md', originRef: 'source/ref', skillId: 'skill-1' },
      { timeoutMs: 30_000 },
    ],
    [
      'runtime:skill-list',
      {
        limit: 20,
        workspaceId: ' workspace-1 ',
        skillVersionIds: [' version-1 ', 'version-1', 'version-2'],
      },
      'skill.list',
      {
        limit: 20,
        workspaceId: 'workspace-1',
        skillVersionIds: ['version-1', 'version-2'],
      },
      undefined,
    ],
    [
      'runtime:skill-delete',
      { skillVersionId: ' version-1 ' },
      'skill.delete',
      { skillVersionId: 'version-1' },
      undefined,
    ],
    [
      'runtime:skill-get',
      { skillVersionId: ' version-1 ' },
      'skill.get',
      { skillVersionId: 'version-1' },
      undefined,
    ],
    [
      'runtime:skill-set-enabled',
      { skillVersionId: ' version-1 ', enabled: false },
      'skill.setEnabled',
      { skillVersionId: 'version-1', enabled: false },
      undefined,
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload, options) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    if (options) expect(request).toHaveBeenCalledWith(command, payload, options);
    else expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:skill-import')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['runtime:skill-import', { skillMd: '' }],
    ['runtime:skill-import-remote', { url: 'file:///tmp/SKILL.md' }],
    ['runtime:skill-list', { limit: 0 }],
    ['runtime:skill-delete', {}],
    ['runtime:skill-get', { skillVersionId: ' ' }],
    ['runtime:skill-set-enabled', { skillVersionId: 'version-1', enabled: 'yes' }],
  ])('connects before rejecting invalid %s payloads without transport', async (channel, value) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(connectionFixture.handlers.get('runtime:skill-list')!('trusted', {})).rejects.toBe(
      offline,
    );
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:skill-get')!('trusted', {
        skillVersionId: 'version-1',
      }),
    ).rejects.toBe(failure);
  });
});
