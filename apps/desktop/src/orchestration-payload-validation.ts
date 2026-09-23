import { isRecord } from '@sync-think/shared/value-validation';

const MAX_ID = 256;
const SECRET_KEY =
  /^(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization|credential(?:value|plaintext))$/i;

export { isRecord } from '@sync-think/shared/value-validation';

export function hasOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowlist = new Set(allowed);
  return Object.keys(record).every((key) => allowlist.has(key));
}

export function boundedText(value: unknown, max = MAX_ID): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function taskVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function revision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

export function invalid(name: string): never {
  throw new Error(`Invalid ${name} payload`);
}

export function assertRendererSafeOrchestrationPayload(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    visited += 1;
    if (visited > 10_000 || current.depth > 16) {
      throw new Error('Invalid orchestration payload complexity');
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isRecord(current.value)) continue;
    for (const [key, nested] of Object.entries(current.value)) {
      if (SECRET_KEY.test(key)) {
        throw new Error(`Renderer orchestration payload contains secret-like field: ${key}`);
      }
      stack.push({ value: nested, depth: current.depth + 1 });
    }
  }
}
