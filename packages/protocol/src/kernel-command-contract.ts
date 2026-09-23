import type {
  KernelDetectResponse,
  KernelRecyclePayload,
  KernelRecycleResponse,
} from './commands.js';

export type KernelEmptyPayload = Record<string, never>;

/** Kernel discovery and resident lifecycle RPCs. */
export interface KernelCommandContract {
  'kernel.detect': {
    request: KernelEmptyPayload;
    response: KernelDetectResponse;
  };
  'kernel.recycle': {
    request: KernelRecyclePayload;
    response: KernelRecycleResponse;
  };
}

export type KernelCommand = keyof KernelCommandContract;
export type KernelCommandRequest<K extends KernelCommand> = KernelCommandContract[K]['request'];
export type KernelCommandResponse<K extends KernelCommand> = KernelCommandContract[K]['response'];
