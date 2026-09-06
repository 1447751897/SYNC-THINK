import { parseContentReference, type ContentReference } from './deferred-content.js';

export type FileDiffSource = { reference: ContentReference } | { text: string };
export interface FileDiffReadOptions {
  before: FileDiffSource;
  after: FileDiffSource;
  offset?: number;
  limit?: number;
  version?: string;
}
export interface FileDiffRow {
  kind: 'add' | 'del' | 'ctx';
  text: string;
  truncated?: boolean;
  oldLine?: number;
  newLine?: number;
  oldOffset?: number;
  newOffset?: number;
}
export interface FileDiffPage {
  rows: FileDiffRow[];
  offset: number;
  nextOffset?: number;
  totalRows: number;
  added: number;
  removed: number;
  version: string;
  beforeVersion?: string;
  afterVersion?: string;
  mode: 'exact' | 'replacement';
  formatChanged: boolean;
}

function source(value: unknown): FileDiffSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1) return undefined;
  if (Object.hasOwn(input, 'text') && typeof input.text === 'string' && input.text.length <= 8192)
    return { text: input.text };
  if (!Object.hasOwn(input, 'reference')) return undefined;
  const reference = parseContentReference(input.reference);
  return reference ? { reference } : undefined;
}

export function parseFileDiffReadOptions(value: unknown): FileDiffReadOptions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    !Object.hasOwn(input, 'before') ||
    !Object.hasOwn(input, 'after') ||
    Object.keys(input).some(
      (key) => !['before', 'after', 'offset', 'limit', 'version'].includes(key),
    )
  )
    return undefined;
  const before = source(input.before);
  const after = source(input.after);
  if (
    !before ||
    !after ||
    (input.offset !== undefined &&
      (!Number.isSafeInteger(input.offset) || Number(input.offset) < 0)) ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) ||
        Number(input.limit) < 1 ||
        Number(input.limit) > 160)) ||
    (input.version !== undefined &&
      (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version)))
  )
    return undefined;
  return {
    before,
    after,
    ...(input.offset === undefined ? {} : { offset: input.offset as number }),
    ...(input.limit === undefined ? {} : { limit: input.limit as number }),
    ...(input.version === undefined ? {} : { version: input.version as string }),
  };
}

function split(text: string): { values: string[]; starts: number[] } {
  if (!text) return { values: [], starts: [] };
  const raw = text.split('\n');
  const starts: number[] = [];
  let position = 0;
  const values = raw.map((line, index) => {
    starts.push(position);
    position += line.length + 1;
    return index < raw.length - 1 && line.endsWith('\r') ? line.slice(0, -1) : line;
  });
  if (text.endsWith('\n')) {
    values.pop();
    starts.pop();
  }
  return { values, starts };
}

export function projectFileDiffPage(
  before: string,
  after: string,
  options: Pick<FileDiffReadOptions, 'offset' | 'limit'>,
  version: string,
): FileDiffPage {
  const old = split(before);
  const next = split(after);
  let prefix = 0;
  while (
    prefix < old.values.length &&
    prefix < next.values.length &&
    old.values[prefix] === next.values[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < old.values.length - prefix &&
    suffix < next.values.length - prefix &&
    old.values[old.values.length - suffix - 1] === next.values[next.values.length - suffix - 1]
  )
    suffix++;
  const oldCount = old.values.length - prefix - suffix;
  const newCount = next.values.length - prefix - suffix;
  const mode = oldCount * newCount <= 160000 ? 'exact' : 'replacement';
  const offset = options.offset ?? Math.max(0, prefix - 3);
  const limit = options.limit ?? 80;
  const rows: FileDiffRow[] = [];
  let totalRows = 0;
  let added = 0;
  let removed = 0;
  const emit = (kind: FileDiffRow['kind'], oldIndex?: number, newIndex?: number) => {
    if (kind === 'add') added++;
    if (kind === 'del') removed++;
    if (totalRows >= offset && rows.length < limit) {
      const text = newIndex === undefined ? old.values[oldIndex!]! : next.values[newIndex]!;
      let end = Math.min(text.length, 512);
      const previous = text.charCodeAt(end - 1);
      if (end < text.length && previous >= 0xd800 && previous <= 0xdbff) end--;
      rows.push({
        kind,
        text: text.slice(0, end),
        ...(end < text.length ? { truncated: true } : {}),
        ...(oldIndex === undefined
          ? {}
          : { oldLine: oldIndex + 1, oldOffset: old.starts[oldIndex] }),
        ...(newIndex === undefined
          ? {}
          : { newLine: newIndex + 1, newOffset: next.starts[newIndex] }),
      });
    }
    totalRows++;
  };
  for (let index = 0; index < prefix; index++) emit('ctx', index, index);
  if (mode === 'replacement' || oldCount === 0 || newCount === 0) {
    for (let index = 0; index < oldCount; index++) emit('del', prefix + index);
    for (let index = 0; index < newCount; index++) emit('add', undefined, prefix + index);
  } else {
    const width = newCount + 1;
    const matrix = new Uint32Array((oldCount + 1) * width);
    for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex--)
      for (let newIndex = newCount - 1; newIndex >= 0; newIndex--)
        matrix[oldIndex * width + newIndex] =
          old.values[prefix + oldIndex] === next.values[prefix + newIndex]
            ? matrix[(oldIndex + 1) * width + newIndex + 1]! + 1
            : Math.max(
                matrix[(oldIndex + 1) * width + newIndex]!,
                matrix[oldIndex * width + newIndex + 1]!,
              );
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldCount && newIndex < newCount) {
      if (old.values[prefix + oldIndex] === next.values[prefix + newIndex]) {
        emit('ctx', prefix + oldIndex++, prefix + newIndex++);
      } else if (
        matrix[(oldIndex + 1) * width + newIndex]! >= matrix[oldIndex * width + newIndex + 1]!
      )
        emit('del', prefix + oldIndex++);
      else emit('add', undefined, prefix + newIndex++);
    }
    while (oldIndex < oldCount) emit('del', prefix + oldIndex++);
    while (newIndex < newCount) emit('add', undefined, prefix + newIndex++);
  }
  for (let index = suffix; index > 0; index--)
    emit('ctx', old.values.length - index, next.values.length - index);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > totalRows ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 160
  )
    throw new Error('content.invalid-range');
  const end = offset + rows.length;
  return {
    rows,
    offset,
    ...(end < totalRows ? { nextOffset: end } : {}),
    totalRows,
    added,
    removed,
    version,
    mode,
    formatChanged: before !== after && added === 0 && removed === 0,
  };
}
