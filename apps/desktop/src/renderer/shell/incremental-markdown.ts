import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const UNSTABLE_TAIL_BLOCKS = 2;

interface MarkdownBlockRange {
  start: number;
  end: number;
}

export interface IncrementalMarkdownBlock {
  key: string;
  text: string;
  frozen: boolean;
}

export interface IncrementalMarkdownSnapshot {
  blocks: readonly IncrementalMarkdownBlock[];
  unstableStart: number;
}

export type MarkdownTopLevelParser = (text: string) => readonly MarkdownBlockRange[];

const markdownParser = unified().use(remarkParse).use(remarkGfm).freeze();

export function parseMarkdownTopLevelBlocks(text: string): readonly MarkdownBlockRange[] {
  const tree = markdownParser.parse(text) as {
    children?: Array<{
      position?: {
        start?: { offset?: number };
        end?: { offset?: number };
      };
    }>;
  };
  return (tree.children ?? []).flatMap((node) => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    return typeof start === 'number' && typeof end === 'number' ? [{ start, end }] : [];
  });
}

/**
 * Append-only Markdown parser matching DSH's two-block unstable tail. Frozen
 * blocks retain object identity and never enter the parser again while streaming.
 */
export class IncrementalMarkdownParser {
  private source: string | undefined;
  private unstableStart = 0;
  private readonly frozenBlocks: IncrementalMarkdownBlock[] = [];
  private snapshot: IncrementalMarkdownSnapshot = { blocks: [], unstableStart: 0 };

  constructor(private readonly parseTopLevelBlocks: MarkdownTopLevelParser = parseMarkdownTopLevelBlocks) {}

  update(source: string): IncrementalMarkdownSnapshot {
    if (source === this.source) return this.snapshot;
    if (this.source !== undefined && !source.startsWith(this.source)) this.reset();
    this.source = source;

    const unstableText = source.slice(this.unstableStart);
    const ranges = this.parseTopLevelBlocks(unstableText);
    const freezeCount = Math.max(0, ranges.length - UNSTABLE_TAIL_BLOCKS);

    for (let index = 0; index < freezeCount; index += 1) {
      const range = ranges[index]!;
      const segmentStart = index === 0 ? 0 : range.start;
      const segmentEnd = ranges[index + 1]?.start ?? range.end;
      this.frozenBlocks.push({
        key: `block:${this.unstableStart + range.start}`,
        text: unstableText.slice(segmentStart, segmentEnd),
        frozen: true,
      });
    }

    if (freezeCount > 0) {
      this.unstableStart += ranges[freezeCount]!.start;
    }
    const tail = source.slice(this.unstableStart);
    this.snapshot = {
      blocks: [
        ...this.frozenBlocks,
        ...(tail
          ? [{ key: `tail:${this.unstableStart}`, text: tail, frozen: false } as const]
          : []),
      ],
      unstableStart: this.unstableStart,
    };
    return this.snapshot;
  }

  private reset(): void {
    this.source = undefined;
    this.unstableStart = 0;
    this.frozenBlocks.length = 0;
    this.snapshot = { blocks: [], unstableStart: 0 };
  }
}
