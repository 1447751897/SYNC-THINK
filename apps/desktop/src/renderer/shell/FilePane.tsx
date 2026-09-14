import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ChevronDown, Code, Eye, Loader2, PencilLine } from 'lucide-react';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { isExcalidrawPath } from './excalidraw-document.js';
import { FileContentPreview, isRenderedMarkdownPath } from './FileContentPreview.js';
import { matchesShortcut, readShortcutPreferences } from './preferences-store.js';
import { DsTabBar } from './DsTabBar.js';

export interface FileRevealTarget extends ProjectTextLocation {
  nonce: number;
}

type FilePaneView = 'rich' | 'source' | 'preview';
type MarkdownViewMode = 'editor' | 'source' | 'preview';

const MARKDOWN_MODE_KEY = 'niuma:filepreview:md-mode';
const MARKDOWN_MODES: readonly MarkdownViewMode[] = ['editor', 'source', 'preview'];

function asMarkdownMode(view: FilePaneView): MarkdownViewMode {
  return view === 'rich' ? 'editor' : view;
}

function fromMarkdownMode(mode: MarkdownViewMode): FilePaneView {
  return mode === 'editor' ? 'rich' : mode;
}

function readLastMarkdownViewMode(): MarkdownViewMode {
  try {
    const stored = localStorage.getItem(MARKDOWN_MODE_KEY);
    return MARKDOWN_MODES.includes(stored as MarkdownViewMode)
      ? (stored as MarkdownViewMode)
      : 'editor';
  } catch {
    return 'editor';
  }
}

function writeLastMarkdownViewMode(mode: MarkdownViewMode): void {
  try {
    localStorage.setItem(MARKDOWN_MODE_KEY, mode);
  } catch {
    /* ignore quota / private-mode */
  }
}

function defaultFilePaneView(path: string): FilePaneView {
  return isRenderedMarkdownPath(path) ? fromMarkdownMode(readLastMarkdownViewMode()) : 'preview';
}

interface LoadedFile {
  content: string;
  mtimeMs: number | null;
  size: number | null;
}

interface DiskChange {
  exists: boolean;
  mtimeMs: number | null;
  size: number | null;
}

interface FilePaneSession {
  loaded: LoadedFile;
  draft: string;
  diskChange: DiskChange | null;
  cleanStatus: '已同步' | '已保存';
}

const AUTO_SAVE_KEY = 'niuma:filepreview:md-autosave';
const filePaneSessions = new Map<string, FilePaneSession>();

