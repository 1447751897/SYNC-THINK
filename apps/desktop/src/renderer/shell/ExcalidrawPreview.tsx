import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowRight,
  Circle,
  Diamond,
  Eraser,
  Hand,
  Image as ImageIcon,
  Library,
  Lock,
  Menu,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Square,
  Type,
  Unlock,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createEmptyExcalidrawDocument,
  parseExcalidrawDocument,
  serializeExcalidrawDocument,
  type ExcalidrawDocument,
} from './excalidraw-document.js';
import {
  loadExcalidrawVendor,
  type ExcalidrawVendorHandle,
} from './excalidraw-vendor-loader.js';

interface ExcalidrawPreviewProps {
  content: string;
  filePath?: string;
  isActive?: boolean;
  onChange?(content: string): void;
  onHandle?(handle: ExcalidrawVendorHandle | null): void;
}

const sceneSubscribers = new Map<string, Set<(content: string, source?: object) => void>>();

function sceneKey(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').toLowerCase();
}

function broadcastScene(filePath: string, content: string, source: object): void {
  for (const subscriber of sceneSubscribers.get(sceneKey(filePath)) ?? []) {
    subscriber(content, source);
  }
}

function subscribeScene(
  filePath: string,
  subscriber: (content: string, source?: object) => void,
): () => void {
  const key = sceneKey(filePath);
  const subscribers = sceneSubscribers.get(key) ?? new Set();
  subscribers.add(subscriber);
  sceneSubscribers.set(key, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) sceneSubscribers.delete(key);
  };
}

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function currentLanguage(): 'zh-CN' | 'en' {
  const language = document.documentElement.lang.toLowerCase();
  return language.startsWith('zh') || !language ? 'zh-CN' : 'en';
}

type ExcalidrawToolName =
  | 'selection'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'eraser'
  | 'hand';

type ChromeApi = NonNullable<ReturnType<ExcalidrawVendorHandle['getApi']>>;

interface ChromeHosts {
  menu: HTMLElement | null;
  auxiliary: HTMLElement | null;
  tools: HTMLElement | null;
}

interface NativeControlInfo {
  label: string;
  shortcut: string;
  iconMarkup: string;
}

interface NativeToolInfo extends NativeControlInfo {
  name: ExcalidrawToolName;
}

const EXCALIDRAW_TOOLS: ReadonlyArray<{
  name: ExcalidrawToolName;
  label: string;
  icon: typeof MousePointer2;
  shortcut?: string;
}> = [
  { name: 'selection', label: '选择', icon: MousePointer2, shortcut: 'V' },
  { name: 'rectangle', label: '矩形', icon: Square, shortcut: 'R' },
  { name: 'diamond', label: '菱形', icon: Diamond },
  { name: 'ellipse', label: '椭圆', icon: Circle, shortcut: 'O' },
  { name: 'arrow', label: '箭头', icon: ArrowRight, shortcut: 'A' },
  { name: 'line', label: '直线', icon: Minus, shortcut: 'L' },
  { name: 'freedraw', label: '画笔', icon: Pencil, shortcut: 'P' },
  { name: 'text', label: '文字', icon: Type, shortcut: 'T' },
  { name: 'image', label: '图片', icon: ImageIcon },
  { name: 'eraser', label: '橡皮擦', icon: Eraser, shortcut: 'E' },
  { name: 'hand', label: '手型', icon: Hand, shortcut: 'H' },
];

const PRIMITIVE_TOOL_NAMES: ReadonlySet<ExcalidrawToolName> = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'arrow',
  'line',
]);
const SECONDARY_TOOL_NAMES: ReadonlySet<ExcalidrawToolName> = new Set([
  'freedraw',
  'text',
  'image',
  'eraser',
]);

function getNativeControlInfo(
  root: HTMLElement,
  selector: string,
  fallbackLabel: string,
): NativeControlInfo | null {
  const control = root.querySelector<HTMLElement>(selector);
  if (!control) return null;
  const controlRoot = control.closest<HTMLElement>('label, .ToolIcon') ?? control;
  const icon = controlRoot.querySelector<SVGElement>('svg');
  if (!icon) return null;
  return {
    label: control.getAttribute('aria-label') || fallbackLabel,
    shortcut: control.getAttribute('aria-keyshortcuts') || '',
    iconMarkup: icon.outerHTML,
  };
}

