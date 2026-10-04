let fontDataUrl = '';
let pending: Promise<void> | undefined;
export function boardDataFontReady(): boolean {
  return !!fontDataUrl;
}
export function boardDataFontDataUrl(): string {
  return fontDataUrl;
}
/** Separate chunk: the 73KB offline font never becomes an initial-chat JS dependency. */
export function loadBoardDataFont(): Promise<void> {
  if (fontDataUrl) return Promise.resolve();
  if (!pending)
    pending = import('./board-data-font.js')
      .then((module) => {
        fontDataUrl = module.BOARD_DATA_INTER_DATA_URL;
      })
      .catch((error) => {
        pending = undefined;
        throw error;
      });
  return pending;
}
