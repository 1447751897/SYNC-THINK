import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Code,
  Copy,
  Eye,
  Loader2,
  PencilLine,
  RefreshCw,
  Save,
} from 'lucide-react';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { isExcalidrawPath } from './excalidraw-document.js';
import { FileContentPreview, isRenderedMarkdownPath } from './FileContentPreview.js';
import { matchesShortcut, readShortcutPreferences } from './preferences-store.js';
import { SlidingTabs } from './SlidingTabs.js';

export interface FileRevealTarget extends ProjectTextLocation {
  nonce: number;
}

type FilePaneView = 'rich' | 'source' | 'preview';

function defaultFilePaneView(path: string): FilePaneView {
  return isRenderedMarkdownPath(path) ? 'rich' : 'preview';
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

const filePaneSessions = new Map<string, FilePaneSession>();

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

async function copySourceText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.inset = '-9999px auto auto -9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy_failed');
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
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const loadedRef = useRef<LoadedFile | null>(initialSession?.loaded ?? null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(
    Boolean(initialSession && initialSession.draft !== initialSession.loaded.content),
  );
  const savingRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const revealedNonceRef = useRef<number>();
  const copyResetTimerRef = useRef<number>();

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
    setCopyState('idle');
    setSaveMenuOpen(false);
    setView(defaultFilePaneView(path));
    if (copyResetTimerRef.current !== undefined) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = undefined;
    }
    return () => {
      if (copyResetTimerRef.current !== undefined) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, [path]);

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

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const shortcut = readShortcutPreferences().saveFile;
    if (shortcut.enabled && matchesShortcut(event.nativeEvent, shortcut.accelerator)) {
      event.preventDefault();
      if (canSave && !saving) void saveFile(false);
    }
  };

  const handleCopySource = useCallback(async () => {
    if (copyResetTimerRef.current !== undefined) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    try {
      await copySourceText(draft);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyResetTimerRef.current = undefined;
    }, 1500);
  }, [draft]);

  const status = saving ? '保存中' : dirty ? '未保存' : neverSaved ? '草稿' : cleanStatus;
  const previewLabel = isRenderedMarkdownPath(path) ? '文档预览' : '高亮预览';
  const pending = dirty || neverSaved || saving;
  const copyLabel =
    copyState === 'copied' ? '已复制' : copyState === 'error' ? '重试复制' : '复制源码';
  const copyAriaLabel =
    copyState === 'copied' ? '源码已复制' : copyState === 'error' ? '复制失败，重试' : '复制源码';
  const canvasDocument = isExcalidrawPath(path);
  const richTextDocument = isRenderedMarkdownPath(path);
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
              <SlidingTabs
                className="shell-file-pane-view-tabs"
                aria-label={richTextDocument ? '文档编辑模式' : '文件查看方式'}
              >
                {richTextDocument ? (
                  <button
                    type="button"
                    role="tab"
                    aria-label="富文本编辑"
                    title="富文本编辑"
                    aria-selected={view === 'rich'}
                    className={view === 'rich' ? 'is-active' : undefined}
                    onClick={() => setView('rich')}
                  >
                    <PencilLine size={15} aria-hidden="true" />
                  </button>
                ) : null}
                {!richTextDocument ? (
                  <button
                    type="button"
                    role="tab"
                    aria-label={previewLabel}
                    title={previewLabel}
                    aria-selected={view === 'preview'}
                    className={view === 'preview' ? 'is-active' : undefined}
                    onClick={() => setView('preview')}
                  >
                    <Eye size={15} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  role="tab"
                  aria-label={richTextDocument ? '源码编辑' : '源码'}
                  title={richTextDocument ? '源码编辑' : '源码'}
                  aria-selected={view === 'source'}
                  className={view === 'source' ? 'is-active' : undefined}
                  onClick={() => setView('source')}
                >
                  <Code size={15} aria-hidden="true" />
                </button>
                {richTextDocument ? (
                  <button
                    type="button"
                    role="tab"
                    aria-label="预览"
                    title="预览"
                    aria-selected={view === 'preview'}
                    className={view === 'preview' ? 'is-active' : undefined}
                    onClick={() => setView('preview')}
                  >
                    <Eye size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </SlidingTabs>
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
                disabled={saving || loading}
                onClick={() => {
                  setSaveMenuOpen(false);
                  if (canSave) void saveFile(false);
                }}
              >
                {saving ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
                <span className="shell-file-pane-status" data-testid="file-pane-status">
                  {status}
                </span>
              </button>
              <button
                type="button"
                className="shell-file-pane-save-pill__menu"
                data-testid="file-pane-save-menu"
                aria-label="更多文件操作"
                title="更多文件操作"
                aria-expanded={saveMenuOpen}
                aria-haspopup="menu"
                onClick={() => setSaveMenuOpen((open) => !open)}
              >
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            </div>
            {saveMenuOpen ? (
              <div className="shell-file-pane-save-menu" role="menu" aria-label="文件操作">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canSave || saving || loading}
                  onClick={() => {
                    setSaveMenuOpen(false);
                    if (canSave) void saveFile(false);
                  }}
                >
                  <Save size={14} aria-hidden="true" />
                  <span>保存</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`is-${copyState}`}
                  aria-label={copyAriaLabel}
                  onClick={() => void handleCopySource()}
                >
                  {copyState === 'copied' ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Copy size={14} aria-hidden="true" />
                  )}
                  <span>{copyLabel}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {diskChange ? (
        <div className="shell-file-pane-conflict" role="alert" data-testid="file-pane-conflict">
          <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">磁盘上的文件已变化</span>
          <button type="button" onClick={() => void loadFromDisk(true)}>
            <RefreshCw size={12} aria-hidden="true" />
            加载磁盘版本
          </button>
          <button type="button" onClick={() => void saveFile(true)}>
            <Save size={12} aria-hidden="true" />
            覆盖磁盘版本
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
