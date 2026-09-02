import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { RunProcessView } from '@sync-think/protocol';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { FilePane, type FileRevealTarget } from './FilePane.js';
import { WorkspaceFilesPanel } from './RightDock.js';
import { isExcalidrawPath } from './excalidraw-document.js';

const DEFAULT_EXPLORER_WIDTH = 288;
const MIN_EXPLORER_WIDTH = 221;
const MAX_EXPLORER_WIDTH = 600;
const MIN_EDITOR_WIDTH = 360;
const DIVIDER_WIDTH = 1;
const KEYBOARD_RESIZE_STEP = 16;
const FLOATING_LAYOUT_MAX_WIDTH = MIN_EXPLORER_WIDTH + MIN_EDITOR_WIDTH + DIVIDER_WIDTH;

interface ExplorerResizeDrag {
  startClientX: number;
  startWidth: number;
  lastWidth: number;
  pointerId: number;
  target: HTMLDivElement;
}

function explorerWidthBounds(
  containerWidth: number,
  floating: boolean,
): { min: number; max: number } {
  if (containerWidth <= 0) {
    return { min: MIN_EXPLORER_WIDTH, max: MAX_EXPLORER_WIDTH };
  }
  const available = floating
    ? Math.max(MIN_EXPLORER_WIDTH, containerWidth - 40)
    : Math.max(MIN_EXPLORER_WIDTH, containerWidth - MIN_EDITOR_WIDTH - DIVIDER_WIDTH);
  return {
    min: Math.min(MIN_EXPLORER_WIDTH, available),
    max: Math.max(MIN_EXPLORER_WIDTH, Math.min(MAX_EXPLORER_WIDTH, available)),
  };
}

