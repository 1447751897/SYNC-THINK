import { z } from 'zod';
import type {
  ConversationGetContextStatusPayload,
  ConversationGetContextStatusResponse,
  ContextStatusSectionType,
} from './commands.js';

export const MAX_CONTEXT_STATUS_CONVERSATION_ID_LENGTH = 128;
export const MAX_CONTEXT_STATUS_MODEL_ID_LENGTH = 256;
export const MAX_CONTEXT_STATUS_KERNEL_ID_LENGTH = 64;
export const MAX_CONTEXT_STATUS_TOKENS = 100_000_000;
export const MAX_CONTEXT_STATUS_USAGE_RATIO = MAX_CONTEXT_STATUS_TOKENS;
export const MIN_CONTEXT_WINDOW_OVERRIDE = 1_024;
export const MAX_CONTEXT_WINDOW_OVERRIDE = 10_000_000;

export const CONTEXT_STATUS_SECTION_TYPES = [
  'system',
  'agent',
  'project',
  'summary',
  'messages',
  'tools',
] as const satisfies readonly ContextStatusSectionType[];

const conversationGetContextStatusPayloadSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(MAX_CONTEXT_STATUS_CONVERSATION_ID_LENGTH),
    modelId: z.string().trim().min(1).max(MAX_CONTEXT_STATUS_MODEL_ID_LENGTH).optional(),
    kernelId: z.string().trim().min(1).max(MAX_CONTEXT_STATUS_KERNEL_ID_LENGTH).optional(),
  })
  .strict();

const contextStatusSectionSchema = z
  .object({
    type: z.enum(CONTEXT_STATUS_SECTION_TYPES),
    tokens: z.number().int().min(0).max(MAX_CONTEXT_STATUS_TOKENS),
  })
  .strict();

const conversationGetContextStatusResponseSchema = z
  .object({
    modelId: z.string().trim().min(1).max(MAX_CONTEXT_STATUS_MODEL_ID_LENGTH),
    contextWindow: z.number().int().min(1).max(MAX_CONTEXT_STATUS_TOKENS),
    modelContextWindow: z.number().int().min(1).max(MAX_CONTEXT_STATUS_TOKENS),
    contextWindowOverride: z
      .number()
      .int()
      .min(MIN_CONTEXT_WINDOW_OVERRIDE)
      .max(MAX_CONTEXT_WINDOW_OVERRIDE)
      .optional(),
    contextWindowSource: z.enum(['model-default', 'conversation-override', 'kernel-limit']),
    kernelContextWindowLimit: z.number().int().min(1).max(MAX_CONTEXT_STATUS_TOKENS).optional(),
    contextWindowEstimated: z.boolean().optional(),
    estimatedUsedTokens: z.number().int().min(0).max(MAX_CONTEXT_STATUS_TOKENS),
    usageRatio: z.number().finite().min(0).max(MAX_CONTEXT_STATUS_USAGE_RATIO),
    compactThreshold: z.literal(0.7),
    compactedAt: z.string().datetime({ offset: true }).optional(),
    sections: z.array(contextStatusSectionSchema).length(CONTEXT_STATUS_SECTION_TYPES.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.contextWindowSource === 'model-default' &&
      value.contextWindowOverride !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contextWindowSource'],
        message: 'Model-default context must not carry a conversation override',
      });
    }
    if (
      value.contextWindowSource === 'conversation-override' &&
      value.contextWindowOverride === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contextWindowOverride'],
        message: 'Conversation override source requires an override value',
      });
    }
    if (value.contextWindowSource === 'kernel-limit') {
      if (
        value.kernelContextWindowLimit === undefined ||
        value.contextWindow !== value.kernelContextWindowLimit
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['kernelContextWindowLimit'],
          message: 'Kernel-limit source requires the effective kernel ceiling',
        });
      }
    } else if (value.kernelContextWindowLimit !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kernelContextWindowLimit'],
        message: 'Kernel limit is only valid when it is the effective source',
      });
    }
    if (value.contextWindowEstimated === true && value.contextWindowOverride !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contextWindowEstimated'],
        message: 'A user-provided context window is not estimated',
      });
    }

    const sectionTypes = new Set(value.sections.map((section) => section.type));
    if (sectionTypes.size !== CONTEXT_STATUS_SECTION_TYPES.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections'],
        message: 'Context status sections must contain every section type exactly once',
      });
    }

    const sectionTokenTotal = value.sections.reduce((total, section) => total + section.tokens, 0);
    if (sectionTokenTotal !== value.estimatedUsedTokens) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedUsedTokens'],
        message: 'Estimated token usage must equal the section token total',
      });
    }

    const expectedUsageRatio = value.estimatedUsedTokens / value.contextWindow;
    if (Math.abs(value.usageRatio - expectedUsageRatio) > 1e-9) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['usageRatio'],
        message: 'Usage ratio must equal estimatedUsedTokens / contextWindow',
      });
    }
  });

export function parseConversationGetContextStatusPayload(
  value: unknown,
): ConversationGetContextStatusPayload {
  return conversationGetContextStatusPayloadSchema.parse(
    value,
  ) as ConversationGetContextStatusPayload;
}

export function parseConversationGetContextStatusResponse(
  value: unknown,
): ConversationGetContextStatusResponse {
  return conversationGetContextStatusResponseSchema.parse(
    value,
  ) as ConversationGetContextStatusResponse;
}
