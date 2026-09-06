import {
  ConversationNavigationLayout,
  type NavigationMessageAnchor,
} from './conversation-navigation-layout.js';

interface NavigationItemAnchor {
  id: string;
  promptId?: string;
}

interface NavigationGeometrySnapshot {
  height: number;
  activeId?: string;
  navigating: boolean;
}

export class ConversationNavigationGeometry {
  private items: readonly NavigationItemAnchor[] = [];
  private itemKey: string | undefined;
  private readonly nodes = new Map<string, HTMLElement>();
  private layout = new ConversationNavigationLayout([], []);
  private dirty = true;
  private frame: number | undefined;
  private width = 0;
  private contentHeight = 0;
  private content: Element | null = null;
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly mutationObserver: MutationObserver | undefined;
  private disposed = false;

  constructor(
    private readonly scroller: HTMLDivElement,
    private readonly onMeasure: (snapshot: NavigationGeometrySnapshot) => void,
  ) {
    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver((entries) => this.resized(entries));
    this.resizeObserver?.observe(scroller);
    this.mutationObserver =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(() => this.invalidate());
    scroller.addEventListener('scroll', this.schedule, { passive: true });
    window.addEventListener('resize', this.invalidate);
  }

  setItems(items: readonly NavigationItemAnchor[]): void {
    const key = JSON.stringify(items.map((item) => [item.id, item.promptId]));
    if (key === this.itemKey) return;
    this.itemKey = key;
    this.items = items;
    this.dirty = true;
    this.measure();
  }

  findNode(item: NavigationItemAnchor): HTMLElement | undefined {
    if (this.dirty && this.scroller.clientHeight > 0 && !this.disposed) this.rebuild();
    return (item.promptId ? this.nodes.get(item.promptId) : undefined) ?? this.nodes.get(item.id);
  }

  schedule = (): void => {
    if (this.disposed || this.frame !== undefined) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = undefined;
      this.measure();
    });
  };

  invalidate = (): void => {
    this.dirty = true;
    this.schedule();
  };

  dispose(): void {
    this.disposed = true;
    this.scroller.removeEventListener('scroll', this.schedule);
    window.removeEventListener('resize', this.invalidate);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.nodes.clear();
  }

  private measure(): void {
    if (this.disposed) return;
    const height = this.scroller.clientHeight;
    if (height > 0 && this.dirty) this.rebuild();
    this.onMeasure({
      height,
      navigating: this.scroller.dataset.navigationSettling === 'true',
      activeId: this.layout.active(this.scroller.scrollTop, height, this.scroller.scrollHeight),
    });
  }

  private rebuild(): void {
    this.dirty = false;
    this.width = this.scroller.clientWidth;
    this.content = this.scroller.firstElementChild;
    const scrollerTop = this.scroller.getBoundingClientRect().top;
    const scrollTop = this.scroller.scrollTop;
    this.nodes.clear();
    const rows = Array.from(
      this.scroller.querySelectorAll<HTMLElement>('[data-message-id]'),
      (node) => {
        const bounds = node.getBoundingClientRect();
        const id = node.dataset.messageId!;
        this.nodes.set(id, node);
        return { id, top: bounds.top - scrollerTop + scrollTop, height: bounds.height };
      },
    );
    const anchors: NavigationMessageAnchor[] = this.items.flatMap((item) => {
      const node = this.findNode(item);
      return node ? [{ id: item.id, messageId: node.dataset.messageId! }] : [];
    });
    this.layout = new ConversationNavigationLayout(rows, anchors);
    this.contentHeight = this.content?.getBoundingClientRect().height ?? 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver?.observe(this.scroller);
    if (this.content) this.resizeObserver?.observe(this.content);
    for (const node of this.nodes.values()) this.resizeObserver?.observe(node);
    this.mutationObserver?.disconnect();
    this.mutationObserver?.observe(this.scroller, { childList: true });
    if (this.content) this.mutationObserver?.observe(this.content, { childList: true });
  }

  private resized(entries: readonly ResizeObserverEntry[]): void {
    if (this.disposed) return;
    if (this.scroller.clientWidth !== this.width) {
      this.invalidate();
      return;
    }
    const changes: { messageId: string; height: number }[] = [];
    let contentHeight: number | undefined;
    for (const entry of entries) {
      const height =
        entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
      if (entry.target === this.content) contentHeight = height;
      const messageId = (entry.target as HTMLElement).dataset.messageId;
      if (messageId && this.nodes.get(messageId) === entry.target)
        changes.push({ messageId, height });
    }
    const delta = this.layout.updateHeights(changes);
    if (contentHeight !== undefined) {
      if (Math.abs(contentHeight - this.contentHeight - delta) > 1) this.dirty = true;
      this.contentHeight = contentHeight;
    } else this.contentHeight += delta;
    this.schedule();
  }
}