function readAutoSave(): boolean {
  try {
    return localStorage.getItem(AUTO_SAVE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeAutoSave(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SAVE_KEY, String(enabled));
  } catch {
    /* ignore quota / private-mode */
  }
}

function filePaneSessionKey(projectFolder: string, path: string): string {
  const root = projectFolder.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const relativePath = path.trim().replace(/\\/g, '/');
  return `${root}\0${relativePath}`;
}

export function isFilePaneSessionDirty(projectFolder: string, path: string): boolean {
  const session = filePaneSessions.get(filePaneSessionKey(projectFolder, path));
  return Boolean(session && session.draft !== session.loaded.content);
}

export function seedFilePaneUnsavedDraft(
  projectFolder: string,
  path: string,
  initialContent: string,
): void {
  const loaded: LoadedFile = { content: initialContent, mtimeMs: null, size: null };
  filePaneSessions.set(filePaneSessionKey(projectFolder, path), {
    loaded,
    draft: initialContent,
    diskChange: null,
    cleanStatus: '已同步',
  });
}

export function clearFilePaneSession(projectFolder: string, path: string): void {
  filePaneSessions.delete(filePaneSessionKey(projectFolder, path));
}

function isNeverSavedFile(loaded: LoadedFile | null | undefined): boolean {
  return Boolean(loaded && loaded.mtimeMs === null && loaded.size === null);
}

function fileBridge() {
  return window.syncThink?.runtime;
}

export function FilePane({
  projectFolder,
  path,
  onDirtyChange,
  revealTarget,
}: {
  projectFolder?: string;
  path: string;
  onDirtyChange?(dirty: boolean): void;
  revealTarget?: FileRevealTarget;
}) {
  const sessionKey = projectFolder ? filePaneSessionKey(projectFolder, path) : undefined;
  const initialSession = sessionKey ? filePaneSessions.get(sessionKey) : undefined;
  const [loaded, setLoaded] = useState<LoadedFile | null>(initialSession?.loaded ?? null);
  const [draft, setDraft] = useState(initialSession?.draft ?? '');
  const [loading, setLoading] = useState(!initialSession);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diskChange, setDiskChange] = useState<DiskChange | null>(
    initialSession?.diskChange ?? null,
  );
  const [cleanStatus, setCleanStatus] = useState<'已同步' | '已保存'>(
    initialSession?.cleanStatus ?? '已同步',
  );
  const [view, setView] = useState<FilePaneView>(() => defaultFilePaneView(path));
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [autoSave, setAutoSave] = useState(readAutoSave);
  const loadedRef = useRef<LoadedFile | null>(initialSession?.loaded ?? null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const saveMenuBtnRef = useRef<HTMLButtonElement>(null);
  const dirtyRef = useRef(
    Boolean(initialSession && initialSession.draft !== initialSession.loaded.content),
  );
  const savingRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const revealedNonceRef = useRef<number>();

  const loadFromDisk = useCallback(
    async (showLoading: boolean) => {
      const api = fileBridge();
      const sequence = ++requestSequenceRef.current;
      if (!projectFolder) {
        setLoading(false);
        setError('未绑定项目文件夹');
        return false;
      }
      if (!api?.readProjectFile) {
        setLoading(false);
        setError('文件服务不可用');
        return false;
      }
      if (showLoading) setLoading(true);
      try {
        const result = await api.readProjectFile({ root: projectFolder, path });
        if (sequence !== requestSequenceRef.current) return false;
        if (result.error || result.content === null) {
          setError(result.error ?? '读取失败');
          return false;
        }
        const next: LoadedFile = {
          content: result.content,
          mtimeMs: result.mtimeMs,
          size: result.size,
        };
        loadedRef.current = next;
        dirtyRef.current = false;
        if (sessionKey) {
          filePaneSessions.set(sessionKey, {
            loaded: next,
            draft: next.content,
            diskChange: null,
            cleanStatus: '已同步',
          });
        }
        setLoaded(next);
        setDraft(next.content);
        setDiskChange(null);
        setCleanStatus('已同步');
        setError(null);
        return true;
      } catch {
        if (sequence === requestSequenceRef.current) setError('读取失败');
        return false;
      } finally {
        if (sequence === requestSequenceRef.current) setLoading(false);
      }
    },
    [path, projectFolder, sessionKey],
  );

  const verifyCachedSession = useCallback(
    async (baseline: LoadedFile) => {
      const api = fileBridge();
      if (!projectFolder || !api?.readProjectFile) return;
      const sequence = ++requestSequenceRef.current;
      try {
        const result = await api.readProjectFile({ root: projectFolder, path });
        if (sequence !== requestSequenceRef.current) return;
        if (
          result.error ||
          result.content === null ||
          result.mtimeMs !== baseline.mtimeMs ||
          result.size !== baseline.size
        ) {
          setDiskChange({
            exists: result.content !== null,
            mtimeMs: result.mtimeMs,
            size: result.size,
          });
        }
      } catch {
        if (sequence === requestSequenceRef.current) {
          setDiskChange({ exists: false, mtimeMs: null, size: null });
        }
      }
    },
    [path, projectFolder],
  );

  useEffect(() => {
    requestSequenceRef.current += 1;
    savingRef.current = false;
    setError(null);
    const cached = sessionKey ? filePaneSessions.get(sessionKey) : undefined;
    if (cached && (cached.draft !== cached.loaded.content || isNeverSavedFile(cached.loaded))) {
      loadedRef.current = cached.loaded;
      dirtyRef.current = cached.draft !== cached.loaded.content;
      setLoaded(cached.loaded);
      setDraft(cached.draft);
      setDiskChange(cached.diskChange);
      setCleanStatus(cached.cleanStatus);
      setLoading(false);
      if (!isNeverSavedFile(cached.loaded)) void verifyCachedSession(cached.loaded);
    } else {
      loadedRef.current = null;
      dirtyRef.current = false;
      setLoaded(null);
      setDraft('');
      setDiskChange(null);
      setLoading(true);
      void loadFromDisk(true);
    }
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [loadFromDisk, sessionKey, verifyCachedSession]);

  useEffect(() => {
    setSaveMenuOpen(false);
    setView(defaultFilePaneView(path));
  }, [path]);

  useEffect(() => {
    if (isRenderedMarkdownPath(path)) writeLastMarkdownViewMode(asMarkdownMode(view));
  }, [path, view]);

  useEffect(() => {
    if (!saveMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!saveMenuRef.current?.contains(event.target as Node)) {
        setSaveMenuOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSaveMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [saveMenuOpen]);

  useEffect(() => {
    if (!sessionKey || !loaded) return;
    filePaneSessions.set(sessionKey, { loaded, draft, diskChange, cleanStatus });
  }, [cleanStatus, diskChange, draft, loaded, sessionKey]);

  const neverSaved = isNeverSavedFile(loaded);
  const shouldWatch = !isNeverSavedFile(loaded ?? loadedRef.current);

  useEffect(() => {
    const api = fileBridge();
    if (!projectFolder || !api?.watchProjectFile || !shouldWatch) return;
    const subscription = api.watchProjectFile({ root: projectFolder, path }, (change) => {
      if (savingRef.current || dirtyRef.current) {
        setDiskChange({
          exists: change.exists,
          mtimeMs: change.mtimeMs,
          size: change.size,
        });
        return;
      }
      void loadFromDisk(false);
    });
    void subscription.ready.catch(() => undefined);
    return () => {
      void subscription.unsubscribe();
    };
  }, [loadFromDisk, path, projectFolder, shouldWatch]);
  const dirty = Boolean(loaded && draft !== loaded.content);
  const canSave = Boolean(loaded && (dirty || neverSaved));

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !loaded || !revealTarget || revealedNonceRef.current === revealTarget.nonce) {
      return;
    }
    if (isRenderedMarkdownPath(path) && view !== 'source') {
      setView('source');
      return;
    }
    const targetLine = Math.max(1, Math.floor(revealTarget.line));
    const targetColumn = Math.max(1, Math.floor(revealTarget.column));
    let lineStart = 0;
    for (let line = 1; line < targetLine; line += 1) {
      const nextBreak = draft.indexOf('\n', lineStart);
      if (nextBreak < 0) {
        lineStart = draft.length;
        break;
      }
      lineStart = nextBreak + 1;
    }
    const lineEnd = draft.indexOf('\n', lineStart);
    const lineText = draft
      .slice(lineStart, lineEnd < 0 ? draft.length : lineEnd)
      .replace(/\r$/, '');
    const columnOffset = [...lineText].slice(0, targetColumn - 1).join('').length;
    const offset = Math.min(draft.length, lineStart + columnOffset);
    editor.setSelectionRange(offset, offset);
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 19.2;
    editor.scrollTop = Math.max(0, (targetLine - 1) * lineHeight - editor.clientHeight / 3);
    if (view === 'source') editor.focus();
    revealedNonceRef.current = revealTarget.nonce;
  }, [draft, loaded, path, revealTarget, view]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const saveFile = useCallback(
    async (force = false) => {
      const api = fileBridge();
      const baseline = loadedRef.current;
      if (!api?.writeProjectFile || !projectFolder || !baseline || savingRef.current) return;
      setSaving(true);
      savingRef.current = true;
      setError(null);
      try {
        const result = await api.writeProjectFile({
          root: projectFolder,
          path,
          content: draft,
          expectedMtimeMs: baseline.mtimeMs,
          expectedSize: baseline.size,
          ...(force ? { force: true } : {}),
        });
        if (result.conflict) {
          setDiskChange({
            exists: result.mtimeMs !== null,
            mtimeMs: result.mtimeMs,
            size: result.size,
          });
          return;
        }
        if (!result.ok) {
          setError(result.error ?? '保存失败');
          return;
        }
        const next: LoadedFile = {
          content: draft,
          mtimeMs: result.mtimeMs,
          size: result.size,
        };
        loadedRef.current = next;
        dirtyRef.current = false;
        if (sessionKey) {
          filePaneSessions.set(sessionKey, {
            loaded: next,
            draft,
            diskChange: null,
            cleanStatus: '已保存',
          });
        }
        setLoaded(next);
        setDiskChange(null);
        setCleanStatus('已保存');
      } catch {
        setError('保存失败');
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [draft, path, projectFolder, sessionKey],
  );

  useEffect(() => {
    writeAutoSave(autoSave);
  }, [autoSave]);

  useEffect(() => {
    if (saving || (autoSave && dirty && !diskChange)) setSaveMenuOpen(false);
  }, [autoSave, dirty, diskChange, saving]);

  useEffect(() => {
    if (!autoSave || !canSave || saving || diskChange) return;
    const timer = window.setTimeout(() => {
      void saveFile(false);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [autoSave, canSave, diskChange, saveFile, saving]);

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const shortcut = readShortcutPreferences().saveFile;
    if (shortcut.enabled && matchesShortcut(event.nativeEvent, shortcut.accelerator)) {
      event.preventDefault();
      if (canSave && !saving) void saveFile(false);
    }
  };

  const status = diskChange
    ? '等待选择版本'
    : autoSave
      ? dirty || saving
        ? '保存中'
        : '已保存'
      : saving
        ? '保存中'
        : dirty
          ? '保存'
          : '已保存';
  const canvasDocument = isExcalidrawPath(path);
  const richTextDocument = isRenderedMarkdownPath(path);
  const pending = dirty && !autoSave && !diskChange;
  const autoSavePending = autoSave && dirty && !diskChange;
  const saveInProgress = saving || autoSavePending;
  const updateDraft = useCallback(
    (next: string) => {
      setDraft(next);
      dirtyRef.current = next !== loadedRef.current?.content;
      if (sessionKey && loadedRef.current) {
        filePaneSessions.set(sessionKey, {
          loaded: loadedRef.current,
          draft: next,
          diskChange,
          cleanStatus,
        });
      }
    },
    [cleanStatus, diskChange, sessionKey],
  );

  return (
    <div
      className="shell-file-pane"
      data-testid="file-pane"
      data-kind={canvasDocument ? 'canvas' : richTextDocument ? 'document' : 'code'}
    >
      <header className="shell-file-pane-header">
        <div className="shell-file-pane-bar">
          {!canvasDocument ? (
            <div className="shell-file-pane-tools">
              <DsTabBar
                size="small"
                aria-label={richTextDocument ? '文档编辑模式' : '文件查看方式'}
                value={richTextDocument ? asMarkdownMode(view) : view === 'source' ? 'source' : 'preview'}
                onChange={(next) => {
                  if (richTextDocument) {
                    setView(fromMarkdownMode(next as MarkdownViewMode));
                    return;
                  }
                  setView(next === 'source' ? 'source' : 'preview');
                }}
                items={
                  richTextDocument
                    ? [
                        {
                          value: 'editor',
                          icon: <PencilLine size={15} aria-hidden="true" />,
                          tooltip: '富文本编辑',
                        },
                        {
                          value: 'source',
                          icon: <Code size={15} aria-hidden="true" />,
                          tooltip: '源码编辑',
                        },
                        {
                          value: 'preview',
                          icon: <Eye size={15} aria-hidden="true" />,
                          tooltip: '预览模式',
                        },
                      ]
                    : [
                        {
                          value: 'preview',
                          icon: <Eye size={15} aria-hidden="true" />,
                          tooltip: '高亮预览',
                        },
                        {
                          value: 'source',
                          icon: <Code size={15} aria-hidden="true" />,
                          tooltip: '源码',
                        },
                      ]
                }
              />
            </div>
          ) : null}
          <div className="shell-file-pane-save-wrap" ref={saveMenuRef}>
            <div
              className={[
                'shell-file-pane-save-pill',
                pending ? 'is-dirty' : '',
                saveMenuOpen ? 'is-open' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <button
                type="button"
                className="shell-file-pane-save-pill__action"
                data-testid="file-pane-save"
                aria-label="保存文件"
                title={canSave ? '保存文件' : status}
                disabled={Boolean(diskChange) || !pending || saving}
                onClick={() => {
                  setSaveMenuOpen(false);
                  if (canSave && !autoSave) void saveFile(false);
                }}
              >
                <span className="shell-file-pane-status" data-testid="file-pane-status">
                  {status}
                </span>
              </button>
              <button
                ref={saveMenuBtnRef}
                type="button"
                className="shell-file-pane-save-pill__menu"
                data-testid="file-pane-save-menu"
                aria-label="更多文件操作"
                title="更多文件操作"
                aria-expanded={saveMenuOpen}
                aria-haspopup="menu"
                disabled={saveInProgress}
                onClick={() => {
                  if (!saveInProgress) setSaveMenuOpen((open) => !open);
                }}
              >
                {saveInProgress ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <ChevronDown size={12} aria-hidden="true" />
                )}
              </button>
            </div>
            {saveMenuOpen ? (
              <div className="shell-file-pane-save-menu" role="menu" aria-label="文件操作">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={autoSave}
                  onClick={() => setAutoSave((enabled) => !enabled)}
                >
                  <span>自动保存</span>
                  <span
                    className={
                      autoSave
                        ? 'shell-file-pane-autosave-switch is-on'
                        : 'shell-file-pane-autosave-switch'
                    }
                    aria-hidden="true"
                  />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {diskChange ? (
        <div className="shell-file-pane-conflict" role="alert" data-testid="file-pane-conflict">
          <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            检测到其他应用修改了此文件，而 NewMax 中还有未保存内容。载入外部修改会放弃 NewMax
            中未保存的内容；保留 NewMax 内容会覆盖外部修改。
          </span>
          <button type="button" onClick={() => void loadFromDisk(true)}>
            载入外部修改
          </button>
          <button type="button" onClick={() => void saveFile(true)}>
            保留 NewMax 内容
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="shell-file-pane-error" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="shell-file-pane-editor-wrap">
        {loading && !loaded ? (
          <div className="shell-file-pane-loading">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            <span>读取中</span>
          </div>
        ) : loaded ? (
          canvasDocument ? (
            <div
              className="shell-file-pane-view shell-file-pane-preview"
              data-testid="file-pane-canvas"
              aria-label={`绘图 ${path}`}
            >
              <FileContentPreview text={draft} path={path} onChange={updateDraft} />
            </div>
          ) : (
            <>
              {richTextDocument ? (
                <div
                  className="shell-file-pane-view shell-file-pane-preview"
                  data-testid="file-pane-rich-editor"
                  role="tabpanel"
                  aria-label={`富文本编辑 ${path}`}
                  hidden={view !== 'rich'}
                >
                  <FileContentPreview text={draft} path={path} onChange={updateDraft} />
                </div>
              ) : null}
              <div
                className="shell-file-pane-view shell-file-pane-preview"
                data-testid="file-pane-preview"
                role="tabpanel"
                aria-label={`预览 ${path}`}
                hidden={view !== 'preview'}
              >
                <FileContentPreview text={draft} path={path} highlightLine={revealTarget?.line} />
              </div>
              <textarea
                ref={editorRef}
                className="shell-file-pane-editor shell-file-pane-view"
                data-testid="file-pane-editor"
                aria-label={`编辑 ${path}`}
                role="tabpanel"
                value={draft}
                disabled={saving}
                hidden={view !== 'source'}
                wrap="soft"
                spellCheck={false}
                onChange={(event) => updateDraft(event.currentTarget.value)}
                onKeyDown={handleEditorKeyDown}
              />
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
