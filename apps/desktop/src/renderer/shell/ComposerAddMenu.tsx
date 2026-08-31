import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  FileCode2,
  FolderOpen,
  Globe2,
  ListTodo,
  NotebookPen,
  Paperclip,
  Plus,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSION_OPTIONS, type PermissionMode } from './compose-toolbar.js';
import { ComposerMenuHighlight } from './ComposerMenuHighlight.js';
import { useNewMaxPopoverPresence } from './NewMaxComposerFrame.js';
import { keepListboxOptionVisible } from './compose-picker-scroll.js';
import { MeetingMinutesDialog } from './MeetingMinutesDialog.js';

export interface ComposerWorkspaceFile {
  path: string;
  name: string;
  kind: 'file' | 'dir';
}

interface ComposerAddSearchAnchor {
  before: string;
  after: string;
}

type ComposerAddItem =
  | { kind: 'attach'; key: 'attach'; Icon: LucideIcon }
  | { kind: 'plan'; key: 'plan'; Icon: LucideIcon }
  | { kind: 'goal'; key: 'goal'; Icon: LucideIcon }
  | { kind: 'meeting'; key: 'meeting'; Icon: LucideIcon }
  | { kind: 'network'; key: 'network'; Icon: LucideIcon }
  | {
      kind: 'permission';
      key: `permission:${PermissionMode}`;
      mode: PermissionMode;
      Icon: LucideIcon;
    }
  | { kind: 'file'; key: string; file: ComposerWorkspaceFile };

function resolveSearchQuery(value: string, anchor: ComposerAddSearchAnchor | null): string {
  if (!anchor) return '';
  if (value.length < anchor.before.length + anchor.after.length) return '';
  if (!value.startsWith(anchor.before) || !value.endsWith(anchor.after)) return '';
  return value.slice(anchor.before.length, value.length - anchor.after.length).trim();
}

function fileParts(file: ComposerWorkspaceFile): { name: string; directory: string } {
  const normalized = file.path.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const fallbackName = segments.pop() || file.path;
  return { name: file.name || fallbackName, directory: segments.join('/') };
}

