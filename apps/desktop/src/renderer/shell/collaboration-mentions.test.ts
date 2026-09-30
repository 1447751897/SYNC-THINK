import { describe, expect, it } from 'vitest';
import { agentMentionToken, detectAgentMentionQuery, mentionDisplayText, serializeAgentMentions } from './collaboration-mentions.js';

describe('inline agent mentions', () => {
  it('detects a mention at any prose position, including Chinese without a space', () => {
    expect(detectAgentMentionQuery('帮我问一下@研究 这个问题', 8)).toEqual({ atIndex: 5, caret: 8, query: '研究' });
    expect(detectAgentMentionQuery('@', 1)?.atIndex).toBe(0);
    expect(detectAgentMentionQuery('段落\n@研究', 6)?.atIndex).toBe(3);
    expect(detectAgentMentionQuery('ask@研究', 6)).toEqual({ atIndex: 3, caret: 6, query: '研究' });
  });
  it('preserves repeated mentions, identity, punctuation and surrounding prose', () => {
    const token = agentMentionToken('agent:a', '研[究]员');
    const value = serializeAgentMentions(`先问${token}，再问${token}。`);
    expect(value.text).toBe('先问研[究]员，再问研[究]员。');
    expect(value.recipientMemberIds).toEqual(['agent:a']);
    expect(value.mentions).toEqual([
      { memberId: 'agent:a', label: '研[究]员', start: 2, end: 7 },
      { memberId: 'agent:a', label: '研[究]员', start: 10, end: 15 },
    ]);
    expect(serializeAgentMentions('只剩文本').recipientMemberIds).toEqual([]);
  });
  it('rebuilds tags in place without interpreting unselected names as mentions', () => {
    const value = serializeAgentMentions(`问${agentMentionToken('a', '同名')}和${agentMentionToken('b', '同名')}这个问题`);
    const display = mentionDisplayText(value.text, value.mentions);
    expect(display.text).toBe('问[member](#agent-mention-0)和[member](#agent-mention-1)这个问题');
    expect(display.references.map(r => r.mention.memberId)).toEqual(['a', 'b']);
    expect(mentionDisplayText('普通@文本', []).text).toBe('普通@文本');
    expect(mentionDisplayText('旧@同名消息', [{ memberId: 'a', label: '同名' }]).text).toBe('旧[member](#agent-mention-0)消息');
  });
  it('ignores invalid or overlapping saved positions instead of replacing unrelated text', () => {
    const source = '先问研究员后再说';
    const first = { memberId: 'a', label: '研究员', start: 2, end: 5 };
    expect(mentionDisplayText(source, [first, first]).references).toHaveLength(1);
    expect(mentionDisplayText(source, [{ ...first, start: 0 }]).text).toBe(source);
  });
});
