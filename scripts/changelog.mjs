#!/usr/bin/env node
/**
 * Parser for `docs/releases/CHANGELOG.md`.
 *
 * That file is the single source of truth for user-facing release notes. Both
 * the published update feed and the in-app "查看更新日志" dialog derive from it,
 * so the shape produced here must stay renderable by the renderer's line-level
 * renderer (headings via `###`, items via `1. `).
 *
 * The parser is deliberately strict: a malformed version heading is an error
 * rather than a silently skipped entry, because a silently dropped release note
 * would ship an empty "更新内容" panel to users.
 */

const VERSION_HEADING = /^##\s+(?<version>\S+)\s+—\s+(?<date>\d{4}-\d{2}-\d{2})\s*$/;
const SECTION_HEADING = /^###\s+(?<title>.+?)\s*$/;
const SUMMARY_LINE = /^>\s?(?<summary>.*)$/;
const ORDERED_ITEM = /^(?<ordinal>\d+)[.)]\s+(?<text>.+)$/;
const BULLET_ITEM = /^[-*•]\s+(?<text>.+)$/;
const SEPARATOR = /^-{3,}\s*$/;
const DEFAULT_SECTION_TITLE = '更新内容';

/** Cap mirrored from the feed writer; exceeding it throws at publish time. */
export const MAX_CHANGELOG_RELEASE_NOTES_CHARS = 64 * 1024;

export const CHANGELOG_DEFAULT_PATH = 'docs/releases/CHANGELOG.md';

function createSection(title) {
  return { title, items: [] };
}

function normalizeVersion(value) {
  return String(value).trim().replace(/^v/i, '');
}

/**
 * Parse the changelog markdown into version entries, newest first (as authored).
 *
 * @param {string} markdown
 * @returns {{ entries: Array<{version: string, date: string, summary: string | null, sections: Array<{title: string, items: string[]}>}> }}
 */
export function parseChangelog(markdown) {
  if (typeof markdown !== 'string') throw new Error('changelog.markdown_invalid');
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  /** @type {Array<{version: string, date: string, summary: string | null, sections: Array<{title: string, items: string[]}>}>} */
  const entries = [];
  let current = null;
  let section = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || SEPARATOR.test(line)) continue;

    if (line.startsWith('## ') && !line.startsWith('### ')) {
      const match = VERSION_HEADING.exec(line);
      if (!match) {
        // Headings before the first version block are the format contract at
        // the top of the file: prose, not a version. Once a version block has
        // started, a malformed heading means a release would silently lose its
        // notes, so it is a hard error instead.
        if (current === null) continue;
        throw new Error(`changelog.version_heading_invalid:${line}`);
      }
      current = {
        version: normalizeVersion(match.groups.version),
        date: match.groups.date,
        summary: null,
        sections: [],
      };
      entries.push(current);
      section = null;
      continue;
    }

    // Front matter and the format contract at the top of the file are ignored.
    if (current === null) continue;

    if (line.startsWith('### ')) {
      const match = SECTION_HEADING.exec(line);
      if (!match) throw new Error(`changelog.section_heading_invalid:${line}`);
      section = createSection(match.groups.title);
      current.sections.push(section);
      continue;
    }

    const summary = SUMMARY_LINE.exec(line);
    if (summary) {
      const text = summary.groups.summary.trim();
      if (text.length > 0) current.summary = text;
      continue;
    }

    const item = ORDERED_ITEM.exec(line) ?? BULLET_ITEM.exec(line);
    if (item) {
      if (section === null) {
        section = createSection(DEFAULT_SECTION_TITLE);
        current.sections.push(section);
      }
      section.items.push(item.groups.text.trim());
      continue;
    }

    // Loose prose inside a version block is kept as an item so nothing is lost.
    if (section === null) {
      section = createSection(DEFAULT_SECTION_TITLE);
      current.sections.push(section);
    }
    section.items.push(line);
  }

  if (entries.length === 0) throw new Error('changelog.no_versions_found');
  return { entries };
}

/**
 * Find one version entry. Accepts either `0.1.0-rc.5` or `v0.1.0-rc.5`.
 *
 * @param {Array<{version: string}>} entries
 * @param {string} version
 */
export function findChangelogEntry(entries, version) {
  const wanted = normalizeVersion(version);
  return entries.find((entry) => entry.version === wanted) ?? null;
}

/**
 * Render one entry into the plain-text release notes the feed and the dialog
 * consume. Line shapes are contractual: `### ` renders as a heading and `N. `
 * renders as a numbered item.
 */
export function renderChangelogReleaseNotes(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('changelog.entry_invalid');
  const lines = [];
  if (entry.summary) {
    lines.push(entry.summary, '');
  }
  for (const section of entry.sections) {
    lines.push(`### ${section.title}`);
    section.items.forEach((text, index) => {
      lines.push(`${index + 1}. ${text}`);
    });
    lines.push('');
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length === 0) throw new Error(`changelog.entry_empty:${entry.version}`);
  if (text.length > MAX_CHANGELOG_RELEASE_NOTES_CHARS) {
    throw new Error(`changelog.release_notes_too_long:${entry.version}:${text.length}`);
  }
  return text;
}

/**
 * Resolve the release notes for one version directly from markdown.
 *
 * @param {string} markdown
 * @param {string} version
 */
export function resolveChangelogReleaseNotes(markdown, version) {
  const { entries } = parseChangelog(markdown);
  const entry = findChangelogEntry(entries, version);
  if (entry === null) throw new Error(`changelog.version_not_found:${normalizeVersion(version)}`);
  return renderChangelogReleaseNotes(entry);
}
