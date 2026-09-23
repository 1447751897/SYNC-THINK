export interface StartAbortControllerOptions {
  abortPrevious?: boolean;
}

export class AbortControllerRegistry {
  private readonly controllers = new Map<string, AbortController>();

  start(key: string, options: StartAbortControllerOptions = {}): AbortController {
    if (options.abortPrevious) this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    return controller;
  }

  get(key: string): AbortController | undefined {
    return this.controllers.get(key);
  }

  abort(key: string): boolean {
    const controller = this.controllers.get(key);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  abortAndDelete(key: string): boolean {
    const controller = this.controllers.get(key);
    if (!controller) return false;
    this.controllers.delete(key);
    controller.abort();
    return true;
  }

  delete(key: string): boolean {
    return this.controllers.delete(key);
  }

  deleteIf(key: string, controller: AbortController): boolean {
    if (this.controllers.get(key) !== controller) return false;
    return this.controllers.delete(key);
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  count(): number {
    return this.controllers.size;
  }
}
