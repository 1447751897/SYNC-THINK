// Shadow-DOM stylesheet for rendered mermaid SVGs, ported verbatim from
// NewMax's shipped renderer bundle (`getMermaidShadowCSS`).
//
// Only the CSS custom properties are remapped to SYNC-THINK's token contract:
//   --ds-text-primary   → --color-text
//   --ds-text-secondary → --color-text-secondary
//   --ds-text-tertiary  → --color-text-faint
//   --ds-surface-100    → --color-chat   (the chat canvas behind a diagram)
//   --ds-on-surface     → --color-border-strong
//   hsl(var(--background)) → var(--color-chat)
import { MERMAID_TRANSPARENT_CHART_BACKGROUND_CSS } from './mermaid-post-process.js';

export function getMermaidShadowCSS(dark: boolean): string {
  const colors = dark
    ? {
        // 边标签底色：用 CSS 变量跟 chat 实际背景色对齐，主题切换自动跟随。
        edgeLabelBg: 'var(--color-chat)',
        messageText: '#c8ccc9',
        tickText: '#6a7670',
        tickLine: '#2a2d2a',
        domain: '#3a3d3a',
        titleText: '#b8cebe',
        sectionTitle: '#a8a5a0',
      }
    : {
        edgeLabelBg: 'var(--color-chat)',
        messageText: '#3a3f3c',
        tickText: '#9ca8a2',
        tickLine: '#e8e8ec',
        domain: '#e0e0e4',
        titleText: '#2c3e35',
        sectionTitle: '#5a5a5a',
      };
  return `
      :host {
        display: block;
        width: 100%;
        overflow-x: auto;
      }
      svg {
        max-width: 100%;
        height: auto;
        display: block;
      }

      ${MERMAID_TRANSPARENT_CHART_BACKGROUND_CSS}

      /* ── 通用：节点圆角 ── */
      .node rect,
      .node polygon,
      .basic.label-container {
        rx: 8 !important;
        ry: 8 !important;
      }
      .node polygon[points] {
        rx: 0 !important;
        ry: 0 !important;
      }

      /* ── 节点底/边/文字：对齐 DS token，跟 chat 卡片基调融合并随主题切换自动跟随。
         不动 mermaid 的 themeVariables（保留 gantt/pie 等其他图表色板）。
         注意覆盖 stadium / round 等把 path 包在 .label-container 里的形状。 */
      .node > rect,
      .node > polygon,
      .node > circle,
      .node > ellipse,
      .node > path,
      .node > .label-container,
      .node > .label-container > rect,
      .node > .label-container > polygon,
      .node > .label-container > circle,
      .node > .label-container > ellipse,
      .node > .label-container > path {
        fill: color-mix(in srgb, var(--color-text) 5%, var(--color-chat)) !important;
        stroke: var(--color-border-strong) !important;
        stroke-width: 1 !important;
      }
      .node .nodeLabel,
      .node .nodeLabel p,
      .node .nodeLabel span {
        color: var(--color-text) !important;
      }
      .node text {
        fill: var(--color-text) !important;
      }
      /* 连线：用 color-mix 把"text 30%"提前混进 surface 底色，
         得到等效灰但完全不透明，避免两条线交叠时半透明叠加变深。
         箭头 marker 的颜色由 unifyArrowMarkers() 用 getComputedStyle 同步取这个值，
         保证箭头跟连线像素级同色。 */
      .flowchart-link,
      path.flowchart-link,
      path[class*="edge-thickness"] {
        stroke: color-mix(in srgb, var(--color-text) 30%, var(--color-chat)) !important;
      }

      /* ── 通用：节点文字 ── */
      .nodeLabel,
      .node .label,
      .node text {
        font-weight: 500 !important;
        font-size: 13px !important;
      }
      /* 节点 label 在 foreignObject 内 flex 居中。
         背景：mermaid 在临时 measureEl 里测 label 尺寸用浏览器默认字号（16px），
         实际渲染在 Shadow DOM 里被强制 13px —— foreignObject 容器按测量值偏大，
         若不让内部 flex 撑满，文字就会落在容器左上角。
         同时禁掉 break-all：中英混排时不在英文词内拆字（避免"skill"被拆成 s+kill）。 */
      .node .label foreignObject {
        overflow: visible !important;
      }
      .node .label foreignObject > div {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 100% !important;
        height: 100% !important;
        text-align: center !important;
        word-break: keep-all !important;
        overflow-wrap: normal !important;
      }
      .node .nodeLabel {
        display: inline-block !important;
        text-align: center !important;
        word-break: keep-all !important;
        overflow-wrap: normal !important;
      }
      .node .nodeLabel p {
        text-align: center !important;
      }

      /* ── 连线标签：用 text-faint，跟 export 路径同源 ── */
      .edgeLabel {
        font-size: 12px !important;
        font-weight: 400 !important;
        color: var(--color-text-faint) !important;
      }
      .edgeLabel .label foreignObject {
        overflow: visible !important;
      }
      .edgeLabel .label foreignObject > div {
        text-align: center !important;
      }
      .edgeLabel span {
        color: var(--color-text-faint) !important;
      }
      /* 边标签背景：rect 走 SVG fill；foreignObject 里的 .labelBkg 走 HTML background。
         两种渲染路径 mermaid 会用其中一种，保险起见都设上。 */
      .edgeLabel rect {
        fill: ${colors.edgeLabelBg} !important;
        stroke: none !important;
        rx: 8 !important;
        ry: 8 !important;
      }
      .edgeLabel .labelBkg {
        background: ${colors.edgeLabelBg} !important;
      }

      /* ── 通用：子图/集群 ── */
      .cluster rect {
        rx: 12 !important;
        ry: 12 !important;
        stroke-width: 1 !important;
      }
      .cluster .nodeLabel,
      .cluster span {
        font-weight: 600 !important;
        font-size: 13px !important;
        color: var(--color-text-secondary) !important;
        fill: var(--color-text-secondary) !important;
      }

      /* ── 通用：箭头和连线 ── */
      .flowchart-link,
      path.flowchart-link,
      path[class*="edge-thickness"] {
        stroke-width: 1.5 !important;
        stroke-linejoin: round !important;
        stroke-linecap: round !important;
        fill: none !important;
      }

      /* ── 时序图 ── */
      .actor {
        rx: 8 !important;
        ry: 8 !important;
        stroke-width: 1.5 !important;
      }
      text.actor > tspan {
        font-weight: 600 !important;
        font-size: 13px !important;
      }
      .messageLine0,
      .messageLine1 {
        stroke-width: 1.5 !important;
      }
      .messageText {
        font-size: 12px !important;
        fill: ${colors.messageText} !important;
      }
      .note {
        rx: 8 !important;
        ry: 8 !important;
        stroke-width: 1 !important;
      }
      .loopLine {
        stroke-width: 1 !important;
        stroke-dasharray: 6 4 !important;
      }

      /* ── 类图 ── */
      .classGroup rect {
        rx: 8 !important;
        ry: 8 !important;
        stroke-width: 1.5 !important;
      }
      .classGroup text {
        font-size: 12px !important;
      }
      .classLabel .label {
        font-weight: 600 !important;
        font-size: 13px !important;
      }
      .relation {
        stroke-width: 1.5 !important;
      }

      /* ── 状态图 ── */
      .stateGroup rect,
      .stateGroup .composit {
        rx: 8 !important;
        ry: 8 !important;
      }
      .stateGroup text {
        font-size: 12px !important;
        font-weight: 500 !important;
      }
      .transition {
        stroke-width: 1.5 !important;
      }

      /* ── ER 图 ── */
      .er.entityBox {
        rx: 8 !important;
        ry: 8 !important;
        stroke-width: 1.5 !important;
      }
      .er.entityLabel {
        font-weight: 600 !important;
        font-size: 13px !important;
      }
      .er.attributeBoxEven,
      .er.attributeBoxOdd {
        stroke-width: 1 !important;
      }

      /* ── 思维导图（border/线条样式由 themeCSS 控制，此处仅补充 Shadow DOM 内的覆盖） ── */
      .mindmap-node foreignObject > div,
      .timeline-node foreignObject > div {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 100% !important;
      }
      .mindmap-node .nodeLabel {
        font-size: 13px !important;
        font-weight: 500 !important;
      }

      /* ── Git 图 ── */
      .commit-id text {
        font-size: 11px !important;
      }
      .branch-label text {
        font-weight: 600 !important;
      }

      /* ── 甘特图 ── */
      .tick text {
        transform: translateY(8px);
        fill: ${colors.tickText} !important;
        font-size: 11px;
      }
      .task {
        stroke-width: 1 !important;
        rx: 6 !important;
        ry: 6 !important;
      }
      .taskText,
      .taskTextOutsideRight,
      .taskTextOutsideLeft {
        font-weight: 500 !important;
      }
      .tick line,
      .grid .tick line {
        stroke: ${colors.tickLine} !important;
      }
      .domain {
        stroke: ${colors.domain} !important;
      }
      .titleText {
        fill: ${colors.titleText} !important;
        font-weight: 600 !important;
      }
      .sectionTitle {
        fill: ${colors.sectionTitle} !important;
      }
      .tick text.today-tick-text {
        fill: #ffffff !important;
        font-weight: 600 !important;
        transform: translateY(8px);
      }
  `;
}
