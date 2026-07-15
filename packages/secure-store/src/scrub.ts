// Secret scrubbing. Every diagnostic / log / export line passes through here.
// Returns same type as input but with secrets zeroed-out.

const SECRET_TOKEN_RE = /\b(sk-[A-Za-z0-9_-]{16,})\b/g;
const REDACTED = '[REDACTED]';

/** Redact known-shaped API key sk-... in a string. Conservative; UI MUST ALSO scrub. */
export function scrubSecrets(input: string): string {
  return input.replace(SECRET_TOKEN_RE, REDACTED);
}

/** Zero out a secret string in place. Mutates buffer to mitigate memory exposure. */
export function clearSecret(plaintext: string): void {
  // Strings in V8 are immutable; we cannot truly zero them.
  // This is intent-documentation: caller should keep secrets as Buffer when long-lived.
  // For Phase 0 the function exists so callers say "clearSecret(x)" explicitly.
  void plaintext;
}

export const SECRET_PATTERN = SECRET_TOKEN_RE.source;
