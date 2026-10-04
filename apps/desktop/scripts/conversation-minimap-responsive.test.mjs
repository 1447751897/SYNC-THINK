import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/renderer/shell/shell.css', import.meta.url), 'utf8');

test('minimap responsiveness uses the chat pane width rather than the desktop window width', () => {
  assert.ok(/\.shell-chat-column\s*\{[^}]*container-name:\s*shell-chat;[^}]*container-type:\s*inline-size;/.test(css));
  assert.ok(/@container shell-chat \(max-width: 640px\)\s*\{\s*\.shell-conversation-minimap\s*\{\s*display:\s*none;/.test(css));
});

test('hiding the minimap also gives its left gutter back to messages and the composer', () => {
  const query = css.slice(css.indexOf('@container shell-chat (max-width: 640px)'));
  assert.ok(/^@container[^}]+}\s*\.shell-chat-column:has\(> \.shell-conversation-minimap\) \.shell-chat-content-wrap\s*\{\s*padding-left:\s*16px;\s*}\s*}/.test(query));
});
