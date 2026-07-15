// Theme controller. Helper utilities that set/unset the data-st-theme attribute.
// The actual color custom properties live in ./styles/index.css.

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
