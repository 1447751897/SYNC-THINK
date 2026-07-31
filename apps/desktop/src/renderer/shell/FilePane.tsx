import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, FileCode2, Loader2, RefreshCw, Save } from 'lucide-react';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';

export interface FileRevealTarget extends ProjectTextLocation {
  nonce: number;
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

export function clearFilePaneSession(projectFolder: string, path: string): void {
  filePaneSessions.delete(filePaneSessionKey(projectFolder, path));
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
  const [diskChange, setDiskChange] = useState<DiskChange | null>(initialSession?.diskChange ?? null);
  const [cleanStatus, setCleanStatus] = useState<'已同步' | '已保存'>(
    initialSession?.cleanStatus ?? '已同步',
  );
  const loadedRef = useRef<LoadedFile | null>(initialSession?.loaded ?? null);
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
    if (cached && cached.draft !== cached.loaded.content) {
      loadedRef.current = cached.loaded;
      dirtyRef.current = true;
      setLoaded(cached.loaded);
      setDraft(cached.draft);
      setDiskChange(cached.diskChange);
      setCleanStatus(cached.cleanStatus);
      setLoading(false);
      void verifyCachedSession(cached.loaded);
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
    if (!sessionKey || !loaded) return;
    filePaneSessions.set(sessionKey, { loaded, draft, diskChange, cleanStatus });
  }, [cleanStatus, diskChange, draft, loaded, sessionKey]);

  useEffect(() => {
    const api = fileBridge();
    if (!projectFolder || !api?.watchProjectFile) return;
    const subscription = api.watchProjectFile(
      { root: projectFolder, path },
      (change) => {
        if (savingRef.current || dirtyRef.current) {
          setDiskChange({
            exists: change.exists,
            mtimeMs: change.mtimeMs,
            size: change.size,
          });
          return;
        }
        void loadFromDisk(false);
      },
    );
    void subscription.ready.catch(() => undefined);
    return () => {
      void subscription.unsubscribe();
    };
  }, [loadFromDisk, path, projectFolder]);

  const dirty = Boolean(loaded && draft !== loaded.content);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !loaded || !revealTarget || revealedNonceRef.current === revealTarget.nonce) {
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
    const lineText = draft.slice(lineStart, lineEnd < 0 ? draft.length : lineEnd).replace(/\r$/, '');
    const columnOffset = [...lineText].slice(0, targetColumn - 1).join('').length;
    const offset = Math.min(draft.length, lineStart + columnOffset);
    editor.focus();
    editor.setSelectionRange(offset, offset);
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 19.2;
    editor.scrollTop = Math.max(0, (targetLine - 1) * lineHeight - editor.clientHeight / 3);
    revealedNonceRef.current = revealTarget.nonce;
  }, [draft, loaded, revealTarget]);

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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (dirty && !saving) void saveFile(false);
    }
  };

  const status = saving ? '保存中' : dirty ? '未保存' : cleanStatus;

  return (
    <div className="shell-file-pane" data-testid="file-pane">
      <header className="shell-file-pane-header">
        <FileCode2 size={14} className="shrink-0 text-text-faint" aria-hidden="true" />
        <span className="shell-file-pane-path" title={path}>
          {path}
        </span>
        <span
          className={dirty ? 'shell-file-pane-status is-dirty' : 'shell-file-pane-status'}
          data-testid="file-pane-status"
        >
          {status}
        </span>
        <button
          type="button"
          className="shell-file-pane-icon-button"
          data-testid="file-pane-save"
          aria-label="保存文件"
          title="保存文件"
          disabled={!dirty || saving || loading}
          onClick={() => void saveFile(false)}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        </button>
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
          <textarea
            ref={editorRef}
            className="shell-file-pane-editor"
            data-testid="file-pane-editor"
            aria-label={`编辑 ${path}`}
            value={draft}
            disabled={saving}
            spellCheck={false}
            onChange={(event) => {
              const next = event.currentTarget.value;
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
            }}
            onKeyDown={handleEditorKeyDown}
          />
        ) : null}
      </div>
    </div>
  );
}