export function WorkspaceFileView({
  projectFolder,
  path,
  revealTarget,
  workspaceFilesOpen: controlledWorkspaceFilesOpen,
  onWorkspaceFilesOpenChange,
  explorerWidth: controlledExplorerWidth,
  onExplorerWidthChange,
  reviewView,
  onOpenReview,
  onDirtyChange,
  onOpenFileInCurrentTab,
  onOpenFileInNewTab,
}: {
  projectFolder?: string;
  path: string;
  revealTarget?: FileRevealTarget;
  workspaceFilesOpen?: boolean;
  onWorkspaceFilesOpenChange?(open: boolean): void;
  explorerWidth?: number;
  onExplorerWidthChange?(width: number, commit: boolean): void;
  reviewView?: RunProcessView | null;
  onOpenReview?(view: RunProcessView): void;
  onDirtyChange?(dirty: boolean): void;
  onOpenFileInCurrentTab(path: string, location?: ProjectTextLocation): void;
  onOpenFileInNewTab(path: string, location?: ProjectTextLocation): void;
}) {
  const [internalWorkspaceFilesOpen, setInternalWorkspaceFilesOpen] = useState(true);
  const canvasDocument = isExcalidrawPath(path);
  const workspaceFilesOpen = canvasDocument
    ? false
    : (controlledWorkspaceFilesOpen ?? internalWorkspaceFilesOpen);
  const setWorkspaceFilesOpen = useCallback(
    (open: boolean) => {
      if (controlledWorkspaceFilesOpen === undefined) setInternalWorkspaceFilesOpen(open);
      onWorkspaceFilesOpenChange?.(open);
    },
    [controlledWorkspaceFilesOpen, onWorkspaceFilesOpenChange],
  );
  const [internalExplorerWidth, setInternalExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const explorerWidth = controlledExplorerWidth ?? internalExplorerWidth;
  const [containerWidth, setContainerWidth] = useState(0);
  const floating = containerWidth > 0 && containerWidth < FLOATING_LAYOUT_MAX_WIDTH;
  const [resizeBounds, setResizeBounds] = useState({
    min: MIN_EXPLORER_WIDTH,
    max: MAX_EXPLORER_WIDTH,
  });
  const layoutRef = useRef<HTMLDivElement>(null);
  const explorerRef = useRef<HTMLElement>(null);
  const resizeDragRef = useRef<ExplorerResizeDrag | null>(null);

  const currentContainerWidth = useCallback(() => {
    return layoutRef.current?.getBoundingClientRect().width ?? 0;
  }, []);

  const applyExplorerWidth = useCallback(
    (value: number, commit: boolean, width = currentContainerWidth()) => {
      const nextFloating = width > 0 && width < FLOATING_LAYOUT_MAX_WIDTH;
      const nextBounds = explorerWidthBounds(width, nextFloating);
      const nextWidth = Math.round(Math.min(nextBounds.max, Math.max(nextBounds.min, value)));
      setResizeBounds(nextBounds);
      if (controlledExplorerWidth === undefined) setInternalExplorerWidth(nextWidth);
      onExplorerWidthChange?.(nextWidth, commit);
      return nextWidth;
    },
    [controlledExplorerWidth, currentContainerWidth, onExplorerWidthChange],
  );

  const finishResize = useCallback(() => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    resizeDragRef.current = null;
    if (drag.target.hasPointerCapture?.(drag.pointerId)) {
      drag.target.releasePointerCapture?.(drag.pointerId);
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    onExplorerWidthChange?.(drag.lastWidth, true);
  }, [onExplorerWidthChange]);

  useEffect(() => {
    window.addEventListener('blur', finishResize);
    return () => {
      window.removeEventListener('blur', finishResize);
      finishResize();
    };
  }, [finishResize]);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? layout.getBoundingClientRect().width;
      setContainerWidth(width);
      if (resizeDragRef.current) finishResize();
      const nextFloating = width > 0 && width < FLOATING_LAYOUT_MAX_WIDTH;
      const nextBounds = explorerWidthBounds(width, nextFloating);
      setResizeBounds(nextBounds);
      if (controlledExplorerWidth === undefined) {
        setInternalExplorerWidth((current) =>
          Math.min(nextBounds.max, Math.max(nextBounds.min, current)),
        );
      }
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, [controlledExplorerWidth, finishResize]);

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    const containerWidth = currentContainerWidth();
    const startWidth = explorerRef.current?.getBoundingClientRect().width ?? 0;
    if (startWidth <= 0 || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeDragRef.current = {
      startClientX: event.clientX,
      startWidth,
      lastWidth: startWidth,
      pointerId: event.pointerId,
      target: event.currentTarget,
    };
    setResizeBounds(explorerWidthBounds(containerWidth, floating));
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const resizeWithPointer = (event: PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const containerWidth = currentContainerWidth();
    const nextWidth = drag.startWidth - (event.clientX - drag.startClientX);
    drag.lastWidth = applyExplorerWidth(nextWidth, false, containerWidth);
  };

  const adjustWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const containerWidth = currentContainerWidth();
    const bounds = explorerWidthBounds(containerWidth, floating);
    let next: number | undefined;
    if (event.key === 'Home') next = bounds.min;
    else if (event.key === 'End') next = bounds.max;
    else if (event.key === 'ArrowLeft') next = explorerWidth + KEYBOARD_RESIZE_STEP;
    else if (event.key === 'ArrowRight') next = explorerWidth - KEYBOARD_RESIZE_STEP;
    if (next === undefined) return;
    event.preventDefault();
    applyExplorerWidth(next, true, containerWidth);
  };

  const workbenchStyle = {
    '--shell-file-explorer-width': `${explorerWidth}px`,
  } as CSSProperties;

  return (
    <div
      className="shell-file-workbench"
      data-testid="workspace-file-view"
      data-explorer-open={workspaceFilesOpen ? 'true' : 'false'}
      data-explorer-floating={floating ? 'true' : 'false'}
      style={workbenchStyle}
    >
      <div
        ref={layoutRef}
        className="shell-file-workbench__layout"
        data-testid="workspace-file-layout"
      >
        <div className="shell-file-workbench__editor">
          <FilePane
            projectFolder={projectFolder}
            path={path}
            revealTarget={revealTarget}
            onDirtyChange={onDirtyChange}
            workspaceFilesOpen={workspaceFilesOpen}
            onToggleWorkspaceFiles={() => setWorkspaceFilesOpen(!workspaceFilesOpen)}
          />
        </div>
        {workspaceFilesOpen ? (
          <>
            <div
              role="separator"
              tabIndex={0}
              aria-label="调整工作区文件宽度"
              aria-orientation="vertical"
              aria-valuemin={Math.round(resizeBounds.min)}
              aria-valuemax={Math.round(resizeBounds.max)}
              aria-valuenow={Math.round(explorerWidth)}
              className="shell-file-workbench__divider"
              data-testid="workspace-file-divider"
              onPointerDown={beginResize}
              onPointerMove={resizeWithPointer}
              onPointerUp={finishResize}
              onPointerCancel={finishResize}
              onLostPointerCapture={finishResize}
              onDoubleClick={() =>
                applyExplorerWidth(DEFAULT_EXPLORER_WIDTH, true, currentContainerWidth())
              }
              onKeyDown={adjustWithKeyboard}
            />
            <aside
              ref={explorerRef}
              className="shell-file-workbench__explorer"
              aria-label="嵌入的工作区文件"
              data-testid="workspace-file-explorer"
            >
              <WorkspaceFilesPanel
                projectFolder={projectFolder}
                activeFilePath={path}
                reviewView={reviewView}
                onOpenReview={onOpenReview}
                onOpenFile={onOpenFileInCurrentTab}
                onOpenFileInNewTab={onOpenFileInNewTab}
              />
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
