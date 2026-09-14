// Mermaid rendering pipeline, ported from NewMax's shipped renderer bundle
// (`loadMermaidModule` / `renderSvgInShadowHost` / `getExportSvg` /
// `postProcessMermaidSvgForExport` / `svgToPngBlob`).
//
// The rendered SVG always lives inside an open shadow root: the shadow
// stylesheet from mermaid-shadow-css.ts can then use plain selectors without
// leaking into (or being overridden by) the shell stylesheet.
import { loadMermaidVendor, type MermaidVendor } from '../shell/mermaid-vendor-loader.js';
import { getMermaidConfig, getMermaidThemeVars, isDarkTheme } from './mermaid-theme.js';
import {
  applyFlowchartInlineLayout,
  applyMermaidPostProcess,
  getChatSurfaceBg,
  tightenFlowchartViewBox,
} from './mermaid-post-process.js';
import { getMermaidShadowCSS } from './mermaid-shadow-css.js';

export async function loadMermaidModule(): Promise<MermaidVendor> {
  return loadMermaidVendor();
}

export function initializeMermaid(vendor: MermaidVendor, dark: boolean): void {
  vendor.initialize(getMermaidConfig(getMermaidThemeVars(dark), dark));
}

const EXPORT_MERMAID_WIDTH = 680;

/** Serialize the rendered SVG with the shadow stylesheet inlined, so a PNG
 *  export / data-url preview looks exactly like the on-screen diagram. */
export function postProcessMermaidSvgForExport(svg: string, dark: boolean): string {
  let host: HTMLDivElement | null = null;
  try {
    const css = getMermaidShadowCSS(dark);
    host = document.createElement('div');
    host.style.cssText = `position:absolute;left:-99999px;top:0;width:${EXPORT_MERMAID_WIDTH}px;visibility:hidden;pointer-events:none;`;
    document.body.appendChild(host);
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `<style>${css}</style>${svg}`;
    const svgEl = shadowRoot.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return svg;
    void host.offsetHeight;
    applyMermaidPostProcess(svgEl, dark);
    const clonedSvg = svgEl.cloneNode(true) as SVGElement;
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = css;
    clonedSvg.insertBefore(styleEl, clonedSvg.firstChild);
    clonedSvg.setAttribute('width', String(EXPORT_MERMAID_WIDTH));
    clonedSvg.removeAttribute('height');
    clonedSvg.style.width = `${EXPORT_MERMAID_WIDTH}px`;
    clonedSvg.style.maxWidth = `${EXPORT_MERMAID_WIDTH}px`;
    clonedSvg.style.height = 'auto';
    return new XMLSerializer().serializeToString(clonedSvg);
  } catch {
    return svg;
  } finally {
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }
}

export interface MermaidExport {
  svg: string;
  width: number;
  height: number;
}

function extractLabelLines(element: Element, measure = false): string[] {
  const lines: string[] = [];
  let current = '';
  let top: number | null = null;
  let measured = false;
  const flush = () => {
    if (current.trim()) lines.push(current.trim());
    current = '';
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || '';
      if (!measure) {
        current += value;
        return;
      }
      for (let index = 0; index < value.length; index++) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getClientRects?.()[0];
        if (rect) {
          measured = true;
          if (top !== null && Math.abs(rect.top - top) > 4) flush();
          top = rect.top;
        }
        current += value[index];
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName.toLowerCase();
      const boundary = !measure && ['br', 'p', 'div'].includes(tag);
      if (boundary) flush();
      node.childNodes.forEach(walk);
      if (boundary) flush();
    }
  };
  element.childNodes.forEach(walk);
  flush();
  return measure && !measured ? [] : lines;
}

