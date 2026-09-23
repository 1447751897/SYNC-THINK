import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/bot-channel-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Bot Channel IPC wiring', () => {
  it('registers lifecycle commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:bot-channel-get', 'bot.channel.get'],
      ['runtime:bot-channel-save', 'bot.channel.save'],
      ['runtime:bot-channel-test', 'bot.channel.test'],
      ['runtime:bot-channel-wechat-qr-request', 'bot.channel.wechat.qr.request'],
      ['runtime:bot-channel-wechat-qr-check', 'bot.channel.wechat.qr.check'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerBotChannelHandlers({');
    expect(mainSource).toContain('requestBotChannel:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:bot-channel-get',
      'runtime:bot-channel-save',
      'runtime:bot-channel-test',
      'runtime:bot-channel-wechat-qr-request',
      'runtime:bot-channel-wechat-qr-check',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('getBotChannelConfig(');
    expect(globalSource).toContain('saveBotChannelConfig(');
    expect(globalSource).toContain('testBotChannel(');
    expect(globalSource).toContain('requestWechatBotQr(');
    expect(globalSource).toContain('checkWechatBotQr(');
  });
});
