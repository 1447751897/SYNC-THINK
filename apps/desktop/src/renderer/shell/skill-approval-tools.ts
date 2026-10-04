import type { PendingToolApproval } from './tool-approval-types.js';

/** Preview only; the host re-parses the original source and validates the removal. */
export function skillApprovalTools(approval: PendingToolApproval): string[] | undefined {
  if (!['create_skill', 'update_skill'].includes(approval.toolName) || typeof approval.arguments?.skillMd !== 'string') return undefined;
  const fence = approval.arguments.skillMd.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return undefined;
  const fields = [...fence[1]!.matchAll(/^\s*(allowed-tools|allowedtools)\s*:[ \t]*([^\r\n]*)/gim)];
  const selected = fields.filter(field => field[1]!.toLowerCase() === 'allowed-tools').at(-1) ?? fields.at(-1);
  const scalar = selected?.[2]?.trim() ?? '';
  const raw = (/^"[\s\S]*"$|^'[\s\S]*'$/.test(scalar) ? scalar.slice(1, -1) : scalar);
  if (!raw) return [];
  if (/^[>|]/.test(raw)) return undefined; // Leave uncommon scalar forms to the original full-source review.
  let tools: string[];
  if (raw.startsWith('[')) {
    try { tools = JSON.parse(raw.replace(/'/g, '"')); if (!Array.isArray(tools) || !tools.every(x => typeof x === 'string')) return undefined; }
    catch { tools = raw.replace(/^\[|\]$/g, '').split(',').map(x => x.replace(/\[\]/g, '').trim().replace(/^['"]|['"]$/g, '')); }
  } else tools = [raw.replace(/^['"]|['"]$/g, '')];
  return [...new Set(tools.map(x => x.trim()).filter(Boolean))];
}
