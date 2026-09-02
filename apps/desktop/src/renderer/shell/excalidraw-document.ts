/** The stable on-disk shape shared with NewMax's Excalidraw file tabs. */
export interface ExcalidrawDocument {
  type: 'excalidraw';
  version: 2;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export type ExcalidrawParseResult =
  | { ok: true; document: ExcalidrawDocument }
  | { ok: false; error: string };

const PERSISTED_APP_STATE_KEYS = [
  'viewBackgroundColor',
  'gridSize',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemFillStyle',
  'currentItemStrokeWidth',
  'currentItemRoughness',
  'currentItemOpacity',
  'currentItemTextAlign',
  'currentItemStartArrowhead',
  'currentItemEndArrowhead',
  'currentItemRoundness',
] as const;

export function createEmptyExcalidrawDocument(): ExcalidrawDocument {
  return {
    type: 'excalidraw',
    version: 2,
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function parseExcalidrawDocument(input: string): ExcalidrawParseResult {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return { ok: false, error: '设计稿不是有效的 Excalidraw JSON' };
  }
  if (!isRecord(value) || value.type !== 'excalidraw') {
    return { ok: false, error: '设计稿不是 Excalidraw 文件' };
  }
  const elements = Array.isArray(value.elements) ? value.elements : [];
  const appState = isRecord(value.appState) ? value.appState : {};
  const files = isRecord(value.files) ? value.files : {};
  return {
    ok: true,
    document: {
      type: 'excalidraw',
      version: 2,
      elements,
      appState: {
        viewBackgroundColor:
          typeof appState.viewBackgroundColor === 'string'
            ? appState.viewBackgroundColor
            : '#ffffff',
        ...appState,
      },
      files,
    },
  };
}

/**
 * Match NewMax's compact save format. Excalidraw's transient app state (zoom,
 * selection, collaborators, DOM dimensions, etc.) must not leak into files.
 */
export function serializeExcalidrawDocument(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
): string {
  const persistedAppState: Record<string, unknown> = {};
  for (const key of PERSISTED_APP_STATE_KEYS) {
    if (key in appState) persistedAppState[key] = appState[key];
  }
  if (typeof persistedAppState.viewBackgroundColor !== 'string') {
    persistedAppState.viewBackgroundColor = '#ffffff';
  }
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      elements: elements.filter((element) => {
        return !isRecord(element) || element.isDeleted !== true;
      }),
      appState: persistedAppState,
      files: isRecord(files) ? files : {},
    },
    null,
    2,
  );
}

export function isExcalidrawPath(path: string): boolean {
  return /\.excalidraw$/i.test(path.trim());
}
