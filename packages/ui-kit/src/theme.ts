// DEPRECATED — do not wire anything new to this.
//
// This is the *legacy* theme controller: it toggles a `data-st-theme` attribute
// that the deleted packages/ui-kit/src/styles/ stylesheets used to key off. Those
// stylesheets are gone (2026-08-18 shell switchover), so setting the attribute
// now changes nothing visually. It survives only because AppShell.tsx still calls
// applyTheme(), and AppShell is itself legacy-only — both go together in the
// dead-component cleanup.
//
// The shipping controller is the shell's: `.dark` class on <html>, persisted as
// `sync-think-shell-theme`, applied by applyShellTheme() in
// apps/desktop/src/renderer/shell/SettingsPage.tsx. Colors live in
// apps/desktop/src/renderer/shell/tokens.css, generated from
// docs/product/16-shell-design-tokens.json.

export type Theme = 'light' | 'dark' | 'system';

export function resolveTheme(t: Theme): 'light' | 'dark' | 'system' {
  return t;
}

export function applyTheme(root: HTMLElement, theme: Theme): void {
  if (theme === 'system') {
    root.removeAttribute('data-st-theme');
  } else {
    root.setAttribute('data-st-theme', theme);
  }
}

export function currentResolvedTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-st-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
