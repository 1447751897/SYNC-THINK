import type { CollaborationSnapshot } from '@sync-think/shared';
import { parseComposerEditorInlineTokens } from './ComposerEditorTokens.js';
import type { MentionQuery } from './compose-mention.js';

type Mention = CollaborationSnapshot['messages'][number]['mentions'][number];
export const agentMentionToken = (id: string, name: string) => `[${encodeURIComponent(name)}](newmax-agent:${encodeURIComponent(id)})`;

/** No word boundary is required: selection may start anywhere in the prose. */
export function detectAgentMentionQuery(text: string, caret: number): MentionQuery | null {
  if (caret < 0 || caret > text.length) return null;
  const match = /@([^\s@]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { atIndex: match.index, caret, query: match[1] };
}

/** Editor tokens never leak into model prompts. Positions refer to the plain, untrimmed text. */
export function serializeAgentMentions(draft: string) {
  let text = '', cursor = 0;
  const mentions: (Mention & { start: number; end: number })[] = [];
  for (const token of parseComposerEditorInlineTokens(draft).filter(token => token.kind === 'agent')) {
    text += draft.slice(cursor, token.start);
    const start = text.length;
    text += token.label;
    mentions.push({ memberId: token.value, label: token.label, start, end: text.length });
    cursor = token.end;
  }
  text += draft.slice(cursor);
  return { text, mentions, recipientMemberIds: [...new Set(mentions.map(mention => mention.memberId))] };
}

/** Rebuild inline display links from durable spans; old unpositioned mentions get an inline prefix. */
export function mentionDisplayText(text: string, mentions: readonly Mention[]) {
  const references: { href: string; mention: Mention }[] = [];
  let result = '', cursor = 0, prefix = '';
  const link = (mention: Mention) => {
    const href = `#agent-mention-${references.length}`;
    references.push({ href, mention });
    // The renderer supplies the visible label, so names containing Markdown punctuation are safe.
    return `[member](${href})`;
  };
  for (const mention of mentions) {
    const { start, end } = mention;
    if (start === undefined || end === undefined) {
      const legacy = `@${mention.label}`;
      const at = text.indexOf(legacy, cursor);
      if (at >= cursor) { result += text.slice(cursor, at) + link(mention); cursor = at + legacy.length; }
      else prefix += link(mention) + ' ';
    } else if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= cursor && end > start && end <= text.length && text.slice(start, end) === mention.label) {
      result += text.slice(cursor, start) + link(mention);
      cursor = end;
    }
  }
  return { text: prefix + result + text.slice(cursor), references };
}
