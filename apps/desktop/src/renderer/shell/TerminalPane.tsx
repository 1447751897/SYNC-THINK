import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { DEFAULT_TERMINAL_SIZE, isValidTerminalSize } from '../../terminal-dimensions.js';
import { useKeepAliveActive } from './KeepAliveLayer.js';
import { loadXtermVendor, type XtermInstance } from './xterm-vendor-loader.js';
import { extractFilePathsFromDrag, isTerminalPathDrag, shellEscapePath } from './terminal/path-drop.js';
import { getTerminalViewportStyle, getXtermTheme } from './terminal/xterm-theme.js';

export interface TerminalPaneProps {
  terminalId: string;
  projectFolder?: string;
  cwd: string;
  workspaceId?: string;
  title?: string;
  active?: boolean;
  onCwdChange?(cwd: string): void;
}

function createTerminalResizeScheduler(
  resize: (dimensions: { cols: number; rows: number }) => boolean,
  delay = 80,
) {
  let timer: number | null = null;
  let pending: { cols: number; rows: number } | null = null;
  let lastSent: { cols: number; rows: number } | null = null;
  return {
    schedule(dimensions: { cols: number; rows: number }) {
      if (!isValidTerminalSize(dimensions)) return;
      pending = dimensions;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const next = pending;
        pending = null;
        if (!next) return;
        if (lastSent?.cols === next.cols && lastSent.rows === next.rows) return;
        if (resize(next)) lastSent = next;
      }, delay);
    },
    dispose() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

