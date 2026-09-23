import type {
  DecideMemoryPayload,
  DecideMemoryResponse,
  ListMemoryPayload,
  ListMemoryResponse,
  RollbackMemoryPayload,
  RollbackMemoryResponse,
} from './commands.js';

/** Memory RPCs bind each command to its request and response payload. */
export interface MemoryCommandContract {
  'memory.list': {
    request: ListMemoryPayload;
    response: ListMemoryResponse;
  };
  'memory.decide': {
    request: DecideMemoryPayload;
    response: DecideMemoryResponse;
  };
  'memory.rollback': {
    request: RollbackMemoryPayload;
    response: RollbackMemoryResponse;
  };
}

export type MemoryCommand = keyof MemoryCommandContract;
export type MemoryCommandRequest<K extends MemoryCommand> = MemoryCommandContract[K]['request'];
export type MemoryCommandResponse<K extends MemoryCommand> = MemoryCommandContract[K]['response'];
