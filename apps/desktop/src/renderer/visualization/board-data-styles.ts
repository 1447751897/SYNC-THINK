import { BOARD_DATA_CATALOG_STYLES } from './board-data-catalog-styles.js';
import { boardDataFontDataUrl } from './board-data-font-loader.js';

/** Measured against the public BoardUI previews; theme tokens stay scoped to data surfaces. */
export const BOARD_DATA_STYLES =
  `
body:has(.bd-root),body:has(.board-table) { overflow-y:auto; overflow-x:hidden; }
:root { --bd-blue:#2b7fff; --bd-purple:#c27aff; --bd-green:#9ae600; --bd-yellow:#ffdf20; --bd-cyan:#00bcff; --bd-pink:#fb51b8; --bd-surface:#f7f7f7; --bd-inner:#fff; --bd-selected:#fff; --bd-stat-icon:#fff; --bd-text:#0a0a0a; --bd-muted:#737373; --bd-tertiary:#a3a3a3; --bd-border:#ebebeb; --bd-track:#ebebeb; --bd-line-ink:#7ccf00; --bd-line-area:#9ae600; --bd-bar-ink:#615fff; --bd-neutral:#d4d4d4; --bd-positive-bg:#d8f999; --bd-positive-text:#3c6300; --bd-negative-bg:#ffccd3; --bd-negative-text:#a50036; }
html[data-theme='dark'] { --bd-surface:#171717; --bd-inner:rgb(38 38 38 / .6); --bd-selected:#262626; --bd-stat-icon:#262626; --bd-text:#fafafa; --bd-muted:#737373; --bd-tertiary:#525252; --bd-border:#262626; --bd-track:#262626; --bd-neutral:#262626; --bd-positive-bg:rgb(25 47 3 / .6); --bd-positive-text:#7ccf00; --bd-negative-bg:rgb(77 2 23 / .6); --bd-negative-text:#ff2056; }
.bd-root { color:var(--bd-text); font-family:BoardDataInter,Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif; font-size:14px; line-height:20px; min-width:0; width:100%; font-synthesis:none; -webkit-font-smoothing:antialiased; }
.bd-root *, .bd-root *::before, .bd-root *::after { box-sizing:border-box; }
.bd-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.bd-plot svg .bd-x-tick { font-size:13px; }
.bd-intro { margin:0 0 20px; }
.bd-intro h2 { font-size:20px; font-weight:600; line-height:1.4; margin:0 0 6px; letter-spacing:-.025em; }
.bd-intro p,.bd-caption { color:var(--bd-muted); font-size:12px; margin:4px 0 0; overflow-wrap:anywhere; }
.bd-dashboard { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr)); gap:16px; align-items:start; }
.bd-component { min-width:0; }
.bd-card { min-width:0; padding:16px; border-radius:16px; background:var(--bd-surface); overflow:hidden; filter:blur(0px); }
.bd-card[data-frame='cartesian'] { height:329px; padding:16px 16px 12px; display:flex; flex-direction:column; gap:24px; }
.bd-card[data-frame='cartesian'][data-component='bar'] { height:344px; }
.bd-header { display:flex; gap:2px; align-items:flex-start; justify-content:space-between; margin-bottom:20px; }
.bd-header > div { min-width:0; }
.bd-card[data-frame='cartesian'] .bd-header { margin:0; flex-shrink:0; }
.bd-identity { flex:1; }
.bd-title { margin:0; font-size:14px; font-weight:500; line-height:20px; color:var(--bd-muted); overflow-wrap:anywhere; }
.bd-headline { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:2px; }
.bd-value { font-size:24px; font-weight:500; line-height:34px; font-variant-numeric:tabular-nums; letter-spacing:normal; overflow-wrap:anywhere; }
.bd-delta { display:inline-flex; align-items:center; justify-content:center; border-radius:6px; padding:2px 6px; font-size:14px; line-height:20px; font-weight:500; color:var(--bd-muted); background:var(--bd-track); white-space:nowrap; }
.bd-delta[data-direction='up'] { background:var(--bd-positive-bg); color:var(--bd-positive-text); }
.bd-delta[data-direction='down'] { background:var(--bd-negative-bg); color:var(--bd-negative-text); }
.bd-periods { position:relative; display:flex; flex-wrap:wrap; gap:2px; padding:4px; border-radius:10px; background:var(--bd-surface); flex-shrink:0; }
.bd-root button,.bd-root input { font:inherit; }
.bd-periods button { position:relative; z-index:1; padding:4px 10px; line-height:20px; background:transparent; color:var(--bd-muted); border:0; border-radius:6px; font-size:14px; cursor:pointer; transition:color .2s ease; }
.bd-periods button[aria-pressed='true'] { color:var(--bd-text); font-weight:500; }
.bd-period-indicator { position:absolute; top:4px; left:0; height:28px; border-radius:6px; background:var(--bd-selected); box-shadow:0 1px 0 rgb(0 0 0 / .05); transition:transform .2s ease,width .2s ease; pointer-events:none; }
.bd-root button:focus-visible,.bd-root input:focus-visible,.bd-plot svg:focus-visible,.bd-cell:focus-visible { outline:2px solid var(--bd-blue); outline-offset:2px; }
.bd-description { margin:5px 0 0; color:var(--bd-muted); font-size:12px; overflow-wrap:anywhere; }
.bd-plot { position:relative; min-width:0; overflow-x:auto; overflow-y:hidden; }
.bd-card[data-frame="cartesian"] > .bd-plot { flex:1; min-height:0; width:100%; }
.bd-plot svg { display:block; overflow:visible; max-width:none; }
.bd-plot svg text { font-family:inherit; font-size:12px; fill:var(--bd-tertiary); font-variant-numeric:normal; }
.bd-grid-line { stroke:var(--bd-border); stroke-dasharray:3 4; stroke-width:1; }
.bd-tooltip { position:absolute; pointer-events:none; z-index:2; max-width:calc(100% - 12px); min-width:120px; padding:9px 11px; border:1px solid var(--bd-border); border-radius:9px; background:var(--ds-surface-100,#fff); color:var(--bd-text); font-size:12px; box-shadow:0 3px 10px color-mix(in srgb,var(--bd-text) 8%,transparent); }
.bd-tooltip[hidden] { display:none; }
.bd-tooltip strong { display:block; font-size:11px; margin-bottom:5px; overflow-wrap:anywhere; }
.bd-tooltip p { display:flex; align-items:center; gap:5px; margin:3px 0; }
.bd-tooltip p > span:last-child { margin-left:auto; padding-left:12px; font-variant-numeric:tabular-nums; }
.bd-legend { display:flex; flex-wrap:wrap; gap:8px 16px; font-size:12px; color:var(--bd-muted); margin:10px 0 0; }
.bd-legend-item { display:inline-flex; gap:6px; align-items:center; min-width:0; }
.bd-swatch { width:8px; height:8px; border-radius:50%; flex-shrink:0; background:var(--bd-blue); }
.bd-chart-data { margin-top:10px; font-size:12px; color:var(--bd-muted); }
.bd-chart-data summary { cursor:pointer; width:fit-content; padding:3px 0; }
.bd-chart-data .bd-table-wrap { margin-top:8px; }
.bd-stat-group { display:grid; grid-template-columns:repeat(var(--bd-stat-columns,3),minmax(0,1fr)); gap:16px; grid-column:1/-1; }
.bd-stat { height:132px; padding:16px; border-radius:16px; background:var(--bd-surface); min-width:0; display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; }
.bd-stat-icon { display:flex; align-items:center; justify-content:center; border-radius:6px; background:var(--bd-stat-icon); padding:6px; color:var(--bd-text); flex-shrink:0; }
.bd-stat-icon svg { display:block; width:20px; height:20px; }
.bd-stat .bd-title { font-size:14px; }
.bd-stat .bd-value { font-size:24px; font-variant-numeric:normal; }
.bd-stat .bd-description { font-size:12px; }
.bd-stat-identity { width:100%; }
.bd-stat-group .bd-section-heading { grid-column:1/-1; font-size:14px; font-weight:500; margin:0 0 -4px; color:var(--bd-muted); }
.bd-stat[data-variant='footer'] { height:198px; padding:8px; align-items:stretch; }
.bd-stat-top { display:flex; justify-content:space-between; align-items:flex-start; padding:8px; }
.bd-stat[data-variant='footer'] .bd-stat-icon { width:40px; height:40px; border-radius:10px; background:linear-gradient(#2b7fff,#155dfc); color:white; }
.bd-stat[data-tone='orange'] .bd-stat-icon { background:linear-gradient(#ff8904,#f54900); }
.bd-stat[data-tone='purple'] .bd-stat-icon { background:linear-gradient(#ad46ff,#9810fa); }
.bd-stat[data-tone='pink'] .bd-stat-icon { background:linear-gradient(#f6339a,#e60076); }
.bd-stat[data-tone='sky'] .bd-stat-icon { background:linear-gradient(#00bcff,#0084d1); }
.bd-stat[data-tone='emerald'] .bd-stat-icon { background:linear-gradient(#00d492,#009966); }
.bd-stat[data-variant='footer'] .bd-stat-identity { display:flex; flex-direction:column; gap:2px; padding:10px 8px 14px; }
.bd-stat[data-variant='footer'] .bd-headline { margin:0; }
.bd-stat[data-variant='footer'] .bd-value { font-size:32px; line-height:44px; font-variant-numeric:tabular-nums; }
.bd-stat-footer { margin-top:auto; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 6px 6px 10px; border-radius:10px; background:var(--bd-inner); box-shadow:0 0 0 1px rgb(0 0 0 / .02),0 1px 2px rgb(0 0 0 / .04); color:var(--bd-muted); font-size:14px; line-height:20px; }
.bd-stat-footer .bd-delta { border-radius:999px; gap:4px; padding:2px 8px 2px 4px; font-variant-numeric:tabular-nums; }
.bd-stat-footer .bd-delta svg { width:16px; height:16px; }
.bd-info { border:0; padding:0; background:none; color:var(--bd-muted); cursor:help; }
.bd-info svg { width:20px; height:20px; display:block; }
.bd-header .bd-legend { margin:0; gap:16px; font-size:12px; font-weight:500; line-height:18px; flex-shrink:0; }
.bd-previous { margin:2px 0 0; font-size:12px; font-weight:500; line-height:18px; color:var(--bd-tertiary); font-variant-numeric:tabular-nums; }
.bd-pulse { transform-box:fill-box; transform-origin:center; }
.bd-root[data-reduce-motion='false'] .bd-pulse { animation:bd-pulse 1.4s ease-out infinite; }
@keyframes bd-pulse { from { transform:scale(1); opacity:.35 } to { transform:scale(2.6); opacity:0 } }
.bd-component[data-component="table"] { grid-column:1/-1; }
.bd-table-card { grid-column:1/-1; padding:8px 0 12px; border:1px solid var(--bd-border); background:var(--bd-inner); }
.bd-table-card .bd-header { margin:0 0 8px; padding:4px 12px; align-items:center; min-height:48px; gap:12px; }
.bd-table-card .bd-title { color:var(--bd-tertiary); }
.bd-table-tools { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:0; }
.bd-search { width:180px; min-width:0; border:1px solid var(--bd-border); border-radius:8px; padding:7px 10px; color:var(--bd-text); background:var(--bd-inner); font-size:14px !important; }
.bd-button { border:1px solid var(--bd-border); border-radius:8px; padding:6px 8px; line-height:20px; font-size:14px !important; color:var(--bd-text); background:var(--bd-inner); cursor:pointer; white-space:nowrap; }
.bd-button:hover:not(:disabled) { background:var(--bd-track); }
.bd-button:disabled { opacity:.45; cursor:default; }
.bd-table-wrap { overflow-x:auto; width:100%; }
.bd-root table,.board-table { width:100%; border-collapse:collapse; font-family:BoardDataInter,Inter,ui-sans-serif,system-ui,sans-serif; font-size:14px; line-height:20px; font-weight:500; color:var(--bd-text); font-variant-numeric:normal; }
.bd-root th,.bd-root td,.board-table th,.board-table td { padding:10px 12px; text-align:left; border-bottom:1px solid var(--bd-border); vertical-align:middle; white-space:nowrap; }
.bd-root th,.board-table th { border-top:1px solid var(--bd-border); font-weight:500; color:var(--bd-tertiary); font-size:14px; background:var(--bd-surface); }
.bd-root tbody,.board-table tbody { background:var(--bd-inner); }
.bd-table-wrap { border:0; }
.bd-sort { display:inline-flex; align-items:center; gap:2px; }
.bd-sort svg { width:24px; height:24px; color:var(--bd-tertiary); transition:transform .15s ease,color .15s ease; }
.bd-sort[data-active='true'] svg { color:var(--bd-text); }
.bd-sort[data-ascending='true'] svg { transform:rotate(180deg); }
.bd-root tr:last-child td,.board-table tr:last-child td { border-bottom:0; }
.bd-root tbody tr,.board-table tbody tr { transition:background-color .15s ease; }
.bd-root tbody tr:hover,.board-table tbody tr:hover { background:var(--bd-surface); }
.bd-root th[data-align='number'],.bd-root td[data-align='number'] { text-align:right; font-variant-numeric:tabular-nums; }
.bd-sort { padding:0; border:0; background:none; color:inherit; cursor:pointer; font-size:inherit !important; }
.bd-sort span { margin-left:5px; font-size:10px; }
.bd-pagination { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; margin:16px 12px 0; font-size:14px; color:var(--bd-muted); }
.bd-pagination > div { display:flex; align-items:center; gap:8px; }
.bd-page-numbers { display:flex; align-items:center; gap:2px; }
.bd-page-number { display:flex; align-items:center; justify-content:center; width:32px; height:32px; border:1px solid transparent; border-radius:8px; background:none; color:var(--bd-muted); cursor:pointer; font-size:14px; }
.bd-page-number[aria-current='page'] { background:var(--bd-inner); border-color:var(--bd-border); color:var(--bd-text); box-shadow:0 1px 2px rgb(0 0 0 / .04); }
.bd-page-number:hover { background:var(--bd-surface); }
@media(max-width:500px) { .bd-table-card .bd-header { align-items:stretch; } .bd-table-tools { flex-wrap:nowrap; } .bd-table-tools .bd-search { flex:1; width:0; } .bd-pagination > span { width:100%; } .bd-pagination > div { width:100%; justify-content:space-between; } }

.bd-no-results { text-align:center !important; padding:24px !important; color:var(--bd-muted); }
.bd-bars { display:grid; gap:14px; }
.bd-bar-row { display:grid; grid-template-columns:minmax(70px,1fr) minmax(70px,2fr) auto; gap:12px; align-items:center; font-size:12px; }
.bd-bar-label { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.bd-bar-track { height:12px; border-radius:4px; background:var(--bd-track); position:relative; overflow:hidden; }
.bd-bar-fill { position:absolute; top:0; bottom:0; border-radius:4px; background:var(--bd-blue); }
.bd-bar-value { font-variant-numeric:tabular-nums; }
.bd-funnel { display:grid; gap:10px; }
.bd-funnel-step { display:grid; grid-template-columns:100px minmax(0,1fr) 64px; align-items:center; gap:8px; font-size:12px; }
.bd-funnel-shape { height:32px; margin:auto; border-radius:5px; background:var(--bd-blue); }
.bd-funnel-step small { color:var(--bd-muted); }
.bd-heatmap-scroll { overflow-x:auto; }
.bd-heatmap { display:grid; gap:5px; width:fit-content; align-items:center; }
.bd-heatmap-label { font-size:10px; color:var(--bd-muted); white-space:nowrap; padding-right:6px; }
.bd-cell { min-width:18px; height:22px; border-radius:4px; background:var(--bd-track); border:0; padding:0; cursor:default; }
.bd-cell[data-missing='true'] { opacity:.25; }
.bd-stage-track { display:flex; gap:3px; height:18px; border-radius:6px; overflow:hidden; margin:16px 0; }
.bd-stage { min-width:0; height:100%; }
.bd-stage-labels { display:grid; gap:8px; }
.bd-stage-labels > p { margin:0; display:flex; align-items:center; gap:6px; font-size:12px; }
.bd-stage-labels strong { margin-left:auto; font-weight:500; font-variant-numeric:tabular-nums; }
.bd-error { grid-column:1/-1; border:1px solid var(--bd-border); border-radius:12px; padding:14px 16px; background:var(--bd-surface); font-size:13px; }
.bd-error p { margin:4px 0 0; color:var(--bd-muted); font-size:12px; }
.bd-root[data-reduce-motion='false'] .bd-line { animation:bd-reveal .5s ease-out; }
@keyframes bd-reveal { from { opacity:0 } to { opacity:1 } }
@media(max-width:639px) { .bd-card[data-frame="cartesian"] .bd-header { flex-direction:column; gap:12px; } .bd-periods { padding:0; } .bd-period-indicator { top:0; } }
@media(max-width:500px) { .bd-dashboard { grid-template-columns:1fr; gap:12px; } .bd-header { flex-direction:column; gap:10px; } .bd-card,.bd-stat { padding:16px; } .bd-stat-group { grid-template-columns:repeat(var(--bd-stat-mobile-columns,2),minmax(0,1fr)); } .bd-value { font-size:24px; } .bd-funnel-step { grid-template-columns:72px minmax(0,1fr) 54px; } }
@media(prefers-reduced-motion:reduce) { .bd-root * { animation:none !important; transition:none !important; } }
` + BOARD_DATA_CATALOG_STYLES;

export function boardDataStyles(): string {
  const font = boardDataFontDataUrl();
  return (
    (font
      ? '@font-face{font-family:BoardDataInter;font-style:normal;font-weight:100 900;font-display:swap;src:url(' +
        font +
        ") format('woff2');}\n"
      : '') + BOARD_DATA_STYLES
  );
}
