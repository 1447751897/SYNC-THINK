export interface PreparedContent {
  readonly text: string;
  readonly utf8Bytes: number;
  readonly version: string;
  readonly format: 'text' | 'json';
}

export class ContentSnapshotCache {
  private readonly entries = new Map<string, { content: PreparedContent; bytes: number }>();
  private revision?: string;
  private bytes = 0;

  constructor(
    private readonly maxEntries = 8,
    private readonly maxBytes = 16 * 1024 * 1024,
  ) {}

  get size(): number {
    return this.entries.size;
  }
  get estimatedBytes(): number {
    return this.bytes;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
    this.revision = undefined;
  }

  get(key: string, revision: string): PreparedContent | undefined {
    this.useRevision(revision);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.content;
  }

  set(key: string, content: PreparedContent, revision: string): void {
    this.useRevision(revision);
    const previous = this.entries.get(key);
    if (previous?.content === content) {
      this.entries.delete(key);
      this.entries.set(key, previous);
      return;
    }
    if (previous) {
      this.entries.delete(key);
      this.bytes -= previous.bytes;
    }
    const bytes = (key.length + content.text.length + content.version.length) * 2 + 256;
    if (this.maxEntries < 1 || bytes > this.maxBytes) return;
    while (
      this.entries.size &&
      (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)
    ) {
      const oldest = this.entries.entries().next().value!;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[1].bytes;
    }
    const owned = { ...content, text: Buffer.from(content.text, 'utf16le').toString('utf16le') };
    this.entries.set(key, { content: Object.freeze(owned), bytes });
    this.bytes += bytes;
  }

  private useRevision(revision: string): void {
    if (this.revision === revision) return;
    this.clear();
    this.revision = revision;
  }
}
