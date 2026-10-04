import { parseSkillMd } from '@sync-think/core';

/** Only the human may narrow a pending proposal; names, version and body stay intact. */
export function narrowSkillApprovalArguments(toolName: string, args: Record<string, unknown>, excluded: string[]): Record<string, unknown> {
  if (!['create_skill', 'update_skill'].includes(toolName) || typeof args.skillMd !== 'string') throw new Error('approval.tool_declarations_not_editable');
  const original = parseSkillMd(args.skillMd);
  if (excluded.some(name => !original.allowedTools.includes(name))) throw new Error('approval.unknown_tool_declaration');
  const kept = original.allowedTools.filter(name => !excluded.includes(name));
  const source = args.skillMd.replace(/^\uFEFF/, '');
  const fence = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)!;
  const lines = fence[1]!.split(/\r?\n/);
  const next: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const field = line.trim().match(/^([^:]+):\s*(.*)$/);
    const removable = field && ['allowed-tools', 'allowedtools'].includes(field[1]!.trim().toLowerCase());
    let end = i;
    if (field && /^[>|](?:[+-])?$/.test(field[2]!)) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      while (end + 1 < lines.length && (/^\s*$/.test(lines[end + 1]!) || (lines[end + 1]!.match(/^\s*/)?.[0].length ?? 0) > indent)) end++;
    }
    if (!removable) next.push(...lines.slice(i, end + 1));
    i = end;
  }
  next.push('allowed-tools: ' + JSON.stringify(kept));
  const skillMd = '---\n' + next.join('\n') + '\n---\n' + source.slice(fence[0].length);
  const parsed = parseSkillMd(skillMd);
  if (parsed.name !== original.name || parsed.version !== original.version || parsed.description !== original.description || parsed.body !== original.body || JSON.stringify(parsed.allowedTools) !== JSON.stringify(kept)) throw new Error('approval.proposal_integrity_mismatch');
  return { ...args, skillMd };
}
