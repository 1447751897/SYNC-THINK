import type { ArtifactTextComparison } from '@sync-think/shared';

export interface CompareTextSnapshotsInput {
  left: string;
  right: string;
}

export type MergeTextSnapshotsResult =
  | {
      status: 'clean';
      content: string;
      source: 'left' | 'right' | 'both';
    }
  | {
      status: 'conflict';
      base: string;
      left: string;
      right: string;
    };

const MAX_DIFF3_LCS_CELLS = 250_000;

interface LineChange {
  start: number;
  end: number;
  lines: string[];
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split('\n');
}

function buildLineChanges(base: string[], branch: string[]): LineChange[] | undefined {
  if (base.length * branch.length > MAX_DIFF3_LCS_CELLS) return undefined;

  const lcs = Array.from(
    { length: base.length + 1 },
    () => new Uint32Array(branch.length + 1),
  );
  for (let baseIndex = base.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let branchIndex = branch.length - 1; branchIndex >= 0; branchIndex -= 1) {
      lcs[baseIndex]![branchIndex] =
        base[baseIndex] === branch[branchIndex]
          ? lcs[baseIndex + 1]![branchIndex + 1]! + 1
          : Math.max(
              lcs[baseIndex + 1]![branchIndex]!,
              lcs[baseIndex]![branchIndex + 1]!,
            );
    }
  }

  const changes: LineChange[] = [];
  let active: LineChange | undefined;
  let baseIndex = 0;
  let branchIndex = 0;
  const beginChange = (): LineChange => {
    active ??= { start: baseIndex, end: baseIndex, lines: [] };
    return active;
  };
  const finishChange = (): void => {
    if (active) changes.push(active);
    active = undefined;
  };

  while (baseIndex < base.length || branchIndex < branch.length) {
    if (
      baseIndex < base.length &&
      branchIndex < branch.length &&
      base[baseIndex] === branch[branchIndex]
    ) {
      finishChange();
      baseIndex += 1;
      branchIndex += 1;
      continue;
    }

    const insertScore =
      branchIndex < branch.length ? lcs[baseIndex]![branchIndex + 1]! : -1;
    const deleteScore =
      baseIndex < base.length ? lcs[baseIndex + 1]![branchIndex]! : -1;
    if (
      branchIndex < branch.length &&
      (baseIndex === base.length || insertScore >= deleteScore)
    ) {
      beginChange().lines.push(branch[branchIndex]!);
      branchIndex += 1;
    } else {
      beginChange().end += 1;
      baseIndex += 1;
    }
  }
  finishChange();
  return changes;
}

function sameChange(left: LineChange, right: LineChange): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.lines.length === right.lines.length &&
    left.lines.every((line, index) => line === right.lines[index])
  );
}

function changesOverlap(left: LineChange, right: LineChange): boolean {
  if (sameChange(left, right)) return false;
  const leftIsInsert = left.start === left.end;
  const rightIsInsert = right.start === right.end;
  if (leftIsInsert && rightIsInsert) return left.start === right.start;
  if (leftIsInsert) return right.start < left.start && left.start < right.end;
  if (rightIsInsert) return left.start < right.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

function combineLineChanges(
  base: string[],
  left: LineChange[],
  right: LineChange[],
): string | undefined {
  if (left.some((leftChange) => right.some((rightChange) => changesOverlap(leftChange, rightChange)))) {
    return undefined;
  }

  const combined = [...left];
  for (const rightChange of right) {
    if (!combined.some((change) => sameChange(change, rightChange))) {
      combined.push(rightChange);
    }
  }
  combined.sort((a, b) => a.start - b.start || a.end - b.end);

  const result: string[] = [];
  let cursor = 0;
  for (const change of combined) {
    if (change.start < cursor) return undefined;
    result.push(...base.slice(cursor, change.start), ...change.lines);
    cursor = change.end;
  }
  result.push(...base.slice(cursor));
  return result.join('\n');
}

export function compareTextSnapshots(
  input: CompareTextSnapshotsInput,
): ArtifactTextComparison {
  if (input.left === input.right) return { kind: 'text', equal: true, hunks: [] };

  const leftLines = input.left.split('\n');
  const rightLines = input.right.split('\n');
  let prefixLength = 0;
  while (
    prefixLength < leftLines.length &&
    prefixLength < rightLines.length &&
    leftLines[prefixLength] === rightLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < leftLines.length - prefixLength &&
    suffixLength < rightLines.length - prefixLength &&
    leftLines[leftLines.length - suffixLength - 1] ===
      rightLines[rightLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  return {
    kind: 'text',
    equal: false,
    hunks: [
      {
        leftStartLine: prefixLength + 1,
        rightStartLine: prefixLength + 1,
        removedLines: leftLines.slice(prefixLength, leftLines.length - suffixLength),
        addedLines: rightLines.slice(prefixLength, rightLines.length - suffixLength),
      },
    ],
  };
}

export function mergeTextSnapshots(input: {
  base: string;
  left: string;
  right: string;
}): MergeTextSnapshotsResult {
  if (input.left === input.right) {
    return { status: 'clean', content: input.left, source: 'both' };
  }
  if (input.left === input.base) {
    return { status: 'clean', content: input.right, source: 'right' };
  }
  if (input.right === input.base) {
    return { status: 'clean', content: input.left, source: 'left' };
  }

  const baseLines = splitLines(input.base);
  const leftChanges = buildLineChanges(baseLines, splitLines(input.left));
  const rightChanges = buildLineChanges(baseLines, splitLines(input.right));
  if (leftChanges && rightChanges) {
    const content = combineLineChanges(baseLines, leftChanges, rightChanges);
    if (content !== undefined) {
      return { status: 'clean', content, source: 'both' };
    }
  }
  return {
    status: 'conflict',
    base: input.base,
    left: input.left,
    right: input.right,
  };
}
