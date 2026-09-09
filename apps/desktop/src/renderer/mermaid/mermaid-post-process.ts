// Mermaid SVG post-processing, ported verbatim from NewMax's shipped renderer
// bundle (app.asar → walletStore-BwxxPnpb.js). This is the layer that turns a
// raw mermaid SVG into the NewMax-looking diagram: rounded orthogonally-routed
// edges, unified arrow heads, edge labels snapped to their edge with a surface
// background pill, centred node labels, cluster backgrounds, gantt today-pill,
// mindmap/timeline theming, xychart axis staggering and a tightened viewBox.
//
// Only the CSS custom properties differ from NewMax: `--ds-text-primary`
// → `--color-text`, `--ds-text-secondary` → `--color-text-secondary`,
// `--ds-text-tertiary` → `--color-text-faint`, `--ds-surface-100`/`--background`
// → `--color-chat`, `--ds-on-surface` → `--color-border-strong`.
import { isDarkTheme } from './mermaid-theme.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function getChatSurfaceBg(): string {
  if (typeof window === 'undefined') return isDarkTheme() ? '#1e1f1f' : '#faf8f3';
  const root = getComputedStyle(document.documentElement);
  const chat = root.getPropertyValue('--color-chat').trim();
  return chat || (isDarkTheme() ? '#1e1f1f' : '#faf8f3');
}

// ── colour helpers ──────────────────────────────────────────────────────────

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r: r / 255, g: g / 255, b: b / 255 };
  }
  const m = s.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) {
    return {
      r: parseInt(m[1], 10) / 255,
      g: parseInt(m[2], 10) / 255,
      b: parseInt(m[3], 10) / 255,
    };
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: hue2rgb(h + 1 / 3),
    g: hue2rgb(h),
    b: hue2rgb(h - 1 / 3),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const DARK_NORMALIZE_L_THRESHOLD = 0.55;

function normalizeDarkNodeColors(svgEl: SVGSVGElement, dark: boolean): void {
  if (!dark) return;
  const TEXT_COLOR = '#b8cebe';
  const darken = (hex: string): string | null => {
    const rgb = parseColor(hex);
    if (!rgb) return null;
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    if (hsl.l < DARK_NORMALIZE_L_THRESHOLD) return null;
    const out = hslToRgb(hsl.h, Math.min(hsl.s, 0.25), 0.15);
    return rgbToHex(out.r, out.g, out.b);
  };
  const darkenStroke = (hex: string): string | null => {
    const rgb = parseColor(hex);
    if (!rgb) return null;
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    if (hsl.l < DARK_NORMALIZE_L_THRESHOLD) return null;
    const out = hslToRgb(hsl.h, Math.min(hsl.s, 0.35), 0.32);
    return rgbToHex(out.r, out.g, out.b);
  };
  const normalizedNodes = new Set<Element>();
  const shapes = svgEl.querySelectorAll(
    '.node rect, .node polygon, .node circle, .node ellipse, .node path',
  );
  shapes.forEach((shape) => {
    if (shape.closest('marker, defs')) return;
    const currentFill = (shape as SVGElement).style.fill || shape.getAttribute('fill') || '';
    const newFill = darken(currentFill);
    if (newFill) {
      (shape as SVGElement).style.setProperty('fill', newFill, 'important');
      const parentNode = shape.closest('.node');
      if (parentNode) normalizedNodes.add(parentNode);
    }
    const currentStroke = (shape as SVGElement).style.stroke || shape.getAttribute('stroke') || '';
    const newStroke = darkenStroke(currentStroke);
    if (newStroke) {
      (shape as SVGElement).style.setProperty('stroke', newStroke, 'important');
    }
  });
  normalizedNodes.forEach((nodeEl) => {
    nodeEl.querySelectorAll('text, tspan').forEach((t) => {
      (t as SVGElement).style.setProperty('fill', TEXT_COLOR, 'important');
    });
    nodeEl
      .querySelectorAll('foreignObject span, foreignObject div, foreignObject p')
      .forEach((t) => {
        (t as HTMLElement).style.setProperty('color', TEXT_COLOR, 'important');
      });
  });
}

function applyClusterBackgroundToSvg(svgEl: SVGSVGElement, dark: boolean): void {
  const fill = dark ? '#191a1a' : '#faf9f5';
  const rects = svgEl.querySelectorAll('.cluster rect, rect.outer, rect.inner');
  rects.forEach((rect) => {
    const el = rect as SVGElement;
    el.style.setProperty('fill', fill, 'important');
    el.style.setProperty('fill-opacity', '1', 'important');
    el.removeAttribute('fill-opacity');
  });
}

// ── edge routing ────────────────────────────────────────────────────────────

const CORNER_RADIUS = 28;

interface Point {
  x: number;
  y: number;
}

function parsePathPoints(d: string): Point[] {
  const points: Point[] = [];
  const segs = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) || [];
  let cx = 0;
  let cy = 0;
  let lastFromL = false;
  const pushPoint = (): void => {
    points.push({ x: cx, y: cy });
  };
  for (const seg of segs) {
    const upper = seg[0].toUpperCase();
    const isRel = seg[0] !== upper;
    const nums = (seg.slice(1).match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || []).map(
      parseFloat,
    );
    if (upper === 'M') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cx = isRel ? cx + nums[i] : nums[i];
        cy = isRel ? cy + nums[i + 1] : nums[i + 1];
        pushPoint();
      }
      lastFromL = false;
    } else if (upper === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cx = isRel ? cx + nums[i] : nums[i];
        cy = isRel ? cy + nums[i + 1] : nums[i + 1];
        pushPoint();
      }
      lastFromL = true;
    } else if (upper === 'H') {
      for (const v of nums) {
        cx = isRel ? cx + v : v;
        pushPoint();
      }
      lastFromL = true;
    } else if (upper === 'V') {
      for (const v of nums) {
        cy = isRel ? cy + v : v;
        pushPoint();
      }
      lastFromL = true;
    } else if (upper === 'Q') {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const ctrlX = isRel ? cx + nums[i] : nums[i];
        const ctrlY = isRel ? cy + nums[i + 1] : nums[i + 1];
        if (lastFromL && points.length > 0) {
          points[points.length - 1] = { x: ctrlX, y: ctrlY };
        } else {
          points.push({ x: ctrlX, y: ctrlY });
        }
        cx = isRel ? cx + nums[i + 2] : nums[i + 2];
        cy = isRel ? cy + nums[i + 3] : nums[i + 3];
        lastFromL = false;
      }
    } else if (upper === 'C') {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        cx = isRel ? cx + nums[i + 4] : nums[i + 4];
        cy = isRel ? cy + nums[i + 5] : nums[i + 5];
        pushPoint();
      }
      lastFromL = false;
    } else if (upper === 'S') {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        cx = isRel ? cx + nums[i + 2] : nums[i + 2];
        cy = isRel ? cy + nums[i + 3] : nums[i + 3];
        pushPoint();
      }
      lastFromL = false;
    } else if (upper === 'T') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cx = isRel ? cx + nums[i] : nums[i];
        cy = isRel ? cy + nums[i + 1] : nums[i + 1];
        pushPoint();
      }
      lastFromL = false;
    }
  }
  return points;
}

