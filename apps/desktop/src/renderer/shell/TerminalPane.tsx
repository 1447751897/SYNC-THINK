import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { Eraser, Loader2, Play, Square, SquareTerminal } from 'lucide-react';
import {
  getTerminalSessionStore,
  type TerminalSessionStore,
} from './terminal-session-store.js';
import { loadXtermVendor, type XtermInstance } from './xterm-vendor-loader.js';

export interface TerminalPaneProps {
  terminalId: string;
  projectFolder?: string;
  cwd: string;
  store?: TerminalSessionStore;
  onCwdChange?(cwd: string): void;
}

function terminalDimensions(element: HTMLElement): { columns: number; rows: number } | undefined {
  if (element.clientWidth < 20 || element.clientHeight < 20) return undefined;
  return {
    columns: Math.max(20, Math.floor(element.clientWidth / 7.5)),
    rows: Math.max(4, Math.floor(element.clientHeight / 17)),
  };
}

function terminalTheme(element: HTMLElement): Record<string, string> {
  const styles = getComputedStyle(element);
  return {
    background: styles.getPropertyValue('--color-page').trim() || styles.backgroundColor,
    foreground: styles.getPropertyValue('--color-text').trim() || styles.color,
    cursor: styles.getPropertyValue('--color-accent').trim() || styles.color,
    selectionBackground:
      styles.getPropertyValue('--color-accent-soft').trim() || styles.backgroundColor,
  };
}

