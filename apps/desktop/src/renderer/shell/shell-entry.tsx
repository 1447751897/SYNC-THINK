import { createRoot } from 'react-dom/client';
import { ShellApp } from './ShellApp.js';
import { applyShellMotionPreference } from '../ui-preferences.js';
import {
  applyAppearancePreferences,
  readAppearancePreferences,
  readShortcutPreferences,
} from './preferences-store.js';

applyAppearancePreferences(readAppearancePreferences());

const quickWindow = readShortcutPreferences().quickWindow;
void window.syncThink?.runtime?.setGlobalShortcut?.(quickWindow);
applyShellMotionPreference(localStorage.getItem('sync-think-animation') !== '0');

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const current = readAppearancePreferences();
  if (current.mode === 'system') applyAppearancePreferences(current);
});

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(<ShellApp />);
