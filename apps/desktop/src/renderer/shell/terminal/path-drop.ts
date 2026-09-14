export function shellEscapePath(filePath: string): string {
  if (/^[a-zA-Z0-9_./@:-]+$/.test(filePath)) return filePath;
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}

function parseUriList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => line.toLowerCase().startsWith('file://'))
    .map((line) => {
      try {
        return decodeURIComponent(line.replace(/^file:\/\/(localhost)?/i, ''));
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

export function isTerminalPathDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types ?? []);
  if (types.includes('Files') || types.includes('text/uri-list')) return true;
  if (dataTransfer.files?.length > 0) return true;
  try {
    return dataTransfer.getData('text/plain').startsWith('newmax-file:');
  } catch {
    return false;
  }
}

export function extractFilePathsFromDrag(event: { dataTransfer: DataTransfer | null }): string[] {
  const transfer = event.dataTransfer;
  if (!transfer) return [];
  const paths: string[] = [];
  const plainText = transfer.getData('text/plain');
  if (plainText?.startsWith('newmax-file:')) {
    paths.push(plainText.slice('newmax-file:'.length));
    return paths;
  }
  if (transfer.files.length > 0) {
    for (let index = 0; index < transfer.files.length; index += 1) {
      const file = transfer.files[index];
      if (!file) continue;
      try {
        const filePath = window.syncThink?.runtime.pathForFile(file);
        if (filePath) paths.push(filePath);
      } catch {
        /* NewMax swallows getPathForFile failures */
      }
    }
    if (paths.length > 0) return paths;
  }
  const uriList = transfer.getData('text/uri-list');
  if (uriList) paths.push(...parseUriList(uriList));
  return paths;
}
