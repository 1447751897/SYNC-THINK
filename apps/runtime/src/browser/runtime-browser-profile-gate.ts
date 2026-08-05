export interface BrowserProfileOperationGate {
  runExclusive<T>(profileId: string, operation: () => T | Promise<T>): Promise<T>;
  isBusy(profileId: string): boolean;
  assertAvailable(profileId: string): void;
}

/** Serializes Profile maintenance with the durable command reservation boundary. */
export class RuntimeBrowserProfileGate implements BrowserProfileOperationGate {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(profileId: string, operation: () => T | Promise<T>): Promise<T> {
    const key = normalizeProfileId(profileId);
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const marker = previous.catch(() => undefined).then(() => current);
    this.tails.set(key, marker);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === marker) this.tails.delete(key);
    }
  }

  isBusy(profileId: string): boolean {
    return this.tails.has(normalizeProfileId(profileId));
  }

  assertAvailable(profileId: string): void {
    if (this.isBusy(profileId)) {
      throw new Error('browser.profile_in_use');
    }
  }
}

function normalizeProfileId(value: string): string {
  return String(value ?? '').trim();
}
