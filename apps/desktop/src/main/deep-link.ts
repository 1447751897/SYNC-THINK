// Deep-link parsing for the syncthink:// protocol.
// Pure module — no Electron dependency, so it stays unit-testable in jsdom-node.

export const SYNCTHINK_PROTOCOL = 'syncthink:';

export interface DeepLinkTarget {
  conversationId: string;
}

/**
 * Parse a syncthink://conversation/{id} URL. Returns null for any other
 * scheme, path, or an empty id so the main process can ignore junk.
 */
export function parseDeepLinkUrl(raw: string): DeepLinkTarget | null {
  if (!raw || typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Accept `syncthink:` and `syncthink://` forms; reject everything else.
  if (url.protocol !== 'syncthink:') return null;

  // For non-standard schemes the URL parser may put the first path segment
  // (`conversation`) into the host, leaving the rest in pathname — e.g.
  // `syncthink://conversation/conv-1` has host=`conversation`, pathname=`/conv-1`.
  // Recombine host + pathname so both `syncthink://conversation/conv-1` and
  // `syncthink:conversation/conv-1` parse the same way, and strip any query.
  const path = `${url.host ? `${url.host}/` : ''}${url.pathname}`.replace(/^\//, '');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'conversation') return null;
  if (parts.length !== 2) return null;
  let conversationId: string;
  try {
    conversationId = decodeURIComponent(parts[1]).trim();
  } catch {
    return null;
  }
  if (!conversationId) return null;
  // Disallow path separators / whitespace inside the id.
  if (/[/\s]/.test(conversationId)) return null;
  return { conversationId };
}

/** Extract the first syncthink://conversation/{id} URL from a raw argv list. */
export function findDeepLinkInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const trimmed = String(arg ?? '').trim();
    if (trimmed.toLowerCase().startsWith('syncthink:')) return trimmed;
  }
  return null;
}