function buildRoundedPath(pts: Point[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
    const len2 = Math.sqrt(d2x * d2x + d2y * d2y);
    if (len1 === 0 || len2 === 0) {
      d += `L${curr.x},${curr.y}`;
      continue;
    }
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 0.1) continue;
    const r = Math.min(CORNER_RADIUS, len1 / 2, len2 / 2);
    const ax = curr.x - (d1x / len1) * r;
    const ay = curr.y - (d1y / len1) * r;
    const bx = curr.x + (d2x / len2) * r;
    const by = curr.y + (d2y / len2) * r;
    d += `L${ax},${ay}Q${curr.x},${curr.y},${bx},${by}`;
  }
  d += `L${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
  return d;
}

function roundEdgeCorners(svgEl: SVGSVGElement): void {
  svgEl.querySelectorAll('path').forEach((edge) => {
    if (edge.closest('.node, .cluster, marker, defs, .actor, .timeline-node, .mindmap-node')) return;
    const d = edge.getAttribute('d');
    if (!d || !/^\s*[Mm]/.test(d)) return;
    const pts = parsePathPoints(d);
    if (pts.length < 3) return;
    const newD = buildRoundedPath(pts);
    if (newD) edge.setAttribute('d', newD);
  });
}

function snapEdgeLabelsToEdges(svgEl: SVGSVGElement): void {
  const labels = Array.from(svgEl.querySelectorAll('g.edgeLabel'));
  const paths = Array.from(svgEl.querySelectorAll('.edgePaths path'));
  if (labels.length === 0 || paths.length === 0) return;
  if (labels.length !== paths.length) return;
  const SAMPLES = 120;
  labels.forEach((label, i) => {
    const path = paths[i] as SVGPathElement;
    if (!path) return;
    const transformAttr = label.getAttribute('transform') || '';
    const m = /translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/.exec(transformAttr);
    if (!m) return;
    const labelX = parseFloat(m[1]);
    const labelY = parseFloat(m[2]);
    if (!Number.isFinite(labelX) || !Number.isFinite(labelY)) return;
    let totalLen = 0;
    try {
      totalLen = path.getTotalLength();
    } catch {
      return;
    }
    if (!Number.isFinite(totalLen) || totalLen < 10) return;
    let bestX = labelX;
    let bestY = labelY;
    let bestDist = Infinity;
    for (let j = 0; j <= SAMPLES; j++) {
      const len = (j / SAMPLES) * totalLen;
      try {
        const p = path.getPointAtLength(len);
        const d = Math.hypot(p.x - labelX, p.y - labelY);
        if (d < bestDist) {
          bestDist = d;
          bestX = p.x;
          bestY = p.y;
        }
      } catch {
        return;
      }
    }
    label.setAttribute('transform', `translate(${bestX}, ${bestY})`);
  });
}

function fixEdgeLabelCentering(svgEl: SVGSVGElement): void {
  svgEl.querySelectorAll('.edgeLabel').forEach((edgeLabelGroup) => {
    const labelG = edgeLabelGroup.querySelector('.label');
    if (!labelG) return;
    const labelGTransform = labelG.getAttribute('transform') || '';
    const m = /translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/.exec(labelGTransform);
    if (!m) return;
    const tx = parseFloat(m[1]);
    const ty = parseFloat(m[2]);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    const mermaidW = -2 * tx;
    const mermaidH = -2 * ty;
    if (mermaidW <= 0 || mermaidH <= 0) return;
    const PAD_X = 10;
    const PAD_Y = 4;
    let bgRect = edgeLabelGroup.querySelector('rect');
    if (!bgRect) {
      bgRect = document.createElementNS(SVG_NS, 'rect');
      edgeLabelGroup.insertBefore(bgRect, edgeLabelGroup.firstChild);
    }
    bgRect.setAttribute('width', String(mermaidW + PAD_X * 2));
    bgRect.setAttribute('height', String(mermaidH + PAD_Y * 2));
    bgRect.setAttribute('x', String(-mermaidW / 2 - PAD_X));
    bgRect.setAttribute('y', String(-mermaidH / 2 - PAD_Y));
    bgRect.setAttribute('rx', '8');
    bgRect.setAttribute('ry', '8');
    const bg = getChatSurfaceBg();
    bgRect.setAttribute('fill', bg);
    (bgRect as SVGElement).style.setProperty('fill', bg, 'important');
    (bgRect as SVGElement).style.setProperty('stroke', 'none', 'important');
    (bgRect as SVGElement).style.setProperty('opacity', '1', 'important');
    (bgRect as SVGElement).style.setProperty('fill-opacity', '1', 'important');
    bgRect.setAttribute('fill-opacity', '1');
    bgRect.setAttribute('opacity', '1');
  });
}

function styleEdgeLabels(svgEl: SVGSVGElement): void {
  const rootStyle = getComputedStyle(document.documentElement);
  const LABEL_COLOR =
    rootStyle.getPropertyValue('--color-text-faint').trim() || 'rgba(24,27,25,0.48)';
  const BG_COLOR = getChatSurfaceBg();
  svgEl.querySelectorAll('*').forEach((el) => {
    const cls = el.getAttribute('class') || '';
    if (!cls.includes('edgeLabel') && !cls.includes('relationshipLabel')) return;
    if (el.tagName === 'text' || el.tagName === 'TEXT') {
      el.setAttribute('fill', LABEL_COLOR);
      el.setAttribute('font-size', '12');
    }
    if (el.tagName === 'rect' || el.tagName === 'RECT') {
      el.setAttribute('fill', BG_COLOR);
      el.setAttribute('stroke', 'none');
    }
    el.querySelectorAll('text').forEach((t) => {
      t.setAttribute('fill', LABEL_COLOR);
    });
    el.querySelectorAll('rect').forEach((r) => {
      r.setAttribute('fill', BG_COLOR);
      r.setAttribute('stroke', 'none');
    });
    el.querySelectorAll('.labelBkg').forEach((bkg) => {
      (bkg as HTMLElement).style.backgroundColor = BG_COLOR;
    });
    el.querySelectorAll('span, div').forEach((e) => {
      if (e.classList.contains('labelBkg')) return;
      (e as HTMLElement).style.color = LABEL_COLOR;
    });
  });
}

function centerNodeLabels(svgEl: SVGSVGElement): void {
  svgEl.querySelectorAll('.node .label foreignObject').forEach((fo) => {
    const div = fo.querySelector(':scope > div') as HTMLElement | null;
    if (!div) return;
    div.style.textAlign = 'center';
  });
  svgEl.querySelectorAll('.node .nodeLabel').forEach((el) => {
    (el as HTMLElement).style.display = 'inline-block';
    (el as HTMLElement).style.textAlign = 'center';
  });
  svgEl.querySelectorAll('.node .nodeLabel p').forEach((el) => {
    (el as HTMLElement).style.textAlign = 'center';
    (el as HTMLElement).style.margin = '0';
  });
}

function unifyArrowMarkers(svgEl: SVGSVGElement): void {
  svgEl.querySelectorAll('defs marker').forEach((marker) => {
    const id = marker.getAttribute('id') || '';
    if (
      id.includes('circle') ||
      id.includes('dot') ||
      id.includes('aggregation') ||
      id.includes('composition')
    )
      return;
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    while (marker.firstChild) marker.removeChild(marker.firstChild);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M 0 1 L 9 5 L 0 9 z');
    marker.appendChild(path);
  });
  const overrideId = 'sync-think-arrow-color-override';
  if (!svgEl.querySelector(`#${overrideId}`)) {
    const style = document.createElementNS(SVG_NS, 'style');
    style.setAttribute('id', overrideId);
    style.textContent = `
      .marker,
      .marker path,
      .marker polygon,
      .marker polyline,
      .arrowheadPath,
      [id$="pointEnd"],
      [id$="pointEnd"] path,
      [id$="pointStart"],
      [id$="pointStart"] path {
        fill: color-mix(in srgb, var(--color-text) 30%, var(--color-chat)) !important;
        stroke: color-mix(in srgb, var(--color-text) 30%, var(--color-chat)) !important;
      }
    `;
    svgEl.appendChild(style);
  }
}

