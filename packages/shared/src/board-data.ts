/** Data-only HTML rendering contract. Named templates retain their own layout; values map to reusable geometry. */
export const BOARD_DATA_KIT_VERSION = 'board-data-v2';
export const BOARD_DATA_TYPES = {
  table: 'table',
  'data-table': 'table',
  'data-grid': 'table',
  stats: 'stats',
  'stat-cards': 'stats',
  card: 'stats',
  line: 'line',
  'line-chart-card': 'line',
  'revenue-chart-card': 'line',
  area: 'area',
  'area-chart-card': 'area',
  bar: 'bar',
  'orders-chart-card': 'bar',
  'earnings-chart-card': 'bar',
  'steps-card': 'bar',
  'most-active-days-card': 'bar',
  'bar-list': 'bar-list',
  'bar-list-card': 'bar-list',
  combo: 'combo',
  'combo-chart-card': 'combo',
  donut: 'donut',
  pie: 'donut',
  radial: 'donut',
  'radial-chart-card': 'donut',
  radar: 'radar',
  'radar-chart-card': 'radar',
  scatter: 'scatter',
  'scatter-chart-card': 'scatter',
  funnel: 'funnel',
  'funnel-chart-card': 'funnel',
  heatmap: 'heatmap',
  'heatmap-chart-card': 'heatmap',
  contributions: 'heatmap',
  'contributions-card': 'heatmap',
  sankey: 'sankey',
  'sankey-chart-card': 'sankey',
  rings: 'rings',
  'activity-rings-card': 'rings',
  gauge: 'gauge',
  'sleep-score-card': 'gauge',
  stages: 'stages',
  'stage-bars-card': 'stages',
} as const;
export type BoardDataType = keyof typeof BOARD_DATA_TYPES;
export interface BoardDataSeries {
  key: string;
  label: string;
  type?: 'line' | 'bar';
  axis?: 'left' | 'right';
  unit?: string;
  format?: 'number' | 'percent' | 'currency';
  currency?: string;
}
export interface BoardDataColumn {
  key: string;
  label: string;
  format?: 'text' | 'number' | 'percent' | 'currency';
  currency?: string;
  unit?: string;
  sortable?: boolean;
  cell?: 'text' | 'number' | 'badge' | 'select' | 'progress' | 'boolean' | 'avatar' | 'date';
  editable?: boolean;
  filterable?: boolean;
  options?: string[];
  width?: number;
  min?: number;
  max?: number;
  aggregate?: 'sum' | 'avg' | 'count' | 'min' | 'max';
}
export interface BoardDataComponent {
  type: BoardDataType;
  title: string;
  description?: string;
  source?: string;
  timeRange?: string;
  unit?: string;
  xLabel?: string;
  yLabel?: string;
  rightLabel?: string;
  labelKey?: string;
  series?: BoardDataSeries[];
  data?: Record<string, unknown>[];
  columns?: BoardDataColumn[];
  rows?: Record<string, unknown>[];
  items?: Array<{
    label: string;
    value: number | string;
    delta?: number | string;
    deltaColor?: 'lime' | 'rose' | 'neutral';
    description?: string;
    target?: number;
    icon?: 'users' | 'orders' | 'views' | 'revenue' | 'trend';
    tone?: 'blue' | 'orange' | 'purple' | 'pink' | 'sky' | 'emerald';
    caption?: string;
    hint?: string;
    format?: 'number' | 'percent' | 'currency';
    currency?: string;
    unit?: string;
  }>;
  format?: 'number' | 'percent' | 'currency';
  currency?: string;
  variant?:
    | 'plain'
    | 'footer'
    | 'rings'
    | 'labels'
    | 'grid'
    | 'gauge'
    | 'solid'
    | 'stacked'
    | 'percent'
    | 'overlap'
    | 'filled'
    | 'dotted'
    | 'lines'
    | 'score';
  tiles?: boolean;
  editable?: boolean;
  rowLabel?: string;
  target?: number;
  metrics?: Array<{ label: string; value: number | string; unit?: string }>;
  showTitle?: boolean;
  showData?: boolean;
  domain?: [number, number];
  ticks?: number[];
  previous?: number;
  previousLabel?: string;
  hoverPreviousLabel?: string;
  interactive?: boolean;
  pageSize?: number;
  value?: number | string;
  delta?: number | string;
  max?: number;
  shape?: 'smooth' | 'sharp';
  stacked?: boolean;
  periods?: Array<{
    label: string;
    data: Record<string, unknown>[];
    items?: Array<{ label: string; value: number; target?: number; unit?: string }>;
    max?: number;
    value?: number;
    delta?: number;
    timeRange?: string;
  }>;
  nodes?: Array<{ id: string; label: string }>;
  links?: Array<{ source: string; target: string; value: number }>;
}
export interface BoardDataDocument {
  version?: 1;
  title?: string;
  description?: string;
  source?: string;
  timeRange?: string;
  components: BoardDataComponent[];
}

