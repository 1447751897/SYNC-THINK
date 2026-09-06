import { createHash } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type StatePath = Array<string | number>;
type StateOperation =
  | { type: 'set'; path: StatePath; value: JsonValue }
  | { type: 'delete'; path: StatePath }
  | { type: 'splice'; path: StatePath; index: number; deleteCount: number; values: JsonValue[] }
  | { type: 'text'; path: StatePath; index: number; deleteCount: number; text: string };

export interface RunStateDelta {
  version: 1;
  baseHash: string;
  resultHash: string;
  operations: StateOperation[];
}

export interface RunStateSnapshot {
  readonly value: Record<string, JsonValue>;
  readonly hash: string;
}

function record(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stateHash(value: object): string {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item: unknown) =>
        record(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, item[key]]),
            )
          : item,
      ),
    )
    .digest('hex');
}

function itemKey(value: JsonValue): string | undefined {
  if (!record(value)) return undefined;
  if (typeof value.id === 'string') return JSON.stringify(['id', value.id]);
  if (
    Number.isSafeInteger(value.sequence) &&
    typeof value.kind === 'string' &&
    typeof value.toolId === 'string'
  ) {
    return JSON.stringify(['tool', value.kind, value.toolId, value.sequence]);
  }
  return undefined;
}

function keyed(values: JsonValue[]): boolean {
  const keys = values.map(itemKey);
  return keys.every((key) => key !== undefined) && new Set(keys).size === keys.length;
}

function diffValue(
  previous: JsonValue,
  next: JsonValue,
  path: StatePath,
  operations: StateOperation[],
): void {
  if (previous === next) return;
  if (path.length > 128) throw new Error('run-state.invalid-path');
  if (typeof previous === 'string' && typeof next === 'string') {
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix])
      prefix += 1;
    let suffix = 0;
    while (
      suffix < previous.length - prefix &&
      suffix < next.length - prefix &&
      previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
    )
      suffix += 1;
    const text = next.slice(prefix, next.length - suffix);
    if (text.length + 64 < next.length) {
      operations.push({
        type: 'text',
        path,
        index: prefix,
        deleteCount: previous.length - prefix - suffix,
        text,
      });
    } else operations.push({ type: 'set', path, value: next });
    return;
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    const working = [...previous];
    if (keyed(previous) && keyed(next)) {
      for (let index = 0; index < next.length; index += 1) {
        const key = itemKey(next[index]);
        let matching = index;
        while (matching < working.length && itemKey(working[matching]) !== key) matching += 1;
        if (matching === working.length) {
          operations.push({ type: 'splice', path, index, deleteCount: 0, values: [next[index]] });
          working.splice(index, 0, next[index]);
        } else {
          if (matching > index) {
            operations.push({
              type: 'splice',
              path,
              index,
              deleteCount: matching - index,
              values: [],
            });
            working.splice(index, matching - index);
          }
          diffValue(working[index], next[index], [...path, index], operations);
        }
      }
      if (working.length > next.length)
        operations.push({
          type: 'splice',
          path,
          index: next.length,
          deleteCount: working.length - next.length,
          values: [],
        });
    } else {
      const common = Math.min(previous.length, next.length);
      for (let index = 0; index < common; index += 1)
        diffValue(previous[index], next[index], [...path, index], operations);
      if (previous.length !== next.length)
        operations.push({
          type: 'splice',
          path,
          index: common,
          deleteCount: previous.length - common,
          values: next.slice(common),
        });
    }
    return;
  }
  if (record(previous) && record(next)) {
    for (const key of Object.keys(previous))
      if (!Object.hasOwn(next, key)) operations.push({ type: 'delete', path: [...path, key] });
    for (const key of Object.keys(next)) {
      if (Object.hasOwn(previous, key))
        diffValue(previous[key], next[key], [...path, key], operations);
      else operations.push({ type: 'set', path: [...path, key], value: next[key] });
    }
    return;
  }
  operations.push({ type: 'set', path, value: next });
}

export function prepareRunState(value: object): RunStateSnapshot {
  const owned = cloneJson(value);
  if (!record(owned)) throw new Error('run-state.invalid-state');
  return { value: owned, hash: stateHash(owned) };
}

export function diffRunStateSnapshots(
  previous: RunStateSnapshot,
  next: RunStateSnapshot,
): RunStateDelta {
  const operations: StateOperation[] = [];
  diffValue(previous.value, next.value, [], operations);
  return {
    version: 1,
    baseHash: previous.hash,
    resultHash: next.hash,
    operations: cloneJson(operations),
  };
}

