import { createRoot } from 'react-dom/client';
import { ShellApp } from './ShellApp.js';
import { applyShellMotionPreference } from '../ui-preferences.js';
import {
  applyAppearancePreferences,
  readAppearancePreferences,
  readShortcutPreferences,
  readTrayPreferences,
} from './preferences-store.js';

applyAppearancePreferences(readAppearancePreferences());

const quickWindow = readShortcutPreferences().quickWindow;
void window.syncThink?.runtime?.setGlobalShortcut?.(quickWindow);
void window.syncThink?.runtime?.setTrayVisible?.(readTrayPreferences().visible);
applyShellMotionPreference(localStorage.getItem('sync-think-animation') !== '0');

/*
 * Stop decorative animations while the window is hidden (minimized or fully
 * backgrounded). They would otherwise keep consuming GPU/CPU and battery for
 * frames nobody can see, and a returning window then has a backlog of animation
 * work to catch up on. Functional loaders are exempted in CSS so the app never
 * looks frozen on return. Mirrors NewMax's `.app-hidden` handling.
 */
const syncAppHiddenAttribute = () => {
  document.documentElement.dataset.appHidden = document.hidden ? 'true' : 'false';
};
document.addEventListener('visibilitychange', syncAppHiddenAttribute);
syncAppHiddenAttribute();

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const current = readAppearancePreferences();
  if (current.mode === 'system') applyAppearancePreferences(current);
});

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(<ShellApp />);
