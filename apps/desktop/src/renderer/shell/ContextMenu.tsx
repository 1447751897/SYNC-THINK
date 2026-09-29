import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ClipboardPaste, Copy, ExternalLink, Link2, Quote, Redo2, Scissors, TextSelect, Undo2, ChevronRight } from 'lucide-react';
import type { EditCommand } from '../../context-menu-contract.js';
import { toastApi } from './Toast.js';

// Keep editor commands out of the shell's initial bundle.
let codeMirror: typeof import('./context-editor.js') | undefined;

export interface ContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  children?: readonly ContextAction[];
  run?: () => void | Promise<unknown>;
}
type ContextEvent = MouseEvent | ReactMouseEvent<HTMLElement>;
type OpenMenu = (event: ContextEvent, actions: readonly ContextAction[]) => void;
const MenuContext = createContext<OpenMenu | undefined>(undefined);
export const MessageContextActions = createContext<{
  quote?: (text: string, label: string) => void;
  openFile?: (path: string) => void;
}>({});

export async function copyContextText(text: string): Promise<void> {
  if (window.syncThink?.editing) await window.syncThink.editing.writeText(text);
  else await navigator.clipboard.writeText(text);
}
export async function executeEditCommand(command: EditCommand): Promise<void> {
  if (window.syncThink?.editing) return window.syncThink.editing.execute(command);
  // Web previews retain basic editing; the desktop always uses its trusted bridge.
  if (!document.execCommand(command)) throw new Error('编辑操作未生效，请重试');
}
export function selectedContextText(scope?: Element): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
  if (scope && (!scope.contains(selection.anchorNode) || !scope.contains(selection.focusNode))) return '';
  return selection.toString();
}
export function selectionContextActions(text: string, quote?: (text: string, label: string) => void): ContextAction[] {
  if (!text) return [];
  return [
    { id: 'copy-selection', label: '复制选中文字', icon: <Copy size={14} />, shortcut: 'Ctrl+C', run: () => copyContextText(text) },
    ...(quote ? [{ id: 'quote-selection', label: '引用选中文字', icon: <Quote size={14} />, run: () => quote(text, '引用选中文字') }] : []),
  ];
}
export function linkContextActions(target: EventTarget | null): ContextAction[] {
  const anchor = target instanceof Element ? target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return [];
  const url = anchor.href;
  if (!/^(https?:|mailto:)/i.test(url)) return [];
  return [
    { id: 'open-link', label: '打开链接', icon: <ExternalLink size={14} />, run: () => { anchor.click(); } },
    { id: 'copy-link', label: '复制链接地址', icon: <Link2 size={14} />, run: () => copyContextText(url) },
  ];
}

function editorAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="password"], input[type="tel"], input[type="number"], [contenteditable="true"], .cm-content');
  return element instanceof HTMLElement ? element : null;
}
export function isContextEditor(target: EventTarget | null): boolean { return !!editorAt(target); }

function editorActions(target: HTMLElement): ContextAction[] {
  const view = codeMirror?.findView(target);
  const input = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : undefined;
  const readOnly = view ? view.state.readOnly || !codeMirror!.isEditable(view) : input ? input.readOnly || input.disabled : target.contentEditable !== 'true';
  const password = input instanceof HTMLInputElement && input.type === 'password';
  const selection = view ? view.state.selection.ranges.some(range => !range.empty) : input ? input.selectionStart !== input.selectionEnd : !!selectedContextText(target);
  const command = (id: EditCommand, label: string, icon: ReactNode, shortcut: string, disabled = false): ContextAction => ({
    id, label, icon, shortcut, disabled,
    run: () => {
      if (view && (id === 'undo' || id === 'redo' || id === 'selectAll')) {
        view.focus();
        codeMirror!.execute(view, id);
        return;
      }
      return executeEditCommand(id);
    },
  });
  return [
    ...(!readOnly ? [
      command('undo', '撤销', <Undo2 size={14} />, 'Ctrl+Z', view ? codeMirror!.undoDepth(view.state) === 0 : false),
      command('redo', '重做', <Redo2 size={14} />, 'Ctrl+Shift+Z', view ? codeMirror!.redoDepth(view.state) === 0 : false),
    ] : []),
    ...(!readOnly ? [{ ...command('cut', '剪切', <Scissors size={14} />, 'Ctrl+X', !selection || password), separator: true }] : []),
    command('copy', '复制', <Copy size={14} />, 'Ctrl+C', !selection || password),
    ...(!readOnly ? [command('paste', '粘贴', <ClipboardPaste size={14} />, 'Ctrl+V')] : []),
    { ...command('selectAll', '全选', <TextSelect size={14} />, 'Ctrl+A'), separator: true },
  ];
}

