import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import type {
  PaneNode,
  PaneSplitDirection,
  WorkspacePane,
  WorkspacePaneLayout,
} from './pane-layout.js';

export interface WorkspacePaneHostProps {
  layout: WorkspacePaneLayout;
  renderPane(pane: WorkspacePane, focused: boolean): ReactNode;
  onFocusPane(paneId: string): void;
  /** commit=false while dragging; commit=true on mouse-up or keyboard adjustment. */
  onSplitRatioChange(splitNodeId: string, ratio: number, commit: boolean): void;
}

interface ResizeDrag {
  splitNodeId: string;
  direction: PaneSplitDirection;
  startClient: number;
  startRatio: number;
  size: number;
  lastRatio: number;
}

function clampRatio(value: number): number {
  return Math.min(0.8, Math.max(0.2, value));
}

export function WorkspacePaneHost(props: WorkspacePaneHostProps) {
  const dragRef = useRef<ResizeDrag | null>(null);
  const onSplitRatioChange = props.onSplitRatioChange;

  useEffect(() => {
    const onMove = (event: globalThis.MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.size <= 0) return;
      const client = drag.direction === 'horizontal' ? event.clientX : event.clientY;
      const ratio = clampRatio(drag.startRatio + (client - drag.startClient) / drag.size);
      drag.lastRatio = ratio;
      onSplitRatioChange(drag.splitNodeId, ratio, false);
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onSplitRatioChange(drag.splitNodeId, drag.lastRatio, true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [onSplitRatioChange]);

  const beginResize = (
    event: MouseEvent<HTMLDivElement>,
    node: Extract<PaneNode, { type: 'split' }>,
  ) => {
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const size = node.direction === 'horizontal' ? rect.width : rect.height;
    if (size <= 0) return;
    event.preventDefault();
    dragRef.current = {
      splitNodeId: node.id,
      direction: node.direction,
      startClient: node.direction === 'horizontal' ? event.clientX : event.clientY,
      startRatio: node.ratio,
      size,
      lastRatio: node.ratio,
    };
    document.body.style.cursor = node.direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const adjustWithKeyboard = (
    event: KeyboardEvent<HTMLDivElement>,
    node: Extract<PaneNode, { type: 'split' }>,
  ) => {
    let ratio: number | undefined;
    if (event.key === 'Home') ratio = 0.2;
    else if (event.key === 'End') ratio = 0.8;
    else if (
      (node.direction === 'horizontal' && event.key === 'ArrowLeft') ||
      (node.direction === 'vertical' && event.key === 'ArrowUp')
    ) {
      ratio = clampRatio(node.ratio - 0.05);
    } else if (
      (node.direction === 'horizontal' && event.key === 'ArrowRight') ||
      (node.direction === 'vertical' && event.key === 'ArrowDown')
    ) {
      ratio = clampRatio(node.ratio + 0.05);
    }
    if (ratio === undefined) return;
    event.preventDefault();
    props.onSplitRatioChange(node.id, Number(ratio.toFixed(2)), true);
  };

  const renderNode = (node: PaneNode): ReactNode => {
    if (node.type === 'pane') {
      const pane = props.layout.panes[node.paneId];
      if (!pane) return null;
      const focused = props.layout.focusedPaneId === pane.id;
      return (
        <section
          key={node.id}
          data-testid={`workspace-pane-${pane.id}`}
          data-focused={focused ? 'true' : 'false'}
          className={clsx('shell-workspace-pane', focused && 'shell-workspace-pane--focused')}
          onMouseDownCapture={() => props.onFocusPane(pane.id)}
          onFocusCapture={() => props.onFocusPane(pane.id)}
        >
          {props.renderPane(pane, focused)}
        </section>
      );
    }

    const separatorOrientation = node.direction === 'horizontal' ? 'vertical' : 'horizontal';
    const cursor = node.direction === 'horizontal' ? 'col-resize' : 'row-resize';
    return (
      <div
        key={node.id}
        data-testid={`workspace-split-${node.id}`}
        data-direction={node.direction}
        className={clsx('shell-pane-split', `shell-pane-split--${node.direction}`)}
      >
        <div
          className="shell-pane-branch shell-pane-branch--primary"
          style={{ flex: `0 0 ${node.ratio * 100}%` }}
        >
          {renderNode(node.children[0])}
        </div>
        <div
          role="separator"
          tabIndex={0}
          aria-label="调整窗格比例"
          aria-orientation={separatorOrientation}
          aria-valuemin={20}
          aria-valuemax={80}
          aria-valuenow={Math.round(node.ratio * 100)}
          className={clsx('shell-pane-tree-divider', `shell-pane-tree-divider--${node.direction}`)}
          style={{ cursor }}
          onMouseDown={(event) => beginResize(event, node)}
          onDoubleClick={() => props.onSplitRatioChange(node.id, 0.5, true)}
          onKeyDown={(event) => adjustWithKeyboard(event, node)}
        />
        <div className="shell-pane-branch shell-pane-branch--secondary">
          {renderNode(node.children[1])}
        </div>
      </div>
    );
  };

  return (
    <div className="shell-pane-tree" data-testid="workspace-pane-tree">
      {renderNode(props.layout.root)}
    </div>
  );
}