export function TerminalPane(props: TerminalPaneProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XtermInstance | null>(null);
  const [termBg, setTermBg] = useState(() => getXtermTheme().background);
  const [isPathDragOver, setIsPathDragOver] = useState(false);
  const [vendorError, setVendorError] = useState<string>();
  const cwd = props.projectFolder?.trim() || props.cwd || '/';
  const layerActive = useKeepAliveActive();
  const isActive = layerActive && props.active !== false;
  const activeRef = useRef(isActive);
  const resizeSchedulerRef = useRef<ReturnType<typeof createTerminalResizeScheduler> | null>(null);
  const fitTerminalRef = useRef<(() => void) | null>(null);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isTerminalPathDrag(event.dataTransfer)) {
      setIsPathDragOver(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setIsPathDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current;
    if (wrapper && !wrapper.contains(event.relatedTarget as Node | null)) {
      setIsPathDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      setIsPathDragOver(false);
      const paths = extractFilePathsFromDrag(event);
      if (paths.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const escaped = `${paths.map(shellEscapePath).join(' ')} `;
      window.syncThink?.terminal?.write(props.terminalId, escaped);
      xtermRef.current?.focus();
    },
    [props.terminalId],
  );

  useEffect(() => {
    const container = containerRef.current;
    const bridge = window.syncThink?.terminal;
    if (!container || !bridge) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let themeObserver: MutationObserver | undefined;
    let inputDisposable: { dispose(): void } | undefined;
    let onDataCleanup: (() => void) | undefined;
    let onExitCleanup: (() => void) | undefined;
    let resizeScheduler: ReturnType<typeof createTerminalResizeScheduler> | undefined;
    let applyTheme: (() => void) | undefined;

    void loadXtermVendor()
      .then(({ Terminal, FitAddon, WebLinksAddon }) => {
        if (disposed || !container) return;
        const term = new Terminal({
          fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
          fontSize: 13,
          lineHeight: 1.2,
          cursorBlink: true,
          cursorStyle: 'block',
          theme: getXtermTheme(),
          allowProposedApi: true,
        });
        const fitAddon = FitAddon ? new FitAddon() : undefined;
        const webLinksAddon = WebLinksAddon ? new WebLinksAddon() : undefined;
        if (fitAddon) term.loadAddon?.(fitAddon);
        if (webLinksAddon) term.loadAddon?.(webLinksAddon);
        term.open(container);
        xtermRef.current = term;
        setTermBg(getXtermTheme().background);

        const writeBufferedOutput = (replay: boolean) => {
          void bridge.getBuffer(props.terminalId).then((snapshot) => {
            if (disposed || !snapshot || !replay) return;
            term.write(snapshot);
          });
        };

        let ptyReadyForResize = false;
        const canResize = () => !disposed && activeRef.current && container.clientWidth > 0 && container.clientHeight > 0;
        const measureAndFit = () => {
          if (!canResize()) return;
          const dimensions = fitAddon?.proposeDimensions();
          if (!isValidTerminalSize(dimensions)) return;
          fitAddon?.fit();
          return dimensions;
        };
        const syncPtyDimensions = ({ cols, rows }: { cols: number; rows: number }) => {
          if (!ptyReadyForResize || !canResize()) return false;
          bridge.resize(props.terminalId, cols, rows);
          return true;
        };
        resizeScheduler = createTerminalResizeScheduler(syncPtyDimensions);
        resizeSchedulerRef.current = resizeScheduler;
        const fitAndSchedule = () => {
          const dimensions = measureAndFit();
          if (dimensions) resizeScheduler?.schedule(dimensions);
        };
        fitTerminalRef.current = fitAndSchedule;
        const enablePtyResize = () => {
          ptyReadyForResize = true;
          // The pane may have switched while create/exists was pending. Measure now.
          fitAndSchedule();
        };

        term.attachCustomKeyEventHandler?.((event) => {
          if (event.type === 'keydown' && event.metaKey && event.key === 'Backspace') {
            bridge.write(props.terminalId, '\u0015');
            return false;
          }
          return true;
        });
        inputDisposable = term.onData?.((data) => {
          bridge.write(props.terminalId, data);
        });
        onDataCleanup = bridge.onData((sessionId, data) => {
          if (sessionId !== props.terminalId) return;
          term.write(data);
        });
        onExitCleanup = bridge.onExit((sessionId, exitCode) => {
          if (sessionId !== props.terminalId) return;
          term.writeln?.(`\r\n\u001b[90m[进程已退出，代码 ${exitCode}]\u001b[0m`);
        });

        requestAnimationFrame(() => {
          if (disposed) return;
          const { cols, rows } = measureAndFit() ?? DEFAULT_TERMINAL_SIZE;
          void bridge.exists(props.terminalId).then((alive) => {
            if (disposed) return;
            if (alive) {
              writeBufferedOutput(true);
              enablePtyResize();
              return;
            }
            const colorScheme = document.documentElement.classList.contains('dark')
              ? 'dark'
              : 'light';
            void bridge
              .create({
                sessionId: props.terminalId,
                workspaceId: props.workspaceId ?? '__unknown_workspace__',
                cwd,
                cols,
                rows,
                title: props.title,
                colorScheme,
              })
              .then((result) => {
                if (disposed) return;
                if (!result.success) {
                  term.writeln?.('\r\n\u001b[31m[终端创建失败]\u001b[0m');
                  if (result.error) {
                    for (const line of result.error.split('\n')) {
                      term.writeln?.(`\u001b[33m${line}\u001b[0m`);
                    }
                  }
                  return;
                }
                if (result.sessionId && result.sessionId !== props.terminalId) return;
                enablePtyResize();
              });
          });
          if (canResize()) term.focus();
        });

        resizeObserver = new ResizeObserver(fitAndSchedule);
        resizeObserver.observe(container);

        applyTheme = () => {
          const theme = getXtermTheme();
          if (xtermRef.current?.options) xtermRef.current.options.theme = theme;
          setTermBg(theme.background);
        };
        themeObserver = new MutationObserver(applyTheme);
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-color-theme', 'data-image-theme', 'style'],
        });
        window.addEventListener('shell-preferences-applied', applyTheme);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setVendorError(error instanceof Error ? error.message : '终端组件加载失败');
        }
      });

    return () => {
      disposed = true;
      if (applyTheme) window.removeEventListener('shell-preferences-applied', applyTheme);
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      inputDisposable?.dispose();
      onDataCleanup?.();
      onExitCleanup?.();
      resizeScheduler?.dispose();
      resizeSchedulerRef.current = null;
      fitTerminalRef.current = null;
      xtermRef.current?.dispose();
      xtermRef.current = null;
    };
  }, [cwd, props.terminalId, props.title, props.workspaceId]);

  useLayoutEffect(() => {
    activeRef.current = isActive;
    if (!isActive) {
      resizeSchedulerRef.current?.dispose();
      return;
    }
    const id = requestAnimationFrame(() => {
      fitTerminalRef.current?.();
      xtermRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [isActive]);

  return (
    <div
      ref={wrapperRef}
      className="shell-terminal-pane"
      data-testid="terminal-pane"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        ref={containerRef}
        className="shell-terminal-output"
        data-testid="terminal-output"
        style={getTerminalViewportStyle(termBg)}
      >
        {vendorError ? <div className="shell-terminal-load-error">{vendorError}</div> : null}
      </div>
      {isPathDragOver ? (
        <div data-terminal-path-drop-highlight="true" className="shell-terminal-drop-highlight">
          <div className="shell-terminal-drop-highlight__fill" />
        </div>
      ) : null}
    </div>
  );
}