/** Preserve the original editor/selection while the menu owns keyboard focus. */
function captureFocus(target: EventTarget | null): () => void {
  const editor = editorAt(target);
  const view = editor ? codeMirror?.findView(editor) : null;
  const state = view?.state;
  const focus = editor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const input = editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement ? editor : undefined;
  const start = input?.selectionStart, end = input?.selectionEnd, direction = input?.selectionDirection;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  return () => {
    if (view && view.dom.isConnected) {
      view.focus();
      if (state && view.state.doc.eq(state.doc)) view.dispatch({ selection: state.selection });
    } else if (focus?.isConnected) {
      focus.focus({ preventScroll: true });
      if (input && start != null && end != null) input.setSelectionRange(start, end, direction ?? undefined);
      else if (ranges.length && ranges.every(range => range.commonAncestorContainer.isConnected)) {
        const live = window.getSelection(); live?.removeAllRanges(); ranges.forEach(range => live?.addRange(range));
      }
    }
  };
}

export function useContextMenu() {
  const open = useContext(MenuContext);
  return useCallback((event: ContextEvent, actions: readonly ContextAction[]) => {
    if (!event.defaultPrevented && !isContextEditor(event.target)) open?.(event, actions);
  }, [open]);
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ x: number; y: number; actions: readonly ContextAction[]; restore: () => void } | null>(null);
  const requestRef = useRef(request); requestRef.current = request;
  const open = useCallback<OpenMenu>((event, actions) => {
    if (!actions.length) return;
    event.preventDefault(); event.stopPropagation();
    const bounds = event.target instanceof Element ? event.target.getBoundingClientRect() : null;
    setRequest({ x: event.clientX || bounds?.left || 0, y: event.clientY || bounds?.bottom || 0, actions, restore: captureFocus(event.target) });
  }, []);
  useEffect(() => {
    let requestVersion = 0;
    const handle = async (event: MouseEvent) => {
      const version = ++requestVersion;
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="menu"], .xterm'))) return;
      const editor = editorAt(event.target);
      if (editor?.closest('.cm-editor') && !codeMirror) {
        event.preventDefault();
        try { codeMirror = await import('./context-editor.js'); }
        catch { toastApi.toast({ type: 'error', title: '编辑菜单加载失败，请重试' }); return; }
        if (version !== requestVersion || !editor.isConnected) return;
      }
      const target = event.target instanceof Element ? event.target : undefined;
      const selection = selectedContextText();
      const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : undefined;
      const onSelection = !!(target && range && range.intersectsNode(target));
      const actions = editor ? editorActions(editor) : [...selectionContextActions(onSelection ? selection : ''), ...linkContextActions(event.target)];
      if (actions.length) open(event, actions); else setRequest(null);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      const target = document.activeElement;
      if (!(target instanceof HTMLElement) || target.closest('[role="menu"]')) return;
      event.preventDefault(); const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 12, clientY: rect.top + 20 }));
    };
    document.addEventListener('contextmenu', handle);
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('contextmenu', handle); document.removeEventListener('keydown', keys); };
  }, [open]);
  const run = (action: ContextAction) => {
    const pending = requestRef.current;
    setRequest(null);
    window.requestAnimationFrame(() => {
      pending?.restore();
      void Promise.resolve().then(() => action.run?.()).catch(error => {
        toastApi.toast({ type: 'error', title: '操作未完成', description: error instanceof Error ? error.message : '请重试' });
      });
    });
  };
  const renderItems = (actions: readonly ContextAction[]): ReactNode => actions.map(action => <Menu.Group key={action.id}>
    {action.separator ? <Menu.Separator className="shell-context-menu__separator" /> : null}
    {action.children ? <Menu.Sub>
      <Menu.SubTrigger className="shell-context-menu__item" disabled={action.disabled}>
        <span className="shell-context-menu__icon">{action.icon}</span><span>{action.label}</span><ChevronRight size={13} className="shell-context-menu__chevron" />
      </Menu.SubTrigger>
      <Menu.Portal><Menu.SubContent className="shell-context-menu" sideOffset={4} collisionPadding={8}>{renderItems(action.children)}</Menu.SubContent></Menu.Portal>
    </Menu.Sub> : <Menu.Item className="shell-context-menu__item" data-danger={action.danger || undefined} disabled={action.disabled} onSelect={() => run(action)}>
      <span className="shell-context-menu__icon">{action.icon}</span><span>{action.label}</span>{action.shortcut ? <span className="shell-context-menu__shortcut">{action.shortcut}</span> : null}
    </Menu.Item>}
  </Menu.Group>);
  return <MenuContext.Provider value={open}>{children}
    <Menu.Root open={request !== null} onOpenChange={value => { if (!value) setRequest(null); }} modal={false}>
      <Menu.Trigger asChild><span aria-hidden="true" style={{ position: 'fixed', left: request?.x ?? 0, top: request?.y ?? 0, width: 1, height: 1, pointerEvents: 'none' }} /></Menu.Trigger>
      <Menu.Portal><Menu.Content className="shell-context-menu" data-testid="shell-context-menu" align="start" sideOffset={2} collisionPadding={8}
        onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={() => requestRef.current?.restore()}
        onContextMenu={event => event.preventDefault()}>{request ? renderItems(request.actions) : null}</Menu.Content></Menu.Portal>
    </Menu.Root>
  </MenuContext.Provider>;
}
