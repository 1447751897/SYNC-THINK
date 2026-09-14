import { deriveTaskTitleFromPrompt } from './task-title.js';
import {
  RUN_INDEX_MAX_TITLE_LENGTH,
  type RunIndexSource,
} from './types/run-index.js';

/** Fallback label when no human title can be resolved. Never a raw id. */
export const RUN_INDEX_SOURCE_TITLES: Record<RunIndexSource, string> = {
  chat: '对话',
  scheduled: '定时任务',
  external: '系统触发',
  orchestration: '编排',
};

const PLACEHOLDER_TITLES = new Set([
  '新对话',
  '新任务',
  '子任务',
  '未命名对话',
  '未命名',
]);

/**
 * True for Sync-Think / ULID-style opaque ids that must not be shown as a
 * title or model name. Human labels like `gpt-5.2` keep their hyphens and
 * fail this check on purpose.
 */
export function looksLikeOpaqueId(value: string | null | undefined): boolean {
  const text = (value ?? '').trim();
  if (!text) return false;
  if (/^(run|evt|msg|conv|task|thread|workspace)-/i.test(text)) return true;
  return text.length >= 20 && text.length <= 40 && /^[0-9A-HJKMNP-TV-Z]+$/i.test(text);
}

export function isUsableRunIndexTitle(value: string | null | undefined): value is string {
  const text = (value ?? '').trim();
  if (!text) return false;
  if (PLACEHOLDER_TITLES.has(text)) return false;
  if (/^(?:新任务|子任务)(?:\s+\d+)?$/.test(text)) return false;
  if (looksLikeOpaqueId(text)) return false;
  return true;
}

export function truncateRunIndexTitle(value: string): string {
  const characters = Array.from(value.trim());
  if (characters.length <= RUN_INDEX_MAX_TITLE_LENGTH) return characters.join('');
  return `${characters.slice(0, RUN_INDEX_MAX_TITLE_LENGTH - 1).join('')}…`;
}

export function extractRunIndexMessageText(
  blocks: ReadonlyArray<{ type: string; text?: string }> | null | undefined,
): string {
  return (blocks ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim();
}

export interface RunIndexTitleInput {
  storedTitle?: string;
  conversationTitle?: string;
  taskTitle?: string;
  externalEventTitle?: string;
  triggerText?: string;
  source: RunIndexSource;
}

/** Human label only. Returns undefined when the caller should persist nothing. */
export function resolveRunIndexHumanTitle(input: RunIndexTitleInput): string | undefined {
  if (isUsableRunIndexTitle(input.storedTitle)) {
    return truncateRunIndexTitle(input.storedTitle);
  }
  if (isUsableRunIndexTitle(input.conversationTitle)) {
    return truncateRunIndexTitle(input.conversationTitle);
  }
  if (isUsableRunIndexTitle(input.taskTitle)) {
    return truncateRunIndexTitle(input.taskTitle);
  }
  if (isUsableRunIndexTitle(input.externalEventTitle)) {
    return truncateRunIndexTitle(input.externalEventTitle);
  }
  const fromPrompt = input.triggerText?.trim()
    ? deriveTaskTitleFromPrompt(input.triggerText, 32)
    : '';
  if (isUsableRunIndexTitle(fromPrompt)) return fromPrompt;
  return undefined;
}

/** Always a readable line for the activity list. Never a run / event id. */
export function resolveRunIndexDisplayTitle(input: RunIndexTitleInput): string {
  return resolveRunIndexHumanTitle(input) ?? RUN_INDEX_SOURCE_TITLES[input.source];
}

export function resolveRunIndexModelLabel(input: {
  displayName?: string;
  providerModelId?: string;
  modelId?: string;
}): string | undefined {
  for (const candidate of [input.displayName, input.providerModelId, input.modelId]) {
    const text = candidate?.trim();
    if (text && !looksLikeOpaqueId(text)) return text;
  }
  return undefined;
}
