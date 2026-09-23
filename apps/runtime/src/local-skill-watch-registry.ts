export type LocalSkillWatchCleanup = () => void;

function watchKey(directory: string): string {
  return directory.trim().toLocaleLowerCase();
}

/** Owns process-local filesystem watcher cleanup and directory deduplication. */
export class LocalSkillWatchRegistry {
  private readonly cleanups = new Map<string, LocalSkillWatchCleanup>();

  add(directory: string, cleanup: LocalSkillWatchCleanup): boolean {
    const key = watchKey(directory);
    if (!key || this.cleanups.has(key)) return false;
    this.cleanups.set(key, cleanup);
    return true;
  }

  isWatching(directory: string): boolean {
    return this.cleanups.has(watchKey(directory));
  }

  isActive(): boolean {
    return this.cleanups.size > 0;
  }

  count(): number {
    return this.cleanups.size;
  }

  stopAll(): void {
    const cleanups = [...this.cleanups.values()];
    this.cleanups.clear();

    let firstError: unknown;
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
  }
}
