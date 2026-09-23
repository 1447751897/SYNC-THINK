import { describe, expect, it, vi } from 'vitest';
import { registerSkillMarketHandlers, type SkillMarketHost } from './skill-market-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { items: [] };
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
    requestSkillMarket: request as SkillMarketHost<string>['requestSkillMarket'],
  };
  registerSkillMarketHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Skill Market IPC boundary', () => {
  it('registers the Skill Market command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:skill-market-list',
      'runtime:skill-market-install',
    ]);
  });

  it.each([
    ['runtime:skill-market-list', undefined, 'skill.market.list', {}],
    [
      'runtime:skill-market-install',
      { marketSkillId: ' project-bootstrap ' },
      'skill.market.install',
      { marketSkillId: 'project-bootstrap' },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:skill-market-install')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting an invalid install payload without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:skill-market-install')!('trusted', { marketSkillId: ' ' }),
    ).rejects.toThrow('Invalid skill-market-install payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:skill-market-list')!('trusted', undefined),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:skill-market-install')!('trusted', {
        marketSkillId: 'project-bootstrap',
      }),
    ).rejects.toBe(failure);
  });
});
