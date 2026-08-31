import { afterEach, describe, expect, it, vi } from 'vitest';
import { WechatGateway } from './wechat-gateway.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WechatGateway', () => {
  it('uses the iLink 1.0.2 authentication contract', async () => {
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(JSON.stringify({ ret: 0, typing_ticket: 'ticket' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new WechatGateway();

    const result = await gateway.test({
      platform: 'wechat',
      enabled: true,
      credentials: { botToken: 'secret-token' },
      settings: { baseUrl: 'https://ilink.example', ilinkUserId: 'ilink-user' },
    });

    expect(result.overall).toBe('pass');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ilink.example/ilink/bot/getconfig',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          AuthorizationType: 'ilink_bot_token',
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      ilink_user_id: 'ilink-user',
      base_info: { channel_version: '1.0.2' },
    });
  });

  it('requests a QR image and maps confirmed login credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ret: 0, qrcode: 'qr-id', qrcode_img_content: 'weixin://qr/test' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'confirmed',
            bot_token: 'bot-token',
            baseurl: 'https://ilink-confirmed.example',
            ilink_bot_id: 'bot-id',
            ilink_user_id: 'ilink-user',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new WechatGateway();

    const qr = await gateway.requestQrLogin('https://ilink.example/');
    expect(qr.qrcode).toBe('qr-id');
    expect(qr.qrcodeImage).toMatch(/^data:image\/png;base64,/);
    await expect(gateway.checkQrStatus(qr.qrcode, 'https://ilink.example')).resolves.toEqual({
      status: 'confirmed',
      botToken: 'bot-token',
      baseUrl: 'https://ilink-confirmed.example',
      botId: 'bot-id',
      ilinkUserId: 'ilink-user',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://ilink.example/ilink/bot/get_bot_qrcode?bot_type=3',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://ilink.example/ilink/bot/get_qrcode_status?qrcode=qr-id',
    );
  });
});
