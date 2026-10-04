/** Dimensions and tokens measured from BoardUI's public component previews. */
export const BOARD_DATA_CATALOG_STYLES = `
.bd-stat { min-height:132px; height:auto; gap:8px; }
.bd-stat[data-variant='footer'] { min-height:198px; height:auto; }
.bd-stat .bd-headline { row-gap:4px; }
.bd-stat .bd-value { max-width:100%; overflow-wrap:anywhere; }
.bd-stat .bd-delta { flex-shrink:0; }
.bd-card[data-template] { min-width:0; }
.bd-card[data-template='area-chart-card'],.bd-card[data-template='combo-chart-card'] { height:auto; min-height:365px; }
.bd-card[data-template='earnings-chart-card'] { height:329px; --bd-bar-ink:var(--bd-green); }
.bd-card[data-template='steps-card'] { height:330px; border-radius:20px; padding:10px; --bd-bar-ink:#00c9b5; }
.bd-card[data-template='steps-card'] .bd-header { padding:6px; }
.bd-card[data-template='scatter-chart-card'],.bd-card[data-template='radar-chart-card'],.bd-card[data-template='radial-chart-card'] { min-height:365px; }
.bd-card[data-template='sankey-chart-card'],.bd-card[data-template='funnel-chart-card'],.bd-card[data-template='heatmap-chart-card'] { min-height:329px; }
.bd-card[data-template='stage-bars-card'],.bd-card[data-template='bar-list-card'] { height:auto; }
.bd-card[data-template='activity-rings-card'],.bd-card[data-template='sleep-score-card'] { min-height:330px; border-radius:20px; padding:10px; }
.bd-card[data-template='activity-rings-card'] .bd-header,.bd-card[data-template='sleep-score-card'] .bd-header { padding:6px; margin:0; }
.bd-card[data-template='activity-rings-card'] .bd-headline { display:none; }
.bd-range { border:1px solid var(--bd-border); border-radius:8px; background:var(--bd-inner); color:var(--bd-text); font-size:12px; padding:6px 8px; max-width:180px; min-width:0; }
.bd-range-static { display:inline-flex; gap:6px; align-items:center; white-space:nowrap; }
.bd-tiles { display:grid; grid-template-columns:repeat(var(--bd-tile-cols,3),minmax(0,1fr)); gap:4px; margin-top:12px; }
.bd-metric-tile { min-width:0; display:flex; flex-direction:column; gap:2px; background:var(--bd-inner); border-radius:8px; padding:6px 8px; font-size:12px; line-height:18px; }
.bd-metric-tile strong { font-size:12px; font-weight:500; color:var(--bd-text); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.bd-tile-label { display:flex; gap:4px; align-items:center; color:var(--bd-muted); min-width:0; overflow-wrap:anywhere; }
.bd-tile-label .bd-dot { flex-shrink:0; }
.bd-activity-tiles { margin:10px 0 0; }
.bd-activity-panel { display:flex; justify-content:center; flex:1; min-height:200px; }
.bd-activity-svg { max-height:232px; width:100%; }
.bd-radial-panel { display:flex; justify-content:center; min-height:220px; }
.bd-radial-svg { width:100%; max-height:230px; }
.bd-radial-score { font-size:32px; font-weight:500; fill:var(--bd-text); }
.bd-radial-caption { font-size:12px; fill:var(--bd-muted); }
.bd-single-radial circle { r:84; }
.bd-solid-radial circle { stroke-width:22; }
.bd-radial-grid circle:first-child { stroke-dasharray:2 3; }
.bd-ring-label { font-size:8px; fill:var(--bd-muted); }
.bd-sleep-ring { display:flex; justify-content:center; min-height:175px; }
.bd-sleep-ring svg { max-height:195px; width:100%; }
.bd-sleep-metrics { display:grid; gap:4px; margin-top:8px; }
.bd-sleep-row { display:flex; align-items:center; gap:6px; border-radius:8px; background:var(--bd-inner); padding:8px; color:var(--bd-muted); font-size:12px; }
.bd-sleep-row strong { margin-left:auto; color:var(--bd-text); font-size:12px; font-weight:500; }
.bd-flow-funnel { display:flex; align-items:center; min-height:160px; flex:1; }
.bd-flow-funnel svg { display:block; width:100%; max-height:210px; }
.bd-funnel-percent { font-size:11px; fill:var(--bd-text); font-weight:600; }
[data-focus-item] { transition:opacity .15s ease,filter .15s ease; outline:none; }
[data-focus-item]:focus-visible { outline:2px solid var(--bd-blue); outline-offset:2px; }
[data-focus-item][data-dim='true'] { opacity:.35; }
.bd-stage-list { display:grid; gap:8px; margin:16px 0; }
.bd-stage-pill { display:grid; grid-template-columns:minmax(50px,auto) minmax(40px,1fr) auto 34px; align-items:center; gap:8px; color:var(--bd-muted); font-size:12px; }
.bd-stage-name { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width:110px; }
.bd-stage-pill strong { font-weight:500; color:var(--bd-text); }
.bd-stage-pill small { text-align:right; font-size:11px; }
.bd-stage-background { height:20px; border-radius:10px; overflow:hidden; background:var(--bd-track); }
.bd-stage-background i { display:block; height:100%; border-radius:10px; }
.bd-ranked-list { display:grid; gap:8px; }
.bd-ranked-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; font-size:14px; }
.bd-ranked-track { position:relative; border-radius:8px; overflow:hidden; padding:9px 10px; }
.bd-ranked-track i { position:absolute; inset:0 auto 0 0; background:color-mix(in srgb,var(--bd-blue) 15%,transparent); border-radius:8px; }
.bd-ranked-track span { position:relative; }
.bd-ranked-row strong { font-size:14px; font-weight:500; min-width:42px; text-align:right; }
.bd-expand-list { justify-self:center; border:1px solid var(--bd-border); border-radius:999px; padding:4px 12px; background:var(--bd-inner); color:var(--bd-text); cursor:pointer; font-size:12px; }
.bd-contribution-scroll { overflow-x:auto; padding:8px 0; }
.bd-contribution-grid { display:grid; grid-template-columns:repeat(var(--bd-weeks),minmax(7px,1fr)); grid-template-rows:16px repeat(7,10px); gap:3px; min-width:calc(var(--bd-weeks) * 10px); }
.bd-contribution-month { color:var(--bd-muted); font-size:10px; white-space:nowrap; }
.bd-contribution-cell { width:100%; height:10px; min-width:7px; border:0; padding:0; border-radius:2px; cursor:default; background:color-mix(in srgb,var(--bd-purple) calc(var(--bd-intensity) * 100%),var(--bd-track)); }
.bd-contribution-cell[data-missing='true'] { background:transparent; box-shadow:inset 0 0 0 1px var(--bd-track); }
.bd-card[data-template='most-active-days-card'] { border-radius:20px; min-height:330px; }
.bd-calendar-nav { display:flex; align-items:center; border:1px solid var(--bd-border); border-radius:8px; background:var(--bd-inner); }
.bd-calendar-nav button { padding:0 6px; border:0; box-shadow:none; background:transparent; }
.bd-calendar-month { font-size:12px; min-width:62px; text-align:center; }
.bd-day-calendar { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; margin-top:12px; }
.bd-day-button { display:flex; flex-direction:column; align-items:center; gap:2px; border:1px solid transparent; border-radius:8px; background:none; color:var(--bd-text); padding:4px 0; font-size:11px; cursor:pointer; }
.bd-day-button[data-selected='true'] { background:var(--bd-inner); border-color:var(--bd-blue); }
.bd-day-button:disabled { color:var(--bd-tertiary); cursor:default; }
.bd-day-ring { width:36px; height:36px; }
.bd-day-missing { height:36px; line-height:36px; }
.bd-weekday { font-size:10px; color:var(--bd-muted); text-align:center; }
.bd-stacked-area { height:221px; }
.bd-heat-legend { display:flex; gap:4px; justify-content:flex-end; align-items:center; font-size:11px; color:var(--bd-muted); padding-top:12px; }
.bd-heat-legend i { width:12px; height:12px; border-radius:3px; }
.bd-rich-toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:8px 12px 16px; }
.bd-results { margin:0; display:flex; flex-direction:column; gap:4px; font-size:14px; color:var(--bd-text); }
.bd-result-label { color:var(--bd-tertiary); font-size:14px; }
.bd-results strong { font-weight:500; }
.bd-selection-count { color:var(--bd-blue); font-size:12px; }
.bd-rich-tools { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
.bd-rich-tools .bd-button,.bd-rich-tools .bd-search { font-size:12px !important; }
.bd-column-menu { padding:8px 12px; background:var(--bd-inner); display:flex; flex-wrap:wrap; gap:12px; border-top:1px solid var(--bd-border); }
.bd-column-menu[hidden] { display:none; }
.bd-column-option { display:flex; align-items:center; gap:5px; color:var(--bd-muted); font-size:12px; }
.bd-column-filters { display:flex; flex-wrap:wrap; gap:8px; padding:0 12px 12px; }
.bd-column-filters:empty { display:none; }
.bd-select { border:1px solid var(--bd-border); border-radius:8px; padding:6px 24px 6px 8px; font-size:12px; color:var(--bd-text); background:var(--bd-inner); }
.bd-check { width:16px; height:16px; margin:0; accent-color:var(--bd-blue); }
.bd-row-selector { width:48px; min-width:48px; padding:10px 8px !important; }
.bd-row-selector small { color:var(--bd-tertiary); font-size:10px; margin-left:4px; }
.bd-grid { table-layout:fixed; min-width:max-content; }
.bd-grid td,.bd-grid th { height:38px; max-width:600px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; position:relative; border-right:1px solid var(--bd-border); }
.bd-grid .bd-frozen { position:sticky; left:0; z-index:2; background:var(--bd-inner); }
.bd-grid .bd-frozen-first { left:48px; box-shadow:1px 0 var(--bd-border); }
.bd-grid th.bd-frozen { z-index:3; background:var(--bd-surface); }
.bd-grid-card[data-density='compact'] td { height:30px; padding-top:5px; padding-bottom:5px; }
.bd-grid [data-range='true'] { background:color-mix(in srgb,var(--bd-blue) 10%,var(--bd-inner)); box-shadow:inset 0 0 0 1px var(--bd-blue); }
.bd-grid td:focus-visible { outline:2px solid var(--bd-blue); outline-offset:-2px; }
.bd-column-resize { position:absolute; right:0; top:0; bottom:0; width:7px; cursor:col-resize; touch-action:none; }
.bd-column-resize:hover,.bd-column-resize:focus-visible { background:color-mix(in srgb,var(--bd-blue) 20%,transparent); }
.bd-cell-editor { width:100%; min-width:0; border:1px solid var(--bd-blue); border-radius:4px; outline:none; padding:3px 4px; background:var(--bd-inner); color:var(--bd-text); font:inherit; }
.bd-cell-editor[aria-invalid='true'] { border-color:#fb7185; }
.bd-grid-summary td { background:var(--bd-surface); color:var(--bd-muted); font-size:12px; border-top:1px solid var(--bd-border); }
.bd-edit-status { min-height:0; font-size:12px; padding:0 12px; color:var(--bd-muted); margin:8px 0 0; }
.bd-edit-status:empty { display:none; }
.bd-cell-progress { display:inline-block; width:48px; height:6px; border-radius:3px; overflow:hidden; background:var(--bd-track); margin-left:6px; vertical-align:middle; }
.bd-cell-progress i { display:block; height:100%; background:var(--bd-green); }
.bd-status-chip { display:inline-flex; padding:2px 8px; border-radius:6px; font-size:12px; color:var(--bd-blue); background:color-mix(in srgb,var(--bd-blue) 14%,transparent); }
.bd-status-chip[data-tone='lime'] { color:var(--bd-lime-text); background:var(--bd-lime-bg); }
.bd-status-chip[data-tone='rose'] { color:var(--bd-rose-text); background:var(--bd-rose-bg); }
.bd-status-chip[data-tone='orange'] { color:#b45309; background:#ffedd5; }
.bd-person { display:flex; align-items:center; gap:8px; }
.bd-person-avatar { border-radius:50%; width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; background:var(--bd-track); color:var(--bd-muted); font-size:10px; font-style:normal; }
.bd-row-actions { position:relative; }
.bd-row-actions summary { list-style:none; cursor:pointer; border-radius:6px; display:inline-block; padding:0 6px; }
.bd-row-actions[open] { min-width:110px; }
.bd-row-actions .bd-button { display:block; margin-top:4px; width:100%; font-size:12px !important; text-align:left; }
.bd-record-details { display:grid; grid-template-columns:minmax(90px,1fr) minmax(0,2fr); gap:8px; background:var(--bd-inner); border:1px solid var(--bd-border); border-radius:10px; margin:12px; padding:12px; font-size:12px; }
.bd-record-details dt { color:var(--bd-muted); }
.bd-record-details dd { margin:0; overflow-wrap:anywhere; }
.bd-advanced-table tr[data-selected='true'],.bd-grid tr[data-selected='true'] { background:color-mix(in srgb,var(--bd-blue) 6%,var(--bd-inner)); }
@media(max-width:500px) { .bd-rich-tools { width:100%; } .bd-rich-tools .bd-search { width:100%; } .bd-calendar-nav { align-self:flex-start; } .bd-day-ring { width:28px; height:28px; } .bd-tiles { grid-template-columns:repeat(2,minmax(0,1fr)); } .bd-activity-tiles { grid-template-columns:repeat(var(--bd-tile-cols),minmax(0,1fr)); } .bd-stage-name { max-width:66px; } .bd-card[data-template='earnings-chart-card'],.bd-card[data-template='steps-card'] { min-height:329px; height:auto; } }

/* Named card shells: each frame follows its measured public preview, not a generic alias. */
.bd-dot { display:inline-block; width:7px; height:7px; border-radius:2px; flex-shrink:0; }
.bd-tiles { grid-template-columns:repeat(60,minmax(0,1fr)); gap:8px; margin:0 -8px -4px; }
.bd-metric-tile { min-height:57px; padding:8px; gap:4px; }
.bd-tile-label { line-height:16px; font-size:12px; }
.bd-metric-tile strong { font-size:14px; line-height:20px; }
.bd-card[data-template]:not(.bd-table-card) { display:flex; flex-direction:column; gap:16px; }
.bd-card[data-template] .bd-header { margin:0; flex-shrink:0; }
.bd-card[data-template='area-chart-card'],.bd-card[data-template='combo-chart-card'] { gap:16px; }
.bd-card[data-template='area-chart-card'] .bd-plot,.bd-card[data-template='combo-chart-card'] .bd-plot { flex:none; height:196px; min-height:196px; }
.bd-card[data-template='earnings-chart-card'] { height:329px; }
.bd-card[data-template='steps-card'] { height:330px; }
.bd-card[data-template='revenue-chart-card'][data-frame] { height:344px; }
.bd-card[data-template='activity-rings-card'] { height:330px; gap:16px; }
.bd-activity-top { display:flex; flex-direction:column; gap:11px; }
.bd-card[data-template='activity-rings-card'] .bd-header { padding:6px 6px 0; }
.bd-activity-tiles { margin:0; gap:8px; }
.bd-activity-panel { min-height:0; height:200px; }
.bd-activity-svg { height:200px; width:100%; }
.bd-card[data-template='sleep-score-card'] { height:330px; }
.bd-card[data-template='sleep-score-card'] .bd-header { padding:6px 6px 0; }
.bd-sleep-ring { height:104px; min-height:104px; margin-top:-8px; flex:none; }
.bd-sleep-ring svg { height:104px; }
.bd-sleep-metrics { margin:0; gap:0; border-radius:10px; overflow:hidden; flex:1; min-height:120px; background:var(--bd-inner); }
.bd-sleep-row { border-radius:0; padding:10px 8px; border-bottom:1px solid var(--bd-border); }
.bd-sleep-row:last-child { border:0; }
.bd-card[data-template='funnel-chart-card'] { min-height:329px; }
.bd-flow-funnel { height:160px; flex:none; min-height:0; }
.bd-flow-funnel svg { height:160px; }
.bd-card[data-template='contributions-card'] { min-height:337px; gap:16px; }
.bd-contribution-scroll { margin-top:0; }
.bd-contribution-grid { grid-template-rows:16px repeat(7,12px); }
.bd-contribution-cell { height:12px; }
.bd-card[data-template='heatmap-chart-card'] { min-height:329px; }
.bd-card[data-template='heatmap-chart-card'] .bd-heatmap { gap:4px; }
.bd-card[data-template='heatmap-chart-card'] .bd-cell { height:22px; min-width:0; }
.bd-card[data-template='heatmap-chart-card'] .bd-heatmap-label { font-size:11px; }
.bd-heat-legend { padding:0; margin-top:-4px; }
.bd-card[data-template='radar-chart-card'] .bd-plot { height:231px; }
.bd-radial-panel { height:231px; min-height:0; }
.bd-radial-svg { height:231px; max-height:none; }
.bd-card[data-template='scatter-chart-card'] .bd-plot { height:196px; }
.bd-card[data-template='sankey-chart-card'] { height:480px; }
.bd-card[data-template='sankey-chart-card'] .bd-plot { flex:1; min-height:0; }
.bd-stage-list { gap:12px; margin:0; padding:8px 0; }
.bd-stage-background { height:18px; }
.bd-stage-pill { grid-template-columns:64px minmax(40px,1fr) auto 34px; }
.bd-stat-group > .bd-caption { grid-column:1/-1; }
.bd-status-chip[data-tone='lime'] { color:var(--bd-positive-text); background:var(--bd-positive-bg); }
.bd-status-chip[data-tone='rose'] { color:var(--bd-negative-text); background:var(--bd-negative-bg); }
.bd-grid .bd-row-selector { width:56px; min-width:56px; }
.bd-grid .bd-frozen-first { left:56px; }
.bd-grid td { padding-top:7px; padding-bottom:7px; }
@media(max-width:500px) { .bd-tiles { grid-template-columns:repeat(2,minmax(0,1fr)); } .bd-tiles .bd-metric-tile { grid-column:auto !important; } .bd-activity-tiles { grid-template-columns:repeat(var(--bd-tile-cols),minmax(0,1fr)); } .bd-card[data-template='activity-rings-card'],.bd-card[data-template='sleep-score-card'] { height:auto; } .bd-card[data-template='funnel-chart-card'] { height:auto; } }

.bd-card[data-template='earnings-chart-card'][data-component='bar'] { height:329px; }
.bd-card[data-template='steps-card'][data-component='bar'] { height:330px; }
.bd-list-metric { color:var(--bd-tertiary); text-transform:uppercase; letter-spacing:.05em; font-size:11px; margin-left:auto; }
.bd-card[data-template='bar-list-card'] .bd-periods { padding:0; gap:12px; overflow-x:auto; }
.bd-card[data-template='bar-list-card'] .bd-period { border-radius:0; border-bottom:1px solid transparent; padding:8px 0; }
.bd-card[data-template='bar-list-card'] .bd-period[aria-pressed='true'] { color:var(--bd-blue); border-color:var(--bd-blue); }
.bd-card[data-template='bar-list-card'] .bd-period-indicator { display:none; }
.bd-contribution-toolbar { display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--bd-muted); margin-bottom:8px; }
.bd-contribution-toolbar .bd-periods { padding:0; }
.bd-card[data-template='contributions-card'] .bd-metric-tile { flex-direction:column-reverse; min-height:60px; }
.bd-card[data-template='contributions-card'] .bd-tile-label .bd-dot { display:none; }
.bd-card[data-template='contributions-card'] .bd-metric-tile strong { font-size:20px; line-height:24px; }

.bd-card[data-template='most-active-days-card'] .bd-weekday { display:none; }
.bd-card[data-template='most-active-days-card'] .bd-day-ring { width:20px; height:20px; }
.bd-card[data-template='most-active-days-card'] .bd-day-button { gap:2px; padding:2px 0; line-height:14px; }
.bd-card[data-template='most-active-days-card'] .bd-day-calendar { margin-top:0; gap:4px; }
.bd-calendar-unit { font-size:10px; line-height:16px; color:var(--bd-muted); }
.bd-card[data-template='most-active-days-card'] .bd-headline { gap:4px; align-items:baseline; }

.bd-tiles { column-gap:0; margin-left:-12px; margin-right:-12px; }
.bd-metric-tile { margin:0 4px; }
.bd-activity-tiles { margin-left:-4px; margin-right:-4px; }

.bd-card[data-template='combo-chart-card'],.bd-card[data-template='contributions-card'],.bd-card[data-template='funnel-chart-card'],.bd-card[data-template='heatmap-chart-card'],.bd-card[data-template='radar-chart-card'],.bd-card[data-template='radial-chart-card'],.bd-card[data-template='scatter-chart-card'],.bd-card[data-template='stage-bars-card'],.bd-card[data-template='bar-list-card'] { padding-bottom:12px; }
.bd-card[data-template='heatmap-chart-card'] .bd-heatmap { gap:3px; }
.bd-ranked-track { padding:6px 10px; }
.bd-card[data-template='bar-list-card'] { min-height:177px; }
.bd-scatter-captions { display:flex; align-items:center; justify-content:space-between; font-size:12px; line-height:16px; color:var(--bd-tertiary); }
.bd-card[data-template='most-active-days-card'] .bd-headline { flex-wrap:nowrap; }

.bd-grid .bd-row-selector { padding:7px 8px !important; }
.bd-grid-card[data-density='compact'] .bd-row-selector { padding:5px 8px !important; }
.bd-grid .bd-check { vertical-align:middle; }
`;
