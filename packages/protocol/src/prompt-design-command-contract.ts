import type {
  DesignGeneratePayload,
  DesignGenerateResponse,
  PromptEnhanceCancelPayload,
  PromptEnhanceCancelResponse,
  PromptEnhancePayload,
  PromptEnhanceResponse,
} from './commands.js';

/** One-shot prompt and visual-design transformation RPCs. */
export interface PromptDesignCommandContract {
  'prompt.enhance': {
    request: PromptEnhancePayload;
    response: PromptEnhanceResponse;
  };
  'prompt.enhance.cancel': {
    request: PromptEnhanceCancelPayload;
    response: PromptEnhanceCancelResponse;
  };
  'design.generate': {
    request: DesignGeneratePayload;
    response: DesignGenerateResponse;
  };
}

export type PromptDesignCommand = keyof PromptDesignCommandContract;
export type PromptDesignCommandRequest<K extends PromptDesignCommand> =
  PromptDesignCommandContract[K]['request'];
export type PromptDesignCommandResponse<K extends PromptDesignCommand> =
  PromptDesignCommandContract[K]['response'];
