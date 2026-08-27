import { createRoot } from 'react-dom/client';
import { Phase3VisualFixture, resolvePhase3VisualCase } from './Phase3VisualFixture.js';
import { ShellApp } from './ShellApp.js';
import {
  applyAppearancePreferences,
  readAppearancePreferences,
  readShortcutPreferences,
} from './preferences-store.js';

const searchParams = new URLSearchParams(window.location.search);
const phase3VisualCase = resolvePhase3VisualCase(window.location.search);

if (phase3VisualCase) {
  const fixtureTheme = searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', fixtureTheme === 'dark');
  document.documentElement.dataset.phase3Theme = fixtureTheme;
  document.documentElement.setAttribute('data-reduced-motion', '');
} else {
  // Restore persisted theme. Both light and dark are tuned against the NewMax
  // reference, so following the OS is the honest product default.
  applyAppearancePreferences(readAppearancePreferences());

  const quickWindow = readShortcutPreferences().quickWindow;
  void window.syncThink?.runtime?.setGlobalShortcut?.(quickWindow);

  // Restore animation preference.
  const animPref = localStorage.getItem('sync-think-animation');
  if (animPref === '0') {
    document.documentElement.setAttribute('data-reduced-motion', '');
  }

  // Keep OS-follow responsive while theme is 'system'.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = readAppearancePreferences();
    if (current.mode === 'system') applyAppearancePreferences(current);
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(
  phase3VisualCase ? <Phase3VisualFixture visualCase={phase3VisualCase} /> : <ShellApp />,
);
