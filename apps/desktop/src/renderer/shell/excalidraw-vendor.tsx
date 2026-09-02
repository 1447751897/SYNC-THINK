import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Excalidraw,
  exportToBlob,
  exportToSvg,
} from '@excalidraw/excalidraw';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export interface ExcalidrawVendorDocument {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface ExcalidrawVendorOptions {
  document: ExcalidrawVendorDocument;
  theme: 'light' | 'dark';
  langCode: 'zh-CN' | 'en';
  onChange(
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
  ): void;
}

export interface ExcalidrawVendorHandle {
  update(document: ExcalidrawVendorDocument): void;
  getCurrentDocument(): ExcalidrawVendorDocument;
  exportPng(): Promise<Blob>;
  exportSvg(): Promise<Blob>;
  focus(): void;
  getRoot(): HTMLElement;
  getApi(): {
    getAppState(): Record<string, unknown>;
    setActiveTool(tool: { type: string; insertOnCanvasDirectly?: boolean; locked?: boolean }): void;
    updateScene(scene: { appState?: Record<string, unknown> }): void;
    onChange(callback: (_elements: readonly unknown[], appState: Record<string, unknown>) => void): () => void;
  } | null;
  onReady(callback: () => void): () => void;
  dispose(): void;
}

interface SurfaceBridge {
  api: ExcalidrawImperativeAPI | null;
  pendingDocument: ExcalidrawVendorDocument | null;
  document: ExcalidrawVendorDocument;
  readyListeners: Set<() => void>;
}

function toInitialData(document: ExcalidrawVendorDocument): ExcalidrawInitialDataState {
  return {
    elements: document.elements as OrderedExcalidrawElement[],
    appState: {
      // Match NewMax's default Excalifont while allowing a persisted scene
      // to override it explicitly.
      currentItemFontFamily: 5,
      ...document.appState,
      collaborators: new Map(),
    } as Partial<AppState>,
    files: document.files as BinaryFiles,
  };
}

function Surface({ options, bridge }: { options: ExcalidrawVendorOptions; bridge: SurfaceBridge }) {
  return React.createElement(Excalidraw, {
    initialData: toInitialData(options.document),
    theme: options.theme,
    langCode: options.langCode,
    aiEnabled: false,
    UIOptions: { canvasActions: { loadScene: false } },
    onChange: (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      options.onChange(
        elements,
        appState as unknown as Record<string, unknown>,
        files as unknown as Record<string, unknown>,
      );
      bridge.document = {
        elements: [...elements],
        appState: appState as unknown as Record<string, unknown>,
        files: files as unknown as Record<string, unknown>,
      };
    },
    excalidrawAPI: (api: ExcalidrawImperativeAPI) => {
      bridge.api = api;
      for (const listener of bridge.readyListeners) listener();
      if (bridge.pendingDocument) {
        applyDocument(api, bridge.pendingDocument);
        bridge.pendingDocument = null;
      }
    },
    onDuplicate: (nextElements: readonly OrderedExcalidrawElement[]) => [...nextElements],
  });
}

function applyDocument(api: ExcalidrawImperativeAPI, document: ExcalidrawVendorDocument): void {
  api.updateScene({
    elements: document.elements as OrderedExcalidrawElement[],
    appState: document.appState as Partial<AppState>,
  });
  const files = Object.values(document.files) as BinaryFiles[keyof BinaryFiles][];
  if (files.length > 0) api.addFiles(files);
}

export function mountExcalidraw(
  element: HTMLElement,
  options: ExcalidrawVendorOptions,
): ExcalidrawVendorHandle {
  const root: Root = createRoot(element);
  const bridge: SurfaceBridge = {
    api: null,
    pendingDocument: null,
    document: options.document,
    readyListeners: new Set(),
  };
  root.render(React.createElement(Surface, { options, bridge }));
  return {
    update(document) {
      bridge.document = document;
      if (bridge.api) applyDocument(bridge.api, document);
      else bridge.pendingDocument = document;
    },
    getCurrentDocument() {
      return bridge.document;
    },
    async exportPng() {
      const document = bridge.document;
      return exportToBlob({
        elements: document.elements as never,
        appState: document.appState as never,
        files: document.files as never,
        mimeType: 'image/png',
      });
    },
    async exportSvg() {
      const document = bridge.document;
      const svg = await exportToSvg({
        elements: document.elements as never,
        appState: document.appState as never,
        files: document.files as never,
      });
      return new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
    },
    focus() {
      const target = element.querySelector<HTMLElement>('.excalidraw');
      target?.focus();
    },
    getRoot() {
      return element;
    },
    getApi() {
      const api = bridge.api;
      if (!api) return null;
      return {
        getAppState: () => api.getAppState() as unknown as Record<string, unknown>,
        setActiveTool: (tool: { type: string; insertOnCanvasDirectly?: boolean; locked?: boolean }) => {
          api.setActiveTool(tool as never);
        },
        updateScene: (scene: { appState?: Record<string, unknown> }) => {
          api.updateScene({ appState: scene.appState as never });
        },
        onChange: (callback: (_elements: readonly unknown[], appState: Record<string, unknown>) => void) =>
          api.onChange((elements, appState) => callback(elements, appState as unknown as Record<string, unknown>)),
      };
    },
    onReady(callback) {
      bridge.readyListeners.add(callback);
      if (bridge.api) callback();
      return () => bridge.readyListeners.delete(callback);
    },
    dispose() {
      bridge.api = null;
      bridge.pendingDocument = null;
      bridge.readyListeners.clear();
      root.unmount();
    },
  };
}

(globalThis as typeof globalThis & { SyncThinkExcalidraw?: unknown }).SyncThinkExcalidraw = {
  mountExcalidraw,
};
