import type { EmbeddedBrowserSessionInfo } from '../browser-session-info.js';
export function embeddedBrowserSessionInfo(guest: {
  getType(): string;
  hostWebContents?: { id: number };
  session: { isPersistent(): boolean; getStoragePath(): string | null };
}, senderId: number): EmbeddedBrowserSessionInfo {
  if (guest.getType() !== 'webview' || guest.hostWebContents?.id !== senderId) throw new Error('Browser guest does not belong to this window');
  return { engine: 'electron-webview', persistent: guest.session.isPersistent(), storagePath: guest.session.getStoragePath() };
}
