export const MAX_ACCEPTANCE_CRITERIA = 64;
export const MAX_ACCEPTANCE_CRITERION_UTF8_BYTES = 4_000;
export const MAX_ACCEPTANCE_CRITERIA_TOTAL_UTF8_BYTES = 64 * 1_024;

export type AcceptanceCriteriaValidationErrorCode =
  | 'acceptance_criteria.invalid'
  | 'acceptance_criteria.required'
  | 'acceptance_criteria.too_many'
  | 'acceptance_criteria.empty'
  | 'acceptance_criteria.item_too_large'
  | 'acceptance_criteria.total_too_large';

export class AcceptanceCriteriaValidationError extends Error {
  readonly code: AcceptanceCriteriaValidationErrorCode;

  constructor(code: AcceptanceCriteriaValidationErrorCode) {
    super(code);
    this.name = 'AcceptanceCriteriaValidationError';
    this.code = code;
  }
}

export interface NormalizeAcceptanceCriteriaOptions {
  requireNonEmpty?: boolean;
}

export function normalizeAcceptanceCriteria(
  value: unknown,
  options: NormalizeAcceptanceCriteriaOptions = {},
): string[] {
  if (!Array.isArray(value)) {
    throw new AcceptanceCriteriaValidationError('acceptance_criteria.invalid');
  }
  if (value.length > MAX_ACCEPTANCE_CRITERIA) {
    throw new AcceptanceCriteriaValidationError('acceptance_criteria.too_many');
  }
  if (options.requireNonEmpty && value.length === 0) {
    throw new AcceptanceCriteriaValidationError('acceptance_criteria.required');
  }

  let totalBytes = 0;
  return value.map((criterion) => {
    if (typeof criterion !== 'string') {
      throw new AcceptanceCriteriaValidationError('acceptance_criteria.invalid');
    }
    const normalized = criterion.trim();
    if (normalized.length === 0) {
      throw new AcceptanceCriteriaValidationError('acceptance_criteria.empty');
    }
    const itemBytes = boundedUtf8ByteLength(
      normalized,
      MAX_ACCEPTANCE_CRITERION_UTF8_BYTES,
    );
    if (itemBytes > MAX_ACCEPTANCE_CRITERION_UTF8_BYTES) {
      throw new AcceptanceCriteriaValidationError('acceptance_criteria.item_too_large');
    }
    totalBytes += itemBytes;
    if (totalBytes > MAX_ACCEPTANCE_CRITERIA_TOTAL_UTF8_BYTES) {
      throw new AcceptanceCriteriaValidationError('acceptance_criteria.total_too_large');
    }
    return normalized;
  });
}

function boundedUtf8ByteLength(value: string, limit: number): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes +=
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > limit) return bytes;
  }
  return bytes;
}
