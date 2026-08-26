import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverSkillFolders,
  enabledClaudePluginSkillSources,
  installLocalSkillFolders,
  resolveLocalSkillPackage,
  scanLocalSkillSources,
  scanLocalSkills,
} from '../src/local-skill-discovery.js';

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
    expect(reviewer?.skillDirectory).toBe(join(root, 'reviewer'));
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

  it('recognizes direct Skill folders and plugin-style skills bundles', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-skill-bundle-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'skills', 'alpha', 'scripts'), { recursive: true });
    mkdirSync(join(root, 'skills', 'beta', 'assets'), { recursive: true });
    writeFileSync(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\nAlpha');
    writeFileSync(join(root, 'skills', 'beta', 'SKILL.md'), '---\nname: beta\n---\nBeta');

    expect(discoverSkillFolders(root).map((skill) => skill.name)).toEqual(['alpha', 'beta']);
  });

  it('copies the complete Skill directory and requires overwrite for conflicts', async () => {
    const source = mkdtempSync(join(tmpdir(), 'sync-think-skill-source-'));
    const destination = mkdtempSync(join(tmpdir(), 'sync-think-skill-destination-'));
    tempDirs.push(source, destination);
    mkdirSync(join(source, 'reviewer', 'scripts'), { recursive: true });
    mkdirSync(join(source, 'reviewer', 'assets'), { recursive: true });
    writeFileSync(
      join(source, 'reviewer', 'SKILL.md'),
      '---\nname: reviewer\ndescription: Review changes\n---\nReview carefully.',
    );
    writeFileSync(join(source, 'reviewer', 'scripts', 'run.js'), 'export default true;');
    writeFileSync(join(source, 'reviewer', 'assets', 'rules.txt'), 'rules');

    const resolved = await resolveLocalSkillPackage(join(source, 'reviewer'));
    try {
      const first = installLocalSkillFolders(resolved.skills, destination, false);
      expect(first.conflictNames).toEqual([]);
      expect(existsSync(join(destination, 'reviewer', 'scripts', 'run.js'))).toBe(true);
      expect(readFileSync(join(destination, 'reviewer', 'assets', 'rules.txt'), 'utf8')).toBe(
        'rules',
      );
      expect(readFileSync(join(destination, 'reviewer', 'SKILL.md'), 'utf8')).toBe(
        readFileSync(join(source, 'reviewer', 'SKILL.md'), 'utf8'),
      );

      const conflict = installLocalSkillFolders(resolved.skills, destination, false);
      expect(conflict.installed).toEqual([]);
      expect(conflict.conflictNames).toEqual(['reviewer']);

      writeFileSync(join(source, 'reviewer', 'assets', 'rules.txt'), 'updated');
      const overwritten = installLocalSkillFolders(resolved.skills, destination, true);
      expect(overwritten.conflictNames).toEqual([]);
      expect(readFileSync(join(destination, 'reviewer', 'assets', 'rules.txt'), 'utf8')).toBe(
        'updated',
      );
    } finally {
      resolved.cleanup();
    }
  });

  it('uses the ZIP filename for a root-level SKILL.md instead of the extraction temp name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-root-skill-zip-'));
    const destination = mkdtempSync(join(tmpdir(), 'sync-think-root-skill-destination-'));
    tempDirs.push(root, destination);
    const zipPath = join(root, 'stable-root-skill.zip');
    writeFileSync(
      zipPath,
      Buffer.from(
        'UEsDBBQAAAAIAM69Gl0dCS55GwAAABkAAAARAAAAYXNzZXRzL21hcmtlci50eHTLSy3PTazQLUgsyiyp1E01StW1MEo2SzPkAgBQSwMEFAAAAAgAzr0aXefrZqU0AAAAMgAAABEAAABzY3JpcHRzL2NoZWNrLm1qc0utKMgvKlFIzs8rLlHITSzKTi1SsFVQz0stz02s0C1ILMosqdRNNUrVtTBKNkszVLfmAgBQSwMEFAAAAAgAzr0aXYQolHaeAAAAzgAAAAgAAABTS0lMTC5tZE2Oyw6CMBBF9/2KSVxPiSyMYeeCpe8f6FgGqKWlaavA35tgYtzek5xzEVF4clyB58nRjIGiyQtyybgv9a7dioaTjiZkM/oKztF0xtMAgbSljuGPQjtGeCyZMUROHN+0rteDFIgoxAZOPB1phsvagLqshbi9PKivIhW6Z22leyYF5BuwzAEUpcQ5FY6i5SjznBVMJveQe4a7NcPvixQfUEsBAhQAFAAAAAgAzr0aXR0JLnkbAAAAGQAAABEAAAAAAAAAAAAAAAAAAAAAAGFzc2V0cy9tYXJrZXIudHh0UEsBAhQAFAAAAAgAzr0aXefrZqU0AAAAMgAAABEAAAAAAAAAAAAAAAAASgAAAHNjcmlwdHMvY2hlY2subWpzUEsBAhQAFAAAAAgAzr0aXYQolHaeAAAAzgAAAAgAAAAAAAAAAAAAAAAArQAAAFNLSUxMLm1kUEsFBgAAAAADAAMAtAAAAHEBAAAAAA==',
        'base64',
      ),
    );

    const resolved = await resolveLocalSkillPackage(zipPath);
    try {
      expect(resolved.sourceType).toBe('zip');
      expect(resolved.skills).toHaveLength(1);
      expect(resolved.skills[0]).toMatchObject({
        folderName: 'stable-root-skill',
        name: 'newmax-parity-e2e-82c6f1',
      });
      const installed = installLocalSkillFolders(resolved.skills, destination, false);
      expect(installed.installed[0]?.installedDirectory).toBe(
        join(destination, 'stable-root-skill'),
      );
      expect(existsSync(join(destination, 'stable-root-skill', 'scripts', 'check.mjs'))).toBe(true);
      expect(existsSync(join(destination, 'stable-root-skill', 'assets', 'marker.txt'))).toBe(true);
    } finally {
      resolved.cleanup();
    }
  });

  it('merges NewMax-style sources in precedence order and records their labels', () => {
    const root = makeTree();
    const candidates = scanLocalSkillSources([
      { directory: root, type: 'workspace', label: 'SYNC-THINK', workspaceId: 'workspace-1' },
      { directory: root, type: 'plugin', label: '插件 · test', workspaceId: 'workspace-2' },
      { directory: join(root, 'missing'), type: 'global', label: '全局' },
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      sourceType: 'workspace',
      sourceLabel: 'SYNC-THINK',
      workspaceId: 'workspace-1',
      workspaceIds: ['workspace-1', 'workspace-2'],
    });
  });

  it('loads only explicitly enabled Claude plugin Skill directories from the cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-claude-plugins-'));
    tempDirs.push(root);
    const claudeDirectory = join(root, '.claude');
    const pluginRoot = join(
      claudeDirectory,
      'plugins',
      'cache',
      'team-tools',
      'formatter',
      '1.2.0',
    );
    mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginRoot, 'skills', 'format-code'), { recursive: true });
    writeFileSync(
      join(pluginRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'formatter' }),
    );
    writeFileSync(
      join(pluginRoot, 'skills', 'format-code', 'SKILL.md'),
      '---\nname: format-code\n---\nFormat code.',
    );
    writeFileSync(
      join(claudeDirectory, 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'formatter@team-tools': true,
          'disabled@team-tools': false,
        },
      }),
    );

    const sources = enabledClaudePluginSkillSources({ claudeDirectory });
    expect(sources).toEqual([
      {
        directory: join(pluginRoot, 'skills'),
        type: 'plugin',
        label: '插件 · formatter',
      },
    ]);
    expect(scanLocalSkillSources(sources)[0]).toMatchObject({
      name: 'format-code',
      sourceType: 'plugin',
      sourceLabel: '插件 · formatter',
    });
  });

  it('honors workspace-local plugin disable overrides', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-claude-plugin-override-'));
    tempDirs.push(root);
    const claudeDirectory = join(root, '.claude-home');
    const workspace = join(root, 'workspace');
    mkdirSync(join(workspace, '.claude'), { recursive: true });
    writeFileSync(
      join(workspace, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'formatter@team-tools': true } }),
    );
    writeFileSync(
      join(workspace, '.claude', 'settings.local.json'),
      JSON.stringify({ enabledPlugins: { 'formatter@team-tools': false } }),
    );

    expect(
      enabledClaudePluginSkillSources({
        claudeDirectory,
        workspaceFolder: workspace,
        workspaceId: 'workspace-1',
        includeUserSettings: false,
      }),
    ).toEqual([]);
  });
});