function stopKeyboardEvent(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export interface ComposerAddControlProps {
  variant: 'empty' | 'conversation';
  open: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  composerRef: RefObject<HTMLElement | null>;
  value: string;
  onValueChange(value: string): void;
  onOpenChange(open: boolean): void;
  onBeforeOpen?(): void;
  workspaceFolder?: string;
  selectedFilePaths: readonly string[];
  networkEnabled: boolean;
  permissionMode: PermissionMode;
  /** NewMax moves permission choices into Add only after the toolbar collapses them. */
  showPermissionItems?: boolean;
  disabled?: boolean;
  attachDisabled?: boolean;
  onAttach(): void;
  onPlan(): void;
  onGoal(): void;
  onNetworkChange(enabled: boolean): void;
  onPermissionChange(mode: PermissionMode): void;
  onFile(file: ComposerWorkspaceFile): void;
  triggerTestId?: string;
  menuTestId?: string;
}

/** Shared NewMax 1.1.15 `+` trigger and action sheet for both composer entry points. */
export function ComposerAddControl({
  variant,
  open,
  inputRef,
  composerRef,
  value,
  onValueChange,
  onOpenChange,
  onBeforeOpen,
  workspaceFolder,
  selectedFilePaths,
  networkEnabled,
  permissionMode,
  showPermissionItems = false,
  disabled = false,
  attachDisabled = false,
  onAttach,
  onPlan,
  onGoal,
  onNetworkChange,
  onPermissionChange,
  onFile,
  triggerTestId,
  menuTestId,
}: ComposerAddControlProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchAnchorRef = useRef<ComposerAddSearchAnchor | null>(null);
  const [files, setFiles] = useState<ComposerWorkspaceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [meetingOpen, setMeetingOpen] = useState(false);
  const menuPresence = useNewMaxPopoverPresence(open);
  const liveQuery = resolveSearchQuery(value, searchAnchorRef.current);
  const lastOpenQueryRef = useRef(liveQuery);
  if (open) lastOpenQueryRef.current = liveQuery;
  const query = open ? liveQuery : lastOpenQueryRef.current;
  const searching = query.length > 0;

  const close = useCallback(
    (focusComposer = true) => {
      onOpenChange(false);
      if (focusComposer) {
        inputRef.current?.focus();
        window.requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [inputRef, onOpenChange],
  );

  useEffect(() => {
    if (!menuPresence.rendered) searchAnchorRef.current = null;
  }, [menuPresence.rendered]);

  const captureSearchAnchor = useCallback(() => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    searchAnchorRef.current = {
      before: value.slice(0, start),
      after: value.slice(end),
    };
  }, [inputRef, value]);

  const toggle = useCallback(() => {
    if (disabled) return;
    if (open) {
      close(true);
      return;
    }
    onBeforeOpen?.();
    captureSearchAnchor();
    onOpenChange(true);
    inputRef.current?.focus();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [captureSearchAnchor, close, disabled, inputRef, onBeforeOpen, onOpenChange, open]);

  useEffect(() => {
    if (!open) {
      setLoading(false);
      return;
    }
    const root = workspaceFolder?.trim();
    const api = window.syncThink?.runtime;
    if (!root || !api?.listProjectFiles) {
      setFiles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api
      .listProjectFiles({ root, query, maxEntries: 80 })
      .then((result) => {
        if (!cancelled) setFiles(result.files ?? []);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query, workspaceFolder]);

  const actionItems = useMemo<ComposerAddItem[]>(() => {
    if (searching) return [];
    return [
      { kind: 'attach', key: 'attach', Icon: Paperclip },
      { kind: 'plan', key: 'plan', Icon: ListTodo },
      { kind: 'goal', key: 'goal', Icon: Target },
      { kind: 'meeting', key: 'meeting', Icon: NotebookPen },
      { kind: 'network', key: 'network', Icon: Globe2 },
      ...(showPermissionItems
        ? PERMISSION_OPTIONS.map(
            (option): ComposerAddItem => ({
              kind: 'permission',
              key: `permission:${option.value}`,
              mode: option.value,
              Icon: option.Icon,
            }),
          )
        : []),
    ];
  }, [searching, showPermissionItems]);
  const fileItems = useMemo<ComposerAddItem[]>(
    () => files.map((file) => ({ kind: 'file', key: `file:${file.kind}:${file.path}`, file })),
    [files],
  );
  const items = useMemo(() => [...actionItems, ...fileItems], [actionItems, fileItems]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex((current) => (items.length === 0 ? 0 : Math.min(current, items.length - 1)));
  }, [items.length, open]);

  useLayoutEffect(() => {
    if (!open) return;
    keepListboxOptionVisible(scrollRef.current, activeIndex);
  }, [activeIndex, items.length, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = composerRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = Math.max(320, window.innerWidth);
      const width = Math.max(0, Math.min(rect.width, viewportWidth - 16));
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
      const gap = 8;
      if (variant === 'empty') {
        const available = window.innerHeight - rect.bottom - gap - 24;
        setMenuStyle({
          position: 'fixed',
          top: rect.bottom + gap,
          left,
          width,
          maxHeight: Math.max(96, Math.min(420, Math.floor(available))),
          zIndex: 10002,
        });
        return;
      }
      const available = rect.top - gap - 24;
      setMenuStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + gap,
        left,
        width,
        maxHeight: Math.max(96, Math.min(420, Math.floor(available))),
        zIndex: 10002,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [composerRef, open, variant]);

  const consumeSearchFragment = useCallback(() => {
    const anchor = searchAnchorRef.current;
    if (!anchor) return { nextValue: value, caret: inputRef.current?.selectionStart ?? value.length };
    const valid =
      value.length >= anchor.before.length + anchor.after.length &&
      value.startsWith(anchor.before) &&
      value.endsWith(anchor.after);
    if (!valid) return { nextValue: value, caret: inputRef.current?.selectionStart ?? value.length };
    const nextValue = `${anchor.before}${anchor.after}`;
    const caret = anchor.before.length;
    onValueChange(nextValue);
    searchAnchorRef.current = {
      before: nextValue.slice(0, caret),
      after: nextValue.slice(caret),
    };
    return { nextValue, caret };
  }, [inputRef, onValueChange, value]);

  const execute = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      if (item.kind === 'attach') {
        if (attachDisabled) return;
        onAttach();
        close(false);
        return;
      }
      if (item.kind === 'plan') {
        consumeSearchFragment();
        onPlan();
        close(true);
        return;
      }
      if (item.kind === 'goal') {
        consumeSearchFragment();
        onGoal();
        close(true);
        return;
      }
      if (item.kind === 'meeting') {
        consumeSearchFragment();
        setMeetingOpen(true);
        close(false);
        return;
      }
      if (item.kind === 'network') {
        onNetworkChange(!networkEnabled);
        return;
      }
      if (item.kind === 'permission') {
        onPermissionChange(item.mode);
        close(true);
        return;
      }
      const { nextValue, caret } = consumeSearchFragment();
      onFile(item.file);
      window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(Math.min(caret, nextValue.length), Math.min(caret, nextValue.length));
      });
    },
    [
      attachDisabled,
      close,
      consumeSearchFragment,
      inputRef,
      items,
      networkEnabled,
      onAttach,
      onFile,
      onGoal,
      onNetworkChange,
      onPermissionChange,
      onPlan,
    ],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') {
        stopKeyboardEvent(event);
        close(true);
        return;
      }
      if (event.key === 'ArrowDown' && items.length > 0) {
        stopKeyboardEvent(event);
        setActiveIndex((current) => (current + 1) % items.length);
        return;
      }
      if (event.key === 'ArrowUp' && items.length > 0) {
        stopKeyboardEvent(event);
        setActiveIndex((current) => (current - 1 + items.length) % items.length);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && items.length > 0) {
        if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) return;
        stopKeyboardEvent(event);
        execute(activeIndex);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activeIndex, close, execute, items.length, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target) ||
        inputRef.current?.contains(target)
      ) {
        return;
      }
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [close, inputRef, open]);

  const renderItem = (item: ComposerAddItem, index: number) => {
    const selected = index === activeIndex;
    const common = {
      role: 'option',
      'aria-selected': selected,
      'data-composer-menu-index': index,
      'data-composer-add-selected': selected ? 'true' : undefined,
      onMouseEnter: () => setActiveIndex(index),
      onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
      onClick: () => execute(index),
    } as const;

    if (item.kind === 'attach') {
      return (
        <button
          {...common}
          key={item.key}
          type="button"
          className="shell-composer-add-menu__item"
          disabled={attachDisabled}
        >
          <Paperclip size={16} aria-hidden="true" />
          <span className="shell-composer-add-menu__copy">
            <span className="shell-composer-add-menu__label">附加文件</span>
          </span>
        </button>
      );
    }
    if (item.kind === 'plan' || item.kind === 'goal') {
      const Icon = item.Icon;
      const isPlan = item.kind === 'plan';
      return (
        <button {...common} key={item.key} type="button" className="shell-composer-add-menu__item">
          <Icon size={16} aria-hidden="true" />
          <span className="shell-composer-add-menu__copy">
            <span className="shell-composer-add-menu__label">
              {isPlan ? '规划模式' : '目标模式'}
            </span>
            <span className="shell-composer-add-menu__description">
              {isPlan ? '先制定方案，再开始执行' : '持续工作，直到达成目标'}
            </span>
          </span>
        </button>
      );
    }
    if (item.kind === 'meeting') {
      return (
        <button {...common} key={item.key} type="button" className="shell-composer-add-menu__item">
          <NotebookPen size={16} aria-hidden="true" />
          <span className="shell-composer-add-menu__copy">
            <span className="shell-composer-add-menu__label">会议纪要</span>
            <span className="shell-composer-add-menu__description">连续转写并整理会议结论</span>
          </span>
        </button>
      );
    }
    if (item.kind === 'network') {
      return (
        <button
          {...common}
          key={item.key}
          type="button"
          className="shell-composer-add-menu__item"
          aria-checked={networkEnabled}
        >
          <Globe2 size={16} aria-hidden="true" />
          <span className="shell-composer-add-menu__copy">
            <span className="shell-composer-add-menu__label">联网搜索</span>
            <span className="shell-composer-add-menu__description">搜索并引用最新网页信息</span>
          </span>
          <span className="shell-composer-add-menu__segments" aria-hidden="true">
            <span className={!networkEnabled ? 'is-active' : ''}>关</span>
            <span className={networkEnabled ? 'is-active' : ''}>开</span>
          </span>
        </button>
      );
    }
    if (item.kind === 'permission') {
      const option = PERMISSION_OPTIONS.find((candidate) => candidate.value === item.mode)!;
      const Icon = item.Icon;
      const checked = permissionMode === item.mode;
      return (
        <button
          {...common}
          key={item.key}
          type="button"
          className="shell-composer-add-menu__item"
          aria-checked={checked}
        >
          <Icon size={16} aria-hidden="true" />
          <span className="shell-composer-add-menu__copy">
            <span className="shell-composer-add-menu__label">{option.title}</span>
            <span className="shell-composer-add-menu__description">{option.desc}</span>
          </span>
          <Check
            size={16}
            className={`shell-composer-add-menu__check${checked ? ' is-visible' : ''}`}
            aria-hidden="true"
          />
        </button>
      );
    }

    const selectedFile = selectedFilePaths.includes(item.file.path);
    const { name, directory } = fileParts(item.file);
    return (
      <button
        {...common}
        key={item.key}
        type="button"
        className="shell-composer-add-menu__item shell-composer-add-menu__file"
        aria-pressed={selectedFile}
      >
        {selectedFile ? (
          <Check size={16} className="is-file-selected" aria-hidden="true" />
        ) : item.file.kind === 'dir' ? (
          <FolderOpen size={16} aria-hidden="true" />
        ) : (
          <FileCode2 size={16} aria-hidden="true" />
        )}
        <span className="shell-composer-add-menu__copy">
          <span className="shell-composer-add-menu__label">{name}</span>
          {directory ? (
            <span className="shell-composer-add-menu__description">{directory}</span>
          ) : null}
        </span>
      </button>
    );
  };

  const menu = menuPresence.rendered ? (
    <div
      ref={menuRef}
      className="shell-composer-add-menu"
      data-placement={variant === 'empty' ? 'below' : 'above'}
      data-motion-state={menuPresence.phase}
      data-searching={searching ? '1' : '0'}
      data-testid={menuTestId}
      aria-hidden={menuPresence.phase === 'exiting' ? 'true' : undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) menuPresence.completeMotion();
      }}
      style={menuStyle}
    >
      <div
        ref={scrollRef}
        className="shell-composer-add-menu__scroll"
        role="listbox"
        aria-label="添加文件和更多"
      >
        <ComposerMenuHighlight containerRef={scrollRef} activeIndex={activeIndex} />
        {!searching ? (
          <>
            <div className="shell-composer-add-menu__section">添加</div>
            {actionItems.slice(0, 4).map(renderItem)}
            <div className="shell-composer-add-menu__section is-settings">设置</div>
            {actionItems.slice(4).map((item, index) => renderItem(item, index + 4))}
          </>
        ) : null}
        <div className={`shell-composer-add-menu__section${searching ? '' : ' is-files'}`}>
          {searching ? `在工作区搜索“${query}”` : '工作区文件'}
        </div>
        {!workspaceFolder?.trim() ? (
          <div className="shell-composer-add-menu__empty">未绑定项目文件夹</div>
        ) : loading ? (
          <div className="shell-composer-add-menu__empty">搜索文件…</div>
        ) : fileItems.length === 0 ? (
          <div className="shell-composer-add-menu__empty">
            {searching ? '无匹配文件' : '没有可引用的工作区文件'}
          </div>
        ) : (
          fileItems.map((item, index) => renderItem(item, actionItems.length + index))
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="shell-compose__icon-tool shell-compose__shortcut-plus shell-composer-add__trigger"
        aria-label="添加文件和更多"
        title="添加文件和更多"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-open={open ? '1' : '0'}
        data-testid={triggerTestId}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
      >
        <Plus size={18} aria-hidden="true" />
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
      <MeetingMinutesDialog
        open={meetingOpen}
        onOpenChange={setMeetingOpen}
        onUseTranscript={(prompt) => {
          const input = inputRef.current;
          const start = input?.selectionStart ?? value.length;
          const end = input?.selectionEnd ?? start;
          const before = value.slice(0, start);
          const after = value.slice(end);
          const nextValue = `${before}${before && !/\s$/.test(before) ? '\n\n' : ''}${prompt}${
            after && !/^\s/.test(after) ? '\n\n' : ''
          }${after}`;
          const caret = before.length + (before && !/\s$/.test(before) ? 2 : 0) + prompt.length;
          onValueChange(nextValue);
          window.requestAnimationFrame(() => {
            const target = inputRef.current;
            if (!target) return;
            target.focus();
            target.setSelectionRange(caret, caret);
          });
        }}
      />
    </>
  );
}
