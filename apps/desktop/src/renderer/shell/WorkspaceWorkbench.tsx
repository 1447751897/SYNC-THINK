import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  Bot,
  File,
  FileDiff,
  FilePlus2,
  Files,
  Globe,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  SquareTerminal,
  Users,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { ConversationTrack } from '@sync-think/shared';
import { FileTypeIcon } from './FileTypeIcon.js';
import { browserTabFaviconSrc } from './ExternalSourceIcon.js';
import type { WorkbenchPlacement, WorkbenchScope, WorkbenchTab } from './workspace-workbench.js';
import {
  WORKBENCH_BOTTOM_DEFAULT_HEIGHT,
  WORKBENCH_BOTTOM_MAX_HEIGHT,
  WORKBENCH_BOTTOM_MIN_HEIGHT,
  WORKBENCH_FILE_BROWSER_MAX_WIDTH,
  WORKBENCH_FILE_BROWSER_MIN_WIDTH,
  WORKBENCH_RIGHT_COMPACT_WIDTH,
  WORKBENCH_RIGHT_MAX_WIDTH,
  WORKBENCH_RIGHT_MIN_WIDTH,
} from './workspace-workbench.js';

export type WorkbenchNewResource =
  | 'files'
  | 'terminal'
  | 'browser'
  | 'canvas'
  | 'document'
  | 'conversation';

export interface WorkspaceWorkbenchProps {
  placement: WorkbenchPlacement;
  scope: WorkbenchScope;
  /** When false the panel stays mounted at zero size so open/close can animate. */
  open?: boolean;
  focused?: boolean;
  canOpenTerminal?: boolean;
  renderContent(tab: WorkbenchTab): ReactNode;
  renderFileBrowser?(): ReactNode;
  browserPageMeta?: Record<string, { title?: string; favicon?: string }>;
  conversationTabMeta?: Record<string, { title?: string; track?: ConversationTrack }>;
  onActivateTab(tabId: string): void;
  onCloseTab(tab: WorkbenchTab): void;
  onNewResource(resource: WorkbenchNewResource): void;
  onChromeFocus?(): void;
  onToggleFileBrowser?(): void;
  onClose(): void;
  onSizeChange(size: number, commit: boolean): void;
  onFileBrowserWidthChange?(width: number, commit: boolean): void;
}

interface ResizeDrag {
  kind: 'host' | 'files';
  startClient: number;
  startSize: number;
  pointerId: number;
  target: HTMLDivElement;
  lastSize: number;
}

function tabLabel(
  tab: WorkbenchTab,
  chrome?: { title?: string; favicon?: string },
  conversation?: { title?: string },
): string {
  if (tab.type === 'conversation') return conversation?.title?.trim() || '新对话';
  if (tab.type === 'file') return tab.path.split(/[\\/]/).at(-1) || tab.path;
  if (tab.type === 'terminal') return 'Terminal';
  if (tab.type === 'browser') {
    const title = chrome?.title?.trim();
    if (title) return title;
    try {
      return new URL(tab.url).hostname || '浏览器';
    } catch {
      return '浏览器';
    }
  }
  if (tab.type === 'review') return '审阅';
  return '工作区文件';
}

function WorkbenchBrowserIcon({
  tab,
  favicon,
}: {
  tab: Extract<WorkbenchTab, { type: 'browser' }>;
  favicon?: string;
}) {
  const src = browserTabFaviconSrc({ url: tab.url, favicon });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (!src || failed) {
    return <Globe size={14} aria-hidden="true" />;
  }
  return (
    <img
      className="shell-pane-tab__favicon"
      src={src}
      alt=""
      data-testid={`workbench-tab-favicon-${tab.browserId}`}
      onError={() => setFailed(true)}
    />
  );
}

