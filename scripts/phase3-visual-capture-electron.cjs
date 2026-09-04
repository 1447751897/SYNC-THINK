'use strict';

const { createHash } = require('node:crypto');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { app, BrowserWindow } = require('electron');

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1])
    throw new Error('phase3.visual.argument_missing:' + name);
  return process.argv[index + 1];
}

async function waitForFixture(window, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await window.webContents.executeJavaScript(
      'Boolean(document.querySelector(\'[data-phase3-ready="true"]\'))',
      true,
    );
    if (ready) {
      await window.webContents.executeJavaScript(
        'document.fonts ? document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))) : Promise.resolve()',
        true,
      );
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error('phase3.visual.fixture_timeout');
}

async function verifyTargetedFixture(window, visualCase) {
  if (visualCase.fixture === 'long-trace-open') {
    const result = await window.webContents.executeJavaScript(
      `(() => {
        const timeline = document.querySelector('[data-testid="execution-timeline"]');
        const items = timeline
          ? [...timeline.querySelectorAll(
              '[data-testid="execution-commentary-item"], [data-testid="execution-tools-item"]',
            )]
          : [];
        return {
          itemTypes: items.map((node) => node.getAttribute('data-testid')),
          visible: items.every((node) => node.getBoundingClientRect().height > 0),
          commentaryTexts: items
            .filter((node) => node.getAttribute('data-testid') === 'execution-commentary-item')
            .map((node) => node.textContent?.trim() ?? ''),
          hasStepTimes: items.some((node) => node.querySelector('time')),
          toolDisclosureStates: items
            .filter((node) => node.getAttribute('data-testid') === 'execution-tools-item')
            .map((node) => node.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')),
        };
      })()`,
      true,
    );
    const expectedTypes = [
      'execution-commentary-item',
      'execution-tools-item',
      'execution-commentary-item',
      'execution-tools-item',
    ];
    if (
      JSON.stringify(result.itemTypes) !== JSON.stringify(expectedTypes) ||
      !result.visible ||
      result.commentaryTexts.length !== 2 ||
      !result.commentaryTexts.every((text) => text.length > 0) ||
      result.hasStepTimes ||
      result.toolDisclosureStates.length !== 2 ||
      !result.toolDisclosureStates.every((state) => state === 'false')
    ) {
      throw new Error(
        'phase3.visual.execution_timeline_invalid:' + visualCase.id + ':' + JSON.stringify(result),
      );
    }
  }

  if (visualCase.fixture === 'long-trace-closed') {
    const result = await window.webContents.executeJavaScript(
      `(() => ({
        toggleExpanded: document
          .querySelector('.shell-process-group__toggle')
          ?.getAttribute('aria-expanded'),
        hasTimeline: Boolean(document.querySelector('[data-testid="execution-timeline"]')),
      }))()`,
      true,
    );
    if (result.toggleExpanded !== 'false' || result.hasTimeline) {
      throw new Error(
        'phase3.visual.execution_timeline_closed_invalid:' +
          visualCase.id +
          ':' +
          JSON.stringify(result),
      );
    }
  }

  if (visualCase.fixture === 'connection-and-code') {
    const result = await window.webContents.executeJavaScript(
      `(() => {
        const statuses = [...document.querySelectorAll('.shell-run-connection-status')];
        const code = document.querySelector('.shell-md-code');
        const viewport = document.querySelector('.shell-md-code__viewport');
        const content = document.querySelector('.shell-md-code__pre');
        return {
          statusTexts: statuses.map((node) => node.textContent?.trim()),
          statusVisible: statuses.every((node) => node.getBoundingClientRect().height > 0),
          codeClass: code?.className ?? '',
          codeVisibleHeight: viewport?.getBoundingClientRect().height ?? 0,
          codeContentHeight: content?.getBoundingClientRect().height ?? 0,
          hasEndMarker: Boolean(content?.textContent?.includes('SHORT_TEXT_BLOCK_END')),
        };
      })()`,
      true,
    );
    if (
      result.statusTexts.length !== 2 ||
      !result.statusVisible ||
      !result.statusTexts.includes('正在重新连接 4/5') ||
      !result.statusTexts.includes('正在切换备用模型：luna → gpt-5.6-sol') ||
      result.codeClass.includes('is-expandable') ||
      !result.hasEndMarker ||
      result.codeVisibleHeight + 1 < result.codeContentHeight
    ) {
      throw new Error(
        'phase3.visual.connection_code_invalid:' + visualCase.id + ':' + JSON.stringify(result),
      );
    }
  }

  if (visualCase.fixture === 'streaming-follow') {
    const startedAt = Date.now();
    let result;
    while (Date.now() - startedAt < 5000) {
      result = await window.webContents.executeJavaScript(
        `(() => {
          const fixture = document.querySelector('[data-phase3-streaming-follow]');
          const body = document.querySelector('.shell-process-group__body');
          return {
            ready: fixture?.getAttribute('data-phase3-streaming-follow') === 'ready',
            hasLatest: Boolean(body?.textContent?.includes('STREAMING_FOLLOW_LATEST')),
            distanceFromBottom: body
              ? Math.max(0, body.scrollHeight - body.scrollTop - body.clientHeight)
              : null,
          };
        })()`,
        true,
      );
      if (result.ready && result.hasLatest && result.distanceFromBottom <= 2) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    if (!result?.ready || !result.hasLatest || result.distanceFromBottom > 2) {
      throw new Error(
        'phase3.visual.streaming_follow_invalid:' + visualCase.id + ':' + JSON.stringify(result),
      );
    }
  }

  if (visualCase.fixture === 'composer-slash-open') {
    const result = await window.webContents.executeJavaScript(
      `(() => {
        const composer = document.querySelector('[data-testid="composer-slash-open"]');
        const menu = document.querySelector('[data-testid="composer-slash-open-menu"]');
        const input = composer?.querySelector('.shell-compose__input');
        const toolbar = composer?.querySelector('.shell-compose__bar');
        const plus = composer?.querySelector('.shell-compose__shortcut-plus');
        const model = composer?.querySelector('.shell-compose__model-btn');
        const send = composer?.querySelector('.shell-compose__send');
        const options = menu ? [...menu.querySelectorAll('.shell-slash-pop__item')] : [];
        const rect = (node) => node?.getBoundingClientRect();
        const composerRect = rect(composer);
        const menuRect = rect(menu);
        const inputRect = rect(input);
        const toolbarRect = rect(toolbar);
        const plusRect = rect(plus);
        const modelRect = rect(model);
        const sendRect = rect(send);
        const composerStyle = composer ? getComputedStyle(composer) : null;
        const menuStyle = menu ? getComputedStyle(menu) : null;
        const inputStyle = input ? getComputedStyle(input) : null;
        const modelStyle = model ? getComputedStyle(model) : null;
        const sendStyle = send ? getComputedStyle(send) : null;
        return {
          composer: composerRect ? {
            width: composerRect.width,
            height: composerRect.height,
            radius: composerStyle?.borderRadius,
            padding: composerStyle?.padding,
            background: composerStyle?.backgroundColor,
          } : null,
          menu: menuRect ? {
            width: menuRect.width,
            gap: composerRect ? composerRect.top - menuRect.bottom : null,
            radius: menuStyle?.borderRadius,
            padding: menuStyle?.padding,
            background: menuStyle?.backgroundColor,
          } : null,
          input: inputRect ? {
            height: inputRect.height,
            padding: inputStyle?.padding,
            fontSize: inputStyle?.fontSize,
            lineHeight: inputStyle?.lineHeight,
          } : null,
          toolbar: toolbarRect ? { height: toolbarRect.height } : null,
          controls: {
            plus: plusRect
              ? { width: plusRect.width, height: plusRect.height, left: plusRect.left }
              : null,
            model: modelRect ? {
              height: modelRect.height,
              left: modelRect.left,
              fontSize: modelStyle?.fontSize,
              lineHeight: modelStyle?.lineHeight,
            } : null,
            send: sendRect ? {
              width: sendRect.width,
              height: sendRect.height,
              left: sendRect.left,
              radius: sendStyle?.borderRadius,
            } : null,
          },
          optionHeights: options.map((option) => option.getBoundingClientRect().height),
          noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        };
      })()`,
      true,
    );
    const near = (actual, expected) =>
      typeof actual === 'number' && Math.abs(actual - expected) <= 1;
    if (
      !result.composer ||
      !near(result.composer.width, 656) ||
      !near(result.composer.height, 80) ||
      result.composer.radius !== '20px' ||
      result.composer.padding !== '0px' ||
      !result.menu ||
      !near(result.menu.width, result.composer.width) ||
      !near(result.menu.gap, 8) ||
      result.menu.radius !== '18px' ||
      result.menu.padding !== '4px' ||
      result.menu.background !== result.composer.background ||
      !result.input ||
      !near(result.input.height, 42) ||
      result.input.padding !== '12px 16px 8px' ||
      result.input.fontSize !== '14px' ||
      result.input.lineHeight !== '22px' ||
      !result.toolbar ||
      !near(result.toolbar.height, 32) ||
      !result.controls.plus ||
      !near(result.controls.plus.width, 32) ||
      !near(result.controls.plus.height, 32) ||
      !result.controls.model ||
      !near(result.controls.model.height, 32) ||
      result.controls.model.fontSize !== '13px' ||
      result.controls.model.lineHeight !== '20px' ||
      !result.controls.send ||
      !near(result.controls.send.width, 32) ||
      !near(result.controls.send.height, 32) ||
      result.controls.send.radius !== '12px' ||
      result.controls.model.left <= result.controls.plus.left ||
      result.controls.send.left <= result.controls.model.left ||
      result.optionHeights.length !== 5 ||
      result.optionHeights.some((height) => !near(height, 32)) ||
      !result.noHorizontalOverflow
    ) {
      throw new Error(
        'phase3.visual.composer_geometry_invalid:' + visualCase.id + ':' + JSON.stringify(result),
      );
    }
  }

  if (visualCase.fixture === 'task-status-panel') {
    let wallpaperSync = null;
    if (visualCase.state === 'manual-open') {
      await window.webContents.executeJavaScript(
        `(async () => {
          const startedAt = Date.now();
          while (Date.now() - startedAt < 3000) {
            const trigger = document.querySelector('.shell-task-status-mini');
            if (trigger && getComputedStyle(trigger).display !== 'none') {
              trigger.click();
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        })()`,
        true,
      );
    }
    if (visualCase.state === 'wallpaper-switch') {
      wallpaperSync = await window.webContents.executeJavaScript(
        `(async () => {
          const root = document.documentElement;
          const stage = document.querySelector('.phase3-task-status');
          const panel = document.querySelector('[data-testid="task-status-panel"]');
          const applyPalette = async (background, composer, overlay) => {
            root.dataset.imageTheme = 'active';
            root.style.setProperty('--shell-chat-composer-surface', composer);
            root.style.setProperty('--color-overlay', overlay);
            if (stage) stage.style.backgroundColor = background;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return panel ? getComputedStyle(panel).backgroundColor : '';
          };
          const first = await applyPalette('#264f43', 'rgba(22, 37, 32, 0.86)', 'rgb(38, 79, 67)');
          const second = await applyPalette('#613f55', 'rgba(43, 28, 38, 0.86)', 'rgb(97, 63, 85)');
          return {
            first,
            second,
            imageTheme: root.dataset.imageTheme,
            stageBackground: stage ? getComputedStyle(stage).backgroundColor : '',
          };
        })()`,
        true,
      );
    }
    const startedAt = Date.now();
    let result;
    while (Date.now() - startedAt < 5000) {
      result = await window.webContents.executeJavaScript(
        `(() => {
          const panel = document.querySelector('[data-testid="task-status-panel"]');
          const rect = panel?.getBoundingClientRect();
          const stage = panel?.closest('.shell-chat-message-stage');
          const stageRect = stage?.getBoundingClientRect();
          const sections = panel
            ? [...panel.querySelectorAll('[data-testid="task-status-section"]')]
            : [];
          const close = panel?.querySelector('.shell-task-status-panel__close');
          const firstStats = panel?.querySelector(
            '.shell-task-status__section:first-of-type .shell-task-status__section-trailing'
          );
          const closeRect = close?.getBoundingClientRect();
          const firstStatsRect = firstStats?.getBoundingClientRect();
          return {
            visible: Boolean(rect && rect.width > 0 && rect.height > 0),
            width: rect?.width ?? 0,
            top: rect?.top ?? 0,
            right: rect ? window.innerWidth - rect.right : 0,
            withinViewport: Boolean(
              rect && rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
            ),
            withinStage: Boolean(
              rect && stageRect && rect.top >= stageRect.top && rect.bottom <= stageRect.bottom
            ),
            sectionOrder: sections.map((section) => section.getAttribute('data-section')),
            sectionTitles: sections.map(
              (section) => section.querySelector('.shell-task-status__section-toggle span')?.textContent?.trim() ?? ''
            ),
            changesEnabled: Boolean(
              panel?.querySelector('button[aria-label^="更改 "]:not(:disabled)')
            ),
            closeStatsOverlap: Boolean(
              closeRect &&
              firstStatsRect &&
              getComputedStyle(close).display !== 'none' &&
              closeRect.left < firstStatsRect.right &&
              closeRect.right > firstStatsRect.left &&
              closeRect.top < firstStatsRect.bottom &&
              closeRect.bottom > firstStatsRect.top
            ),
            background: panel ? getComputedStyle(panel).backgroundColor : '',
            duplicateCount: document.querySelectorAll(
              '.shell-todo-panel, .shell-goal-capsule-wrap, [data-testid="process-turn-plan"]'
            ).length,
          };
        })()`,
        true,
      );
      if (result.visible && result.sectionOrder.length === 3) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    if (
      !result?.visible ||
      result.width < 300 ||
      result.width > 321 ||
      !result.withinViewport ||
      !result.withinStage ||
      JSON.stringify(result.sectionOrder) !== JSON.stringify(['git', 'goal', 'progress']) ||
      JSON.stringify(result.sectionTitles) !== JSON.stringify(['Git 工具', '目标', '任务清单']) ||
      !result.changesEnabled ||
      result.closeStatsOverlap ||
      !result.background ||
      result.background === 'rgba(0, 0, 0, 0)' ||
      result.duplicateCount !== 0
    ) {
      throw new Error(
        'phase3.visual.task_status_invalid:' + visualCase.id + ':' + JSON.stringify(result),
      );
    }
    if (
      visualCase.state === 'wallpaper-switch' &&
      (!wallpaperSync ||
        !wallpaperSync.first ||
        !wallpaperSync.second ||
        wallpaperSync.first === wallpaperSync.second ||
        wallpaperSync.imageTheme !== 'active' ||
        wallpaperSync.stageBackground !== 'rgb(97, 63, 85)')
    ) {
      throw new Error(
        'phase3.visual.task_status_wallpaper_sync_invalid:' +
          visualCase.id +
          ':' +
          JSON.stringify(wallpaperSync),
      );
    }
  }

  if (visualCase.fixture === 'workspace-file') {
    const initial = await window.webContents.executeJavaScript(
      `(() => {
        const root = document.querySelector('[data-testid="workspace-file-view"]');
        const explorer = document.querySelector('[data-testid="workspace-file-explorer"]');
        const explorerPanel = document.querySelector('.shell-workspace-files-panel');
        const preview = document.querySelector('[data-testid="file-pane-preview"]');
        const source = document.querySelector('[data-testid="file-pane-editor"]');
        const tabs = [...document.querySelectorAll('.shell-file-pane-view-tabs button')];
        const code = preview?.querySelector('[data-language="bash"]');
        const table = preview?.querySelector('.shell-code-preview__table');
        const previewBody = preview?.querySelector('.shell-code-preview');
        const previewRows = table ? [...table.querySelectorAll('tr')] : [];
        const longLineRow = previewRows.find((row) =>
          row.textContent?.includes('workspace-segment')
        );
        const regularLineRow = previewRows.find((row) => row !== longLineRow);
        const editorBody = document.querySelector('.shell-file-workbench__editor');
        const editorHeader = document.querySelector('.shell-file-pane-header');
        const toolbarControls = editorHeader
          ? [...editorHeader.querySelectorAll(
              '.shell-file-pane-view-tabs button, .shell-file-pane-icon-button'
            )]
          : [];
        const bounds = root?.getBoundingClientRect();
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value
            ? {
                top: value.top,
                right: value.right,
                bottom: value.bottom,
                left: value.left,
                width: value.width,
                height: value.height,
                centerY: value.top + value.height / 2,
              }
            : null;
        };
        const rootRect = rect(root);
        const editorRect = rect(editorBody);
        const editorHeaderRect = rect(editorHeader);
        const toolbarRects = toolbarControls.map(rect).filter(Boolean);
        const toolbarCenters = toolbarRects.map((value) => value.centerY);
        const background = (node) => node ? getComputedStyle(node).backgroundColor : null;
        const visualStyle = (node) => {
          if (!node) return null;
          const style = getComputedStyle(node);
          return {
            opacity: style.opacity,
            filter: style.filter,
            backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none',
          };
        };
        const resolvedTokenBackground = (token) => {
          const node = document.createElement('div');
          node.style.background = \`var(\${token})\`;
          document.body.appendChild(node);
          const value = getComputedStyle(node).backgroundColor;
          node.remove();
          return value;
        };
        return {
          rootVisible: Boolean(root && bounds && bounds.width > 0 && bounds.height > 0),
          explorerPresent: Boolean(explorer || explorerPanel),
          editorFillsRoot: Boolean(
            rootRect &&
              editorRect &&
              Math.abs(rootRect.left - editorRect.left) <= 1 &&
              Math.abs(rootRect.right - editorRect.right) <= 1 &&
              Math.abs(rootRect.width - editorRect.width) <= 1
          ),
          previewVisible: Boolean(preview && !preview.hidden && preview.getBoundingClientRect().height > 0),
          sourceHidden: Boolean(source?.hidden),
          tabStates: tabs.map((tab) => tab.getAttribute('aria-selected')),
          hasDuplicateFilename: Boolean(document.querySelector('.shell-file-pane-path')),
          language: code?.getAttribute('data-language') ?? null,
          lineCount: table?.querySelectorAll('tr').length ?? 0,
          codeTextLength: code?.textContent?.trim().length ?? 0,
          wrapping: {
            horizontalOverflow: previewBody
              ? Math.max(0, previewBody.scrollWidth - previewBody.clientWidth)
              : null,
            longLineHeight: longLineRow?.getBoundingClientRect().height ?? null,
            regularLineHeight: regularLineRow?.getBoundingClientRect().height ?? null,
          },
          iconTypes: [...document.querySelectorAll('[data-file-type]')]
            .map((node) => node.getAttribute('data-file-type')),
          backgrounds: {
            editorBody: background(editorBody),
            previewBody: background(previewBody),
            sourceBody: background(source),
            expectedChatBody: resolvedTokenBackground('--color-chat'),
            editorHeader: background(editorHeader),
          },
          clarity: {
            root: visualStyle(root),
            editor: visualStyle(editorBody),
            header: visualStyle(editorHeader),
            preview: visualStyle(previewBody),
          },
          alignment: {
            editorHeaderRect,
            toolbarCenterDelta:
              toolbarCenters.length > 0
                ? Math.max(...toolbarCenters) - Math.min(...toolbarCenters)
                : null,
          },
        };
      })()`,
      true,
    );
    if (
      !initial.rootVisible ||
      initial.explorerPresent ||
      !initial.editorFillsRoot ||
      !initial.previewVisible ||
      !initial.sourceHidden ||
      JSON.stringify(initial.tabStates) !== JSON.stringify(['true', 'false']) ||
      initial.hasDuplicateFilename ||
      initial.language !== 'bash' ||
      initial.lineCount < 10 ||
      initial.codeTextLength < 100 ||
      !initial.iconTypes.includes('shell')
    ) {
      throw new Error(
        'phase3.visual.workspace_file_invalid:' + visualCase.id + ':' + JSON.stringify(initial),
      );
    }
    const unclearSurface = Object.values(initial.clarity).find(
      (style) =>
        !style ||
        style.opacity !== '1' ||
        style.filter !== 'none' ||
        style.backdropFilter !== 'none',
    );
    if (unclearSurface) {
      throw new Error(
        'phase3.visual.workspace_file_clarity_invalid:' +
          visualCase.id +
          ':' +
          JSON.stringify(initial.clarity),
      );
    }
    if (
      initial.wrapping.horizontalOverflow === null ||
      initial.wrapping.horizontalOverflow > 1 ||
      initial.wrapping.longLineHeight === null ||
      initial.wrapping.regularLineHeight === null ||
      initial.wrapping.longLineHeight <= initial.wrapping.regularLineHeight + 1
    ) {
      throw new Error(
        'phase3.visual.workspace_file_wrapping_invalid:' +
          visualCase.id +
          ':' +
          JSON.stringify(initial.wrapping),
      );
    }
    if (initial.alignment.toolbarCenterDelta === null || initial.alignment.toolbarCenterDelta > 1) {
      throw new Error(
        'phase3.visual.workspace_file_alignment_invalid:' +
          visualCase.id +
          ':' +
          JSON.stringify(initial.alignment),
      );
    }
    if (
      initial.backgrounds.editorBody === null ||
      initial.backgrounds.previewBody === null ||
      initial.backgrounds.sourceBody === null ||
      initial.backgrounds.expectedChatBody === null ||
      initial.backgrounds.editorBody !== initial.backgrounds.expectedChatBody ||
      initial.backgrounds.previewBody !== initial.backgrounds.expectedChatBody ||
      initial.backgrounds.sourceBody !== initial.backgrounds.expectedChatBody ||
      initial.backgrounds.editorHeader === null
    ) {
      throw new Error(
        'phase3.visual.workspace_file_background_invalid:' +
          visualCase.id +
          ':' +
          JSON.stringify(initial.backgrounds),
      );
    }

    const source = await window.webContents.executeJavaScript(
      `(async () => {
        const sourceTab = document.querySelector(
          '.shell-file-pane-view-tabs button[aria-label="源码"]'
        );
        sourceTab?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const preview = document.querySelector('[data-testid="file-pane-preview"]');
        const editor = document.querySelector('[data-testid="file-pane-editor"]');
        const menuButton = document.querySelector('button[aria-label="更多文件操作"]');
        if (menuButton?.getAttribute('aria-expanded') !== 'true') menuButton?.click();
        const menuStartedAt = Date.now();
        let copyButton = null;
        while (Date.now() - menuStartedAt < 2000 && !copyButton) {
          copyButton = document.querySelector(
            'button[role="menuitem"][aria-label="复制源码"]'
          );
          if (!copyButton) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        copyButton?.click();
        const startedAt = Date.now();
        while (
          Date.now() - startedAt < 2000 &&
          !document.querySelector('button[aria-label="源码已复制"]')
        ) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return {
          sourceSelected: sourceTab?.getAttribute('aria-selected'),
          previewHidden: Boolean(preview?.hidden),
          editorVisible: Boolean(
            editor && !editor.hidden && editor.getBoundingClientRect().height > 0
          ),
          editorTextLength: editor?.value?.trim().length ?? 0,
          editorWrap: editor?.getAttribute('wrap') ?? null,
          editorHorizontalOverflow: editor
            ? Math.max(0, editor.scrollWidth - editor.clientWidth)
            : null,
          copySucceeded: Boolean(document.querySelector('button[aria-label="源码已复制"]')),
          copiedCompleteSource: window.__phase3CopiedText === editor?.value,
        };
      })()`,
      true,
    );
    if (
      source.sourceSelected !== 'true' ||
      !source.previewHidden ||
      !source.editorVisible ||
      source.editorTextLength < 100 ||
      source.editorWrap !== 'soft' ||
      source.editorHorizontalOverflow === null ||
      source.editorHorizontalOverflow > 1 ||
      !source.copySucceeded ||
      !source.copiedCompleteSource
    ) {
      throw new Error(
        'phase3.visual.workspace_file_source_invalid:' +
          visualCase.id +
          ':' +
          JSON.stringify(source),
      );
    }
  }
}

async function captureCase(request, visualCase) {
  const consoleErrors = [];
  const window = new BrowserWindow({
    show: false,
    width: visualCase.width,
    height: visualCase.height,
    useContentSize: true,
    frame: false,
    backgroundColor: visualCase.theme === 'dark' ? '#0d0d0c' : '#f2eee6',
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) consoleErrors.push(message);
  });

  try {
    await window.loadFile(request.htmlPath, {
      query: {
        'phase3-visual': visualCase.fixture,
        theme: visualCase.theme,
      },
    });
    window.webContents.setZoomFactor(visualCase.scale);
    await waitForFixture(window);
    await verifyTargetedFixture(window, visualCase);
    if (visualCase.state === 'source-copied') {
      const prepared = await window.webContents.executeJavaScript(
        `(async () => {
          const sourceTab = document.querySelector(
            '.shell-file-pane-view-tabs button[aria-label="源码"]'
          );
          sourceTab?.click();
          if (document.querySelector('button[aria-label="源码已复制"]')) {
            return { sourceSelected: sourceTab?.getAttribute('aria-selected'), copied: true };
          }
          const startedAt = Date.now();
          let menuOpened = false;
          while (Date.now() - startedAt < 3000) {
            const editor = document.querySelector('[data-testid="file-pane-editor"]');
            const copyButton = document.querySelector(
              'button[role="menuitem"][aria-label="复制源码"]'
            );
            if (editor && !editor.hidden && copyButton) {
              copyButton.click();
              break;
            }
            if (editor && !editor.hidden && !menuOpened) {
              const menuButton = document.querySelector('button[aria-label="更多文件操作"]');
              if (menuButton?.getAttribute('aria-expanded') !== 'true') menuButton?.click();
              menuOpened = true;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          const copiedStartedAt = Date.now();
          while (Date.now() - copiedStartedAt < 2000) {
            const copiedButton = document.querySelector(
              'button[aria-label="源码已复制"]'
            );
            if (copiedButton) {
              return {
                sourceSelected: sourceTab?.getAttribute('aria-selected'),
                copied: true,
              };
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          return {
            sourceSelected: sourceTab?.getAttribute('aria-selected'),
            copied: false,
          };
        })()`,
        true,
      );
      if (prepared.sourceSelected !== 'true' || !prepared.copied) {
        throw new Error(
          'phase3.visual.workspace_file_source_capture_invalid:' +
            visualCase.id +
            ':' +
            JSON.stringify(prepared),
        );
      }
    }
    const image = await window.webContents.capturePage();
    const png = image.toPNG();
    if (png.length < 10000) throw new Error('phase3.visual.capture_too_small:' + visualCase.id);
    if (consoleErrors.length > 0) {
      throw new Error(
        'phase3.visual.console_error:' + visualCase.id + ':' + consoleErrors.join(' | '),
      );
    }
    const file = visualCase.id + '.png';
    await writeFile(join(request.outputDir, file), png);
    const size = image.getSize();
    return {
      ...visualCase,
      file,
      width: size.width,
      height: size.height,
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function main() {
  const requestPath = readArgument('--request');
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  if (request.schemaVersion !== 1 || !Array.isArray(request.cases)) {
    throw new Error('phase3.visual.request_invalid');
  }
  // Keep one BrowserWindow alive while individual capture windows are destroyed.
  // On Windows an all-hidden-window gap can end the Electron process before the
  // async loop writes its manifest.
  const keeper = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: { backgroundThrottling: false },
  });
  const captures = [];
  try {
    for (const visualCase of request.cases) {
      captures.push(await captureCase(request, visualCase));
    }
  } finally {
    if (!keeper.isDestroyed()) keeper.destroy();
  }
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    captureEngine: 'electron.capturePage',
    captures,
  };
  await writeFile(request.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
    app.exit(1);
  }
});
