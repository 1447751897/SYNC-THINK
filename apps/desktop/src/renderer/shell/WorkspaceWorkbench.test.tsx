/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkspaceWorkbench } from './WorkspaceWorkbench.js';
import {
  createWorkspaceWorkbenchLayout,
  fileWorkbenchTab,
  openWorkbenchTab,
  WORKBENCH_RIGHT_PREVIEW_WIDTH,
  workspaceFilesWorkbenchTab,
} from './workspace-workbench.js';

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const nativePointerEvent = window.PointerEvent;

beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: PointerEventPolyfill,
  });
});

afterAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: nativePointerEvent,
  });
});

afterEach(() => {
  cleanup();
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

describe('WorkspaceWorkbench', () => {
  function rightScope() {
    const files = openWorkbenchTab(
      createWorkspaceWorkbenchLayout(),
      'right',
      workspaceFilesWorkbenchTab(),
    );
    return openWorkbenchTab(files, 'right', fileWorkbenchTab('src/app.ts')).right;
  }

  it('renders shared resource tabs and activates or closes them', () => {
    const onActivateTab = vi.fn();
    const onCloseTab = vi.fn();
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={rightScope()}
        renderContent={(tab) => <div>{tab.id}</div>}
        onActivateTab={onActivateTab}
        onCloseTab={onCloseTab}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /工作区文件/ }));
    expect(onActivateTab).toHaveBeenCalledWith('workspace-files');
    fireEvent.click(screen.getByRole('button', { name: '关闭 app.ts' }));
    expect(onCloseTab).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/app.ts' }));
    expect(screen.getByText('file:src/app.ts')).toBeTruthy();
  });

  it('offers the NewMax-style add menu', () => {
    const onNewResource = vi.fn();
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={rightScope()}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={onNewResource}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加右侧工作台标签' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /新建终端/ }));
    expect(onNewResource).toHaveBeenCalledWith('terminal');
  });

  it('resizes from its outer edge with pointer and keyboard controls', () => {
    const onSizeChange = vi.fn();
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={rightScope()}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={onSizeChange}
      />,
    );

    const separator = screen.getByRole('separator', { name: '调整右侧工作台宽度' });
    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 1_200 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 1_100 });
    expect(onSizeChange).toHaveBeenCalledWith(WORKBENCH_RIGHT_PREVIEW_WIDTH + 100, false);
    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(onSizeChange).toHaveBeenLastCalledWith(WORKBENCH_RIGHT_PREVIEW_WIDTH + 100, true);

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onSizeChange).toHaveBeenLastCalledWith(WORKBENCH_RIGHT_PREVIEW_WIDTH - 16, true);
  });
});