function nativeControlInfoMatches(
  current: NativeControlInfo | null,
  next: NativeControlInfo | null,
): boolean {
  return current?.label === next?.label && current?.shortcut === next?.shortcut && current?.iconMarkup === next?.iconMarkup;
}

function getNativeToolInfo(root: HTMLElement, tool: (typeof EXCALIDRAW_TOOLS)[number]): NativeToolInfo | null {
  const native = getNativeControlInfo(root, `[data-testid='toolbar-${tool.name}']`, tool.label);
  if (!native) return null;
  return { name: tool.name, ...native };
}

function nativeToolInfoMatches(current: NativeToolInfo[], next: NativeToolInfo[]): boolean {
  return current.length === next.length && current.every((tool, index) => {
    const candidate = next[index];
    return (
      tool.name === candidate?.name &&
      tool.label === candidate?.label &&
      tool.shortcut === candidate?.shortcut &&
      tool.iconMarkup === candidate?.iconMarkup
    );
  });
}

function NativeControlIcon({ control, fallback }: { control: NativeControlInfo | null; fallback: ReactNode }) {
  if (control?.iconMarkup) {
    return (
      <span className="newmax-excalidraw-native-control-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: control.iconMarkup }} />
    );
  }
  return <>{fallback}</>;
}

function dispatchCanvasShortcut(root: HTMLElement, key: string, code: string, shiftKey = false): void {
  const target = root.querySelector<HTMLElement>('.excalidraw');
  if (!target) return;
  target.focus();
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code,
      bubbles: true,
      cancelable: true,
      shiftKey,
      metaKey: isMac,
      ctrlKey: !isMac,
    }),
  );
}

function nativeClick(root: HTMLElement, selector: string): void {
  root.querySelector<HTMLElement>(selector)?.click();
}

function makeHost(
  current: HTMLElement | null,
  attribute: 'newmaxExcalidrawMainMenuHost' | 'newmaxExcalidrawToolbarAuxHost' | 'newmaxExcalidrawToolMenuHost',
): HTMLElement {
  if (current?.isConnected) return current;
  const host = document.createElement('span');
  host.dataset[attribute] = '';
  return host;
}

/**
 * NewMax's Excalidraw chrome is a small DOM adapter around the upstream
 * editor. It keeps the vendor toolbar as the source of truth, then portals
 * compact controls into the same slots so menus, keyboard shortcuts and
 * accessibility labels continue to come from Excalidraw itself.
 */