function hideOverlappingTicks(svgEl: SVGSVGElement): void {
  const ticks = Array.from(svgEl.querySelectorAll('.tick text'));
  if (ticks.length < 2) return;
  let prevRight = -Infinity;
  const MIN_GAP = 4;
  for (const t of ticks) {
    if ((t as SVGElement).style.opacity === '0') continue;
    const rect = t.getBoundingClientRect();
    if (rect.left < prevRight + MIN_GAP) {
      (t as SVGElement).style.opacity = '0';
    } else {
      prevRight = rect.right;
    }
  }
}

function highlightTodayTick(svgEl: SVGSVGElement): void {
  const todayLine = svgEl.querySelector('line.today') as SVGLineElement | null;
  if (!todayLine) return;
  const firstGridLine = svgEl.querySelector('.grid .tick line');
  if (firstGridLine) {
    const gridTop = firstGridLine.getBoundingClientRect().top;
    const todayTop = todayLine.getBoundingClientRect().top;
    const svgH = svgEl.getBoundingClientRect().height;
    if (svgH > 0) {
      const vb = svgEl.viewBox?.baseVal;
      const scale = vb && vb.height > 0 ? vb.height / svgH : 1;
      const y1Now = parseFloat(todayLine.getAttribute('y1') || '0');
      const newY1 = y1Now - (todayTop - gridTop) * scale;
      if (isFinite(newY1)) {
        todayLine.setAttribute('y1', String(newY1));
      }
    }
  }
  const x = parseFloat(todayLine.getAttribute('x1') || '0');
  const todayScreenRect = todayLine.getBoundingClientRect();
  const todayCX = todayScreenRect.left + todayScreenRect.width / 2;
  const ticks = svgEl.querySelectorAll('g.tick');
  let closestText: SVGTextElement | null = null;
  let minDist = Infinity;
  for (const g of ticks) {
    const t = g.querySelector('text') as SVGTextElement | null;
    if (!t) continue;
    const r = t.getBoundingClientRect();
    const d = Math.abs(r.left + r.width / 2 - todayCX);
    if (d < minDist) {
      minDist = d;
      closestText = t;
    }
  }
  if (!closestText || minDist > 40) return;
  const label = closestText.textContent || '';
  closestText.style.opacity = '0';
  let refText: SVGTextElement | null = null;
  for (const g of ticks) {
    const t = g.querySelector('text') as SVGTextElement | null;
    if (t && t !== closestText) {
      refText = t;
      break;
    }
  }
  const targetText = refText || closestText;
  const targetRect = targetText.getBoundingClientRect();
  const refScreenCenterY = targetRect.top + targetRect.height / 2;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return;
  const pt = svgEl.createSVGPoint();
  pt.x = todayCX;
  pt.y = refScreenCenterY;
  const svgPt = pt.matrixTransform(ctm.inverse());
  const pillX = x;
  const pillY = svgPt.y;
  const ctmScale = Math.sqrt(ctm.a * ctm.a + ctm.b * ctm.b);
  const fontSize = 9 / ctmScale;
  const padX = 6 / ctmScale;
  const padY = 2 / ctmScale;
  const textEl = document.createElementNS(SVG_NS, 'text');
  textEl.textContent = label;
  textEl.setAttribute('x', String(pillX));
  textEl.setAttribute('y', String(pillY));
  textEl.setAttribute('text-anchor', 'middle');
  textEl.setAttribute('dominant-baseline', 'central');
  textEl.setAttribute('fill', '#ffffff');
  textEl.setAttribute('font-size', String(fontSize));
  textEl.setAttribute('font-weight', '600');
  textEl.setAttribute(
    'font-family',
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  );
  svgEl.appendChild(textEl);
  const bbox = textEl.getBBox();
  svgEl.removeChild(textEl);
  const pillW = bbox.width + padX * 2;
  const pillH = bbox.height + padY * 2;
  if (
    !isFinite(pillW) ||
    !isFinite(pillH) ||
    pillW <= 0 ||
    pillH <= 0 ||
    !isFinite(pillX) ||
    !isFinite(pillY)
  ) {
    return;
  }
  const pillGroup = document.createElementNS(SVG_NS, 'g');
  pillGroup.setAttribute('class', 'today-pill');
  const rectEl = document.createElementNS(SVG_NS, 'rect');
  rectEl.setAttribute('x', String(pillX - pillW / 2));
  rectEl.setAttribute('y', String(pillY - pillH / 2));
  rectEl.setAttribute('width', String(pillW));
  rectEl.setAttribute('height', String(pillH));
  rectEl.setAttribute('rx', String(pillH / 2));
  rectEl.setAttribute('ry', String(pillH / 2));
  rectEl.setAttribute('fill', '#c76a5a');
  pillGroup.appendChild(rectEl);
  pillGroup.appendChild(textEl);
  svgEl.appendChild(pillGroup);
  svgEl.querySelectorAll('.section0, .section2').forEach((el) => {
    (el as SVGElement).style.fill = '#e2ede6';
  });
  const vbFinal = svgEl.viewBox?.baseVal;
  if (vbFinal && vbFinal.height > 0) {
    const titleEl = svgEl.querySelector('.titleText');
    const topPad = titleEl ? parseFloat(titleEl.getAttribute('y') || '0') * 0.6 : 20;
    const extraBottom = Math.max(topPad, 20);
    svgEl.setAttribute(
      'viewBox',
      `${vbFinal.x} ${vbFinal.y} ${vbFinal.width} ${vbFinal.height + extraBottom}`,
    );
  }
}