export const BOARD_DATA_OUTPUT_CONTRACT = [
  'Data display preference (SYNC-THINK local BoardUI data components):',
  '- For ordinary data inspection, comparisons, tables, trends, bar charts, KPI/stat cards or dashboards, use the built-in BoardUI components below as the default, including local/generated HTML files. Do not invent a new visual design for each answer. This is a visual default, not a requirement to convert all prose to HTML; explicit user formats, custom designs, Markdown/CSV/Excel/PPT requests take precedence.',
  '- Separate data blocks: use one component per small html fence (a related stats group may share a fence). Keep interpretation between blocks. Never pack multiple charts/tables into one authored scrolling dashboard, fixed-height wrapper, iframe, or custom CSS layout. Existing components arrays are automatically split by the host into independent inline blocks; the main chat owns vertical scrolling. Long tables use built-in pagination, not a tall inner scroll pane.',
  '- Only explicit webpage/UI design requests may use a custom authored layout. Mark a deliberate designed page with data-boardui-layout="custom" on its html or main element to preserve that layout; do not set this for ordinary data inspection.',
  '- The host injects the local styles and renderer into both html fences and saved inline HTML visualizations. Use a <script type="application/json" data-boardui> block containing JSON DATA only. No npm install, external React/Recharts, CDN, script src, iframe or remote CSS is needed. Authored executable scripts are stripped in fenced previews; interaction comes from the trusted built-in renderer.',
  '- Payload: {"version":1,"title":"Data overview","source":"exact source, or clearly labelled example data","timeRange":"actual time range","components":[...]}. Each component requires type and a specific title. JSON must be valid; escape the less-than sign as a JSON Unicode escape inside string values. A data-boardui attribute containing escaped JSON is also supported.',
  '- Cartesian charts: {"type":"line","title":"Daily visits","xLabel":"Date","yLabel":"Visits","unit":"visits","series":[{"key":"visits","label":"Visits"}],"data":[{"label":"2026-10-01","visits":120},{"label":"2026-10-02","visits":180}]}. Supported types: line, area, bar, combo (series.type=line/bar, optional axis=right for different units), scatter (data has x,y, optional series/label), radar (same series/data shape). Gaps are null, not invented zeros. shape=sharp is available; bars may be stacked.',
  '- Tables: {"type":"table","title":"Products","columns":[{"key":"name","label":"Product"},{"key":"price","label":"Price","format":"number","unit":"CNY"}],"rows":[{"name":"Example product","price":99}]}. Local search, sorting, pagination and CSV export are built in. Percent format expects a fraction (0.25=25%); use number+unit=% for percentage values already expressed as 25.',
  '- Cards: {"type":"stats","title":"Summary","items":[{"label":"Views","value":180,"delta":9.4,"description":"vs previous period"}]}. Stats items and chart headlines support format=percent (fraction, 0.25=25%). Optional value/delta on chart cards must come from the given data; never fabricate a headline or improvement.',
  '- Presentation is fixed to the measured BoardUI templates: line/area cards use a 329px lime curve frame and hover headline with a pulsing point; bar cards use a 344px indigo comparison frame; stats use the 132px plain card with an icon. Do not add custom CSS, fake periods, decorative totals or extra card footers. Source/time range is shown outside the card. showData=true opts into a separate data disclosure.',
  '- Stats can explicitly use variant=footer (198px, tinted icon, display value and comparison band); item icon=users/orders/views/revenue/trend, tone=blue/orange/purple/pink/sky/emerald, caption and hint are supported. deltaColor=lime/rose/neutral selects the comparison tone. format=currency with currency=USD/CNY/etc formats both values and chart ticks. Only provide value, previous or delta when backed by the source data.',
  '- Named catalog templates (use these for faithful BoardUI layouts): activity-rings-card, area-chart-card, bar-list-card, combo-chart-card, contributions-card, earnings-chart-card, funnel-chart-card, heatmap-chart-card, line-chart-card, most-active-days-card, orders-chart-card, radar-chart-card, radial-chart-card, revenue-chart-card, sankey-chart-card, scatter-chart-card, sleep-score-card, stage-bars-card, steps-card, data-grid, data-table, stat-cards. Prefer these exact named types in new responses. Generic types remain compatible but do not select a named template.',
  '- data-grid is an editable spreadsheet, not a data-table alias. columns support cell:text|number|badge|select|progress|boolean|avatar|date, editable, filterable, options, width, aggregate:sum|avg|count|min|max, min/max. Editing is preview/session-local, not persisted to source files. Progress values are fractions. data-table provides selection, filters, status chips, row actions and pagination. Use pageSize to bound long lists.',
  '- most-active-days-card uses data:[{date:YYYY-MM-DD,value,target}] or per-day items:[{label,value,target,unit}] to show mini goal rings on a calendar; never use fake dates. contributions-card uses date/value daily intensity data (missing days remain missing, not zero); split years. activity-rings-card uses items label/value/target; sleep-score-card uses value/max and optional items sub-scores with target. radial-chart-card uses label/value/max rings, not a donut; variants rings|labels|grid|gauge|solid|stacked. area-chart-card supports stacked, overlap, percent. tiles:false suppresses metric tiles when explicitly desired. Funnel and stage-bars use the same label/value stage data but different layouts. Avoid numeric strings for charts; format/currency control display only. CNY currency renders ¥, and stat icon may be users|orders|views|revenue|trend.',
  '- Other types: bar-list, donut/pie, funnel, stages use data:[{label,value}]; heatmap uses data:[{row,column,value}] (contributions-card also accepts date/value); rings uses items:[{label,value,target,unit}]; gauge uses value/max; sankey uses nodes:[{id,label}] and links:[{source,target,value}]. BoardUI component names such as line-chart-card, orders-chart-card, revenue-chart-card, stat-cards and data-table are accepted aliases.',
  '- Optional periods:[{label,data,value,delta,timeRange}] creates a working local period switcher using the supplied datasets, never simulated or fetched data. Include axis units, series names, exact source and time range. Mark demonstrations as example data. Missing data is missing; do not populate an empty chart with guessed values. Put a short interpretation outside the HTML when useful.',
].join('\n');

/** Embed JSON as inert data without letting user strings close the script element. */
export function boardDataHtml(data: BoardDataDocument | BoardDataComponent): string {
  const json = JSON.stringify(data)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
  return '<script type="application/json" data-boardui>' + json + '</script>';
}
