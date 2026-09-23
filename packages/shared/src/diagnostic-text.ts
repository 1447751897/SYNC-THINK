const SECRET_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replace: '[REDACTED]' },
  { re: /Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, replace: 'Bearer [REDACTED]' },
  { re: /api[_-]?key["'\s:=]+[A-Za-z0-9._-]{8,}/gi, replace: 'api_key=[REDACTED]' },
  { re: /plaintext-secret/gi, replace: '[REDACTED]' },
  { re: /\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, replace: '[PATH]' },
  { re: /\/(?:Users|home|var|tmp|private|opt|srv)\/[^\s"']+/g, replace: '[PATH]' },
  { re: /\b(?:response\s+body|body)\s*[:=]?\s*[\s\S]*/gi, replace: 'response body [REDACTED]' },
];

/** Shared scrubber for diagnostic text — never keeps provider keys in store. */
export function scrubDiagnosticText(text: string, maxLen = 480): string {
  let out = text;
  for (const { re, replace } of SECRET_PATTERNS) {
    out = out.replace(re, replace);
  }
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}
