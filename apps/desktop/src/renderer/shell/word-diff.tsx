/**
 * Word-level diff for paired delete/insert lines (NewMax "单词级差异" option).
 *
 * Tokens are identifiers/numbers, runs of whitespace, and single punctuation
 * characters, so a changed identifier or literal is highlighted as a unit
 * instead of shredding the whole line into characters.
 */
export interface WordSegment {
  text: string;
  changed: boolean;
}

/** Renders a tokenized line, marking the changed tokens. */
export function WordSegments({ segments }: { segments: readonly WordSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          <mark key={index} className="shell-diff-word">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/** Longest line we will tokenize; beyond this we fall back to the line diff. */
const MAX_TOKENS = 400;

function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/g) ?? [];
}

export function diffWordSegments(
  before: string,
  after: string,
): { before: WordSegment[]; after: WordSegment[] } | undefined {
  const left = tokenize(before);
  const right = tokenize(after);
  if (left.length > MAX_TOKENS || right.length > MAX_TOKENS) return undefined;
  const n = left.length;
  const m = right.length;
  const width = m + 1;
  const matrix = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      matrix[i * width + j] =
        left[i] === right[j]
          ? matrix[(i + 1) * width + j + 1] + 1
          : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
    }
  }
  const beforeSegments: WordSegment[] = [];
  const afterSegments: WordSegment[] = [];
  const push = (target: WordSegment[], text: string, changed: boolean) => {
    const last = target[target.length - 1];
    if (last && last.changed === changed) last.text += text;
    else target.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      push(beforeSegments, left[i]!, false);
      push(afterSegments, right[j]!, false);
      i++;
      j++;
    } else if (matrix[(i + 1) * width + j] >= matrix[i * width + j + 1]) {
      push(beforeSegments, left[i]!, true);
      i++;
    } else {
      push(afterSegments, right[j]!, true);
      j++;
    }
  }
  while (i < n) push(beforeSegments, left[i++]!, true);
  while (j < m) push(afterSegments, right[j++]!, true);
  return { before: beforeSegments, after: afterSegments };
}

/**
 * Pair each delete run with the insert run that follows it and return
 * row-index → segments for the rows that have a counterpart.
 */
export function wordHighlightMap(
  rows: readonly { kind: string; text: string }[],
): Map<number, WordSegment[]> {
  const highlights = new Map<number, WordSegment[]>();
  let index = 0;
  while (index < rows.length) {
    if (rows[index]!.kind !== 'del') {
      index++;
      continue;
    }
    const deletes: number[] = [];
    while (index < rows.length && rows[index]!.kind === 'del') deletes.push(index++);
    const inserts: number[] = [];
    while (index < rows.length && rows[index]!.kind === 'add') inserts.push(index++);
    const pairs = Math.min(deletes.length, inserts.length);
    for (let pair = 0; pair < pairs; pair++) {
      const segments = diffWordSegments(
        rows[deletes[pair]!]!.text,
        rows[inserts[pair]!]!.text,
      );
      if (!segments) continue;
      highlights.set(deletes[pair]!, segments.before);
      highlights.set(inserts[pair]!, segments.after);
    }
  }
  return highlights;
}
