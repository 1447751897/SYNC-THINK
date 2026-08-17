import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanLocalSkills } from '../src/local-skill-discovery.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-local-skill-'));
  tempDirs.push(root);
  // 顶层 skill
  mkdirSync(join(root, 'reviewer'));
  writeFileSync(
    join(root, 'reviewer', 'SKILL.md'),
    '---\nname: code-reviewer\ndescription: 代码审查专家\n---\n# 代码审查\n检查未提交的改动并给出风险清单。',
  );
  // 嵌套 skill
  mkdirSync(join(root, 'tools', 'formatter'), { recursive: true });
  writeFileSync(
    join(root, 'tools', 'formatter', 'skill.md'),
    '---\nname: formatter\ndescription: 格式化工具\n---\n格式化指定文件。',
  );
  // 忽略目录
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'x', 'SKILL.md'), '---\nname: ignored\n---\n忽略我');
  // 非 skill 文件
  writeFileSync(join(root, 'README.md'), 'hello');
  return root;
}

describe('scanLocalSkills', () => {
  it('finds nested SKILL.md files with parsed frontmatter and summaries', () => {
    const root = makeTree();
    const candidates = scanLocalSkills(root);
    expect(candidates).toHaveLength(2);
    const reviewer = candidates.find((c) => c.name === 'code-reviewer');
    expect(reviewer).toBeTruthy();
    expect(reviewer?.description).toBe('代码审查专家');
    expect(reviewer?.summary).toContain('检查未提交的改动');
    expect(reviewer?.path).toBe(join(root, 'reviewer', 'SKILL.md'));
    const formatter = candidates.find((c) => c.name === 'formatter');
    expect(formatter).toBeTruthy();
    expect(formatter?.folderName).toBe('formatter');
  });

  it('returns empty for a missing directory', () => {
    expect(scanLocalSkills(join(tmpdir(), 'does-not-exist-xyz'))).toEqual([]);
  });

  it('skips unreadable or malformed skill files without failing the scan', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-local-skill-bad-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'bad'));
    writeFileSync(join(root, 'bad', 'SKILL.md'), '');
    const candidates = scanLocalSkills(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBeUndefined();
  });
});