// SVG images cannot inherit the chat's tokens or reliably rasterize HTML labels.
// Preserve the measured line breaks, replacing foreignObject with native SVG text.
function makeExportSelfContained(svgEl: SVGSVGElement, clone: SVGElement, dark: boolean): void {
  const rootStyle = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {
    '--color-chat': getChatSurfaceBg(),
    '--color-text': dark ? '#e6e6e6' : '#181b19',
    '--color-text-secondary': dark ? '#a0a0a0' : '#646866',
    '--color-text-faint': dark ? '#8b9390' : '#868987',
    '--color-border-strong': dark ? '#454a47' : '#d6dad8',
  };
  for (const [name, fallback] of Object.entries(tokens)) {
    tokens[name] = rootStyle.getPropertyValue(name).trim() || fallback;
    clone.style.setProperty(name, tokens[name]);
  }
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.setAttribute('data-mermaid-export-style', '');
  style.textContent = getMermaidShadowCSS(dark);
  clone.querySelectorAll('style[data-mermaid-export-style]').forEach((old) => old.remove());
  clone.appendChild(style);

  const liveLabels = svgEl.querySelectorAll('foreignObject');
  clone.querySelectorAll('foreignObject').forEach((label, index) => {
    const live = liveLabels[index];
    const measured = live ? extractLabelLines(live, true) : [];
    const lines = measured.length ? measured : extractLabelLines(label);
    if (!lines.length) {
      label.remove();
      return;
    }
    const width = parseFloat(label.getAttribute('width') || '0');
    const height = parseFloat(label.getAttribute('height') || '0');
    const cx = parseFloat(label.getAttribute('x') || '0') + width / 2;
    const cy = parseFloat(label.getAttribute('y') || '0') + height / 2;
    const edgeLabel = label.closest('.edgeLabel, .relationshipLabel');
    const fontSize = edgeLabel ? 12 : 13;
    const lineHeight = Math.round(fontSize * 1.35);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(cx));
    text.setAttribute('y', String(cy - 2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-size', String(fontSize));
    text.setAttribute(
      'font-family',
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
    );
    text.style.setProperty(
      'fill',
      tokens[edgeLabel ? '--color-text-faint' : '--color-text'],
      'important',
    );
    text.style.setProperty('font-weight', edgeLabel ? '400' : '500', 'important');
    lines.forEach((line, lineIndex) => {
      const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      span.setAttribute('x', String(cx));
      span.setAttribute(
        'dy',
        String(lineIndex === 0 ? -((lines.length - 1) * lineHeight) / 2 : lineHeight),
      );
      span.textContent = line;
      text.appendChild(span);
    });
    label.replaceWith(text);
    const rect = edgeLabel?.querySelector('rect');
    if (rect) {
      const textWidth = Math.max(
        ...lines.map((line) =>
          Array.from(line).reduce(
            (sum, char) =>
              sum +
              fontSize *
                (/[\u4e00-\u9fff\u3000-\u303f]/.test(char) ? 1 : /\s/.test(char) ? 0.3 : 0.55),
            0,
          ),
        ),
      );
      const textHeight = lines.length * lineHeight;
      rect.setAttribute('width', String(textWidth + 20));
      rect.setAttribute('height', String(textHeight + 8));
      rect.setAttribute('x', String(-textWidth / 2 - 10));
      rect.setAttribute('y', String(-textHeight / 2 - 4));
    }
  });
}

/** Read back the rendered SVG and its intrinsic size from the shadow host. */
export function getExportSvg(container: HTMLElement): MermaidExport | null {
  const shadowRoot = container.shadowRoot;
  if (!shadowRoot) return null;
  const svgEl = shadowRoot.querySelector('svg') as SVGSVGElement | null;
  if (!svgEl) return null;
  const clone = svgEl.cloneNode(true) as SVGElement;
  const viewBox = clone.getAttribute('viewBox');
  let width = 0;
  let height = 0;
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      width = parts[2];
      height = parts[3];
    }
  }
  if (!width)
    width = parseFloat(clone.getAttribute('width') || '') || svgEl.getBoundingClientRect().width;
  if (!height)
    height = parseFloat(clone.getAttribute('height') || '') || svgEl.getBoundingClientRect().height;
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.maxWidth = 'none';
  makeExportSelfContained(svgEl, clone, isDarkTheme());
  return {
    svg: new XMLSerializer().serializeToString(clone),
    width,
    height,
  };
}

export async function svgToPngBlob(
  svgString: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      ctx.fillStyle = getChatSurfaceBg();
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      try {
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        }, 'image/png');
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Mount a rendered SVG into `container`'s shadow root, then run NewMax's
 * post-process pipeline. Flowcharts whose labels render through foreignObject
 * are re-mounted from the export snapshot, exactly like NewMax does — that
 * second pass is what makes the inline (non-scrolling) layout stable.
 */
export function renderSvgInShadowHost(svg: string, container: HTMLElement): void {
  container.innerHTML = '';
  const dark = isDarkTheme();
  let shadowRoot = container.shadowRoot;
  if (!shadowRoot) {
    shadowRoot = container.attachShadow({ mode: 'open' });
  }
  shadowRoot.innerHTML = `<style>${getMermaidShadowCSS(dark)}</style>${svg}`;
  const svgEl = shadowRoot.querySelector('svg') as SVGSVGElement | null;
  if (!svgEl) return;
  applyMermaidPostProcess(svgEl, dark);
  tightenFlowchartViewBox(svgEl);
  if (!svgEl.querySelector('foreignObject')) {
    applyFlowchartInlineLayout(svgEl, container);
    return;
  }
  const nativeTextSvg = getExportSvg(container);
  if (!nativeTextSvg) return;
  shadowRoot.innerHTML = `<style>${getMermaidShadowCSS(dark)}</style>${nativeTextSvg.svg}`;
  const renderedSvg = shadowRoot.querySelector('svg') as SVGSVGElement | null;
  if (!renderedSvg) return;
  renderedSvg.style.removeProperty('max-width');
  renderedSvg.style.height = 'auto';
  applyFlowchartInlineLayout(renderedSvg, container);
}
