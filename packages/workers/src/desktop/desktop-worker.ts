import type { Worker, WorkerEvent, WorkerJobInput, WorkerJobOutput, WorkerToken } from '../types.js';

// DesktopWorker interface only (TD-007). Concrete UI Automation via koffi+COM
// ships in Phase 3. Phase 0 ships a FakeDesktopWorker that returns manual steps
// in stderr, so workflows can be built without real desktop control.

export interface DesktopAction {
  kind: 'launch-app' | 'click-element' | 'read-text' | 'type-text' | 'screenshot';
  selector?: { name?: string; automationId?: string };
  text?: string;
}

export interface DesktopWorkerInput extends WorkerJobInput {
  action: DesktopAction;
}

export interface DesktopWorkerOutput extends WorkerJobOutput {
  screenshotRef?: string;
  readText?: string;
}

export interface DesktopWorker extends Worker<DesktopWorkerInput> {
  readonly kind: 'desktop';
}

export class FakeDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;
  async *exec(input: DesktopWorkerInput, _token: WorkerToken): AsyncIterable<WorkerEvent> {
    yield { type: 'stderr', text: `[fake-desktop] ${input.action.kind} requested — manual step needed` };
    yield {
      type: 'completed',
      output: {
        ok: false,
        message: 'desktop action deferred to manual until UIA worker ships in Phase 3',
      },
    };
  }
}
