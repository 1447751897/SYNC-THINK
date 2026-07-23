import { createRoot } from 'react-dom/client';
import { ShellApp } from './ShellApp.js';
import { applyShellTheme } from './SettingsPage.js';

// Restore persisted theme (or follow OS if not set).
const storedTheme = (localStorage.getItem('sync-think-shell-theme') as 'light' | 'dark' | 'system') || 'system';
applyShellTheme(storedTheme);

// Keep OS-follow responsive while theme is 'system'.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const current = (localStorage.getItem('sync-think-shell-theme') as 'light' | 'dark' | 'system') || 'system';
  if (current === 'system') applyShellTheme('system');
});

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(<ShellApp />);
