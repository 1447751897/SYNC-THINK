import { buildVisualizationDocumentHtml, toVisualizationDataUrl } from '../visualization/ui-kit.js';
import type { VisualizationTheme } from '../visualization/design-system.js';

// Parser stays on the chat hot path; the document renderer loads with HTML previews only.
export {
  parseInlineVisualizationSegments,
  hasInlineVisualization,
  visualizationFileLabel,
} from './inline-visualization-parser.js';
export type {
  InlineVisualizationSegment,
  InlineVisualizationMarkdownSegment,
  InlineVisualizationParts,
} from './inline-visualization-parser.js';

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
