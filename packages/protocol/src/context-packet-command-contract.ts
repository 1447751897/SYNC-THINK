import type {
  AmendContextPacketPayload,
  AmendContextPacketResponse,
  PeekContextPacketPayload,
  PeekContextPacketResponse,
} from './commands.js';

/** Context Packet RPCs bind each command to its request and response payload. */
export interface ContextPacketCommandContract {
  'context.packet.peek': {
    request: PeekContextPacketPayload;
    response: PeekContextPacketResponse;
  };
  'context.packet.amend': {
    request: AmendContextPacketPayload;
    response: AmendContextPacketResponse;
  };
}

export type ContextPacketCommand = keyof ContextPacketCommandContract;
export type ContextPacketCommandRequest<K extends ContextPacketCommand> =
  ContextPacketCommandContract[K]['request'];
export type ContextPacketCommandResponse<K extends ContextPacketCommand> =
  ContextPacketCommandContract[K]['response'];
