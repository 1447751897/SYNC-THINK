import { describe, expect, it } from 'vitest';
import { parseSkillMd } from '@sync-think/core';
import { narrowSkillApprovalArguments } from './skill-approval-narrowing.js';
const source = (declarations: string) => '---\nname: repo-to-agent\ndescription: 分析仓库\nversion: 1.1.0\n' + declarations + '\n---\n正文保持不变：allowed-tools: 不属于前言。';
describe('human narrowing of Skill approval', () => {
  it.each(['allowed-tools: ["read_file", "write_file", "web_fetch"]', "allowedtools: ['read_file', 'write_file', 'web_fetch']"])('rewrites the actual source and keeps the proposal identity and body (%s)', declaration => {
    const args = { skillMd: source(declaration), reason: '登记能力' };
    const narrowed = narrowSkillApprovalArguments('update_skill', args, ['write_file']);
    expect(narrowed.reason).toBe(args.reason);
    expect(parseSkillMd(narrowed.skillMd as string)).toEqual({ ...parseSkillMd(args.skillMd), allowedTools: ['read_file', 'web_fetch'] });
    expect(args.skillMd).toBe(source(declaration));
  });
  it('supports removing every declared tool', () => expect(parseSkillMd(narrowSkillApprovalArguments('create_skill', { skillMd: source('allowed-tools: ["read_file"]') }, ['read_file']).skillMd as string).allowedTools).toEqual([]));
  it('strips both aliases so a fallback cannot re-enable a removed tool', () => {
    const result = narrowSkillApprovalArguments('update_skill', { skillMd: source('allowed-tools: ["read_file"]\nallowedtools: ["write_file"]') }, ['read_file']);
    expect(parseSkillMd(result.skillMd as string).allowedTools).toEqual([]);
    expect(result.skillMd).not.toContain('write_file');
  });
  it('rejects unknown declarations and other tool types', () => {
    expect(() => narrowSkillApprovalArguments('update_skill', { skillMd: source('allowed-tools: ["read_file"]') }, ['shell-exec'])).toThrow('unknown_tool_declaration');
    expect(() => narrowSkillApprovalArguments('create_agent', {}, ['read_file'])).toThrow('not_editable');
  });
});
