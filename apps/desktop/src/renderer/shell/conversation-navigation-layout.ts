export interface NavigationMessageLayout {
  id: string;
  top: number;
  height: number;
}

export interface NavigationMessageAnchor {
  id: string;
  messageId: string;
}

const NAVIGATION_BOTTOM_TOLERANCE_PX = 8;

export class ConversationNavigationLayout {
  private readonly rowIndex: ReadonlyMap<string, number>;
  private readonly heights: number[];
  private readonly deltas: Float64Array;
  private readonly anchors: { id: string; rowIndex: number }[];
  private readonly anchorIndex: ReadonlyMap<string, number>;

  constructor(
    private readonly rows: readonly NavigationMessageLayout[],
    anchors: readonly NavigationMessageAnchor[],
  ) {
    this.rowIndex = new Map(rows.map((row, index) => [row.id, index]));
    this.heights = rows.map((row) => row.height);
    this.deltas = new Float64Array(rows.length + 1);
    this.anchors = anchors.flatMap((anchor) => {
      const index = this.rowIndex.get(anchor.messageId);
      return index === undefined ? [] : [{ id: anchor.id, rowIndex: index }];
    });
    this.anchorIndex = new Map(this.anchors.map((anchor, index) => [anchor.id, index]));
  }

  updateHeights(changes: readonly { messageId: string; height: number }[]): number {
    let totalDelta = 0;
    for (const change of changes) {
      const rowIndex = this.rowIndex.get(change.messageId);
      if (rowIndex === undefined || !Number.isFinite(change.height) || change.height < 0) continue;
      const difference = change.height - this.heights[rowIndex]!;
      if (Math.abs(difference) < 0.01) continue;
      this.heights[rowIndex] = change.height;
      totalDelta += difference;
      for (
        let treeIndex = rowIndex + 1;
        treeIndex < this.deltas.length;
        treeIndex += treeIndex & -treeIndex
      )
        this.deltas[treeIndex]! += difference;
    }
    return totalDelta;
  }

  top(itemId: string): number | undefined {
    const index = this.anchorIndex.get(itemId);
    return index === undefined ? undefined : this.anchorTop(index);
  }

  active(scrollTop: number, viewportHeight: number, scrollHeight: number): string | undefined {
    if (this.anchors.length === 0) return undefined;
    if (scrollTop <= 1) return this.anchors[0]!.id;
    if (Math.max(0, scrollHeight - viewportHeight) - scrollTop <= NAVIGATION_BOTTOM_TOLERANCE_PX)
      return this.anchors.at(-1)!.id;
    const focus = scrollTop + viewportHeight * 0.25 + 1;
    let lower = 0;
    let upper = this.anchors.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (this.anchorTop(middle) <= focus) lower = middle + 1;
      else upper = middle;
    }
    return this.anchors[Math.max(0, lower - 1)]!.id;
  }

  private anchorTop(index: number): number {
    const rowIndex = this.anchors[index]!.rowIndex;
    let delta = 0;
    for (let treeIndex = rowIndex; treeIndex > 0; treeIndex -= treeIndex & -treeIndex)
      delta += this.deltas[treeIndex]!;
    return this.rows[rowIndex]!.top + delta;
  }
}
