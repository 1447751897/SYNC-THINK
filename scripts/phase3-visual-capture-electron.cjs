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
      JSON.stringify(result.sectionTitles) !== JSON.stringify(['Git 工具', '目标', '进程']) ||
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
        const explorerBody = document.querySelector('.shell-file-workbench__explorer');
        const editorHeader = document.querySelector('.shell-file-pane-header');
        const explorerHeader = document.querySelector('.shell-workspace-files-switcher');
        const searchArea = document.querySelector('.shell-workspace-files-search');
        const explorerPanel = document.querySelector('.shell-workspace-files-panel');
        const toolbarControls = editorHeader
          ? [...editorHeader.querySelectorAll(
              '.shell-file-pane-view-tabs button, .shell-file-pane-icon-button'
            )]
          : [];
        const rows = [...document.querySelectorAll(
          '.shell-workspace-file-row:not(.shell-workspace-file-row--search)'
        )];
        const firstActionRow = rows.find((row) =>
          row.querySelector('.shell-workspace-file-row__new-tab')
        );
        const firstPrimary = firstActionRow?.querySelector('.shell-workspace-file-row__primary');
        const firstIcon = firstPrimary?.querySelector('[data-file-type]');
        const firstLabel = firstPrimary?.querySelector(':scope > span');
        const firstAction = firstActionRow?.querySelector('.shell-workspace-file-row__new-tab');
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
        const editorHeaderRect = rect(editorHeader);
        const explorerHeaderRect = rect(explorerHeader);
        const toolbarRects = toolbarControls.map(rect).filter(Boolean);
        const rowRects = rows.map(rect).filter(Boolean);
        const rowHeights = rowRects.map((value) => value.height);
        const toolbarCenters = toolbarRects.map((value) => value.centerY);
        const itemCenters = [firstIcon, firstLabel, firstAction]
          .map(rect)
          .filter(Boolean)
          .map((value) => value.centerY);
        const background = (node) => node ? getComputedStyle(node).backgroundColor : null;
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
          explorerVisible: Boolean(
            explorer &&
              explorer.getBoundingClientRect().width > 0 &&
              explorer.getBoundingClientRect().height > 0
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
            explorerBody: background(explorerBody),
            previewBody: background(previewBody),
            sourceBody: background(source),
            expectedChatBody: resolvedTokenBackground('--color-chat'),
            editorHeader: background(editorHeader),
            explorerHeader: background(explorerHeader),
            searchArea: background(searchArea),
            explorerPanel: background(explorerPanel),
          },
          alignment: {
            editorHeaderRect,
            explorerHeaderRect,
            headerBottomDelta:
              editorHeaderRect && explorerHeaderRect
                ? Math.abs(editorHeaderRect.bottom - explorerHeaderRect.bottom)
                : null,
            headerHeightDelta:
              editorHeaderRect && explorerHeaderRect
                ? Math.abs(editorHeaderRect.height - explorerHeaderRect.height)
                : null,
            toolbarCenterDelta:
              toolbarCenters.length > 0
                ? Math.max(...toolbarCenters) - Math.min(...toolbarCenters)
                : null,
            rowHeightDelta:
              rowHeights.length > 0 ? Math.max(...rowHeights) - Math.min(...rowHeights) : null,
            rowHeights,
            itemCenterDelta:
              itemCenters.length === 3 ? Math.max(...itemCenters) - Math.min(...itemCenters) : null,
          },
        };
      })()`,
      true,
    );
    if (
      !initial.rootVisible ||
      !initial.explorerVisible ||
      !initial.previewVisible ||
      !initial.sourceHidden ||
      JSON.stringify(initial.tabStates) !== JSON.stringify(['true', 'false']) ||
      initial.hasDuplicateFilename ||
      initial.language !== 'bash' ||
      initial.lineCount < 10 ||
      initial.codeTextLength < 100 ||
      !initial.iconTypes.includes('shell') ||
      !initial.iconTypes.includes('json') ||
      !initial.iconTypes.includes('markdown')
    ) {
      throw new Error(
        'phase3.visual.workspace_file_invalid:' + visualCase.id + ':' + JSON.stringify(initial),
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
    if (
      initial.alignment.headerBottomDelta === null ||
      initial.alignment.headerBottomDelta > 1 ||
      initial.alignment.headerHeightDelta === null ||
      initial.alignment.headerHeightDelta > 1 ||
      initial.alignment.toolbarCenterDelta === null ||
      initial.alignment.toolbarCenterDelta > 1 ||
      initial.alignment.rowHeightDelta === null ||
      initial.alignment.rowHeightDelta > 1 ||
      initial.alignment.rowHeights.length < 3 ||
      initial.alignment.rowHeights.some((height) => Math.abs(height - 26) > 1) ||
      initial.alignment.itemCenterDelta === null ||
      initial.alignment.itemCenterDelta > 1
    ) {
      throw new Error(
        'phase3.visual.workspace_file_alignment_invalid:' +
          visualCase.id +
          ':' +
          JSON.stringify(initial.alignment),
      );
    }
    if (
      initial.backgrounds.editorBody === null ||
      initial.backgrounds.explorerBody === null ||
      initial.backgrounds.previewBody === null ||
      initial.backgrounds.sourceBody === null ||
      initial.backgrounds.expectedChatBody === null ||
      initial.backgrounds.editorBody !== initial.backgrounds.expectedChatBody ||
      initial.backgrounds.explorerBody !== initial.backgrounds.expectedChatBody ||
      initial.backgrounds.previewBody !== initial.backgrounds.expectedChatBody ||
      initial.backgrounds.sourceBody !== initial.backgrounds.expectedChatBody ||
      initial.backgrounds.editorHeader === null ||
      initial.backgrounds.explorerHeader === null ||
      initial.backgrounds.editorHeader !== initial.backgrounds.explorerHeader ||
      initial.backgrounds.searchArea === null ||
      initial.backgrounds.explorerPanel === null ||
      initial.backgrounds.searchArea !== initial.backgrounds.explorerPanel
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
        const copyButton = document.querySelector('button[aria-label="复制源码"]');
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

    const json = await window.webContents.executeJavaScript(
      `(async () => {
        const previewTab = document.querySelector(
          '.shell-file-pane-view-tabs button[aria-label="高亮预览"]'
        );
        previewTab?.click();
        const packageButton = [...document.querySelectorAll('.shell-workspace-file-row__primary')]
          .find((button) => button.textContent?.includes('package.json'));
        packageButton?.click();
        const packageIconVisible = Boolean(
          packageButton?.querySelector('[data-file-type="package"]')
        );
        const jsonStartedAt = Date.now();
        let jsonLanguage = null;
        let jsonKeywordCount = 0;
        let jsonActiveFile = null;
        while (Date.now() - jsonStartedAt < 5000) {
          const jsonCode = document.querySelector(
            '[data-testid="file-pane-preview"] [data-language="json"]'
          );
          jsonActiveFile = document
            .querySelector(
              '.shell-workspace-file-row.is-active .shell-workspace-file-row__primary'
            )
            ?.textContent?.trim() ?? null;
          if (jsonCode && jsonActiveFile?.includes('package.json')) {
            jsonLanguage = jsonCode.getAttribute('data-language');
            jsonKeywordCount = jsonCode.querySelectorAll('.hljs-attr').length;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const shellButton = [...document.querySelectorAll('.shell-workspace-file-row__primary')]
          .find((button) => button.textContent?.includes('install-all.sh'));
        shellButton?.click();
        const shellStartedAt = Date.now();
        let shellActiveFile = null;
        let shellLanguage = null;
        while (Date.now() - shellStartedAt < 5000) {
          const shellCode = document.querySelector(
            '[data-testid="file-pane-preview"] [data-language="bash"]'
          );
          shellActiveFile = document
            .querySelector(
              '.shell-workspace-file-row.is-active .shell-workspace-file-row__primary'
            )
            ?.textContent?.trim() ?? null;
          shellLanguage = shellCode?.getAttribute('data-language') ?? null;
          if (shellCode && shellActiveFile?.includes('install-all.sh')) {
            return {
              jsonLanguage,
              jsonKeywordCount,
              packageButtonFound: Boolean(packageButton),
              packageIconVisible,
              jsonActiveFile,
              shellButtonFound: Boolean(shellButton),
              shellActiveFile,
              shellLanguage,
              restoredShell: true,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return {
          jsonLanguage,
          jsonKeywordCount,
          packageButtonFound: Boolean(packageButton),
          packageIconVisible,
          jsonActiveFile,
          shellButtonFound: Boolean(shellButton),
          shellActiveFile,
          shellLanguage,
          restoredShell: false,
        };
      })()`,
      true,
    );
    if (
      json.jsonLanguage !== 'json' ||
      json.jsonKeywordCount < 1 ||
      !json.packageIconVisible ||
      !json.restoredShell
    ) {
      throw new Error(
        'phase3.visual.workspace_file_json_invalid:' + visualCase.id + ':' + JSON.stringify(json),
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
          const startedAt = Date.now();
          while (Date.now() - startedAt < 3000) {
            const editor = document.querySelector('[data-testid="file-pane-editor"]');
            const copyButton = document.querySelector('button[aria-label="复制源码"]');
            if (editor && !editor.hidden && copyButton) {
              copyButton.click();
              break;
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
