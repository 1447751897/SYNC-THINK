import { createRoot } from 'react-dom/client';
import { ShellApp } from './ShellApp.js';
import { applyShellTheme } from './SettingsPage.js';

// Restore persisted theme. Both light and dark are now tuned against the
// NewMax reference, so following the OS is the honest default.
const storedTheme =
  (localStorage.getItem('sync-think-shell-theme') as 'light' | 'dark' | 'system') || 'system';
applyShellTheme(storedTheme);

// Restore animation preference.
const animPref = localStorage.getItem('sync-think-animation');
if (animPref === '0') {
  document.documentElement.setAttribute('data-reduced-motion', '');
}

// Keep OS-follow responsive while theme is 'system'.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const current =
    (localStorage.getItem('sync-think-shell-theme') as 'light' | 'dark' | 'system') || 'system';
  if (current === 'system') applyShellTheme('system');
});

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(<ShellApp />);
