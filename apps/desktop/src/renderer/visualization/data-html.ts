/** Marker recognition is deliberately narrow; arbitrary HTML does not become a data dashboard. */
export function hasBoardDataMarkup(source: string): boolean {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    return Boolean(
      doc.querySelector(
        'script[type="application/json"][data-boardui],div[data-boardui],section[data-boardui],main[data-boardui]',
      ),
    );
  }
  return /<(?:script|div|section|main)\b[^>]*\bdata-boardui(?:\s*=|\s|>)/i.test(source);
}

/** Convert inert JSON scripts before DOMPurify strips authored executable scripts. */
export function prepareBoardDataSource(source: string): string {
  if (!hasBoardDataMarkup(source) || typeof DOMParser === 'undefined') return source;
  const document = new DOMParser().parseFromString(source, 'text/html');
  const markers = document.querySelectorAll('script[type="application/json"][data-boardui]');
  for (const marker of markers) {
    const replacement = document.createElement('div');
    replacement.setAttribute('data-boardui', marker.textContent || '');
    marker.replaceWith(replacement);
  }
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}

/** Avoid creating a new guest for each incomplete streamed JSON chunk. */
export function isBoardDataPending(source: string): boolean {
  if (typeof DOMParser === 'undefined') return false;
  const lower = source.toLowerCase();
  const start = lower.lastIndexOf('<script');
  if (start < 0 || lower.indexOf('</script', start) >= 0) return false;
  const marker = new DOMParser()
    .parseFromString(source.slice(start), 'text/html')
    .querySelector('script[type="application/json"][data-boardui]');
  if (!marker) return false;
  try {
    JSON.parse(marker.textContent || '');
    return false;
  } catch {
    return true;
  }
}
