import { describe, expect, it } from 'vitest';
import { SKILL_FIXTURES } from '@sync-think/test-fixtures';
import { parseSkillMd, ParseSkillMdError, skillContentFingerprint } from './skill-md.js';

function fixture(id: string): string {
  const f = SKILL_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error('missing fixture ' + id);
  return f.skillMd;
}

describe('parseSkillMd (§9.2 SKILL.md subset)', () => {
  it('parses minimal skill frontmatter + body', () => {
    const parsed = parseSkillMd(fixture('minimal-skill'));
    expect(parsed.name).toBe('minimal');
    expect(parsed.description).toMatch(/minimal/i);
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.allowedTools).toEqual([]);
    expect(parsed.body).toMatch(/minimal skill body/i);
    expect(parsed.hasScripts).toBe(false);
  });

  it('records scripts without executing them', () => {
    const parsed = parseSkillMd(fixture('skill-with-scripts-denied-by-default'));
    expect(parsed.hasScripts).toBe(true);
    expect(parsed.allowedTools).toContain('shell-exec');
    expect(parsed.warnings.some((w) => /never auto-executed/i.test(w))).toBe(true);
  });

  it('parses allowed-tools arrays', () => {
    const parsed = parseSkillMd(fixture('skill-permission-diff-on-upgrade'));
    expect(parsed.allowedTools).toEqual(['read-file', 'write-fs']);
  });

  it('rejects missing frontmatter', () => {
    expect(() => parseSkillMd(fixture('broken-frontmatter'))).toThrow(ParseSkillMdError);
    try {
      parseSkillMd(fixture('broken-frontmatter'));
    } catch (e) {
      expect((e as ParseSkillMdError).code).toBe('missing_frontmatter');
    }
  });

  it('rejects path traversal in references', () => {
    expect(() => parseSkillMd(fixture('path-traversal-attempt'))).toThrow(ParseSkillMdError);
    try {
      parseSkillMd(fixture('path-traversal-attempt'));
    } catch (e) {
      expect((e as ParseSkillMdError).code).toBe('path_traversal');
    }
  });

  it('fingerprints content for integrity notes', () => {
    const a = skillContentFingerprint({
      name: 'minimal',
      version: '0.1.0',
      body: 'x',
      allowedTools: [],
    });
    const b = skillContentFingerprint({
      name: 'minimal',
      version: '0.1.0',
      body: 'y',
      allowedTools: [],
    });
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
});
