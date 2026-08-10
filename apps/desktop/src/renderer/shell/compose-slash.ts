// Pure helpers for Compose slash-command menu (NewMax-style / menu).
import type { ModelId } from '@sync-think/shared';

export type SlashCommandKind = 'action' | 'prefix' | 'coming-soon';

export interface SlashCommand {
  /** Command without leading slash, e.g. "compact". */
  id: string;
  /** Full command token, e.g. "/compact". */
  command: string;
  /** Short Chinese label shown in the menu. */
  label: string;
  /** One-line description. */
  description: string;
  /**
   * action — runs immediately (e.g. /compact)
   * prefix — replaces the slash token with a prompt prefix and keeps focus
   * coming-soon — select closes menu and shows a short notice
   */
  kind: SlashCommandKind;
  /** Optional keywords for fuzzy filter. */
  keywords?: string[];
}

export interface SlashQuery {
  /** Absolute start index of '/' in the full text. */
  slashIndex: number;
  /** Text after '/' up to the caret (no spaces). */
  query: string;
  /** Caret position that closed the query. */
  caret: number;
}

/** Built-in slash commands shown above Skills (P6). */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'compact',
    command: '/compact',
    label: '压缩上下文',
    description: '插入命令；发送后才开始压缩',
    // Insert into the composer only — execution happens when the user presses Send.
    kind: 'prefix',
    keywords: ['compress', 'context', '压缩', '上下文'],
  },
  {
    id: 'plan',
    command: '/plan',
    label: '计划模式',
    description: '先出可审批大纲再执行（即将支持）',
    kind: 'coming-soon',
    keywords: ['outline', '规划', '计划'],
  },
  {
    id: 'goal',
    command: '/goal',
    label: '目标模式',
    description: '插入命令；发送后才设置目标（可附加完成条件，如 /goal 完成所有测试）',
    // Insert into the composer only — execution happens when the user presses Send.
    kind: 'prefix',
    keywords: ['autonomous', '目标', '循环', 'goal'],
  },
];

/**
 * Detect an active `/query` token just before the caret.
 * Only triggers when `/` starts a token (start / whitespace).
 * Does not trigger for URLs like https://… mid-token.
 */
export function detectSlashQuery(text: string, caret: number): SlashQuery | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const match = /(?:^|[\s([{])\/([^\s/]*)$/.exec(before);
  if (!match) return null;
  const query = match[1] ?? '';
  const slashIndex = before.length - query.length - 1;
  if (text[slashIndex] !== '/') return null;
  return { slashIndex, query, caret };
}

/** Filter built-in commands by query (command / label / keywords). */
export function filterSlashCommands(
  query: string,
  commands: readonly SlashCommand[] = BUILTIN_SLASH_COMMANDS,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  return commands.filter((cmd) => {
    if (cmd.command.toLowerCase().includes(`/${q}`) || cmd.command.slice(1).toLowerCase().startsWith(q)) {
      return true;
    }
    if (cmd.label.toLowerCase().includes(q)) return true;
    if (cmd.description.toLowerCase().includes(q)) return true;
    return (cmd.keywords ?? []).some((k) => k.toLowerCase().includes(q));
  });
}

/** Remove the active `/query` token from the text. */
export function stripSlashToken(
  text: string,
  slash: SlashQuery,
): { text: string; caret: number } {
  const next = text.slice(0, slash.slashIndex) + text.slice(slash.caret);
  return { text: next, caret: slash.slashIndex };
}

/** Format elapsed seconds for the compact capsule (NewMax shows duration). */
export function formatCompactElapsed(startedAt: number, now: number = Date.now()): string {
  const ms = Math.max(0, now - startedAt);
  const sec = ms / 1000;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  return `${Math.round(sec)}s`;
}

export type ParsedSlashCommand =
  | { kind: 'compact' }
  | { kind: 'compact-with-trailing'; trailing: string }
  | { kind: 'goal' }
  | { kind: 'goal-with-condition'; condition: string }
  | { kind: 'goal-clear' }
  | { kind: 'unknown'; command: string }
  | { kind: 'none' };

/**
 * Parse a composer send payload as a slash command.
 * Only the first non-whitespace token may be a command (start of input).
 */
export function parseSlashCommand(text: string): ParsedSlashCommand {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return { kind: 'none' };
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return { kind: 'none' };
  const command = `/${(match[1] ?? '').toLowerCase()}`;
  const trailing = (match[2] ?? '').trim();
  if (command === '/compact') {
    if (trailing) return { kind: 'compact-with-trailing', trailing };
    return { kind: 'compact' };
  }
  if (command === '/goal') {
    if (/^clear$/i.test(trailing)) return { kind: 'goal-clear' };
    if (trailing) return { kind: 'goal-with-condition', condition: trailing };
    return { kind: 'goal' };
  }
  return { kind: 'unknown', command };
}

export type SystemMessageTone = 'info' | 'success' | 'warning' | 'error';

/**
 * Resolve visual tone for system bubbles.
 * Prefer an explicit tone from the event/payload. Only fall back to a narrow
 * Chinese prefix heuristic for legacy messages that never carried tone.
 * Avoid marking ordinary content red just because it contains "失败/超时".
 */
export function resolveSystemMessageTone(
  tone: string | undefined,
  text: string,
): SystemMessageTone {
  if (tone === 'info' || tone === 'success' || tone === 'warning' || tone === 'error') {
    return tone;
  }
  const trimmed = text.trim();
  if (
    /^(发送失败|上下文压缩失败|上下文压缩超时|Runtime request timed out|请求失败)/i.test(
      trimmed,
    )
  ) {
    return 'error';
  }
  if (/^(请|斜杠命令|执行 \/compact)/.test(trimmed)) {
    return 'warning';
  }
  return 'info';
}

/**
 * Model id to send with appendMessage.
 * - Explicit composer override always wins when present.
 * - Model-track targetRef is only used when it looks like a catalog model id.
 * - Agent/team tracks store agent/team ids in targetRef — never send those as modelId.
 */
export function resolveSendModelId(input: {
  modelOverride?: string | null;
  track?: string | null;
  targetRef?: string | null;
  catalogModelIds?: readonly string[];
}): ModelId | undefined {
  const override = typeof input.modelOverride === 'string' ? input.modelOverride.trim() : '';
  if (override) return override as ModelId;

  const track = input.track ?? 'model';
  if (track === 'agent' || track === 'team') return undefined;

  const target = typeof input.targetRef === 'string' ? input.targetRef.trim() : '';
  if (!target) return undefined;

  const catalog = input.catalogModelIds ?? [];
  if (catalog.length > 0) {
    return catalog.includes(target) ? (target as ModelId) : undefined;
  }
  // No catalog available (tests / early boot): allow model-track targetRef.
  return track === 'model' || !track ? (target as ModelId) : undefined;
}
