import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertShellStylesheet } from './shell-stylesheet-contract.mjs';

test('canonical shell stylesheet imports the profile and conversation menu styles', () => {
  const css = readFileSync(new URL('../src/renderer/shell/shell.css', import.meta.url), 'utf8');
  assert.match(css, /@import\s+['"]\.\/browser-profile-info\.css['"]/);
  assert.match(css, /@import\s+['"]\.\/browser-data-manager\.css['"]/);
  assert.match(css, /@import\s+['"]\.\/task-conversation-picker\.css['"]/);
});

test('production stylesheet rejects omitted component styles', () => {
  const complete =
    '.shell-browser-profile__trigger{} .shell-browser-profile__card{} .browser-data__dialog{} .browser-data__settings{} .shell-browser__submenu{} .shell-browser__switch-row{} .task-run-target__menu{} .sidebar-chat-actions{} .shell-sidebar-actions .sidebar-chat-action{} .sidebar-chat-action--search{} .sidebar-chat-action--new{} .sidebar-chat-search{} .shell-changes-card__summary{} .shell-changes-card__count{} .shell-changes-card__identity{} .shell-changes-card__file-type{} .shell-changes-card__name-stem{} .shell-changes-card__name-extension{} .shell-changes-card__file-meta{} .shell-changes-card__open-file{} .shell-changes-card__review{} .conversation-attention-trigger{} .conversation-attention-dialog{} .shell-activity-dot--attention{}';
  assert.doesNotThrow(() => assertShellStylesheet(complete));
  for (const selector of [
    '.shell-browser-profile__trigger',
    '.shell-browser-profile__card',
    '.browser-data__dialog',
    '.browser-data__settings',
    '.shell-browser__submenu',
    '.shell-browser__switch-row',
    '.task-run-target__menu',
    '.sidebar-chat-actions',
    '.shell-sidebar-actions .sidebar-chat-action',
    '.sidebar-chat-action--search',
    '.sidebar-chat-action--new',
    '.sidebar-chat-search',
    '.shell-changes-card__summary',
    '.shell-changes-card__count',
    '.shell-changes-card__identity',
    '.shell-changes-card__file-type',
    '.shell-changes-card__name-stem',
    '.shell-changes-card__name-extension',
    '.shell-changes-card__file-meta',
    '.shell-changes-card__open-file',
    '.shell-changes-card__review',
    '.conversation-attention-trigger',
    '.conversation-attention-dialog',
    '.shell-activity-dot--attention',
  ]) {
    assert.throws(
      () => assertShellStylesheet(complete.replace(selector, '.missing')),
      /shell\.build\.missing_stylesheet_selector/,
    );
  }
});

test('canonical shell stylesheet ships the shared sidebar action and search styles', () => {
  const css = readFileSync(new URL('../src/renderer/shell/shell.css', import.meta.url), 'utf8');
  assert.match(css, /@import\s+['"]\.\/sidebar-chat-actions\.css['"]/);
});

test('production stylesheet rejects omitted shared sidebar controls', () => {
  const existing =
    '.shell-browser-profile__trigger{} .shell-browser-profile__card{} .browser-data__dialog{} .browser-data__settings{} .shell-browser__submenu{} .shell-browser__switch-row{} .task-run-target__menu{}';
  assert.throws(() => assertShellStylesheet(existing), /shell\.build\.missing_stylesheet_selector/);
});

test('canonical shell stylesheet imports the redesigned file card stylesheet', () => {
  const css = readFileSync(new URL('../src/renderer/shell/shell.css', import.meta.url), 'utf8');
  assert.match(css, /@import\s+['"]\.\/file-diff\.css['"]/);
});

test('new file change markup cannot ship with the old production card stylesheet', () => {
  const legacyCss =
    '.shell-browser-profile__trigger{} .shell-browser-profile__card{} .browser-data__dialog{} .browser-data__settings{} .shell-browser__submenu{} .shell-browser__switch-row{} .task-run-target__menu{} .sidebar-chat-actions{} .shell-sidebar-actions .sidebar-chat-action{} .sidebar-chat-action--search{} .sidebar-chat-action--new{} .sidebar-chat-search{} .shell-changes-card__header{} .shell-changes-card__file{} .shell-changes-card__name{}';
  assert.throws(
    () => assertShellStylesheet(legacyCss),
    /shell\.build\.missing_stylesheet_selector:\.shell-changes-card__summary/,
  );
});




test('canonical shell stylesheet includes conversation attention and waiting markers', () => {
  const css = readFileSync(new URL('../src/renderer/shell/shell.css', import.meta.url), 'utf8');
  assert.match(css, /@import\s+['"]\.\/conversation-attention\.css['"]/);
});
