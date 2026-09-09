import { buildVisualizationDocumentHtml, toVisualizationDataUrl } from '../visualization/ui-kit.js';
import type { VisualizationTheme } from '../visualization/design-system.js';

export interface InlineVisualizationMarkdownSegment {
  type: 'markdown';
  start: number;
  content: string;
}

export interface InlineVisualizationSegment {
  type: 'visualization';
  start: number;
  file: string;
}

export type InlineVisualizationParts =
  InlineVisualizationMarkdownSegment | InlineVisualizationSegment;

const DIRECTIVE_RE = /^\s*::(?:newmax|codex)-inline-vis\{file="([^"]+)"\}\s*$/;
const LEGACY_DIRECTIVE_RE = /^\s*:::(?:newmax|codex)-inline-vis\{file="([^"]+)"\}:::\s*$/;
const PARTIAL_DIRECTIVE_RE = /^\s*:{2,3}(?:newmax|codex)-inline-vis\{/;
const FILE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/;

function normalizeVisualizationFile(value: string): string | null {
  const file = value.trim();
  return FILE_RE.test(file) ? file : null;
}

/**
 * Parse NewMax's file-backed inline visualization directive without allowing
 * directives inside Markdown fences to escape as executable content.
 */
export function parseInlineVisualizationSegments(
  text: string,
  options: { streaming?: boolean } = {},
): InlineVisualizationParts[] {
  const source = options.streaming ? stripPartialTrailingDirective(text) : text;
  const parts: InlineVisualizationParts[] = [];
  let cursor = 0;
  let offset = 0;
  let fenceMarker: '`' | '~' | null = null;
  let fenceLength = 0;
  for (const lineWithEnding of source.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!lineWithEnding) continue;
    const line = lineWithEnding.endsWith('\n') ? lineWithEnding.slice(0, -1) : lineWithEnding;
    const trimmed = line.trimStart();
    const fence = /^(~~~+|```+)/.exec(trimmed);
    if (fence) {
      const run = fence[1]!;
      const marker = run[0] as '`' | '~';
      if (!fenceMarker) {
        fenceMarker = marker;
        fenceLength = run.length;
      } else if (
        marker === fenceMarker &&
        run.length >= fenceLength &&
        /^\s*$/.test(trimmed.slice(run.length))
      ) {
        fenceMarker = null;
        fenceLength = 0;
      }
      offset += lineWithEnding.length;
      continue;
    }
    if (!fenceMarker) {
      const directive = DIRECTIVE_RE.exec(line) ?? LEGACY_DIRECTIVE_RE.exec(line);
      const file = directive ? normalizeVisualizationFile(directive[1] ?? '') : null;
      if (file) {
        if (offset > cursor)
          parts.push({ type: 'markdown', start: cursor, content: source.slice(cursor, offset) });
        parts.push({ type: 'visualization', start: offset, file });
        cursor = offset + lineWithEnding.length;
      }
    }
    offset += lineWithEnding.length;
  }
  if (cursor < source.length)
    parts.push({ type: 'markdown', start: cursor, content: source.slice(cursor) });
  if (parts.length === 0 && source.length > 0)
    parts.push({ type: 'markdown', start: 0, content: source });
  return parts;
}

function stripPartialTrailingDirective(text: string): string {
  const start = text.lastIndexOf('\n') + 1;
  const lastLine = text.slice(start);
  if (PARTIAL_DIRECTIVE_RE.test(lastLine) && !lastLine.includes('}')) return text.slice(0, start);
  return text;
}

export function hasInlineVisualization(text: string): boolean {
  return parseInlineVisualizationSegments(text).some((part) => part.type === 'visualization');
}

/**
 * Build the isolated guest document used by inline visualizations.
 *
 * The template itself lives in `renderer/visualization/ui-kit.ts` so the
 * guest's `--ds-*` vocabulary stays out of the shell token contract; this
 * wrapper keeps the shell-facing API (a ready-to-use data: URL).
 */
export function buildVisualizationDocument(
  source: string,
  options: {
    theme?: VisualizationTheme;
    reduceMotion?: boolean;
    tokens?: Record<string, string>;
    fillViewport?: boolean;
  } = {},
): string {
  return toVisualizationDataUrl(
    buildVisualizationDocumentHtml(source, {
      theme: options.theme,
      reduceMotion: options.reduceMotion,
      tokens: options.tokens,
      fillViewport: options.fillViewport,
    }),
  );
}

export function visualizationFileLabel(file: string): string {
  return file.split('/').at(-1) || file;
}