// ── xychart axis labels ─────────────────────────────────────────────────────

const XYCHART_BOTTOM_LABEL_SELECTOR = '.bottom-axis .label text';
const MIN_LABEL_GAP = 12;
const STAGGER_MARKER = 'syncThinkXyAxisStagger';

function estimateLabelUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    if (/[㐀-鿿]/u.test(char)) units += 1;
    else if (/[A-Z0-9]/u.test(char)) units += 0.65;
    else if (/[a-z]/u.test(char)) units += 0.55;
    else if (/\s/u.test(char)) units += 0.35;
    else if (/[,.:;!?，。：；！？'"`|/\\()[\]{}+\-_=]/u.test(char)) units += 0.35;
    else units += 0.8;
  }
  return units;
}

function estimateLabelWidth(text: string, fontSize: number): number {
  return estimateLabelUnits(text) * fontSize;
}

function readTranslatePoint(transform: string): Point | null {
  const match = transform.match(
    /translate\(\s*(-?\d+(?:\.\d+)?)(?:[\s,]+)(-?\d+(?:\.\d+)?)\s*\)/u,
  );
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function readFontSize(text: SVGTextElement): number {
  const fromAttribute = Number.parseFloat(text.getAttribute('font-size') ?? '');
  if (Number.isFinite(fromAttribute) && fromAttribute > 0) return fromAttribute;
  const fromStyle = Number.parseFloat(text.style.fontSize);
  if (Number.isFinite(fromStyle) && fromStyle > 0) return fromStyle;
  return 11;
}

function setVisibleLabel(text: SVGTextElement, fullLabel: string, visibleLabel: string): void {
  text.replaceChildren();
  if (visibleLabel === fullLabel) {
    delete text.dataset.syncThinkFullLabel;
    text.textContent = fullLabel;
    return;
  }
  text.dataset.syncThinkFullLabel = fullLabel;
  const title = text.ownerDocument.createElementNS(SVG_NS, 'title');
  title.textContent = fullLabel;
  text.append(title, text.ownerDocument.createTextNode(visibleLabel));
}

function truncateLabel(fullLabel: string, maxWidth: number, fontSize: number): string {
  if (estimateLabelWidth(fullLabel, fontSize) <= maxWidth) return fullLabel;
  const chars = Array.from(fullLabel);
  let visible = '';
  for (const char of chars) {
    if (estimateLabelWidth(visible + char + '…', fontSize) > maxWidth) break;
    visible += char;
  }
  return (visible || chars[0] || '') + '…';
}

function staggerText(text: SVGTextElement, offset: number): void {
  const originalTransform =
    text.dataset.syncThinkAxisTransform ?? text.getAttribute('transform') ?? '';
  const point = readTranslatePoint(originalTransform);
  if (!point) return;
  text.dataset.syncThinkAxisTransform = originalTransform;
  text.setAttribute(
    'transform',
    originalTransform.replace(
      /translate\(\s*-?\d+(?:\.\d+)?(?:[\s,]+)-?\d+(?:\.\d+)?\s*\)/u,
      'translate(' + point.x + ', ' + (point.y + offset) + ')',
    ),
  );
}

function extendSvgForStaggeredLabels(svgEl: SVGSVGElement, offset: number): void {
  if (svgEl.dataset[STAGGER_MARKER]) return;
  svgEl.dataset[STAGGER_MARKER] = String(offset);
  const viewBox = (svgEl.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/u).map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    viewBox[3] += offset;
    svgEl.setAttribute('viewBox', viewBox.join(' '));
  }
  const height = Number.parseFloat(svgEl.getAttribute('height') ?? '');
  if (Number.isFinite(height) && height > 0) {
    svgEl.setAttribute('height', String(height + offset));
  }
  const background = svgEl.querySelector('.main > rect.background');
  if (background) {
    const backgroundHeight = Number.parseFloat(background.getAttribute('height') ?? '');
    if (Number.isFinite(backgroundHeight) && backgroundHeight > 0) {
      background.setAttribute('height', String(backgroundHeight + offset));
    }
  }
  const axisTitle = svgEl.querySelector('.bottom-axis .title text') as SVGTextElement | null;
  if (axisTitle) staggerText(axisTitle, offset);
}