export function TerminalPane(props: TerminalPaneProps) {
  const store = useMemo(() => props.store ?? getTerminalSessionStore(), [props.store]);
  store.ensureSession(props.terminalId, props.cwd);
  const snapshot = useSyncExternalStore(
    useCallback((listener) => store.subscribe(props.terminalId, listener), [props.terminalId, store]),
    useCallback(() => store.getSnapshot(props.terminalId), [props.terminalId, store]),
    useCallback(() => store.getSnapshot(props.terminalId), [props.terminalId, store]),
  );
  const [commandLine, setCommandLine] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [terminalReady, setTerminalReady] = useState(0);
  const [vendorError, setVendorError] = useState<string>();
  const outputRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermInstance>();
  const lastChunkIdRef = useRef(0);
  const clearRevisionRef = useRef(snapshot.clearRevision);
  const historyDraftRef = useRef('');
  const commandEditRevisionRef = useRef(0);

  useEffect(() => {
    const element = outputRef.current;
    if (!element) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    const syncTheme = () => {
      const terminal = terminalRef.current;
      if (terminal?.options) terminal.options.theme = terminalTheme(element);
    };
    const resize = () => {
      const dimensions = terminalDimensions(element);
      if (dimensions) terminalRef.current?.resize(dimensions.columns, dimensions.rows);
    };
    void loadXtermVendor()
      .then(({ Terminal }) => {
        if (disposed) return;
        const styles = getComputedStyle(element);
        const terminal = new Terminal({
          convertEol: true,
          cursorBlink: false,
          disableStdin: true,
          fontFamily: styles.getPropertyValue('--font-mono').trim() || 'Cascadia Code, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.35,
          scrollback: 5_000,
          theme: terminalTheme(element),
        });
        terminal.open(element);
        terminalRef.current = terminal;
        resize();
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(element);
        } else {
          window.addEventListener('resize', resize);
        }
        window.addEventListener('shell-theme-applied', syncTheme);
        setTerminalReady((value) => value + 1);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setVendorError(error instanceof Error ? error.message : '终端组件加载失败');
        }
      });
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('shell-theme-applied', syncTheme);
      terminalRef.current?.dispose();
      terminalRef.current = undefined;
      lastChunkIdRef.current = 0;
    };
  }, [props.terminalId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (snapshot.clearRevision !== clearRevisionRef.current) {
      terminal.reset();
      clearRevisionRef.current = snapshot.clearRevision;
      lastChunkIdRef.current = 0;
    }
    for (const chunk of snapshot.chunks) {
      if (chunk.id <= lastChunkIdRef.current) continue;
      terminal.write(
        chunk.stream === 'stderr'
          ? `\u001b[31m${chunk.text}\u001b[0m`
          : chunk.text,
      );
      lastChunkIdRef.current = chunk.id;
    }
  }, [snapshot.chunks, snapshot.clearRevision, terminalReady]);

  const runCommand = async () => {
    if (
      !props.projectFolder ||
      !commandLine.trim() ||
      snapshot.status === 'starting' ||
      snapshot.status === 'running' ||
      snapshot.status === 'stopping'
    ) {
      return;
    }
    const submittedRevision = commandEditRevisionRef.current;
    try {
      const result = await store.startCommand({
        root: props.projectFolder,
        terminalId: props.terminalId,
        commandLine,
        cwd: snapshot.cwd,
      });
      if (commandEditRevisionRef.current === submittedRevision) {
        commandEditRevisionRef.current += 1;
        setCommandLine('');
        setHistoryIndex(null);
        historyDraftRef.current = '';
      }
      if (result.cwd !== props.cwd) props.onCwdChange?.(result.cwd);
    } catch {
      // The store writes the actionable failure into the terminal surface.
    }
  };

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runCommand();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && snapshot.activeCommandId) {
      event.preventDefault();
      void store.cancelCommand(props.terminalId);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (snapshot.history.length === 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp') {
      if (historyIndex === null) historyDraftRef.current = commandLine;
      const next = historyIndex === null ? snapshot.history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      commandEditRevisionRef.current += 1;
      setCommandLine(snapshot.history[next] ?? '');
      return;
    }
    if (historyIndex === null) return;
    const next = historyIndex + 1;
    if (next >= snapshot.history.length) {
      setHistoryIndex(null);
      commandEditRevisionRef.current += 1;
      setCommandLine(historyDraftRef.current);
    } else {
      setHistoryIndex(next);
      commandEditRevisionRef.current += 1;
      setCommandLine(snapshot.history[next] ?? '');
    }
  };

  const running = snapshot.status === 'running' || snapshot.status === 'starting';
  const stopping = snapshot.status === 'stopping';
  const statusLabel = stopping
    ? '停止中'
    : running
      ? '运行中'
      : snapshot.status === 'error'
        ? '命令失败'
        : '就绪';

  return (
    <div className="shell-terminal-pane" data-testid="terminal-pane">
      <header className="shell-terminal-header">
        <SquareTerminal size={14} className="shrink-0 text-text-faint" aria-hidden="true" />
        <span className="shell-terminal-cwd" title={snapshot.cwd || '/'}>
          /{snapshot.cwd}
        </span>
        <span className="shell-terminal-status" data-status={snapshot.status}>
          {statusLabel}
        </span>
        <button
          type="button"
          className="shell-file-pane-icon-button"
          aria-label="清空终端"
          title="清空终端"
          onClick={() => store.clear(props.terminalId)}
        >
          <Eraser size={13} />
        </button>
      </header>
      <div className="shell-terminal-output" ref={outputRef} data-testid="terminal-output">
        {vendorError ? <div className="shell-terminal-load-error">{vendorError}</div> : null}
      </div>
      <div className="shell-terminal-commandbar">
        <span className="shell-terminal-prompt" aria-hidden="true">
          &gt;
        </span>
        <input
          type="text"
          data-testid="terminal-command-input"
          aria-label="终端命令"
          value={commandLine}
          disabled={!props.projectFolder || stopping}
          spellCheck={false}
          autoComplete="off"
          placeholder={props.projectFolder ? '输入命令' : '先绑定项目文件夹'}
          onChange={(event) => {
            commandEditRevisionRef.current += 1;
            setCommandLine(event.currentTarget.value);
            setHistoryIndex(null);
          }}
          onKeyDown={handleCommandKeyDown}
        />
        {running || stopping ? (
          <button
            type="button"
            className="shell-terminal-run is-stop"
            aria-label="停止命令"
            title="停止命令"
            disabled={stopping || !snapshot.activeCommandId}
            onClick={() => void store.cancelCommand(props.terminalId)}
          >
            {stopping ? <Loader2 size={13} className="animate-spin" /> : <Square size={11} fill="currentColor" />}
          </button>
        ) : (
          <button
            type="button"
            className="shell-terminal-run"
            aria-label="运行命令"
            title="运行命令"
            disabled={!props.projectFolder || !commandLine.trim()}
            onClick={() => void runCommand()}
          >
            <Play size={13} fill="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
}
