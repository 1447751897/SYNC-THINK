const REDACTED = '[REDACTED]';
const MAX_DIAGNOSTIC_LENGTH = 4_096;

export function sanitizeKernelDiagnostic(
  value: unknown,
  secrets: readonly (string | undefined)[] = [],
): string {
  let message = value instanceof Error ? value.message : String(value ?? '');
  for (const secret of secrets
    .map((entry) => entry?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .sort((left, right) => right.length - left.length)) {
    message = message.split(secret).join(REDACTED);
  }

  message = message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/(bearer\s+)[A-Za-z0-9._~\-+/=]+/gi, `$1${REDACTED}`)
    .replace(
      /((?:anthropic|openai)[_-](?:api[_-]?key|auth[_-]?token)\s*[:=]\s*)[^\s,;]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /((?:x-)?api[_-]?key|auth(?:orization)?|access[_-]?token|secret)\s*[:=]\s*[^\s,;]+/gi,
      `$1=${REDACTED}`,
    )
    .trim();

  if (message.length <= MAX_DIAGNOSTIC_LENGTH) return message;
  return `...${message.slice(-(MAX_DIAGNOSTIC_LENGTH - 3))}`;
}

export function formatKernelExitDiagnostic(
  kernelName: string,
  code: number | null,
  stderrTail: unknown,
  secrets: readonly (string | undefined)[] = [],
  processError?: unknown,
): string {
  const detail =
    sanitizeKernelDiagnostic(stderrTail, secrets) ||
    sanitizeKernelDiagnostic(processError, secrets);
  const summary =
    code === null
      ? `${kernelName} exited unexpectedly`
      : `${kernelName} exited with code ${String(code)}`;
  return detail ? `${summary}: ${detail}` : summary;
}
