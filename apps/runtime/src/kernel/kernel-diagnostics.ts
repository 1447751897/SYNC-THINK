const REDACTED = '[REDACTED]';
const MAX_DIAGNOSTIC_LENGTH = 4_096;

/** Local spawn/handshake errors occur before a provider request. Switching models cannot repair them. */
export class KernelStartupError extends Error {
  readonly failureClass = 'protocol' as const;

  constructor(kernelName: string, cause: unknown, secrets: readonly (string | undefined)[] = []) {
    super(
      `${kernelName} 本地内核启动失败：${sanitizeKernelDiagnostic(cause, secrets) || '进程未就绪'}`,
      { cause },
    );
    this.name = 'KernelStartupError';
  }
}

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
  // Warnings can precede the fatal error. Put the root cause first so bounded
  // UI/index summaries retain it, while keeping the full warning detail below.
  const lines = detail.split('\n');
  const fatal = lines.filter((line) => /^error:/i.test(line.trim()));
  const ordered = fatal.length
    ? [...fatal, ...lines.filter((line) => !fatal.includes(line))].join('\n')
    : detail;
  return ordered ? `${summary}: ${ordered}` : summary;
}
