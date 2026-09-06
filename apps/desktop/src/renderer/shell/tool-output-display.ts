/** NewMax 1.1.15 `formatToolOutput` display bounds. */
export const MAX_TOOL_OUTPUT_LINES = 200;
export const MAX_TOOL_OUTPUT_CHARACTERS = 40_000;
const LARGE_CONTENT_PREVIEW_HEAD_CHARS = 30_000;
const LARGE_CONTENT_PREVIEW_TAIL_CHARS = 10_000;

export interface DisplayedToolOutput {
  text: string;
  truncated: boolean;
  notice?: string;
}

function buildLargeContentPreview(content: string): { text: string; omittedCharacters: number } {
  const retained = LARGE_CONTENT_PREVIEW_HEAD_CHARS + LARGE_CONTENT_PREVIEW_TAIL_CHARS;
  if (content.length <= retained) return { text: content, omittedCharacters: 0 };
  return {
    text: `${content.slice(0, LARGE_CONTENT_PREVIEW_HEAD_CHARS)}\n\n…\n\n${content.slice(-LARGE_CONTENT_PREVIEW_TAIL_CHARS)}`,
    omittedCharacters: content.length - retained,
  };
}

export function formatDisplayedToolOutput(raw: string): DisplayedToolOutput {
  const trimmed = raw.replace(/\n+$/, '');
  if (!trimmed) return { text: '', truncated: false };
  if (trimmed.length > MAX_TOOL_OUTPUT_CHARACTERS) {
    const preview = buildLargeContentPreview(trimmed);
    return {
      text: preview.text,
      truncated: true,
      notice: `已省略 ${preview.omittedCharacters.toLocaleString()} 个字符`,
    };
  }
  const lines = trimmed.split('\n');
  if (lines.length > MAX_TOOL_OUTPUT_LINES) {
    return {
      text: lines.slice(0, MAX_TOOL_OUTPUT_LINES).join('\n'),
      truncated: true,
      notice: `… 还有 ${lines.length - MAX_TOOL_OUTPUT_LINES} 行`,
    };
  }
  return { text: trimmed, truncated: false };
}
