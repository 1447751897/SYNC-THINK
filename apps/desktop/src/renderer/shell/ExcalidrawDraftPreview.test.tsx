/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExcalidrawDraftPreview } from './ExcalidrawDraftPreview.js';
import { createEmptyExcalidrawDocument } from './excalidraw-document.js';

const mountExcalidraw = vi.fn();
const fakeHandle = {
  update: vi.fn(),
  getCurrentDocument: vi.fn(),
  exportPng: vi.fn(),
  exportSvg: vi.fn(),
  focus: vi.fn(),
  getRoot: vi.fn(() => document.createElement('div')),
  getApi: vi.fn(() => ({
    getAppState: () => ({}),
    setActiveTool: vi.fn(),
    updateScene: vi.fn(),
    onChange: () => () => undefined,
  })),
  onReady: vi.fn(() => () => undefined),
  dispose: vi.fn(),
};

beforeEach(() => {
  mountExcalidraw.mockReturnValue(fakeHandle);
  fakeHandle.getCurrentDocument.mockImplementation(() =>
    mountExcalidraw.mock.calls.at(-1)?.[1]?.document,
  );
  fakeHandle.exportSvg.mockResolvedValue(
    new Blob(['<svg><rect width="10" height="10" /></svg>'], { type: 'image/svg+xml' }),
  );
  Object.defineProperty(window, 'SyncThinkExcalidraw', {
    configurable: true,
    value: { mountExcalidraw },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, 'SyncThinkExcalidraw');
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ExcalidrawDraftPreview', () => {
  it('hands the exported scene to the project-backed browser opener', async () => {
    const onOpenInBrowser = vi.fn().mockResolvedValue(undefined);
    const content = JSON.stringify(createEmptyExcalidrawDocument(), null, 2);
    render(
      <ExcalidrawDraftPreview
        code={content}
        projectFolder="D:/work/demo"
        onOpenInBrowser={onOpenInBrowser}
      />,
    );

    await waitFor(() => expect(mountExcalidraw).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '浏览器打开' }));
    await waitFor(() =>
      expect(onOpenInBrowser).toHaveBeenCalledWith(
        expect.stringContaining('Excalidraw 设计稿'),
        { relativePath: 'designs/ai-drawing.html', persist: true },
      ),
    );
  });

  it('sends the selected frame and children to the real design generator', async () => {
    const generateDesign = vi.fn().mockResolvedValue({
      requestId: 'design-result',
      modelId: 'model-1',
      html: '<!doctype html><html><head></head><body><main>Generated</main></body></html>',
    });
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { generateDesign } },
    });
    const base = createEmptyExcalidrawDocument();
    const content = JSON.stringify(
      {
        ...base,
        appState: { ...base.appState, selectedElementIds: { frame: true } },
        elements: [
          {
            id: 'frame',
            type: 'frame',
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            frameId: null,
          },
          {
            id: 'title',
            type: 'text',
            x: 24,
            y: 24,
            width: 120,
            height: 24,
            frameId: 'frame',
            text: 'Hello',
          },
        ],
      },
      null,
      2,
    );
    render(<ExcalidrawDraftPreview code={content} />);

    await waitFor(() =>
      expect((screen.getByRole('button', { name: '生成网页' }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '生成网页' }));
    await waitFor(() => expect(generateDesign).toHaveBeenCalledTimes(1));
    expect(generateDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        frame: expect.objectContaining({ id: 'frame', type: 'frame' }),
        children: [expect.objectContaining({ id: 'title', frameId: 'frame' })],
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('excalidraw-generated-design')).not.toBeNull());
    expect(fakeHandle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: expect.arrayContaining([
          expect.objectContaining({
            id: 'frame',
            customData: expect.objectContaining({
              generationData: expect.objectContaining({ status: 'done' }),
            }),
          }),
        ]),
      }),
    );
  });

  it('uses the editor live selection instead of the persisted transient app state', async () => {
    const generateDesign = vi.fn().mockResolvedValue({
      requestId: 'design-live-selection',
      modelId: 'model-1',
      html: '<!doctype html><html><body>Second frame</body></html>',
    });
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { generateDesign } },
    });
    const base = createEmptyExcalidrawDocument();
    const elements = [
      { id: 'frame-a', type: 'frame', x: 0, y: 0, width: 320, height: 180 },
      {
        id: 'title-a',
        type: 'text',
        x: 24,
        y: 24,
        width: 120,
        height: 24,
        frameId: 'frame-a',
        text: 'First',
      },
      { id: 'frame-b', type: 'frame', x: 400, y: 0, width: 320, height: 180 },
      {
        id: 'title-b',
        type: 'text',
        x: 424,
        y: 24,
        width: 120,
        height: 24,
        frameId: 'frame-b',
        text: 'Second',
      },
    ];
    fakeHandle.getCurrentDocument.mockReturnValue({
      ...base,
      elements,
      appState: { ...base.appState, selectedElementIds: { 'frame-b': true } },
    });
    render(
      <ExcalidrawDraftPreview
        code={JSON.stringify({
          ...base,
          elements,
          appState: { ...base.appState, selectedElementIds: { 'frame-a': true } },
        })}
      />,
    );

    await waitFor(() => expect(mountExcalidraw).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '生成网页' }));

    await waitFor(() => expect(generateDesign).toHaveBeenCalledTimes(1));
    expect(generateDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        frame: expect.objectContaining({ id: 'frame-b' }),
        children: [expect.objectContaining({ id: 'title-b' })],
      }),
    );
  });

  it('does not call the provider when the scene has no drawable children', async () => {
    const generateDesign = vi.fn();
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { generateDesign } },
    });
    render(<ExcalidrawDraftPreview code={JSON.stringify(createEmptyExcalidrawDocument())} />);
    const button = screen.getByRole('button', { name: '生成网页' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(generateDesign).not.toHaveBeenCalled();
  });
});
