// SKILL.md compatibility subset (product §9.2 / TD-008).
// Pure parser — no filesystem, no script execution.

export interface ParsedSkillMd {
  name: string;
  description: string;
  version: string;
  allowedTools: string[];
  body: string;
  /** True when package declares scripts/ content or shell tools. */
  hasScripts: boolean;
  /** Non-fatal notices for the importer UI. */
  warnings: string[];
}

export type ParseSkillMdErrorCode =
  | 'missing_frontmatter'
  | 'invalid_frontmatter'
  | 'missing_name'
  | 'path_traversal';

export class ParseSkillMdError extends Error {
  readonly code: ParseSkillMdErrorCode;
  constructor(code: ParseSkillMdErrorCode, message: string) {
    super(message);
    this.name = 'ParseSkillMdError';
    this.code = code;
  }
}

function stripQuotes(value: string): string {
  const t = value.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseAllowedTools(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  // JSON-ish array: ["a", "b"]
  if (t.startsWith('[')) {
    try {
      const parsed = JSON.parse(t.replace(/'/g, '"')) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter(Boolean);
      }
    } catch {
      // fall through to simple split
    }
    return t
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => stripQuotes(s.replace(/\[\]/g, '').trim()))
      .filter(Boolean);
  }
  return [stripQuotes(t)].filter(Boolean);
}

function parseFrontmatterBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    out[key] = value;
  }
  return out;
}

function containsPathTraversal(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (t.includes('..')) return true;
  if (t.includes('\\')) return true;
  return false;
}

function assertNoPathTraversal(raw: string, where: string): void {
  if (containsPathTraversal(raw)) {
    throw new ParseSkillMdError(
      'path_traversal',
      where + ' must not contain path traversal segments',
    );
  }
}

/**
 * Parse a SKILL.md document into a normalized Manifest draft.
 * Does **not** execute scripts; callers must re-approve tools on upgrade (§9.3).
 */
export function parseSkillMd(source: string): ParsedSkillMd {
  const text = String(source ?? '');
  if (!text.trim()) {
    throw new ParseSkillMdError('missing_frontmatter', 'SKILL.md is empty');
  }

  // Require opening --- frontmatter fence
  const fence = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fence) {
    throw new ParseSkillMdError(
      'missing_frontmatter',
      'SKILL.md must start with YAML frontmatter delimited by ---',
    );
  }

  const fm = parseFrontmatterBlock(fence[1] ?? '');
  const body = (fence[2] ?? '').trim();
  const name = stripQuotes(fm.name ?? '').trim();
  if (!name) {
    throw new ParseSkillMdError('missing_name', 'frontmatter.name is required');
  }

  const description = stripQuotes(fm.description ?? '').trim() || name;
  const version = stripQuotes(fm.version ?? '').trim() || '0.0.0';
  const allowedTools = parseAllowedTools(fm['allowed-tools'] ?? fm.allowedtools ?? '');

  const warnings: string[] = [];

  // references may live in frontmatter or as a body declaration line.
  const refsFm = stripQuotes(fm.references ?? '');
  if (refsFm) assertNoPathTraversal(refsFm, 'references');

  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*references\s*:\s*(.+)\s*$/i);
    if (m && m[1]) {
      assertNoPathTraversal(stripQuotes(m[1]), 'references');
    }
  }

  const hasScripts =
    /scripts\//i.test(body) ||
    allowedTools.some((t) => /shell|exec|bash|cmd/i.test(t));
  if (hasScripts) {
    warnings.push('Scripts and shell tools are recorded but never auto-executed on import (§9.2).');
  }

  return {
    name,
    description,
    version,
    allowedTools,
    body,
    hasScripts,
    warnings,
  };
}

/** Stable content hash for integrity (non-crypto fingerprint for M1 soft). */
export function skillContentFingerprint(input: {
  name: string;
  version: string;
  body: string;
  allowedTools: readonly string[];
}): string {
  const payload = [
    input.name,
    input.version,
    input.allowedTools.join(','),
    input.body,
  ].join('\n');
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}
