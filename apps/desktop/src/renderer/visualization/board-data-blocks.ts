import { BOARD_DATA_TYPES } from '@sync-think/shared';

export interface BoardDataBlockGroup {
  title?: string;
  description?: string;
  source?: string;
  timeRange?: string;
  blocks: string[];
}

/** Re-embed data as an escaped attribute, never as authored HTML or executable JS. */
function markerSource(raw: string): string {
  const marker = document.createElement('div');
  marker.setAttribute('data-boardui', raw);
  return marker.outerHTML;
}
function label(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Split old multi-component data documents too; explicit page designs opt out. */
export function splitBoardDataBlocks(source: string): BoardDataBlockGroup[] | null {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  if (doc.querySelector('[data-boardui-layout="custom"]')) return null;
  const markers = [
    ...doc.querySelectorAll(
      'script[type="application/json"][data-boardui],div[data-boardui],section[data-boardui],main[data-boardui]',
    ),
  ];
  if (markers.length > 32) throw new Error('数据块超过 32 个，请分批展示。');
  let total = 0;
  return markers.map((marker) => {
    const raw =
      marker.tagName === 'SCRIPT'
        ? marker.textContent || ''
        : marker.getAttribute('data-boardui') || marker.textContent || '';
    const fallback = () => {
      if (++total > 32) throw new Error('数据块超过 32 个，请分批展示。');
      return { blocks: [markerSource(raw)] };
    };
    // Leave invalid, oversized and future-version payloads to the bounded renderer error.
    if (raw.length > 1048576) return fallback();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return fallback();
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback();
    const data = value as Record<string, unknown>;
    if (data.version !== undefined && data.version !== 1) return fallback();
    if (!Array.isArray(data.components) || !data.components.length) {
      return fallback();
    }
    total += data.components.length;
    if (total > 32) throw new Error('数据块超过 32 个，请分批展示。');
    return {
      title: label(data.title),
      description: label(data.description),
      source: label(data.source),
      timeRange: label(data.timeRange),
      blocks: data.components.map((component) =>
        markerSource(JSON.stringify({ version: 1, components: [component] })),
      ),
    };
  });
}

/** Reserve a useful first-paint size instead of a 420px blank for every small KPI. */
export function boardDataBlockInitialHeight(source: string, mobile = false): number {
  try {
    const raw =
      new DOMParser()
        .parseFromString(source, 'text/html')
        .querySelector('[data-boardui]')
        ?.getAttribute('data-boardui') || '';
    if (raw.length > 1048576) return 420;
    const data = JSON.parse(raw);
    const config = Array.isArray(data?.components) ? data.components[0] : data;
    const type = BOARD_DATA_TYPES[config?.type as keyof typeof BOARD_DATA_TYPES];
    const caption = config?.source || config?.timeRange || config?.unit ? 24 : 0;
    if (
      type === 'stats' &&
      Array.isArray(config.items) &&
      config.items.length &&
      config.items.length <= 12
    ) {
      const count = config.items.length;
      const columns = Math.min(mobile ? 2 : 4, count);
      const rows = Math.ceil(count / columns);
      return (
        rows * (config.variant === 'footer' ? 198 : 132) +
        (rows - 1) * 16 +
        (config.showTitle === true ? 36 : 0) +
        caption +
        16
      );
    }
    const namedHeights: Record<string, number> = {
      'activity-rings-card': 330,
      'area-chart-card': 365,
      'bar-list-card': 177,
      'combo-chart-card': 365,
      'contributions-card': 337,
      'earnings-chart-card': 329,
      'funnel-chart-card': 329,
      'heatmap-chart-card': 329,
      'line-chart-card': 329,
      'most-active-days-card': 330,
      'orders-chart-card': 344,
      'radar-chart-card': 465,
      'radial-chart-card': 465,
      'revenue-chart-card': 344,
      'sankey-chart-card': 480,
      'scatter-chart-card': 397,
      'sleep-score-card': 330,
      'stage-bars-card': 430,
      'steps-card': 330,
    };
    const named = namedHeights[config?.type];
    if (named) return named + caption + 16;
    if (type === 'line' || type === 'area') return 329 + caption + 16;
    if (type === 'bar') return 344 + caption + 16;
  } catch {
    /* Invalid data is displayed by the trusted renderer, not hidden here. */
  }
  return 420;
}
