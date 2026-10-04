export interface BrowserSavedPassword {
  id: string;
  origin: string;
  username: string;
  updatedAt: string;
}
export interface BrowserCookieSite {
  domain: string;
  count: number;
  persistentCount: number;
}
export interface BrowserDataSnapshot {
  storagePath: string | null;
  persistent: boolean;
  encryptionAvailable: boolean;
  passwords: BrowserSavedPassword[];
  sites: BrowserCookieSite[];
}
export type BrowserDataAction =
  | { action: 'list' }
  | { action: 'save-password'; origin: string; username: string; password: string }
  | { action: 'save-from-page' }
  | { action: 'fill-password'; id: string }
  /** Fill the single entry matching the current origin; silent when none match. */
  | { action: 'autofill' }
  | { action: 'delete-password'; id: string }
  | { action: 'clear-site'; domain: string }
  /** Clear every Cookie and site storage in this browser profile's session. */
  | { action: 'clear-session' }
  | { action: 'import-file' };
export type BrowserDataRequest = BrowserDataAction & { webContentsId: number };
export type BrowserDataResult =
  | { ok: true; snapshot: BrowserDataSnapshot; message?: string }
  | { ok: false; error: string };
