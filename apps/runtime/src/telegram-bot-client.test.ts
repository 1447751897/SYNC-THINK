import { describe, expect, it, vi } from 'vitest';
import { TelegramBotClient, telegramBotInternals } from './telegram-bot-client.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TelegramBotClient', () => {
  it('tests a token with getMe without exposing it in the result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: { id: 42, username: 'sync_think_bot', first_name: 'SYNC-THINK' },
      }),
    );
    const client = new TelegramBotClient(fetchImpl);

    await expect(client.testConnection('123:secret')).resolves.toEqual({
      id: 42,
      username: 'sync_think_bot',
      displayName: 'SYNC-THINK',
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/getMe');
  });

  it('rejects malformed tokens before issuing a network request', async () => {
    const fetchImpl = vi.fn();
    const client = new TelegramBotClient(fetchImpl);

    await expect(client.testConnection('not-a-bot-token')).rejects.toThrow(
      'Bot Token 格式不正确。',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('projects only incoming text messages and keeps update ids for durable offsets', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: [
          {
            update_id: 9,
            message: {
              message_id: 3,
              text: '检查项目',
              chat: { id: 1001, type: 'private' },
              from: { id: 8, first_name: 'Zhu' },
            },
          },
          { update_id: 10, message: { message_id: 4, chat: { id: 1001, type: 'private' } } },
        ],
      }),
    );
    const client = new TelegramBotClient(fetchImpl);

    await expect(client.getUpdates({ token: '123:secret', offset: 9 })).resolves.toEqual({
      messages: [
        {
          updateId: 9,
          messageId: 3,
          chatId: 1001,
          chatType: 'private',
          text: '检查项目',
          senderName: 'Zhu',
        },
      ],
      nextOffset: 11,
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      offset: 9,
      timeout: 25,
      allowed_updates: ['message'],
    });
  });

  it('splits long replies at Telegram message boundaries', () => {
    const chunks = telegramBotInternals.splitTelegramText(`第一段\n${'x'.repeat(8_300)}`);
    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => chunk.length <= 4_096)).toBe(true);
    expect(chunks.join('')).toContain('第一段');
  });
});
