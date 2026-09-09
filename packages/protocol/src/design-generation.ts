import type { DesignGeneratePayload } from './commands.js';

/** Keep one-shot scene requests bounded before they reach a provider. */
export const MAX_DESIGN_GENERATION_BYTES = 1_500_000;
export const MAX_DESIGN_GENERATION_CHILDREN = 512;
export const MAX_DESIGN_GENERATION_REQUEST_ID = 160;

/**
 * Excalidraw is an explicit source-file format, not the default response for
 * a visual design request. Keeping this policy in protocol makes native and
 * external kernels use the same routing rule.
 */
export function isExplicitExcalidrawRequest(userText: string): boolean {
  return /(?:excalidraw|\.excalidraw\b|excalidraw\s*(?:源文件|json|文件)|可编辑(?:的)?(?:画布|白板)\s*(?:json|源文件)?)/i.test(
    userText,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function utf8Bytes(value: string): number {
  return typeof TextEncoder === 'undefined'
    ? value.length * 2
    : new TextEncoder().encode(value).byteLength;
}

/** Strict parser shared by the Electron boundary and Runtime tests. */
export function parseDesignGeneratePayload(value: unknown): DesignGeneratePayload | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.some((key) => !['requestId', 'modelId', 'frame', 'children'].includes(key))) {
    return undefined;
  }
  const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : '';
  if (!requestId || requestId.length > MAX_DESIGN_GENERATION_REQUEST_ID) return undefined;
  if (value.modelId !== undefined && typeof value.modelId !== 'string') return undefined;
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';
  if (modelId.length > 512) return undefined;
  if (!isRecord(value.frame)) return undefined;
  if (!Array.isArray(value.children) || value.children.length > MAX_DESIGN_GENERATION_CHILDREN) {
    return undefined;
  }
  const children = value.children.filter(isRecord) as Record<string, unknown>[];
  if (children.length !== value.children.length) return undefined;
  try {
    const bytes = utf8Bytes(JSON.stringify({ frame: value.frame, children }));
    if (bytes > MAX_DESIGN_GENERATION_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return {
    requestId,
    ...(modelId ? { modelId: modelId as DesignGeneratePayload['modelId'] } : {}),
    frame: value.frame,
    children,
  };
}

/** Provider prompt used by the local magicframe implementation. */
export function buildDesignGenerationPrompt(payload: DesignGeneratePayload): string {
  return [
    'Convert the supplied Excalidraw wireframe into a polished, self-contained web design.',
    'Return only one complete HTML document: <!doctype html>, <html>, <head>, <body>.',
    'Put all CSS and JavaScript inline. Do not return Markdown fences, explanations, or a prose description.',
    'Preserve the visible hierarchy, labels, relative layout, colors, and interactions represented by the wireframe.',
    'This is a speed-first NewMax-style preview: implement the first viewport and the key interaction states only, keep the HTML compact (target <= 160 KB), and stop once it is usable.',
    'Do not embed base64 assets, large generated SVG path data, exhaustive screen variants, or hidden content that is not needed for the preview.',
    'Do not load remote scripts, stylesheets, fonts, images, or network resources.',
    `Frame JSON:\n${JSON.stringify(payload.frame)}`,
    `Children JSON:\n${JSON.stringify(payload.children)}`,
  ].join('\n\n');
}

/**
 * Accept raw HTML or one accidental markdown fence, then return exactly the
 * complete document. Partial output is rejected as a failed generation.
 */
export function extractGeneratedDesignHtml(raw: string): string {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('设计稿生成结果为空');
  const fenced = [...text.matchAll(/```(?:design-html|html|htm)?\s*([\s\S]*?)```/gi)]
    .map((match) => (match[1] ?? '').trim())
    .find((candidate) => /<html\b/i.test(candidate) || /<!doctype\s+html/i.test(candidate));
  const candidate = fenced ?? text;
  const doctypeIndex = candidate.search(/<!doctype\s+html\b/i);
  const htmlIndex = candidate.search(/<html\b/i);
  const start = doctypeIndex >= 0 ? doctypeIndex : htmlIndex;
  const endMatch = start >= 0 ? /<\/html\s*>/i.exec(candidate.slice(start)) : null;
  if (start < 0 || !endMatch) throw new Error('模型未返回完整 HTML 设计稿');
  const end = start + endMatch.index + endMatch[0].length;
  const html = candidate.slice(start, end).trim();
  if (
    !/<(?:!doctype\s+html\b|html\b)/i.test(html) ||
    !/<head\b/i.test(html) ||
    !/<body\b/i.test(html) ||
    !/<\/body\s*>/i.test(html) ||
    !/<\/html\s*>/i.test(html)
  ) {
    throw new Error('模型未返回完整 HTML 设计稿');
  }
  if (utf8Bytes(html) > 1_048_576) throw new Error('生成的设计稿超过 1MB');
  return html;
}