function fitXyChartAxisLabels(svgEl: SVGSVGElement): void {
  const labels = Array.from(
    svgEl.querySelectorAll(XYCHART_BOTTOM_LABEL_SELECTOR),
  ) as SVGTextElement[];
  if (labels.length < 2) return;
  const points = labels.map((text) =>
    readTranslatePoint(
      text.dataset.syncThinkAxisTransform ?? text.getAttribute('transform') ?? '',
    ),
  );
  if (points.some((point) => point === null)) return;
  const fullLabels = labels.map(
    (text) => text.dataset.syncThinkFullLabel ?? text.textContent ?? '',
  );
  const gaps = labels.map((_, index) => {
    const x = (points[index] as Point).x;
    const leftGap = index > 0 ? x - (points[index - 1] as Point).x : Infinity;
    const rightGap = index < labels.length - 1 ? (points[index + 1] as Point).x - x : Infinity;
    return Math.min(leftGap, rightGap);
  });
  if (gaps.some((gap) => !Number.isFinite(gap) || gap <= 0)) return;
  const needsStagger = labels.some(
    (text, index) =>
      estimateLabelWidth(fullLabels[index], readFontSize(text)) > gaps[index] - MIN_LABEL_GAP,
  );
  if (!needsStagger) {
    labels.forEach((text, index) => setVisibleLabel(text, fullLabels[index], fullLabels[index]));
    return;
  }
  const rowOffset = Math.max(...labels.map(readFontSize)) * 1.35;
  extendSvgForStaggeredLabels(svgEl, rowOffset);
  labels.forEach((text, index) => {
    if (index % 2 === 1) staggerText(text, rowOffset);
    const fullLabel = fullLabels[index];
    const maxWidth = Math.max(20, gaps[index] * 2 - MIN_LABEL_GAP);
    const visibleLabel = truncateLabel(fullLabel, maxWidth, readFontSize(text));
    setVisibleLabel(text, fullLabel, visibleLabel);
  });
}

