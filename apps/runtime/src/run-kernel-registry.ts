const RUN_KERNEL_IDS_SETTING_KEY = 'kernel.runKernelIds';

export interface RunKernelSettingsPort {
  get(key: string): { value: unknown } | undefined;
  set(key: string, value: unknown): unknown;
}

export class RunKernelRegistry {
  private readonly ids = new Map<string, string>();
  private loaded = false;

  constructor(private readonly settings?: RunKernelSettingsPort) {}

  get(runId: string): string | undefined {
    this.ensureLoaded();
    return this.ids.get(runId);
  }

  count(): number {
    this.ensureLoaded();
    return this.ids.size;
  }

  merge(entries: ReadonlyMap<string, string>): void {
    this.ensureLoaded();
    for (const [runId, kernelId] of entries) {
      if (runId && kernelId) this.ids.set(runId, kernelId);
    }
  }

  record(runId: string, kernelId: string | undefined): void {
    if (!runId || !kernelId) return;
    this.ensureLoaded();
    if (this.ids.get(runId) === kernelId) return;
    this.ids.set(runId, kernelId);
    try {
      this.settings?.set(RUN_KERNEL_IDS_SETTING_KEY, Object.fromEntries(this.ids));
    } catch {
      // Persistence is best effort; the in-memory registry remains authoritative for this process.
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const value = this.settings?.get(RUN_KERNEL_IDS_SETTING_KEY)?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [runId, kernelId] of Object.entries(value)) {
      if (runId && typeof kernelId === 'string' && kernelId) this.ids.set(runId, kernelId);
    }
  }
}