function NewMaxExcalidrawChrome({ handle }: { handle: ExcalidrawVendorHandle }) {
  const root = handle.getRoot();
  const [api, setApi] = useState<ChromeApi | null>(() => handle.getApi());
  const [hosts, setHosts] = useState<ChromeHosts>({ menu: null, auxiliary: null, tools: null });
  const hostsRef = useRef(hosts);
  const [nativeControls, setNativeControls] = useState<{
    menu: NativeControlInfo | null;
    lock: NativeControlInfo | null;
    hand: NativeControlInfo | null;
    selection: NativeControlInfo | null;
  }>({ menu: null, lock: null, hand: null, selection: null });
  const nativeControlsRef = useRef(nativeControls);
  const [nativeTools, setNativeTools] = useState<NativeToolInfo[]>(() =>
    EXCALIDRAW_TOOLS.map((tool) => ({
      name: tool.name,
      label: tool.label,
      shortcut: tool.shortcut ?? '',
      iconMarkup: '',
    })),
  );
  const nativeToolsRef = useRef(nativeTools);
  const [activeTool, setActiveTool] = useState<ExcalidrawToolName>('selection');
  const [locked, setLocked] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    setApi(handle.getApi());
    return handle.onReady(() => setApi(handle.getApi()));
  }, [handle]);

  useEffect(() => {
    if (!api) return;
    const syncState = (next: Record<string, unknown>) => {
      const nextActive = next.activeTool;
      if (nextActive && typeof nextActive === 'object') {
        const type = (nextActive as { type?: unknown }).type;
        if (typeof type === 'string' && EXCALIDRAW_TOOLS.some((tool) => tool.name === type)) {
          setActiveTool(type as ExcalidrawToolName);
        }
        setLocked(Boolean((nextActive as { locked?: unknown }).locked));
      }
      const nextZoom = next.zoom;
      const value =
        typeof nextZoom === 'number'
          ? nextZoom
          : nextZoom && typeof nextZoom === 'object'
            ? (nextZoom as { value?: unknown }).value
            : undefined;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        setZoom(value);
      }
    };
    syncState(api.getAppState());
    return api.onChange((_elements, next) => syncState(next));
  }, [api]);

  useEffect(() => {
    const syncHosts = () => {
      const mobileRoot = root.querySelector<HTMLElement>('.excalidraw--mobile');
      const toolbarContainer = mobileRoot?.querySelector<HTMLElement>('.App-toolbar-container');
      const toolbar = toolbarContainer?.querySelector<HTMLElement>('.App-toolbar--mobile');
      const toolbarRow = toolbar?.querySelector<HTMLElement>('.Stack_horizontal');
      const selection = root
        .querySelector<HTMLElement>("[data-testid='toolbar-selection']")
        ?.closest<HTMLElement>('.Shape, label');
      const nextHosts = { ...hostsRef.current };

      if (mobileRoot && toolbarContainer && toolbar && toolbarRow && selection) {
        const menuHost = makeHost(nextHosts.menu, 'newmaxExcalidrawMainMenuHost');
        if (menuHost.nextElementSibling !== toolbar) toolbarContainer.insertBefore(menuHost, toolbar);
        const auxiliary = makeHost(nextHosts.auxiliary, 'newmaxExcalidrawToolbarAuxHost');
        if (auxiliary.nextElementSibling !== selection) toolbarRow.insertBefore(auxiliary, selection);
        nextHosts.menu = menuHost;
        nextHosts.auxiliary = auxiliary;

        const nextControls = {
          menu: getNativeControlInfo(root, '.App-toolbar-content .main-menu-trigger', '画布菜单'),
          lock: getNativeControlInfo(root, "[data-testid='toolbar-lock']", '保持工具激活'),
          hand: getNativeControlInfo(root, "[data-testid='toolbar-hand']", '手型工具'),
          selection: getNativeControlInfo(root, "[data-testid='toolbar-selection']", '选择工具'),
        };
        if (
          !nativeControlInfoMatches(nativeControlsRef.current.menu, nextControls.menu) ||
          !nativeControlInfoMatches(nativeControlsRef.current.lock, nextControls.lock) ||
          !nativeControlInfoMatches(nativeControlsRef.current.hand, nextControls.hand) ||
          !nativeControlInfoMatches(nativeControlsRef.current.selection, nextControls.selection)
        ) {
          nativeControlsRef.current = nextControls;
          setNativeControls(nextControls);
        }
      } else {
        nextHosts.menu?.remove();
        nextHosts.auxiliary?.remove();
        nextHosts.menu = null;
        nextHosts.auxiliary = null;
        if (nativeControlsRef.current.menu || nativeControlsRef.current.lock || nativeControlsRef.current.hand || nativeControlsRef.current.selection) {
          const emptyControls = { menu: null, lock: null, hand: null, selection: null };
          nativeControlsRef.current = emptyControls;
          setNativeControls(emptyControls);
        }
      }

      if (selection?.parentElement) {
        const tools = makeHost(nextHosts.tools, 'newmaxExcalidrawToolMenuHost');
        if (selection.nextElementSibling !== tools) selection.after(tools);
        nextHosts.tools = tools;
      } else {
        nextHosts.tools?.remove();
        nextHosts.tools = null;
      }

      if (
        hostsRef.current.menu !== nextHosts.menu ||
        hostsRef.current.auxiliary !== nextHosts.auxiliary ||
        hostsRef.current.tools !== nextHosts.tools
      ) {
        hostsRef.current = nextHosts;
        setHosts(nextHosts);
      }
    };

    syncHosts();
    const observer = new MutationObserver(syncHosts);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      hostsRef.current.menu?.remove();
      hostsRef.current.auxiliary?.remove();
      hostsRef.current.tools?.remove();
      hostsRef.current = { menu: null, auxiliary: null, tools: null };
    };
  }, [root]);

  useEffect(() => {
    const updateCompact = () => {
      const width = root.getBoundingClientRect().width;
      if (width > 0) setCompact(width <= 560);
    };
    updateCompact();
    window.addEventListener('resize', updateCompact);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateCompact);
    observer?.observe(root);
    return () => {
      window.removeEventListener('resize', updateCompact);
      observer?.disconnect();
    };
  }, [root]);

  useEffect(() => {
    const syncTools = () => {
      const nextTools = EXCALIDRAW_TOOLS.map((tool) => {
        const native = getNativeToolInfo(root, tool);
        return native ?? {
          name: tool.name,
          label: tool.label,
          shortcut: tool.shortcut ?? '',
          iconMarkup: '',
        };
      });
      if (!nativeToolInfoMatches(nativeToolsRef.current, nextTools)) {
        nativeToolsRef.current = nextTools;
        setNativeTools(nextTools);
      }
    };
    syncTools();
    const observer = new MutationObserver(syncTools);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);

  const selectTool = useCallback(
    (name: ExcalidrawToolName) => {
      if (!api) return;
      api.setActiveTool(name === 'image' ? { type: name, insertOnCanvasDirectly: false } : { type: name });
      setActiveTool(name);
      setToolsOpen(false);
    },
    [api],
  );

  const toggleLock = useCallback(() => {
    if (!api) return;
    api.setActiveTool({ type: activeTool, locked: !locked });
    setLocked((value) => !value);
  }, [activeTool, api, locked]);

  const visibleToolNames = compact
    ? new Set<ExcalidrawToolName>([...PRIMITIVE_TOOL_NAMES, ...SECONDARY_TOOL_NAMES])
    : PRIMITIVE_TOOL_NAMES;
  const visibleTools = nativeTools.filter((tool) => visibleToolNames.has(tool.name));
  const triggerTool = visibleTools.find((tool) => tool.name === activeTool) ?? nativeTools.find((tool) => tool.name === 'rectangle');
  const triggerDefinition = EXCALIDRAW_TOOLS.find((tool) => tool.name === triggerTool?.name) ?? EXCALIDRAW_TOOLS[1];
  const TriggerIcon = triggerDefinition?.icon ?? Square;
  const triggerFallback = <TriggerIcon size={18} aria-hidden="true" />;

  const mobileMenu = hosts.menu
    ? createPortal(
        <button
          type="button"
          className="newmax-excalidraw-toolbar-proxy"
          aria-label={nativeControls.menu?.label ?? '画布菜单'}
          title={nativeControls.menu?.label ?? '画布菜单'}
          data-newmax-excalidraw-main-menu-trigger="true"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            nativeClick(root, '.App-toolbar-content .main-menu-trigger');
          }}
        >
          <NativeControlIcon control={nativeControls.menu} fallback={<Menu size={18} aria-hidden="true" />} />
        </button>,
        hosts.menu,
      )
    : null;

  const auxiliary = hosts.auxiliary
    ? createPortal(
        <>
          <button
            type="button"
            className="newmax-excalidraw-toolbar-proxy"
            aria-label={nativeControls.lock?.label ?? (locked ? '解锁工具' : '锁定工具')}
            title={nativeControls.lock?.label ?? (locked ? '解锁工具' : '锁定工具')}
            aria-pressed={locked}
            data-newmax-excalidraw-lock-trigger="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (nativeControls.lock) nativeClick(root, "[data-testid='toolbar-lock']");
              else toggleLock();
            }}
          >
            <NativeControlIcon
              control={nativeControls.lock}
              fallback={locked ? <Lock size={18} aria-hidden="true" /> : <Unlock size={18} aria-hidden="true" />}
            />
          </button>
          <span className="newmax-excalidraw-navigation-tools">
            <button
              type="button"
              className={`newmax-excalidraw-toolbar-proxy${activeTool === 'hand' ? ' is-active' : ''}`}
              aria-label={nativeControls.hand?.label ?? '手型工具'}
              title={nativeControls.hand?.label ?? '手型工具'}
              aria-pressed={activeTool === 'hand'}
              data-newmax-excalidraw-hand-trigger="true"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (nativeControls.hand) nativeClick(root, "[data-testid='toolbar-hand']");
                else selectTool('hand');
              }}
            >
              <NativeControlIcon control={nativeControls.hand} fallback={<Hand size={18} aria-hidden="true" />} />
            </button>
            <button
              type="button"
              className={`newmax-excalidraw-toolbar-proxy${activeTool === 'selection' ? ' is-active' : ''}`}
              aria-label={nativeControls.selection?.label ?? '选择工具'}
              title={nativeControls.selection?.label ?? '选择工具'}
              aria-pressed={activeTool === 'selection'}
              data-newmax-excalidraw-selection-trigger="true"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (nativeControls.selection) nativeClick(root, "[data-testid='toolbar-selection']");
                else selectTool('selection');
              }}
            >
              <NativeControlIcon
                control={nativeControls.selection}
                fallback={<MousePointer2 size={18} aria-hidden="true" />}
              />
            </button>
          </span>
        </>,
        hosts.auxiliary,
      )
    : null;

  const toolMenu = hosts.tools
    ? createPortal(
        <span
          className="newmax-excalidraw-tool-menu-control"
          data-open={toolsOpen ? 'true' : 'false'}
          data-newmax-excalidraw-tool-menu-control="true"
        >
          <button
            type="button"
            className={`newmax-excalidraw-tool-select${triggerTool?.name === activeTool ? ' is-active' : ''}`}
            aria-label={triggerTool?.label ?? '绘图工具'}
            title={triggerTool?.label ?? '绘图工具'}
            aria-pressed={triggerTool?.name === activeTool}
            data-newmax-excalidraw-tool-select="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (triggerTool) selectTool(triggerTool.name);
            }}
          >
            <span
              className="newmax-excalidraw-tool-menu-trigger-icon"
              data-newmax-excalidraw-tool-menu-trigger-icon={triggerTool?.name ?? 'drawing-tools'}
              aria-hidden="true"
            >
              <NativeControlIcon control={triggerTool ?? null} fallback={triggerFallback} />
            </span>
          </button>
          <button
            type="button"
            className="newmax-excalidraw-tool-menu-trigger"
            aria-label="更多绘图工具"
            title="更多绘图工具"
            aria-expanded={toolsOpen}
            data-newmax-excalidraw-tool-menu-trigger="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setToolsOpen((value) => !value);
            }}
          >
            <span className="newmax-excalidraw-tool-menu-trigger-chevron" aria-hidden="true">
              <ArrowDown size={12} />
            </span>
          </button>
          {toolsOpen ? (
            <div className="newmax-excalidraw-tool-menu" role="menu" data-newmax-excalidraw-tool-menu="true">
              {visibleTools.map((tool) => {
                const definition = EXCALIDRAW_TOOLS.find((candidate) => candidate.name === tool.name);
                const ToolIcon = definition?.icon ?? Square;
                return (
                  <button
                    key={tool.name}
                    type="button"
                    role="menuitem"
                    aria-label={tool.label}
                    className={tool.name === activeTool ? 'is-active' : ''}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectTool(tool.name);
                    }}
                  >
                    <span className="newmax-excalidraw-tool-glyph" aria-hidden="true">
                      <NativeControlIcon control={tool} fallback={<ToolIcon size={18} />} />
                    </span>
                    <span>{tool.label}</span>
                    {tool.shortcut ? <kbd>{tool.shortcut}</kbd> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>,
        hosts.tools,
      )
    : null;

  const canvasControls = compact
    ? createPortal(
        <div className="newmax-excalidraw-canvas-controls" data-newmax-excalidraw-canvas-controls="true">
          <div className="newmax-excalidraw-canvas-control-group">
            <button type="button" aria-label="放大" title="放大" onClick={() => dispatchCanvasShortcut(root, '+', 'Equal', true)}>
              <Plus size={17} aria-hidden="true" />
            </button>
            <button type="button" className="newmax-excalidraw-reset-zoom" aria-label="重置缩放" title="重置缩放" onClick={() => dispatchCanvasShortcut(root, '0', 'Digit0')}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" aria-label="缩小" title="缩小" onClick={() => dispatchCanvasShortcut(root, '-', 'Minus')}>
              <Minus size={17} aria-hidden="true" />
            </button>
            <span className="newmax-excalidraw-canvas-control-divider" aria-hidden="true" />
            <button type="button" aria-label="撤销" title="撤销" onClick={() => dispatchCanvasShortcut(root, 'z', 'KeyZ')}>
              <RotateCcw size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-label="重做" title="重做" onClick={() => dispatchCanvasShortcut(root, 'z', 'KeyZ', true)}>
              <Redo2 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>,
        root,
      )
    : null;

  return (
    <>
      {mobileMenu}
      {auxiliary}
      {toolMenu}
      {canvasControls}
    </>
  );
}

/** NewMax replaces Excalidraw's text-heavy sidebar tabs with compact glyphs. */
function ExcalidrawSidebarTabIcons({ root }: { root: HTMLElement }) {
  const [tabs, setTabs] = useState<{ search: HTMLElement | null; library: HTMLElement | null }>({
    search: null,
    library: null,
  });
  const tabsRef = useRef(tabs);

  useEffect(() => {
    const syncTabs = () => {
      const triggers = root.querySelectorAll<HTMLElement>('.default-sidebar .sidebar-triggers .sidebar-tab-trigger');
      const nextTabs = { search: triggers.item(0) || null, library: triggers.item(1) || null };
      if (tabsRef.current.search === nextTabs.search && tabsRef.current.library === nextTabs.library) return;
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
    };
    syncTabs();
    const observer = new MutationObserver(syncTabs);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);

  return (
    <>
      {tabs.search
        ? createPortal(
            <Search size={18} aria-hidden="true" data-newmax-sidebar-tab-icon="search" />,
            tabs.search,
          )
        : null}
      {tabs.library
        ? createPortal(
            <Library size={18} aria-hidden="true" data-newmax-sidebar-tab-icon="library" />,
            tabs.library,
          )
        : null}
    </>
  );
}

export function ExcalidrawPreview({
  content,
  filePath,
  isActive = true,
  onChange,
  onHandle,
}: ExcalidrawPreviewProps): JSX.Element {
  const parsed = useMemo(() => parseExcalidrawDocument(content), [content]);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ExcalidrawVendorHandle | null>(null);
  const appliedContentRef = useRef(content);
  const receivingRef = useRef(false);
  const debounceTimerRef = useRef<number>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [editorHandle, setEditorHandle] = useState<ExcalidrawVendorHandle | null>(null);

  const documentValue: ExcalidrawDocument | null = parsed.ok ? parsed.document : null;

  const applyRemoteContent = useCallback((nextContent: string, source?: object) => {
    if (source === handleRef.current || nextContent === appliedContentRef.current) return;
    const next = parseExcalidrawDocument(nextContent);
    if (!next.ok) return;
    receivingRef.current = true;
    appliedContentRef.current = nextContent;
    handleRef.current?.update(next.document);
    window.setTimeout(() => {
      receivingRef.current = false;
    }, 500);
  }, []);

  useEffect(() => {
    if (!filePath) return;
    return subscribeScene(filePath, applyRemoteContent);
  }, [applyRemoteContent, filePath]);

  useEffect(() => {
    if (!documentValue || !containerRef.current) return;
    let disposed = false;
    const container = containerRef.current;
    void loadExcalidrawVendor()
      .then((vendor) => {
        if (disposed || !containerRef.current) return;
        handleRef.current?.dispose();
        const handle = vendor.mountExcalidraw(container, {
          document: documentValue,
          theme: currentTheme(),
          langCode: currentLanguage(),
          onChange: (elements, appState, files) => {
            if (receivingRef.current) {
              receivingRef.current = false;
              return;
            }
            const nextContent = serializeExcalidrawDocument(elements, appState, files);
            appliedContentRef.current = nextContent;
            if (filePath) broadcastScene(filePath, nextContent, handle);
            if (debounceTimerRef.current !== undefined) {
              window.clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = window.setTimeout(() => {
              debounceTimerRef.current = undefined;
              onChangeRef.current?.(nextContent);
            }, 300);
          },
        });
        handleRef.current = handle;
        setEditorHandle(handle);
        onHandle?.(handle);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setVendorError(error instanceof Error ? error.message : '设计稿编辑器加载失败');
        }
      });
    return () => {
      disposed = true;
      handleRef.current?.dispose();
      setEditorHandle(null);
      onHandle?.(null);
      handleRef.current = null;
      if (debounceTimerRef.current !== undefined) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = undefined;
      }
    };
    // The editor is recreated only when the file identity changes. Content
    // updates are applied below to preserve undo history and avoid resetting
    // the scene after every debounced onChange callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, onHandle]);

  useEffect(() => {
    if (!parsed.ok || content === appliedContentRef.current) return;
    appliedContentRef.current = content;
    handleRef.current?.update(parsed.document);
  }, [content, parsed]);

  useEffect(() => {
    const root = editorHandle?.getRoot();
    if (!root) return;
    const patchNativeSurface = () => {
      // NewMax removes upstream-only actions that have no meaning in the
      // embedded editor, while keeping the native menu as the source of
      // truth for all supported actions.
      root.querySelectorAll<HTMLElement>('[data-testid="toolbar-embeddable"]').forEach((node) => node.remove());
      root.querySelectorAll<HTMLElement>('div').forEach((node) => {
        if (node.childNodes.length === 1 && node.textContent?.trim() === 'Generate') node.remove();
      });
    };
    patchNativeSurface();
    const observer = new MutationObserver(patchNativeSurface);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [editorHandle]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== undefined) window.clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // Keep wide scenes scrollable in the same horizontal viewport used by
  // NewMax. Ctrl+wheel remains available to Excalidraw for zooming.
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || viewport.scrollWidth <= viewport.clientWidth) return;
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (delta === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
      viewport.scrollLeft = Math.min(maxScrollLeft, Math.max(0, viewport.scrollLeft + delta));
    };
    viewport.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel, true);
  }, []);

  if (!documentValue) {
    return (
      <div className="shell-excalidraw-error" role="alert">
        <strong>设计稿</strong>
        <span>{parsed.ok ? '设计稿内容为空' : parsed.error}</span>
      </div>
    );
  }

  if (vendorError) {
    return (
      <div className="shell-excalidraw-error" role="alert">
        <strong>设计稿编辑器</strong>
        <span>{vendorError}</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollViewportRef}
      className="excalidraw-scroll-viewport"
      data-testid="excalidraw-scroll-viewport"
    >
      <div className="excalidraw-wrapper">
        <form onSubmit={(event) => event.preventDefault()}>
          <div
            ref={containerRef}
            className="shell-excalidraw-preview"
            data-testid="excalidraw-preview"
            data-active={isActive ? 'true' : 'false'}
            aria-label="Excalidraw 设计稿"
          />
        </form>
        {editorHandle ? (
          <>
            <ExcalidrawSidebarTabIcons root={editorHandle.getRoot()} />
            <NewMaxExcalidrawChrome handle={editorHandle} />
          </>
        ) : null}
      </div>
    </div>
  );
}

export function emptyExcalidrawContent(): string {
  return JSON.stringify(createEmptyExcalidrawDocument(), null, 2);
}