// ── mindmap / timeline ──────────────────────────────────────────────────────

function darkenRgbFill(rgbStr: string): string | null {
  const m = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return null;
  let r = parseInt(m[1]) / 255;
  let g = parseInt(m[2]) / 255;
  let b = parseInt(m[3]) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  l = Math.min(Math.max(0, l - 0.2), 0.65);
  s = Math.min(1, s + 0.15);
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    return t < 1 / 6
      ? p + (q - p) * 6 * t
      : t < 1 / 2
        ? q
        : t < 2 / 3
          ? p + (q - p) * (2 / 3 - t) * 6
          : p;
  };
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getTextColorFromBg(rgbStr: string): string | null {
  const m = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return null;
  let r = parseInt(m[1]) / 255;
  let g = parseInt(m[2]) / 255;
  let b = parseInt(m[3]) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  if (l > 0.5) {
    l = Math.max(0.18, l - 0.45);
    s = Math.min(1, s + 0.1);
  } else {
    l = Math.min(0.85, l + 0.45);
    s = Math.max(0, s - 0.1);
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    return t < 1 / 6
      ? p + (q - p) * 6 * t
      : t < 1 / 2
        ? q
        : t < 2 / 3
          ? p + (q - p) * (2 / 3 - t) * 6
          : p;
  };
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function isDarkColor(color: string): boolean {
  if (!color || color === 'none' || color === 'transparent') return false;
  const c = color.toLowerCase().trim();
  if (c === 'black') return true;
  if (!c.startsWith('#')) return false;
  const hex = c.replace('#', '');
  let r: number;
  let g: number;
  let b: number;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length >= 6) {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  } else return false;
  return (r * 299 + g * 587 + b * 114) / 1e3 < 120;
}

function postProcessMindmap(svgEl: SVGSVGElement): void {
  if (!svgEl.querySelector('.mindmap-node')) return;
  svgEl.style.maxWidth = 'none';
  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      const vw = parts[2];
      svgEl.style.width = `${Math.max(vw, 600)}px`;
      svgEl.style.height = 'auto';
    }
  }
  svgEl.querySelectorAll('.mindmap-node .node-bkg').forEach((el) => {
    const border = darkenRgbFill(window.getComputedStyle(el).fill);
    if (!border) return;
    (el as SVGElement).style.setProperty('stroke', border, 'important');
    (el as SVGElement).style.setProperty('stroke-width', '1', 'important');
  });
  svgEl.querySelectorAll('.mindmap-node').forEach((node) => {
    const bkg = node.querySelector('.node-bkg');
    if (!bkg) return;
    const fill = window.getComputedStyle(bkg).fill;
    const textColor = getTextColorFromBg(fill);
    if (!textColor) return;
    node.querySelectorAll('.nodeLabel').forEach((label) => {
      (label as HTMLElement).style.setProperty('color', textColor, 'important');
    });
    node.querySelectorAll('text').forEach((t) => {
      (t as SVGElement).style.setProperty('fill', textColor, 'important');
    });
  });
  svgEl.querySelectorAll('.mindmap-node line[class*="node-line"]').forEach((el) => {
    (el as SVGElement).style.display = 'none';
  });
}

