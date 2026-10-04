/** Stable built-in browser profile, separate from the host application session. */
export const DEFAULT_EMBEDDED_BROWSER_PARTITION = 'persist:browser-panel';
/** Respect an explicitly saved previous default; never discard its login data. */
export const LEGACY_EMBEDDED_BROWSER_PARTITION = '';
export interface EmbeddedBrowserSessionInfo {
  engine: 'electron-webview';
  persistent: boolean;
  storagePath: string | null;
}
