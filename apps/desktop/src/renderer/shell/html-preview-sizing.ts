/** Layout policy for ordinary, isolated chat HTML previews (not BoardData guests). */
export const HTML_PREVIEW_SIZE_MESSAGE = 'sync-think:html-preview-size';
export const INITIAL_HTML_PREVIEW_HEIGHT = 420;
export const MAX_HTML_PREVIEW_REPORT = 32_000;

export const HTML_PREVIEW_VIEWPORT_MESSAGE = 'sync-think:html-preview-viewport';

export type HtmlPreviewSizing = 'content' | 'fit' | 'actual';

export interface HtmlPreviewLayout {
  height: number;
  frameHeight: number;
  frameWidth: number;
  scale: number;
}

export function htmlPreviewAvailableHeight(viewportHeight: number): number {
  // Use the window rather than the resulting stage height to avoid resize feedback.
  return Math.max(160, Math.min(960, Math.floor(viewportHeight) - 200));
}

export function htmlPreviewLayout(
  contentHeight: number,
  viewportHeight: number,
  fitToWindow: boolean,
  contentWidth = 0,
  viewportWidth = 0,
  autoHeight = false,
): HtmlPreviewLayout {
  const natural = Math.max(1, Math.min(MAX_HTML_PREVIEW_REPORT, Math.ceil(contentHeight)));
  const frameWidth = Math.max(1, Math.ceil(contentWidth), Math.floor(viewportWidth));
  if (!fitToWindow && !autoHeight) {
    const height = Math.min(natural, 1200);
    // Original size deliberately keeps native scrolling for larger documents.
    return { height, frameHeight: height, frameWidth: Math.max(1, viewportWidth), scale: 1 };
  }
  const available = htmlPreviewAvailableHeight(viewportHeight);
  const scale = Math.min(
    1,
    autoHeight ? 1 : available / natural,
    viewportWidth > 0 ? viewportWidth / frameWidth : 1,
  );
  // Content mode mirrors file-backed agent previews: fit the available width
  // and grow the stage to the whole document. Window-fit remains an explicit
  // option for viewing a complete scene within one screen.
  return { height: autoHeight ? Math.ceil(natural * scale) : Math.min(available, Math.ceil(natural * scale)), frameHeight: natural, frameWidth, scale };
}

/** Append ONLY our sizing bridge after the caller has sanitized authored HTML. */
export function measuredHtmlPreviewDocument(html: string, documentId: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const script = document.createElement('script');
  script.dataset.htmlPreviewSizing = documentId;
  script.textContent = `(() => {
    const type = ${JSON.stringify(HTML_PREVIEW_SIZE_MESSAGE)};
    const documentId = ${JSON.stringify(documentId).replace(/</g, '\\u003c')};
    const root = document.documentElement;
    const body = document.body;
    let scheduled = false;
    let previous = '';
    let viewportHeight = innerHeight;
    const originals = new WeakMap();
    const blockProperties = ['height', 'min-height', 'max-height', 'block-size', 'min-block-size', 'max-block-size'];
    // Keep authored vertical viewport units tied to the host's available height,
    // not to the iframe height that we expand to show its complete document.
    // Otherwise a padded 100vh body grows again after every measurement.
    const stabilizeStyle = (style, isRoot) => {
      let values = originals.get(style);
      if (!values) { values = new Map(); originals.set(style, values); }
      for (const property of Array.from(style)) {
        const current = style.getPropertyValue(property);
        const known = values.get(property);
        if (known && current === known.applied) continue;
        if (/[-+\\d.]+(?:dvh|svh|lvh|vh|dvb|svb|lvb|vb)\\b/i.test(current) ||
          (isRoot && blockProperties.includes(property) && /^\\s*[\\d.]+%\\s*$/.test(current)))
          values.set(property, { original: current, priority: style.getPropertyPriority(property), applied: '' });
        else values.delete(property);
      }
      for (const [property, value] of values) {
        const replace = (_, amount) => (Number(amount) * viewportHeight / 100) + 'px';
        let fixed = value.original.replace(/([-+]?\\d*\\.?\\d+)(?:dvh|svh|lvh|vh|dvb|svb|lvb|vb)\\b/gi, replace);
        if (isRoot && blockProperties.includes(property))
          fixed = fixed.replace(/^\\s*([\\d.]+)%\\s*$/, replace);
        value.applied = fixed;
        if (style.getPropertyValue(property) !== fixed) style.setProperty(property, fixed, value.priority);
      }
    };
    const stabilizeViewport = () => {
      const inspect = rules => Array.from(rules).forEach(rule => {
        if (rule.style) {
          let isRoot = false;
          try { isRoot = root.matches(rule.selectorText) || body.matches(rule.selectorText); } catch {}
          stabilizeStyle(rule.style, isRoot);
        }
        if (rule.cssRules) inspect(rule.cssRules);
      });
      for (const sheet of Array.from(document.styleSheets)) {
        try { inspect(sheet.cssRules); } catch {}
      }
      document.querySelectorAll('[style]').forEach(element =>
        stabilizeStyle(element.style, element === root || element === body));
    };
    const measure = () => {
      scheduled = false;
      stabilizeViewport();
      const top = Math.max(0, body.getBoundingClientRect().top + scrollY);
      const margin = Math.max(0, parseFloat(getComputedStyle(body).marginBottom) || 0);
      // The root scrollHeight has a viewport floor. Ignore that floor so a
      // short document can shrink again after a wider window or source update.
      const overflow = root.scrollHeight > innerHeight + 1 ? root.scrollHeight : 0;
      const height = Math.max(1, Math.min(${MAX_HTML_PREVIEW_REPORT}, Math.ceil(Math.max(
        top + body.offsetHeight + margin,
        top + body.scrollHeight + margin,
        overflow
      ))));
      const width = Math.max(1, Math.min(${MAX_HTML_PREVIEW_REPORT}, Math.ceil(Math.max(
        root.scrollWidth, body.scrollWidth, body.getBoundingClientRect().right + scrollX
      ))));
      const key = width + ':' + height;
      if (key === previous) return;
      previous = key;
      parent.postMessage({ type, documentId, width, height }, '*');
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(measure);
    };
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(schedule);
      observer.observe(body);
      observer.observe(root);
    }
    new MutationObserver(schedule).observe(body, { childList: true, subtree: true, attributes: true });
    addEventListener('message', event => {
      if (event.source !== parent || event.data?.type !== ${JSON.stringify(HTML_PREVIEW_VIEWPORT_MESSAGE)} ||
        event.data.documentId !== documentId || !Number.isFinite(event.data.height) ||
        event.data.height <= 0 || event.data.height > ${MAX_HTML_PREVIEW_REPORT}) return;
      viewportHeight = event.data.height;
      schedule();
    });
    addEventListener('resize', schedule);
    addEventListener('load', schedule, true);
    document.fonts?.ready.then(schedule);
    schedule();
  })();`;
  document.body.append(script);
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}
