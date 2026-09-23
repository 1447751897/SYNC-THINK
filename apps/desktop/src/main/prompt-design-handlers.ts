import type {
  PromptDesignCommand,
  PromptDesignCommandRequest,
  PromptDesignCommandResponse,
} from '@sync-think/protocol';
import {
  parseDesignGeneratePayloadForDesktop,
  parsePromptEnhanceCancelPayload,
  parsePromptEnhancePayload,
} from '../prompt-design-payloads.js';
import { PROMPT_DESIGN_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface PromptDesignHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestPromptDesign<K extends PromptDesignCommand>(
    command: K,
    payload: PromptDesignCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<PromptDesignCommandResponse<K>>;
}

export function registerPromptDesignHandlers<Event>(host: PromptDesignHost<Event>): void {
  host.handle(PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.enhancePrompt, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestPromptDesign('prompt.enhance', parsePromptEnhancePayload(value));
  });

  host.handle(PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.cancelPromptEnhancement, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestPromptDesign(
      'prompt.enhance.cancel',
      parsePromptEnhanceCancelPayload(value),
    );
  });

  host.handle(PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.generateDesign, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestPromptDesign('design.generate', parseDesignGeneratePayloadForDesktop(value));
  });
}