export function createRunStateDelta(previous: object, next: object): RunStateDelta {
  return diffRunStateSnapshots(prepareRunState(previous), prepareRunState(next));
}

function validPath(value: unknown): value is StatePath {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every(
      (key) =>
        typeof key === 'string' ||
        (typeof key === 'number' && Number.isSafeInteger(key) && key >= 0),
    )
  );
}

function atPath(root: JsonValue, path: StatePath): JsonValue {
  let current = root;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number' && key < current.length)
      current = current[key];
    else if (record(current) && typeof key === 'string' && Object.hasOwn(current, key))
      current = current[key];
    else throw new Error('run-state.invalid-path');
  }
  return current;
}

function setPath(root: JsonValue, path: StatePath, value: JsonValue): JsonValue {
  if (!path.length) return value;
  const parent = atPath(root, path.slice(0, -1));
  const key = path.at(-1)!;
  if (Array.isArray(parent) && typeof key === 'number' && key < parent.length) parent[key] = value;
  else if (record(parent) && typeof key === 'string')
    Object.defineProperty(parent, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  else throw new Error('run-state.invalid-path');
  return root;
}

function validRange(index: unknown, count: unknown, length: number): boolean {
  return (
    typeof index === 'number' &&
    Number.isSafeInteger(index) &&
    index >= 0 &&
    index <= length &&
    typeof count === 'number' &&
    Number.isSafeInteger(count) &&
    count >= 0 &&
    count <= length - index
  );
}

function operationKeys(operation: Record<string, JsonValue>, expected: string[]): boolean {
  return (
    Object.keys(operation).length === expected.length &&
    expected.every((key) => Object.hasOwn(operation, key))
  );
}

export function applyRunStateDelta(previous: object, input: unknown): Record<string, unknown> {
  if (
    !record(input) ||
    input.version !== 1 ||
    typeof input.baseHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.baseHash) ||
    typeof input.resultHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.resultHash) ||
    !Array.isArray(input.operations) ||
    input.operations.length > 100000 ||
    !operationKeys(input, ['version', 'baseHash', 'resultHash', 'operations'])
  )
    throw new Error('run-state.invalid-delta');
  let result = cloneJson(previous) as JsonValue;
  if (!record(result)) throw new Error('run-state.invalid-state');
  if (stateHash(result) !== input.baseHash) throw new Error('run-state.base-mismatch');
  for (const candidate of input.operations) {
    if (!record(candidate) || !validPath(candidate.path))
      throw new Error('run-state.invalid-operation');
    const path = candidate.path;
    if (candidate.type === 'set' && operationKeys(candidate, ['type', 'path', 'value'])) {
      result = setPath(result, path, cloneJson(candidate.value));
    } else if (candidate.type === 'delete' && operationKeys(candidate, ['type', 'path'])) {
      if (!path.length) throw new Error('run-state.invalid-path');
      const parent = atPath(result, path.slice(0, -1));
      const key = path.at(-1)!;
      if (!record(parent) || typeof key !== 'string' || !Object.hasOwn(parent, key))
        throw new Error('run-state.invalid-path');
      delete parent[key];
    } else if (
      candidate.type === 'splice' &&
      operationKeys(candidate, ['type', 'path', 'index', 'deleteCount', 'values'])
    ) {
      const target = atPath(result, path);
      if (
        !Array.isArray(target) ||
        !validRange(candidate.index, candidate.deleteCount, target.length) ||
        !Array.isArray(candidate.values)
      )
        throw new Error('run-state.invalid-operation');
      const index = candidate.index as number;
      result = setPath(result, path, [
        ...target.slice(0, index),
        ...cloneJson(candidate.values),
        ...target.slice(index + (candidate.deleteCount as number)),
      ]);
    } else if (
      candidate.type === 'text' &&
      operationKeys(candidate, ['type', 'path', 'index', 'deleteCount', 'text'])
    ) {
      const target = atPath(result, path);
      if (
        typeof target !== 'string' ||
        typeof candidate.text !== 'string' ||
        !validRange(candidate.index, candidate.deleteCount, target.length)
      )
        throw new Error('run-state.invalid-operation');
      const index = candidate.index as number;
      result = setPath(
        result,
        path,
        target.slice(0, index) +
          candidate.text +
          target.slice(index + (candidate.deleteCount as number)),
      );
    } else throw new Error('run-state.invalid-operation');
  }
  if (!record(result) || stateHash(result) !== input.resultHash)
    throw new Error('run-state.result-mismatch');
  return result;
}
