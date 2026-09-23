import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/context-packet-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');

const contextCommands = [
  [
    'peekContextPacket',
    'runtime:context-packet-peek',
    'context.packet.peek',
    'parsePeekContextPacketPayload',
  ],
  [
    'amendContextPacket',
    'runtime:context-packet-amend',
    'context.packet.amend',
    'parseAmendContextPacketPayload',
  ],
] as const;

describe('Desktop Context Packet wiring', () => {
  it.each(contextCommands)(
    'routes %s through its strict parser to %s',
    (method, channel, command, parser) => {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`host.requestContextPacket('${command}'`);
      expect(handlerSource).toContain(`${parser}(value)`);
      expect(preloadSource).toContain(`${method}:`);
      expect(preloadSource).toContain(`'${channel}'`);
    },
  );

  it('registers the Context Packet boundary from the Main composition root', () => {
    expect(mainSource).toContain('registerContextPacketHandlers({');
    expect(mainSource).toContain('requestContextPacket:');
    expect(mainSource).not.toContain("request('context.packet.");
  });
});