function postProcessTimeline(svgEl: SVGSVGElement): void {
  if (!svgEl.querySelector('.timeline-node')) return;
  const LINE_COLOR = '#9ca8a2';
  svgEl.querySelectorAll('line').forEach((line) => {
    const stroke = (line.getAttribute('stroke') || '').toLowerCase().trim();
    if (isDarkColor(stroke)) {
      line.setAttribute('stroke', LINE_COLOR);
      (line as SVGElement).style.stroke = LINE_COLOR;
    }
  });
  svgEl.querySelectorAll('path').forEach((path) => {
    if (path.closest('.node, .mindmap-node, .timeline-node')) return;
    const stroke = (path.getAttribute('stroke') || '').toLowerCase().trim();
    if (isDarkColor(stroke)) {
      path.setAttribute('stroke', LINE_COLOR);
      (path as SVGElement).style.stroke = LINE_COLOR;
    }
  });
  svgEl.querySelectorAll('defs marker').forEach((marker) => {
    marker.querySelectorAll('path, polygon').forEach((shape) => {
      const fill = (shape.getAttribute('fill') || '').toLowerCase().trim();
      if (isDarkColor(fill)) {
        shape.setAttribute('fill', LINE_COLOR);
      }
    });
  });
  svgEl.querySelectorAll('.timeline-node .node-bkg').forEach((el) => {
    const bbox = (el as SVGGraphicsElement).getBBox();
    const w = bbox.width;
    const h = bbox.height;
    const r = 8;
    el.setAttribute(
      'd',
      `M0 ${h - r} v${-(h - 2 * r)} q0,-${r} ${r},-${r} h${w - 2 * r} q${r},0 ${r},${r} v${h - 2 * r} q0,${r} -${r},${r} h${-(w - 2 * r)} q-${r},0 -${r},-${r} Z`,
    );
    const border = darkenRgbFill(window.getComputedStyle(el).fill);
    if (!border) return;
    (el as SVGElement).style.setProperty('stroke', border, 'important');
    (el as SVGElement).style.setProperty('stroke-width', '1', 'important');
  });
  svgEl.querySelectorAll('.timeline-node line[class*="node-line"]').forEach((el) => {
    (el as SVGElement).style.display = 'none';
  });
  svgEl.querySelectorAll('.timeline-node').forEach((node) => {
    const bkg = node.querySelector('.node-bkg');
    if (!bkg) return;
    const fill = window.getComputedStyle(bkg).fill;
    const textColor = getTextColorFromBg(fill);
    if (!textColor) return;
    node.querySelectorAll('.nodeLabel').forEach((label) => {
      (label as HTMLElement).style.setProperty('color', textColor, 'important');
    });
    node.querySelectorAll('text').forEach((t) => {
      (t as SVGElement).style.setProperty('fill', textColor, 'important');
    });
  });
}

// ── viewBox tightening / inline layout ──────────────────────────────────────

const MERMAID_VIEWBOX_PADDING = 24;
const MERMAID_VIEWBOX_EXCESS_RATIO = 1.25;
const MERMAID_MIN_INLINE_SCALE = 0.75;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function calculateTightMermaidViewBox(
  original: Bounds,
  content: Bounds,
  padding = MERMAID_VIEWBOX_PADDING,
): Bounds {
  if (
    ![
      original.x,
      original.y,
      original.width,
      original.height,
      content.x,
      content.y,
      content.width,
      content.height,
    ].every(Number.isFinite) ||
    original.width <= 0 ||
    original.height <= 0 ||
    content.width <= 0 ||
    content.height <= 0
  ) {
    return original;
  }
  const padded: Bounds = {
    x: content.x - padding,
    y: content.y - padding,
    width: content.width + padding * 2,
    height: content.height + padding * 2,
  };
  const contentEscapesOriginal =
    padded.x < original.x ||
    padded.y < original.y ||
    padded.x + padded.width > original.x + original.width ||
    padded.y + padded.height > original.y + original.height;
  const hasExcessWhitespace =
    original.width > padded.width * MERMAID_VIEWBOX_EXCESS_RATIO ||
    original.height > padded.height * MERMAID_VIEWBOX_EXCESS_RATIO;
  return contentEscapesOriginal || hasExcessWhitespace ? padded : original;
}

