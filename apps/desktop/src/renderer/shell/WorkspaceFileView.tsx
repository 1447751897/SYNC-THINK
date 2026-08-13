import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { FilePane, type FileRevealTarget } from './FilePane.js';
import { WorkspaceFilesPanel } from './RightDock.js';

const DEFAULT_EXPLORER_PERCENT = 30;
const MIN_EXPLORER_PERCENT = 22;
const MAX_EXPLORER_PERCENT = 60;
const MIN_EXPLORER_WIDTH = 220;
const MIN_EDITOR_WIDTH = 280;
const DIVIDER_WIDTH = 5;
const KEYBOARD_RESIZE_STEP = 5;
const STACKED_LAYOUT_MAX_WIDTH = 520;

interface ExplorerResizeDrag {
  startClientX: number;
  startWidth: number;
  pointerId: number;
  target: HTMLDivElement;
}

function explorerPercentBounds(containerWidth: number): { min: number; max: number } {
  if (containerWidth <= 0) {
    return { min: MIN_EXPLORER_PERCENT, max: MAX_EXPLORER_PERCENT };
  }
  const min = Math.max(MIN_EXPLORER_PERCENT, (MIN_EXPLORER_WIDTH / containerWidth) * 100);
  const max = Math.min(
    MAX_EXPLORER_PERCENT,
    ((containerWidth - MIN_EDITOR_WIDTH - DIVIDER_WIDTH) / containerWidth) * 100,
  );
  return { min, max: Math.max(min, max) };
}

export function WorkspaceFileView({
  projectFolder,
  path,
  revealTarget,
  onDirtyChange,
  onOpenFileInCurrentTab,
  onOpenFileInNewTab,
}: {
  projectFolder?: string;
  path: string;
  revealTarget?: FileRevealTarget;
  onDirtyChange?(dirty: boolean): void;
  onOpenFileInCurrentTab(path: string, location?: ProjectTextLocation): void;
  onOpenFileInNewTab(path: string, location?: ProjectTextLocation): void;
}) {
  const [workspaceFilesOpen, setWorkspaceFilesOpen] = useState(true);
  const [explorerPercent, setExplorerPercent] = useState(DEFAULT_EXPLORER_PERCENT);
  const [resizeBounds, setResizeBounds] = useState({
    min: MIN_EXPLORER_PERCENT,
    max: MAX_EXPLORER_PERCENT,
  });
  const layoutRef = useRef<HTMLDivElement>(null);
  const explorerRef = useRef<HTMLElement>(null);
  const resizeDragRef = useRef<ExplorerResizeDrag | null>(null);

  const currentContainerWidth = useCallback(() => {
    return layoutRef.current?.getBoundingClientRect().width ?? 0;
  }, []);

  const applyExplorerPercent = useCallback(
    (value: number, containerWidth = currentContainerWidth()) => {
      const nextBounds = explorerPercentBounds(containerWidth);
      setResizeBounds(nextBounds);
      setExplorerPercent(Math.min(nextBounds.max, Math.max(nextBounds.min, value)));
    },
    [currentContainerWidth],
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
  }, []);

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
      if (width <= STACKED_LAYOUT_MAX_WIDTH) return;
      if (resizeDragRef.current) finishResize();
      const nextBounds = explorerPercentBounds(width);
      setResizeBounds(nextBounds);
      setExplorerPercent((current) => Math.min(nextBounds.max, Math.max(nextBounds.min, current)));
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, [finishResize]);

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    const containerWidth = currentContainerWidth();
    const startWidth = explorerRef.current?.getBoundingClientRect().width ?? 0;
    if (
      containerWidth <= STACKED_LAYOUT_MAX_WIDTH ||
      startWidth <= 0 ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeDragRef.current = {
      startClientX: event.clientX,
      startWidth,
      pointerId: event.pointerId,
      target: event.currentTarget,
    };
    setResizeBounds(explorerPercentBounds(containerWidth));
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const resizeWithPointer = (event: PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const containerWidth = currentContainerWidth();
    if (containerWidth <= STACKED_LAYOUT_MAX_WIDTH) {
      finishResize();
      return;
    }
    const nextWidth = drag.startWidth - (event.clientX - drag.startClientX);
    applyExplorerPercent((nextWidth / containerWidth) * 100, containerWidth);
  };

  const adjustWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const containerWidth = currentContainerWidth();
    const bounds = explorerPercentBounds(containerWidth);
    let next: number | undefined;
    if (event.key === 'Home') next = bounds.min;
    else if (event.key === 'End') next = bounds.max;
    else if (event.key === 'ArrowLeft') next = explorerPercent + KEYBOARD_RESIZE_STEP;
    else if (event.key === 'ArrowRight') next = explorerPercent - KEYBOARD_RESIZE_STEP;
    if (next === undefined) return;
    event.preventDefault();
    applyExplorerPercent(next, containerWidth);
  };

  const workbenchStyle = {
    '--shell-file-explorer-width': `${explorerPercent}%`,
  } as CSSProperties;

  return (
    <div
      className="shell-file-workbench"
      data-testid="workspace-file-view"
      data-explorer-open={workspaceFilesOpen ? 'true' : 'false'}
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
            onToggleWorkspaceFiles={() => setWorkspaceFilesOpen((open) => !open)}
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
              aria-valuenow={Math.round(explorerPercent)}
              className="shell-file-workbench__divider"
              data-testid="workspace-file-divider"
              onPointerDown={beginResize}
              onPointerMove={resizeWithPointer}
              onPointerUp={finishResize}
              onPointerCancel={finishResize}
              onLostPointerCapture={finishResize}
              onDoubleClick={() =>
                applyExplorerPercent(DEFAULT_EXPLORER_PERCENT, currentContainerWidth())
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
