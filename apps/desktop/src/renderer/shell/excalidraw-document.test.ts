import { describe, expect, it } from 'vitest';
import {
  createEmptyExcalidrawDocument,
  parseExcalidrawDocument,
  serializeExcalidrawDocument,
} from './excalidraw-document.js';

describe('Excalidraw document contract', () => {
  it('creates the same minimal file shape as NewMax', () => {
    expect(createEmptyExcalidrawDocument()).toEqual({
      type: 'excalidraw',
      version: 2,
      elements: [],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    });
  });

  it('restores valid JSON while normalizing missing collections', () => {
    expect(
      parseExcalidrawDocument(
        JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'a' }] }),
      ),
    ).toEqual({
      ok: true,
      document: {
        type: 'excalidraw',
        version: 2,
        elements: [{ id: 'a' }],
        appState: { viewBackgroundColor: '#ffffff' },
        files: {},
      },
    });
  });

  it('rejects unrelated or malformed file content', () => {
    expect(parseExcalidrawDocument('not json')).toEqual({
      ok: false,
      error: '设计稿不是有效的 Excalidraw JSON',
    });
    expect(parseExcalidrawDocument(JSON.stringify({ type: 'other', elements: [] }))).toEqual({
      ok: false,
      error: '设计稿不是 Excalidraw 文件',
    });
  });

  it('serializes only persisted app state and removes deleted elements', () => {
    const result = serializeExcalidrawDocument(
      [{ id: 'live', isDeleted: false }, { id: 'deleted', isDeleted: true }] as never,
      {
        viewBackgroundColor: '#f8f9fa',
        gridSize: 20,
        currentItemFontFamily: 5,
        currentItemFontSize: 20,
        currentItemStrokeColor: '#111111',
        currentItemBackgroundColor: 'transparent',
        currentItemFillStyle: 'solid',
        currentItemStrokeWidth: 2,
        currentItemRoughness: 0,
        currentItemOpacity: 100,
        currentItemTextAlign: 'left',
        currentItemStartArrowhead: null,
        currentItemEndArrowhead: 'arrow',
        currentItemRoundness: 'round',
        collaborators: new Map(),
        zoom: { value: 1 },
      } as never,
      { image: { id: 'image' } } as never,
    );

    expect(JSON.parse(result)).toEqual({
      type: 'excalidraw',
      version: 2,
      elements: [{ id: 'live', isDeleted: false }],
      appState: {
        viewBackgroundColor: '#f8f9fa',
        gridSize: 20,
        currentItemFontFamily: 5,
        currentItemFontSize: 20,
        currentItemStrokeColor: '#111111',
        currentItemBackgroundColor: 'transparent',
        currentItemFillStyle: 'solid',
        currentItemStrokeWidth: 2,
        currentItemRoughness: 0,
        currentItemOpacity: 100,
        currentItemTextAlign: 'left',
        currentItemStartArrowhead: null,
        currentItemEndArrowhead: 'arrow',
        currentItemRoundness: 'round',
      },
      files: { image: { id: 'image' } },
    });
  });
});
