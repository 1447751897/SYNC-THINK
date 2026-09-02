/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExcalidrawPreview } from './ExcalidrawPreview.js';
import type {
  ExcalidrawVendor,
  ExcalidrawVendorHandle,
} from './excalidraw-vendor-loader.js';

const apiState = {
  activeTool: { type: 'selection', locked: false },
  zoom: { value: 1 },
};
const apiChangeListeners = new Set<(_elements: readonly unknown[], state: Record<string, unknown>) => void>();
const setActiveTool = vi.fn((tool: { type: string; locked?: boolean }) => {
  apiState.activeTool = { type: tool.type, locked: Boolean(tool.locked) };
  for (const listener of apiChangeListeners) listener([], apiState);
});
const nativeMenuClick = vi.fn();
const fakeApi = {
  getAppState: () => apiState,
  setActiveTool,
  updateScene: vi.fn(),
  onChange: (callback: (_elements: readonly unknown[], state: Record<string, unknown>) => void) => {
    apiChangeListeners.add(callback);
    return () => apiChangeListeners.delete(callback);
  },
};

let readyListeners = new Set<() => void>();
let fakeHandle: ExcalidrawVendorHandle;
const vendor: ExcalidrawVendor = {
  mountExcalidraw(element) {
    element.innerHTML = `
      <div class="excalidraw excalidraw--mobile" tabindex="0">
        <div class="App-toolbar-container">
          <div class="App-toolbar--mobile"><div class="Stack_horizontal">
            <label class="Shape"><input data-testid="toolbar-selection" aria-label="选择工具"></label>
            <label class="Shape"><input data-testid="toolbar-rectangle" aria-label="矩形"></label>
          </div></div>
        </div>
        <div class="App-toolbar-content"><button class="main-menu-trigger">菜单</button></div>
      </div>`;
    const menu = element.querySelector('.main-menu-trigger') as HTMLButtonElement;
    menu.addEventListener('click', nativeMenuClick);
    fakeHandle = {
      update: vi.fn(),
      getCurrentDocument: vi.fn(() => ({
        elements: [],
        appState: apiState,
        files: {},
      })),
      exportPng: vi.fn(async () => new Blob()),
      exportSvg: vi.fn(async () => new Blob()),
      focus: vi.fn(),
      getRoot: () => element,
      getApi: () => fakeApi,
      onReady: (callback) => {
        readyListeners.add(callback);
        callback();
        return () => readyListeners.delete(callback);
      },
      dispose: vi.fn(),
    };
    return fakeHandle;
  },
};

vi.mock('./excalidraw-vendor-loader.js', async () => {
  const actual = await vi.importActual<typeof import('./excalidraw-vendor-loader.js')>(
    './excalidraw-vendor-loader.js',
  );
  return { ...actual, loadExcalidrawVendor: vi.fn(async () => vendor) };
});

beforeEach(() => {
  readyListeners = new Set();
  apiChangeListeners.clear();
  setActiveTool.mockClear();
  nativeMenuClick.mockClear();
  apiState.activeTool = { type: 'selection', locked: false };
});

afterEach(() => cleanup());

const content = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [],
  appState: { viewBackgroundColor: '#fff' },
  files: {},
});

describe('ExcalidrawPreview NewMax chrome', () => {
  it('ports the menu and auxiliary controls into the native mobile toolbar', async () => {
    render(<ExcalidrawPreview content={content} />);

    await waitFor(() => expect(screen.getByLabelText('画布菜单')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('画布菜单'));
    expect(nativeMenuClick).toHaveBeenCalledTimes(1);

    expect(screen.getByLabelText('手型工具')).toBeTruthy();
    expect(screen.getAllByLabelText('选择工具').length).toBeGreaterThanOrEqual(1);
  });

  it('selects a drawing tool from the collapsed tool menu through Excalidraw API', async () => {
    render(<ExcalidrawPreview content={content} />);

    await waitFor(() => expect(screen.getByLabelText('更多绘图工具')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('更多绘图工具'));
    fireEvent.click(screen.getByRole('menuitem', { name: '矩形' }));

    expect(setActiveTool).toHaveBeenCalledWith({ type: 'rectangle' });
  });
});
