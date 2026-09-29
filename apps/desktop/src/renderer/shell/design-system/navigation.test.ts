/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pushLibraryNavigation, readLibraryNavigation, restoreDesktopLibraryNavigation, installDesktopLibraryNavigation } from './navigation.js';

function desktop() {
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: {} } });
}
beforeEach(() => {
  Reflect.deleteProperty(window, 'syncThink');
  window.history.replaceState(null, '', '/index.html');
});
afterEach(() => {
  Reflect.deleteProperty(window, 'syncThink');
  window.history.replaceState(null, '', '/');
});

describe('component library navigation', () => {
  it('keeps desktop IPC source unchanged while preserving routes and unrelated history state', () => {
    desktop();
    window.history.replaceState({ workspace: 'project-a' }, '');
    const trustedUrl = window.location.href;
    pushLibraryNavigation('#ds/category/conversation');
    expect(window.location.href).toBe(trustedUrl);
    expect(readLibraryNavigation()).toBe('#ds/category/conversation');
    pushLibraryNavigation('#ds/component/composer-editor');
    expect(window.location.href).toBe(trustedUrl);
    expect(window.history.state.workspace).toBe('project-a');
    expect(readLibraryNavigation()).toBe('#ds/component/composer-editor');
    const count = window.history.length;
    pushLibraryNavigation('#ds/component/composer-editor');
    expect(window.history.length).toBe(count);
  });

  it('supports back and forward without changing the trusted URL', async () => {
    desktop();
    pushLibraryNavigation('#ds/overview');
    pushLibraryNavigation('#ds/tokens');
    pushLibraryNavigation('#ds/live');
    const move = (direction: 'back' | 'forward') => new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      window.history[direction]();
    });
    await move('back');
    expect(readLibraryNavigation()).toBe('#ds/tokens');
    expect(window.location.hash).toBe('');
    await move('forward');
    expect(readLibraryNavigation()).toBe('#ds/live');
    expect(window.location.hash).toBe('');
  });

  it('migrates existing desktop library hashes before requests and preserves the intended route', () => {
    desktop();
    window.history.replaceState({ workspace: 'project-a' }, '', '#ds/tokens');
    restoreDesktopLibraryNavigation();
    expect(window.location.hash).toBe('');
    expect(readLibraryNavigation()).toBe('#ds/tokens');
    expect(window.history.state.workspace).toBe('project-a');
    const before = window.history.state;
    restoreDesktopLibraryNavigation();
    expect(window.history.state).toEqual(before);
  });

  it('migrates a legacy link when the library mounts or handles a history entry', () => {
    desktop();
    window.history.replaceState(null, '', '#ds/category/agents');
    expect(readLibraryNavigation()).toBe('#ds/category/agents');
    expect(window.location.hash).toBe('');
  });

  it('recovers old route entries even when the library page is not mounted', () => {
    desktop();
    const stop = installDesktopLibraryNavigation();
    try {
      window.history.replaceState(null, '', '#ds/category/agents');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(window.location.hash).toBe('');
      expect(readLibraryNavigation()).toBe('#ds/category/agents');
      window.history.replaceState(null, '', '#ds/tokens');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      expect(window.location.hash).toBe('');
      expect(readLibraryNavigation()).toBe('#ds/tokens');
    } finally { stop(); }
  });

  it('leaves unrelated URLs untouched and retains standalone preview deep links', () => {
    desktop();
    window.history.replaceState(null, '', '/index.html?x=1#outside');
    restoreDesktopLibraryNavigation();
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#outside');
    Reflect.deleteProperty(window, 'syncThink');
    window.history.replaceState(null, '', '/preview.html#ds/tokens');
    restoreDesktopLibraryNavigation();
    expect(readLibraryNavigation()).toBe('#ds/tokens');
    expect(window.location.hash).toBe('#ds/tokens');
    pushLibraryNavigation('#ds/live');
    expect(window.location.hash).toBe('#ds/live');
  });
});