function WorkbenchTabIcon({
  tab,
  favicon,
  track,
}: {
  tab: WorkbenchTab;
  favicon?: string;
  track?: ConversationTrack;
}) {
  if (tab.type === 'conversation') {
    const Icon = track === 'agent' ? Bot : track === 'team' ? Users : MessageSquare;
    return <Icon size={14} aria-hidden="true" />;
  }
  if (tab.type === 'file') return <FileTypeIcon path={tab.path} size={14} className="shrink-0" />;
  if (tab.type === 'terminal') return <SquareTerminal size={14} aria-hidden="true" />;
  if (tab.type === 'browser') return <WorkbenchBrowserIcon tab={tab} favicon={favicon} />;
  if (tab.type === 'review') return <FileDiff size={14} aria-hidden="true" />;
  return <File size={14} aria-hidden="true" />;
}

function sizeBounds(placement: WorkbenchPlacement, host: HTMLElement | null) {
  if (placement === 'right') {
    const available = host?.parentElement?.getBoundingClientRect().width ?? 0;
    return {
      min: WORKBENCH_RIGHT_MIN_WIDTH,
      max: Math.max(
        WORKBENCH_RIGHT_MIN_WIDTH,
        Math.min(
          WORKBENCH_RIGHT_MAX_WIDTH,
          available > 0 ? available - 320 : WORKBENCH_RIGHT_MAX_WIDTH,
        ),
      ),
    };
  }
  const available = host?.parentElement?.getBoundingClientRect().height ?? 0;
  return {
    min: WORKBENCH_BOTTOM_MIN_HEIGHT,
    max: Math.max(
      WORKBENCH_BOTTOM_MIN_HEIGHT,
      Math.min(
        WORKBENCH_BOTTOM_MAX_HEIGHT,
        available > 0 ? available - 200 : WORKBENCH_BOTTOM_MAX_HEIGHT,
      ),
    ),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function WorkspaceWorkbench(props: WorkspaceWorkbenchProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [fileBrowserResizing, setFileBrowserResizing] = useState(false);
  const hostRef = useRef<HTMLElement>(null);
  const dragRef = useRef<ResizeDrag | null>(null);
  const open = props.open !== false;
  const revealed = open && entered;

  useLayoutEffect(() => {
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, []);
  const newMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const onSizeChangeRef = useRef(props.onSizeChange);
  onSizeChangeRef.current = props.onSizeChange;
  const onFileBrowserWidthChangeRef = useRef(props.onFileBrowserWidthChange);
  onFileBrowserWidthChangeRef.current = props.onFileBrowserWidthChange;
  const activeTab =
    props.scope.tabs.find((tab) => tab.id === props.scope.activeTabId) ?? props.scope.tabs.at(-1);
  const hideEmptyFilesTab =
    props.placement === 'right' &&
    props.scope.fileBrowserOpen &&
    activeTab?.type === 'file';
  const visibleTabs = props.scope.tabs.filter((tab) => {
    if (tab.type !== 'workspace-files') return true;
    return !hideEmptyFilesTab;
  });
  const showingFilesTab = activeTab?.type === 'workspace-files';
  const showFilesBeside =
    props.placement === 'right' &&
    Boolean(props.renderFileBrowser) &&
    props.scope.fileBrowserOpen &&
    !!activeTab &&
    activeTab.type !== 'workspace-files';
  const showFilesFull = showingFilesTab;
  const fileBrowserPressed = showingFilesTab || showFilesBeside;

  const finishResize = useCallback((commit = true) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setResizing(false);
    setFileBrowserResizing(false);
    if (drag.target.hasPointerCapture?.(drag.pointerId)) {
      drag.target.releasePointerCapture?.(drag.pointerId);
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (!commit) return;
    if (drag.kind === 'files') onFileBrowserWidthChangeRef.current?.(drag.lastSize, true);
    else onSizeChangeRef.current(drag.lastSize, true);
  }, []);

  useEffect(() => {
    const blur = () => finishResize();
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('blur', blur);
      finishResize(false);
    };
  }, [finishResize]);

  useEffect(() => {
    if (!newMenuOpen && !moreMenuOpen) return;
    const close = () => {
      setNewMenuOpen(false);
      setMoreMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [moreMenuOpen, newMenuOpen]);

  useEffect(() => {
    if (props.focused === false) setNewMenuOpen(false);
  }, [props.focused]);

  useEffect(() => {
    if (!newMenuOpen) return;
    newMenuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
  }, [newMenuOpen]);

  const selectNewResource = (resource: WorkbenchNewResource) => {
    setNewMenuOpen(false);
    props.onNewResource(resource);
  };

  const handleNewMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setNewMenuOpen(false);
      newMenuTriggerRef.current?.focus();
      return;
    }
    if (event.key === 'Tab') {
      setNewMenuOpen(false);
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + items.length) % items.length;
    else if (event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      kind: 'host',
      startClient: props.placement === 'right' ? event.clientX : event.clientY,
      startSize: props.scope.size,
      pointerId: event.pointerId,
      target: event.currentTarget,
      lastSize: props.scope.size,
    };
    document.body.style.cursor = props.placement === 'right' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    setResizing(true);
  };

  const resizeWithPointer = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const client = props.placement === 'right' ? event.clientX : event.clientY;
    if (drag.kind === 'files') {
      const width = Math.round(
        clamp(
          drag.startSize - (client - drag.startClient),
          WORKBENCH_FILE_BROWSER_MIN_WIDTH,
          WORKBENCH_FILE_BROWSER_MAX_WIDTH,
        ),
      );
      drag.lastSize = width;
      props.onFileBrowserWidthChange?.(width, false);
      return;
    }
    const bounds = sizeBounds(props.placement, hostRef.current);
    const size = Math.round(
      clamp(drag.startSize - (client - drag.startClient), bounds.min, bounds.max),
    );
    drag.lastSize = size;
    props.onSizeChange(size, false);
  };

  const beginFileBrowserResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      kind: 'files',
      startClient: event.clientX,
      startSize: props.scope.fileBrowserWidth,
      pointerId: event.pointerId,
      target: event.currentTarget,
      lastSize: props.scope.fileBrowserWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setFileBrowserResizing(true);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const bounds = sizeBounds(props.placement, hostRef.current);
    let size: number | undefined;
    if (event.key === 'Home') size = bounds.min;
    else if (event.key === 'End') size = bounds.max;
    else if (
      (props.placement === 'right' && event.key === 'ArrowLeft') ||
      (props.placement === 'bottom' && event.key === 'ArrowUp')
    ) {
      size = props.scope.size + 16;
    } else if (
      (props.placement === 'right' && event.key === 'ArrowRight') ||
      (props.placement === 'bottom' && event.key === 'ArrowDown')
    ) {
      size = props.scope.size - 16;
    }
    if (size === undefined) return;
    event.preventDefault();
    props.onSizeChange(Math.round(clamp(size, bounds.min, bounds.max)), true);
  };

  const defaultSize =
    props.placement === 'right' ? WORKBENCH_RIGHT_COMPACT_WIDTH : WORKBENCH_BOTTOM_DEFAULT_HEIGHT;
  const revealedSize = revealed ? props.scope.size : 0;

  return (
    <section
      ref={hostRef}
      className={clsx('shell-workbench', `shell-workbench--${props.placement}`)}
      data-workspace-file-inspector={props.placement === 'right' ? 'true' : undefined}
      data-workspace-bottom-inspector={props.placement === 'bottom' ? 'true' : undefined}
      data-workspace-panel-layout="true"
      data-workspace-panel-placement={props.placement}
      data-workspace-panel-open={revealed ? 'true' : 'false'}
      data-pane-shell="true"
      data-workspace-chrome-focus={props.focused === false ? 'false' : 'true'}
      data-resizing={resizing ? 'true' : undefined}
      onPointerDownCapture={() => props.onChromeFocus?.()}
      style={
        props.placement === 'right'
          ? {
              width: revealedSize,
              flexBasis: revealedSize,
              ['--workbench-size' as string]: `${props.scope.size}px`,
            }
          : {
              height: revealedSize,
              flexBasis: revealedSize,
              ['--workbench-size' as string]: `${props.scope.size}px`,
            }
      }
    >
      <div
        role="separator"
        tabIndex={revealed ? 0 : -1}
        aria-label={props.placement === 'right' ? '调整右侧工作台宽度' : '调整底部工作台高度'}
        aria-orientation={props.placement === 'right' ? 'vertical' : 'horizontal'}
        aria-valuemin={sizeBounds(props.placement, hostRef.current).min}
        aria-valuemax={sizeBounds(props.placement, hostRef.current).max}
        aria-valuenow={Math.round(props.scope.size)}
        className="shell-workbench__outer-resizer"
        onPointerDown={beginResize}
        onPointerMove={resizeWithPointer}
        onPointerUp={() => finishResize()}
        onPointerCancel={() => finishResize()}
        onLostPointerCapture={() => finishResize()}
        onDoubleClick={() => props.onSizeChange(defaultSize, true)}
        onKeyDown={resizeWithKeyboard}
      />

      <div
        className="shell-workbench__tabbar"
        data-workspace-inspector-tabbar="true"
        data-pane-tab-bar="true"
      >
        <div className="shell-workbench__tab-cluster">
          <div className="shell-workbench__tabs" role="tablist" aria-label="工作台标签">
          {visibleTabs.map((tab) => {
            const active = tab.id === activeTab?.id;
            const chrome = tab.type === 'browser' ? props.browserPageMeta?.[tab.browserId] : undefined;
            const conversation =
              tab.type === 'conversation' ? props.conversationTabMeta?.[tab.conversationId] : undefined;
            const label = tabLabel(tab, chrome, conversation);
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={active}
                data-tab-item="true"
                data-tab-active={active ? 'true' : undefined}
                data-workspace-file-preview-tab={
                  tab.type === 'file' ? tab.path : tab.type === 'review' ? tab.id : undefined
                }
                data-workspace-empty-file-tab={
                  tab.type === 'workspace-files' ? 'true' : undefined
                }
                className={clsx('shell-workbench-tab group', active && 'is-active')}
                title={label}
                onClick={() => props.onActivateTab(tab.id)}
              >
                <WorkbenchTabIcon
                  tab={tab}
                  favicon={chrome?.favicon}
                  track={conversation?.track}
                />
                <span className="shell-workbench-tab__label" data-pane-tab-label="true">
                  {label}
                </span>
                {tab.type === 'workspace-files' ? null : (
                  <button
                    type="button"
                    className="shell-workbench-tab__close"
                    aria-label={`关闭 ${label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onCloseTab(tab);
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
          <div
            className={clsx(
              'shell-workbench__menu-anchor',
              props.focused === false && 'shell-tab-add--hidden',
            )}
          >
            <button
              ref={newMenuTriggerRef}
              type="button"
              data-testid="workbench-tab-new"
              className="shell-workbench__tab-action"
              aria-label={`添加${props.placement === 'right' ? '右侧' : '底部'}工作台标签`}
              aria-haspopup="menu"
              aria-expanded={newMenuOpen}
              aria-hidden={props.focused === false}
              tabIndex={props.focused === false ? -1 : undefined}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                setNewMenuOpen((open) => !open);
                setMoreMenuOpen(false);
              }}
            >
              <Plus size={15} />
            </button>
            {newMenuOpen ? (
              <div
                ref={newMenuRef}
                className="shell-workbench-menu"
                role="menu"
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={handleNewMenuKeyDown}
              >
                {props.placement === 'right' ? (
                  <button type="button" role="menuitem" onClick={() => selectNewResource('files')}>
                    <Files size={14} /> 工作区文件
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => selectNewResource('conversation')}
                >
                  <MessageSquarePlus size={14} /> 新建对话
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={props.canOpenTerminal === false}
                  onClick={() => selectNewResource('canvas')}
                >
                  <Pencil size={14} /> 新建绘图
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={props.canOpenTerminal === false}
                  onClick={() => selectNewResource('document')}
                >
                  <FilePlus2 size={14} /> 新建文档
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => selectNewResource('terminal')}
                >
                  <SquareTerminal size={14} /> 新建终端
                </button>
                <button type="button" role="menuitem" onClick={() => selectNewResource('browser')}>
                  <Globe size={14} /> 网页浏览
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {props.placement === 'right' && props.onToggleFileBrowser ? (
          <button
            type="button"
            data-testid="workspace-files-workbench-toggle"
            className={clsx('shell-workbench__tab-action', fileBrowserPressed && 'is-active')}
            title={fileBrowserPressed ? '收起工作区文件' : '在文档右侧显示工作区文件'}
            aria-label={fileBrowserPressed ? '收起工作区文件' : '在文档右侧显示工作区文件'}
            aria-pressed={fileBrowserPressed}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={props.onToggleFileBrowser}
          >
            <Files size={16} />
          </button>
        ) : null}

        <div className="shell-workbench__menu-anchor shell-workbench__more">
          <button
            type="button"
            className="shell-workbench__tab-action"
            aria-label="工作台更多操作"
            aria-expanded={moreMenuOpen}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => {
              setMoreMenuOpen((open) => !open);
              setNewMenuOpen(false);
            }}
          >
            <MoreHorizontal size={16} />
          </button>
          {moreMenuOpen ? (
            <div
              className="shell-workbench-menu shell-workbench-menu--end"
              role="menu"
              onMouseDown={(event) => event.stopPropagation()}
            >
              {visibleTabs.map((tab) => {
                const chrome =
                  tab.type === 'browser' ? props.browserPageMeta?.[tab.browserId] : undefined;
                const conversation =
                  tab.type === 'conversation'
                    ? props.conversationTabMeta?.[tab.conversationId]
                    : undefined;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="menuitem"
                    className={tab.id === activeTab?.id ? 'is-active' : undefined}
                    onClick={() => props.onActivateTab(tab.id)}
                  >
                    <WorkbenchTabIcon
                      tab={tab}
                      favicon={chrome?.favicon}
                      track={conversation?.track}
                    />
                    <span>{tabLabel(tab, chrome, conversation)}</span>
                  </button>
                );
              })}
              <div className="shell-workbench-menu__divider" />
              <button type="button" role="menuitem" onClick={props.onClose}>
                <X size={14} /> 关闭工作台
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="shell-workbench__divider" data-pane-tab-divider="true" />
      <div className="shell-workbench__content" data-pane-content-area="true">
        <div className="shell-workbench__main">
          {props.scope.tabs
            .filter((tab) => tab.type === 'browser')
            .map((tab) => {
              const browserActive = !showFilesFull && tab.id === activeTab?.id;
              return (
                <div
                  key={tab.id}
                  className="shell-pane-surface"
                  data-surface="browser"
                  data-active={browserActive ? 'true' : 'false'}
                  data-testid={`workbench-surface-browser-${tab.browserId}`}
                >
                  {props.renderContent(tab)}
                </div>
              );
            })}
          {showFilesFull ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {props.renderFileBrowser?.() ?? (activeTab ? props.renderContent(activeTab) : null)}
            </div>
          ) : activeTab && activeTab.type !== 'browser' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {props.renderContent(activeTab)}
            </div>
          ) : null}
        </div>
        {props.placement === 'right' && props.renderFileBrowser && visibleTabs.length > 0 ? (
          <aside
            className="shell-workbench__files"
            data-testid="workspace-workbench-file-browser"
            data-open={showFilesBeside ? 'true' : 'false'}
            data-resizing={fileBrowserResizing ? 'true' : undefined}
            style={{
              width: showFilesBeside ? props.scope.fileBrowserWidth : 0,
              flexBasis: showFilesBeside ? props.scope.fileBrowserWidth : 0,
              ['--workbench-file-browser-size' as string]: `${props.scope.fileBrowserWidth}px`,
            }}
          >
            <div
              role="separator"
              tabIndex={showFilesBeside ? 0 : -1}
              aria-label="调整工作区文件宽度"
              aria-orientation="vertical"
              aria-valuemin={WORKBENCH_FILE_BROWSER_MIN_WIDTH}
              aria-valuemax={WORKBENCH_FILE_BROWSER_MAX_WIDTH}
              aria-valuenow={Math.round(props.scope.fileBrowserWidth)}
              className="shell-workbench__files-resizer"
              onPointerDown={beginFileBrowserResize}
              onPointerMove={resizeWithPointer}
              onPointerUp={() => finishResize()}
              onPointerCancel={() => finishResize()}
              onLostPointerCapture={() => finishResize()}
            />
            <div className="shell-workbench__files-body">{props.renderFileBrowser()}</div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
