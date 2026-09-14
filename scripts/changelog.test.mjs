import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHANGELOG_DEFAULT_PATH,
  findChangelogEntry,
  parseChangelog,
  renderChangelogReleaseNotes,
  resolveChangelogReleaseNotes,
} from './changelog.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_CHANGELOG_PATH = join(REPO_ROOT, CHANGELOG_DEFAULT_PATH);

const SAMPLE = `# SYNC-THINK 更新日志

## 格式约定（机器解析，勿改动标记）

- \`## <版本号> — <YYYY-MM-DD>\` 开始一个版本段落。

---

## 0.2.0 — 2026-10-01

> 这一版的摘要。

### 新功能

1. 第一条
2. 第二条

### 修复

- 无序条目也认

## 0.1.0 — 2026-09-01

### 优化

1. 上一版条目
`;

test('parseChangelog reads versions newest first and keeps section shape', () => {
  const { entries } = parseChangelog(SAMPLE);
  assert.equal(entries.length, 2);

  assert.equal(entries[0].version, '0.2.0');
  assert.equal(entries[0].date, '2026-10-01');
  assert.equal(entries[0].summary, '这一版的摘要。');
  assert.deepEqual(
    entries[0].sections.map((section) => section.title),
    ['新功能', '修复'],
  );
  assert.deepEqual(entries[0].sections[0].items, ['第一条', '第二条']);
  assert.deepEqual(entries[0].sections[1].items, ['无序条目也认']);

  assert.equal(entries[1].version, '0.1.0');
  assert.equal(entries[1].summary, null);
});

test('parseChangelog ignores the format contract above the first version', () => {
  // The contract block itself contains a `## ` heading and `- ` bullets; if it
  // were parsed as a version the feed would publish a placeholder entry.
  const { entries } = parseChangelog(SAMPLE);
  assert.equal(
    entries.some((entry) => entry.version.includes('版本号')),
    false,
  );
});

test('parseChangelog rejects a malformed version heading after the first version', () => {
  const broken = `## 0.2.0 — 2026-10-01

### 新功能

1. 条目

## 0.1.0

### 新功能

1. 条目
`;
  assert.throws(() => parseChangelog(broken), /changelog\.version_heading_invalid/);
});

test('parseChangelog rejects a changelog with no versions at all', () => {
  assert.throws(() => parseChangelog('# 只有标题\n\n没有版本段落。\n'), /changelog\.no_versions_found/);
});

test('parseChangelog keeps loose prose instead of dropping it', () => {
  const markdown = `## 0.2.0 — 2026-10-01

这段话没有分段也没有编号。
`;
  const { entries } = parseChangelog(markdown);
  assert.deepEqual(entries[0].sections, [{ title: '更新内容', items: ['这段话没有分段也没有编号。'] }]);
});

test('findChangelogEntry accepts an optional v prefix', () => {
  const { entries } = parseChangelog(SAMPLE);
  assert.equal(findChangelogEntry(entries, '0.2.0')?.version, '0.2.0');
  assert.equal(findChangelogEntry(entries, 'v0.2.0')?.version, '0.2.0');
  assert.equal(findChangelogEntry(entries, '9.9.9'), null);
});

test('renderChangelogReleaseNotes emits renderer-recognised line shapes', () => {
  const { entries } = parseChangelog(SAMPLE);
  const notes = renderChangelogReleaseNotes(entries[0]);

  // `### ` renders as a heading and `N. ` as an item in the shell renderer.
  assert.match(notes, /^这一版的摘要。\n\n### 新功能\n1\. 第一条\n2\. 第二条\n\n### 修复\n1\. 无序条目也认$/);
  assert.equal(notes.includes('\n\n\n'), false);
});

test('renderChangelogReleaseNotes rejects an empty entry', () => {
  assert.throws(() => renderChangelogReleaseNotes({ version: '0.0.0', sections: [] }), /changelog\.entry_empty/);
});

test('resolveChangelogReleaseNotes reports a missing version by name', () => {
  assert.throws(() => resolveChangelogReleaseNotes(SAMPLE, '1.2.3'), /changelog\.version_not_found:1\.2\.3/);
});

test('the repository changelog parses and covers every shipped version', async () => {
  const markdown = await readFile(REAL_CHANGELOG_PATH, 'utf8');
  const { entries } = parseChangelog(markdown);

  for (const version of ['0.1.0-rc.5', '0.1.0-rc.4', '0.1.0-rc.2', '0.1.0-rc.1']) {
    const entry = findChangelogEntry(entries, version);
    assert.ok(entry, `CHANGELOG.md is missing a section for ${version}`);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.sections.length > 0, `${version} has no sections`);
  }
});

test('the repository changelog produces usable release notes for the current version', async () => {
  const markdown = await readFile(REAL_CHANGELOG_PATH, 'utf8');
  const notes = resolveChangelogReleaseNotes(markdown, '0.1.0-rc.5');

  assert.match(notes, /### 新功能/);
  assert.match(notes, /### 修复/);
  assert.match(notes, /\n1\. /);
  // The renderer truncates past 8 KiB, so the published notes must stay under it.
  assert.ok(notes.length < 8 * 1024, `release notes are ${notes.length} chars, over the 8 KiB client cap`);
});
