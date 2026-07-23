// Pure helpers for Compose @-file mentions + attachment chips (files + images).

export interface MentionQuery {
  /** Absolute start index of the '@' in the full text. */
  atIndex: number;
  /** Text after '@' up to the caret (no spaces). */
  query: string;
  /** Caret position that closed the query. */
  caret: number;
}

export interface ComposeAttachment {
  /** Stable key: file path or image:<id>. */
  path: string;
  name: string;
  kind: 'file' | 'dir' | 'image';
  /** Local preview for image chips / message bubbles (data URL or blob URL). */
  previewUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface MessageImage {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
}

/**
 * Detect an active @-mention query just before the caret.
 * Triggers only when '@' starts a token (start / whitespace / newline).
 */
export function detectMentionQuery(text: string, caret: number): MentionQuery | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const match = /(?:^|[\s([{])@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const query = match[1] ?? '';
  const atIndex = before.length - query.length - 1;
  if (text[atIndex] !== '@') return null;
  return { atIndex, query, caret };
}

/**
 * Remove the active `@query` token from the text (NewMax: selection becomes a chip,
 * not an inline @path string).
 */
export function stripMentionToken(
  text: string,
  mention: MentionQuery,
): { text: string; caret: number } {
  const next = text.slice(0, mention.atIndex) + text.slice(mention.caret);
  return { text: next, caret: mention.atIndex };
}

/** @deprecated kept for tests — prefer stripMentionToken + attachment chips. */
export function applyMention(
  text: string,
  mention: MentionQuery,
  filePath: string,
): { text: string; caret: number } {
  const insert = `@${filePath} `;
  const next = text.slice(0, mention.atIndex) + insert + text.slice(mention.caret);
  const caret = mention.atIndex + insert.length;
  return { text: next, caret };
}

/** File basename for chip label. */
export function fileNameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

/** Add attachment if not already present. */
export function addAttachment(
  current: readonly ComposeAttachment[],
  next: ComposeAttachment,
): ComposeAttachment[] {
  if (current.some((item) => item.path === next.path)) return [...current];
  return [...current, next];
}

/** Remove attachment by path. */
export function removeAttachment(
  current: readonly ComposeAttachment[],
  path: string,
): ComposeAttachment[] {
  return current.filter((item) => item.path !== path);
}

/** Image attachments only. */
export function imageAttachments(
  attachments: readonly ComposeAttachment[],
): ComposeAttachment[] {
  return attachments.filter((a) => a.kind === 'image' && Boolean(a.previewUrl));
}

/** Non-image file/dir attachments. */
export function fileAttachments(
  attachments: readonly ComposeAttachment[],
): ComposeAttachment[] {
  return attachments.filter((a) => a.kind !== 'image');
}

/**
 * Build the outbound user message text.
 * - File paths are listed so the model can still use tools without @ chips.
 * - Image binary is sent separately via appendMessage.images (multimodal).
 *   Do NOT put a fake "附件图片" footer that models treat as missing files.
 */
export function buildMessageWithAttachments(
  text: string,
  attachments: readonly ComposeAttachment[],
): string {
  const body = text.trimEnd();
  const files = fileAttachments(attachments);
  if (files.length === 0) return body.trim() ? body : text;

  const block = `引用文件：\n${files.map((a) => `- ${a.path}`).join('\n')}`;
  if (!body.trim()) return block;
  return `${body}\n\n${block}`;
}

/** Map image attachments into message-local previews for the bubble. */
export function messageImagesFromAttachments(
  attachments: readonly ComposeAttachment[],
): MessageImage[] {
  return imageAttachments(attachments).map((a) => ({
    id: a.path,
    name: a.name,
    url: a.previewUrl!,
    mimeType: a.mimeType,
  }));
}

/** Extract unique @path tokens from a message (legacy inline form). */
export function extractMentionPaths(text: string): string[] {
  const found: string[] = [];
  const re = /@([A-Za-z0-9_./\\-]+(?:\.[A-Za-z0-9_]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = m[1];
    if (p && !found.includes(p)) found.push(p);
  }
  return found;
}

/** Read a browser File as a data URL (for image chips / local preview). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('expected data URL'));
    };
    reader.readAsDataURL(file);
  });
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}

/** NewMax-ish auto-grow: measure scrollHeight against min/max. */
export function computeTextareaHeight(
  el: HTMLTextAreaElement,
  minPx = 56,
  maxPx = 220,
): number {
  el.style.height = '0px';
  const next = Math.min(maxPx, Math.max(minPx, el.scrollHeight));
  el.style.height = `${next}px`;
  return next;
}
