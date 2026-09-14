// Mermaid theme + renderer config, ported verbatim from NewMax's shipped
// renderer bundle (app.asar → out/renderer/assets/walletStore-BwxxPnpb.js,
// `getMermaidThemeVars` / `getMermaidConfig`). Keep the palettes and the ELK
// layout options byte-for-byte in sync with NewMax; they are what make the
// diagrams look identical.

export type MermaidThemeVars = Record<string, string>;

export function isDarkTheme(): boolean {
  if (typeof window === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

export function getMermaidThemeVars(dark: boolean): MermaidThemeVars {
  if (dark) {
    return {
      // ── 字体 ──
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
      // ── 通用文字 ──
      textColor: '#c8ccc9',
      background: 'transparent',
      // ── Primary（主节点）── 深鼠尾草绿底 + 中绿边框
      primaryColor: '#1e2e25',
      primaryTextColor: '#b8cebe',
      primaryBorderColor: '#3d6b4d',
      mainBkg: '#1e2e25',
      nodeBorder: '#3d6b4d',
      nodeTextColor: '#b8cebe',
      // ── Secondary（决策/备选节点）── 深暖底
      secondaryColor: '#2a2520',
      secondaryTextColor: '#c8bda8',
      secondaryBorderColor: '#6b5d48',
      // ── Tertiary（子图/集群）── 深中性底
      tertiaryColor: '#242220',
      tertiaryTextColor: '#a8a5a0',
      tertiaryBorderColor: '#504c44',
      clusterBkg: '#242220',
      clusterBorder: '#504c44',
      // ── 连线 ──
      lineColor: '#a0aca5',
      // ── 边标签 ──
      edgeLabelBackground: 'transparent',
      // ── 时序图 ──
      actorBkg: '#1e2e25',
      actorBorder: '#3d6b4d',
      actorTextColor: '#b8cebe',
      actorLineColor: '#6a7870',
      signalColor: '#a0aca5',
      signalTextColor: '#c8ccc9',
      noteBkgColor: '#2a2520',
      noteTextColor: '#c8bda8',
      noteBorderColor: '#6b5d48',
      activationBkgColor: '#253028',
      activationBorderColor: '#3d6b4d',
      labelBoxBkgColor: '#242220',
      labelBoxBorderColor: '#504c44',
      labelTextColor: '#c8ccc9',
      loopTextColor: '#a8a5a0',
      // ── 饼图 ── 同色板，深色背景下中饱和度仍清晰
      pie1: '#5a8f70',
      pie2: '#c4a055',
      pie3: '#6b8fad',
      pie4: '#9b82ad',
      pie5: '#ad7e6b',
      pie6: '#5aad94',
      pie7: '#ad9e5a',
      pie8: '#ad6b82',
      pieTextColor: '#ffffff',
      pieSectionTextColor: '#ffffff',
      pieTitleTextColor: '#c8ccc9',
      pieStrokeColor: 'transparent',
      pieStrokeWidth: '1px',
      // ── 多分类色板（思维导图 / 状态图等）── 深色柔和
      cScale0: '#1e2e25',
      cScale1: '#2e2820',
      cScale2: '#1e2630',
      cScale3: '#282030',
      cScale4: '#302520',
      cScale5: '#1e3028',
      cScale6: '#302a18',
      cScale7: '#301e24',
      cScale8: '#202e22',
      cScale9: '#2e2820',
      cScale10: '#1e2430',
      cScale11: '#2e2028',
      // ── 甘特图 ──
      sectionBkgColor: '#1a1d1a',
      altSectionBkgColor: '#1e211e',
      gridColor: '#2a2d2a',
      todayLineColor: '#c76a5a',
      taskBkgColor: '#3d6b4d',
      taskBorderColor: '#2d5a3d',
      taskTextColor: '#ffffff',
      taskTextLightColor: '#ffffff',
      taskTextDarkColor: '#b8cebe',
      taskTextOutsideColor: '#a8a5a0',
      activeTaskBkgColor: '#253028',
      activeTaskBorderColor: '#3d6b4d',
      doneTaskBkgColor: '#2a352d',
      doneTaskBorderColor: '#3d4840',
      critBkgColor: '#a85545',
      critBorderColor: '#8a4438',
    };
  }
  return {
    // ── 字体 ──
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
    // ── 通用文字 ──
    textColor: '#3a3f3c',
    // ── Primary（主节点）── 浅鼠尾草绿底 + 中绿边框
    primaryColor: '#e2ede6',
    primaryTextColor: '#2c3e35',
    primaryBorderColor: '#7fa48d',
    mainBkg: '#e2ede6',
    nodeBorder: '#7fa48d',
    nodeTextColor: '#2c3e35',
    // ── Secondary（决策/备选节点）── 暖奶油底
    secondaryColor: '#f0ebe0',
    secondaryTextColor: '#3a3530',
    secondaryBorderColor: '#c4b394',
    // ── Tertiary（子图/集群）── 极浅暖灰底
    tertiaryColor: '#f5f3ee',
    tertiaryTextColor: '#5a5a5a',
    tertiaryBorderColor: '#ddd8cf',
    clusterBkg: '#f5f3ee',
    clusterBorder: '#ddd8cf',
    // ── 连线 ──
    lineColor: '#9ca8a2',
    // ── 边标签 ──
    edgeLabelBackground: '#ffffff',
    // ── 时序图 ──
    actorBkg: '#e2ede6',
    actorBorder: '#7fa48d',
    actorTextColor: '#2c3e35',
    actorLineColor: '#c5cfc9',
    signalColor: '#9ca8a2',
    signalTextColor: '#3a3f3c',
    noteBkgColor: '#f0ebe0',
    noteTextColor: '#3a3530',
    noteBorderColor: '#c4b394',
    activationBkgColor: '#d5e5da',
    activationBorderColor: '#7fa48d',
    labelBoxBkgColor: '#f5f3ee',
    labelBoxBorderColor: '#ddd8cf',
    labelTextColor: '#3a3f3c',
    loopTextColor: '#5a5a5a',
    // ── 饼图 ── 8 色和谐色板（中饱和度，白色文字）
    pie1: '#5a8f70',
    pie2: '#c4a055',
    pie3: '#6b8fad',
    pie4: '#9b82ad',
    pie5: '#ad7e6b',
    pie6: '#5aad94',
    pie7: '#ad9e5a',
    pie8: '#ad6b82',
    pieTextColor: '#ffffff',
    pieSectionTextColor: '#ffffff',
    pieTitleTextColor: '#3a3f3c',
    pieStrokeColor: '#ffffff',
    pieStrokeWidth: '2px',
    // ── 多分类色板（思维导图 / 状态图等）── 柔和低饱和
    cScale0: '#e2ede6',
    cScale1: '#f0e8d8',
    cScale2: '#dce6f0',
    cScale3: '#e8e0f0',
    cScale4: '#f0e0d8',
    cScale5: '#d8f0e8',
    cScale6: '#f0ead0',
    cScale7: '#f0dde4',
    cScale8: '#e0ede2',
    cScale9: '#ede6d8',
    cScale10: '#d8e2ed',
    cScale11: '#ede0ea',
    // ── 甘特图 ── 品牌绿任务条
    sectionBkgColor: '#fafaf7',
    altSectionBkgColor: '#ffffff',
    gridColor: '#f0f0f4',
    todayLineColor: '#c76a5a',
    taskBkgColor: '#5a8f70',
    taskBorderColor: '#4a7a60',
    taskTextColor: '#ffffff',
    taskTextLightColor: '#ffffff',
    taskTextDarkColor: '#2c3e35',
    taskTextOutsideColor: '#5a5a5a',
    activeTaskBkgColor: '#d5e5da',
    activeTaskBorderColor: '#5a8f70',
    doneTaskBkgColor: '#c8d5cd',
    doneTaskBorderColor: '#a8b8ae',
    critBkgColor: '#c76a5a',
    critBorderColor: '#a85545',
  };
}

export function getMermaidConfig(
  themeVars: MermaidThemeVars,
  dark = false,
): Record<string, unknown> {
  return {
    startOnLoad: false,
    theme: 'base',
    themeVariables: themeVars,
    // 顶层 curve：ELK 渲染器读 conf.curve，flowchart.curve 它不看
    // 设成 linear 让 ELK 输出纯 M+L 正交路径，再交给 roundEdgeCorners 后处理上圆角
    curve: 'linear',
    themeCSS: dark
      ? `
    /* 注意：边标签底色 / 节点文字居中由 getMermaidShadowCSS 统一管理，
       这里只放 mermaid themeCSS 才能影响的内部类（edgeLabel 文字色除外）。 */
    .edgeLabel span.edgeLabel { color: #a8b2ac !important; font-size: 12px !important; }
    .relationshipLabel { fill: #a8b2ac !important; }
    .timeline-main-line { stroke: #a0aca5 !important; }
    .timeline-arrow { fill: #a0aca5 !important; stroke: #a0aca5 !important; }
    line.dash-line { stroke: #6a7870 !important; }

    .mindmap-node .node-bkg { stroke-width: 1 !important; }
    .mindmap-node line[class*="node-line"] { display: none !important; }

    /* 深色模式：cluster 底色统一覆盖为接近 --ds-surface-100，
       忽略 .mmd 里 AI 硬编码的亮色 inline style，让区域块只剩淡淡的轮廓感。
       选择器同时覆盖 rect shape (.cluster rect) 与 roundedWithTitle shape
       (rect.outer / rect.inner) ——后者在 mermaid 源码里没有 "cluster" class。 */
    .cluster rect,
    rect.outer,
    rect.inner {
      fill: #191a1a !important;
      fill-opacity: 1 !important;
    }
  `
      : `
    /* 边标签底色 / 节点文字居中由 getMermaidShadowCSS 统一管理 */
    .edgeLabel span.edgeLabel { color: #b0b0b0 !important; font-size: 12px !important; }
    .relationshipLabel { fill: #b0b0b0 !important; }
    .timeline-main-line { stroke: #9ca8a2 !important; }
    .timeline-arrow { fill: #9ca8a2 !important; stroke: #9ca8a2 !important; }
    line.dash-line { stroke: #c5cfc9 !important; }

    .mindmap-node .node-bkg { stroke-width: 1 !important; }
    .mindmap-node line[class*="node-line"] { display: none !important; }

    /* 浅色模式：cluster 底色统一为 --ds-surface-200 (#faf9f5)，
       同样忽略 .mmd 里 AI 硬编码的亮色 inline style。 */
    .cluster rect,
    rect.outer,
    rect.inner {
      fill: #faf9f5 !important;
      fill-opacity: 1 !important;
    }
  `,
    layout: 'elk',
    elk: {
      mergeEdges: true,
      nodePlacementStrategy: 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.edgeEdge': 18,
      // 加大层间通道高度，让 routing channel 里相邻拐角的共享段足够长，
      // 避免 buildRoundedPath 因 len/2 clamp 把圆角压成小直角
      'elk.layered.spacing.nodeNodeBetweenLayers': 80,
      'elk.layered.spacing.edgeNodeBetweenLayers': 40,
      'elk.layered.spacing.edgeEdgeBetweenLayers': 18,
    },
    flowchart: {
      curve: 'linear',
      padding: 16,
      nodeSpacing: 60,
      rankSpacing: 60,
      diagramPadding: 24,
      htmlLabels: true,
      useMaxWidth: true,
    },
    class: {
      curve: 'linear',
      htmlLabels: true,
    },
    state: {
      curve: 'linear',
      htmlLabels: true,
    },
    er: {
      curve: 'linear',
    },
    gantt: {
      useWidth: undefined,
      barHeight: 22,
      barGap: 6,
      topPadding: 56,
      bottomPadding: 2,
      sectionFontSize: 13,
      numberSectionStyles: 4,
      fontSize: 12,
      rightPadding: 20,
      leftPadding: 100,
    },
    mindmap: {
      useMaxWidth: false,
      padding: 20,
      maxNodeWidth: 300,
    },
  };
}

export function getMermaidExportConfig(dark = false): Record<string, unknown> {
  return getMermaidConfig(getMermaidThemeVars(dark), dark);
}