function resolveMermaidInlineLayout(
  viewBoxWidth: number,
  containerWidth: number,
): { scrollable: boolean; renderedWidth: number | null } {
  if (
    !Number.isFinite(viewBoxWidth) ||
    !Number.isFinite(containerWidth) ||
    viewBoxWidth <= 0 ||
    containerWidth <= 0
  ) {
    return { scrollable: false, renderedWidth: null };
  }
  if (containerWidth / viewBoxWidth >= MERMAID_MIN_INLINE_SCALE) {
    return { scrollable: false, renderedWidth: null };
  }
  return {
    scrollable: true,
    renderedWidth: Math.ceil(viewBoxWidth * MERMAID_MIN_INLINE_SCALE),
  };
}

function parseSvgViewBox(svgEl: SVGSVGElement): Bounds | null {
  const raw = svgEl.getAttribute('viewBox');
  if (!raw) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0)
    return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function transformBounds(bounds: Bounds, matrix: Matrix | null): Bounds {
  if (!matrix) return bounds;
  const points = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map(({ x, y }) => ({
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function invertMatrix(matrix: Matrix): Matrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) return null;
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

function getMatrixRelativeToSvg(element: Element, svgEl: SVGSVGElement): Matrix | null {
  const elementMatrix = (element as SVGGraphicsElement).getCTM();
  if (!elementMatrix) return null;
  const rootMatrix = svgEl.getCTM();
  if (!rootMatrix) return elementMatrix;
  const inverseRoot = invertMatrix(rootMatrix);
  return inverseRoot ? multiplyMatrices(inverseRoot, elementMatrix) : elementMatrix;
}

function unionBounds(bounds: Bounds[]): Bounds | null {
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function getFlowchartSemanticBounds(svgEl: SVGSVGElement): Bounds | null {
  const groups = Array.from(
    svgEl.querySelectorAll('g.nodes, g.clusters, g.edgeLabels, text.titleText'),
  );
  const fallbackNodes = groups.some((group) => group.classList.contains('nodes'))
    ? []
    : Array.from(svgEl.querySelectorAll('g.node'));
  return unionBounds(
    [...groups, ...fallbackNodes].flatMap((element) => {
      try {
        const box = (element as SVGGraphicsElement).getBBox();
        if (
          ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
          box.width <= 0 ||
          box.height <= 0
        ) {
          return [];
        }
        return [transformBounds(box, getMatrixRelativeToSvg(element, svgEl))];
      } catch {
        return [];
      }
    }),
  );
}

export function tightenFlowchartViewBox(svgEl: SVGSVGElement): void {
  if (!svgEl.querySelector('.node')) return;
  const original = parseSvgViewBox(svgEl);
  const content = getFlowchartSemanticBounds(svgEl);
  if (!original || !content) return;
  const next = calculateTightMermaidViewBox(original, content);
  if (next === original) return;
  svgEl.setAttribute('viewBox', `${next.x} ${next.y} ${next.width} ${next.height}`);
}

export function applyFlowchartInlineLayout(svgEl: SVGSVGElement, container: HTMLElement): void {
  if (!svgEl.querySelector('.node')) return;
  const viewBox = parseSvgViewBox(svgEl);
  if (!viewBox) return;
  const containerWidth = container.getBoundingClientRect().width;
  const layout = resolveMermaidInlineLayout(viewBox.width, containerWidth);
  if (!layout.scrollable || !layout.renderedWidth) {
    delete container.dataset.mermaidScrollable;
    container.style.removeProperty('justify-content');
    container.style.removeProperty('align-items');
    container.style.removeProperty('overflow-x');
    return;
  }
  container.dataset.mermaidScrollable = 'true';
  container.style.justifyContent = 'flex-start';
  container.style.alignItems = 'flex-start';
  container.style.overflowX = 'auto';
  svgEl.style.width = `${layout.renderedWidth}px`;
  svgEl.style.height = 'auto';
  svgEl.style.maxWidth = 'none';
}

export const MERMAID_TRANSPARENT_CHART_BACKGROUND_CSS = `
  /* xychart 会生成带 Mermaid 默认主题色的整块背景；透明后由 chat surface / 导出画布统一承载。 */
  .main > rect.background {
    fill: transparent !important;
  }
`;

/** NewMax's post-process pipeline, in its original order. */
export function applyMermaidPostProcess(svgEl: SVGSVGElement, dark: boolean): void {
  centerNodeLabels(svgEl);
  snapEdgeLabelsToEdges(svgEl);
  fixEdgeLabelCentering(svgEl);
  styleEdgeLabels(svgEl);
  applyClusterBackgroundToSvg(svgEl, dark);
  normalizeDarkNodeColors(svgEl, dark);
  roundEdgeCorners(svgEl);
  unifyArrowMarkers(svgEl);
  highlightTodayTick(svgEl);
  fitXyChartAxisLabels(svgEl);
  hideOverlappingTicks(svgEl);
  postProcessMindmap(svgEl);
  postProcessTimeline(svgEl);
}
