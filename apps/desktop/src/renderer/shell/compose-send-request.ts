import type { AppendMessagePayload } from '@sync-think/protocol';
import type { MessageImage } from './compose-mention.js';
import type { ReasoningEffort } from './compose-toolbar.js';
import { resolveSendModelId } from './compose-slash.js';

export interface ComposeSendOptions {
  skillVersionIds?: readonly string[];
  modelOverride?: string;
  kernelOverride?: string;
  reasoningEffort?: ReasoningEffort;
  networkEnabled?: boolean;
  planExecuting?: boolean;
  helpMode?: boolean;
}

export type SendComposeText = (
  text: string,
  images?: MessageImage[],
  options?: ComposeSendOptions,
) => Promise<boolean | undefined>;

/** Assemble an append from frozen turn choices; no bridge, UI state, or storage access. */
export function buildComposeAppendRequest(input: {
  threadId: AppendMessagePayload['threadId'];
  taskVersion: number;
  conversationId: string;
  text: string;
  images: readonly MessageImage[];
  track: string;
  targetRef: string;
  catalogModelIds: readonly string[];
  modelOverride: string;
  kernelOverride: string;
  reasoningEffort: ReasoningEffort;
  networkEnabled: boolean;
  skillVersionIds: string[];
  workspacePath?: string;
  planExecuting?: boolean;
  helpMode?: boolean;
}): AppendMessagePayload {
  return {
    threadId: input.threadId,
    expectedTaskVersion: input.taskVersion,
    role: 'user',
    text: input.text.trim()
      ? input.text
      : input.images.length > 0
        ? input.images.map((image) => `[图片] ${image.name}`).join('\n')
        : input.text,
    modelId: resolveSendModelId(input),
    kernelId: input.kernelOverride,
    reasoningEffort: input.reasoningEffort,
    networkEnabled: input.networkEnabled || undefined,
    planExecuting: input.planExecuting === true ? true : undefined,
    helpMode: input.helpMode === true ? true : undefined,
    skillVersionIds: input.skillVersionIds,
    attachmentContext:
      input.images.length > 0
        ? {
            conversationId: input.conversationId,
            workspacePath: input.workspacePath?.trim() || undefined,
          }
        : undefined,
    images:
      input.images.length > 0
        ? input.images.map((image) => ({
            id: image.id,
            name: image.name || 'image',
            mimeType: image.mimeType || 'image/png',
            dataUrl: image.url,
          }))
        : undefined,
  };
}
