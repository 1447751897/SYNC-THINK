/** Structured, host-evaluated conditions; never a model's success assertion. */
export interface AutomationAcceptanceChecks {
  minimumRows?: number;
  requiredColumns?: string[];
  dateColumn?: string;
  sourceUrlColumn?: string;
  minimumSlides?: number;
}

const CHECK_KEYS = [
  'minimumRows',
  'requiredColumns',
  'dateColumn',
  'sourceUrlColumn',
  'minimumSlides',
];

/** Invalid contracts return undefined, matching the scheduled-task parser convention. */
export function parseAutomationAcceptanceChecks(
  value: unknown,
): AutomationAcceptanceChecks | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (!keys.length || keys.some((key) => typeof key !== 'string' || !CHECK_KEYS.includes(key)))
    return undefined;
  if (keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')))
    return undefined;
  const record = value as Record<string, unknown>;
  const result: AutomationAcceptanceChecks = {};
  for (const [key, limit] of [
    ['minimumRows', 10_000],
    ['minimumSlides', 100],
  ] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const count = record[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > limit)
      return undefined;
    result[key] = count;
  }
  for (const key of ['dateColumn', 'sourceUrlColumn'] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const name = columnName(record[key]);
    if (name === undefined) return undefined;
    result[key] = name;
  }
  if (Object.hasOwn(record, 'requiredColumns')) {
    const columns = record.requiredColumns;
    if (!Array.isArray(columns) || columns.length < 1 || columns.length > 128) return undefined;
    const names: string[] = [];
    const seen = new Set<string>();
    for (const column of columns) {
      const name = columnName(column);
      if (name === undefined || seen.has(name)) return undefined;
      seen.add(name);
      names.push(name);
    }
    result.requiredColumns = names;
  }
  return result;
}

// Same text ceiling as the real export tool; limits work before trimming a name.
function columnName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 32_767) return undefined;
  return value.trim() || undefined;
}
