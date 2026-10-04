import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { embedShellReleaseHistory, SHELL_RELEASE_HISTORY_ID } from './shell-release-history.mjs';
import { parseChangelog, renderChangelogReleaseNotes } from '../../../scripts/changelog.mjs';

const TEMPLATE = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';

test('all repository release notes survive offline HTML data embedding unchanged', () => {
  const markdown = readFileSync(new URL('../../../docs/releases/CHANGELOG.md', import.meta.url), 'utf8');
  const history = parseChangelog(markdown).entries.map((entry) => ({
    version: entry.version,
    date: entry.date,
    notes: renderChangelogReleaseNotes(entry),
  }));
  const dom = new JSDOM(embedShellReleaseHistory(TEMPLATE, history));
  const data = dom.window.document.getElementById(SHELL_RELEASE_HISTORY_ID);
  assert.equal(data.type, 'application/json');
  assert.deepEqual(JSON.parse(data.textContent), history);
  assert.equal(dom.window.document.getElementById('root').tagName, 'DIV');
  dom.window.close();
});

test('release notes cannot close the inert data block or execute markup', () => {
  const history = [{ version: '1.0.0', date: '2026-10-04', notes: '</script><script>window.injected=true</script> <img src=x onerror=alert(1)> & 中文' }];
  const dom = new JSDOM(embedShellReleaseHistory(TEMPLATE, history), { runScripts: 'dangerously' });
  assert.equal(dom.window.injected, undefined);
  assert.equal(dom.window.document.querySelectorAll('script').length, 1);
  assert.equal(dom.window.document.querySelectorAll('img').length, 0);
  assert.deepEqual(JSON.parse(dom.window.document.getElementById(SHELL_RELEASE_HISTORY_ID).textContent), history);
  dom.window.close();
});

test('empty history remains valid JSON and a malformed or duplicate template fails visibly', () => {
  const html = embedShellReleaseHistory(TEMPLATE, []);
  const dom = new JSDOM(html);
  assert.deepEqual(JSON.parse(dom.window.document.getElementById(SHELL_RELEASE_HISTORY_ID).textContent), []);
  assert.throws(() => embedShellReleaseHistory('<body></body>', []), /head_missing/);
  assert.throws(() => embedShellReleaseHistory(html, []), /already_embedded/);
  dom.window.close();
});
