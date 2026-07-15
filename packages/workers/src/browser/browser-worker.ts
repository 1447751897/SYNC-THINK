import type { Worker, WorkerEvent, WorkerJobInput, WorkerJobOutput, WorkerToken } from '../types.js';

// BrowserWorker interface. Real Playwright worker ships in M3; Phase 0 ships a
// FakeBrowserWorker that emits failure if the action targets an out-of-allowlist
// site. Site allowlist is the §13.1 minimum.

export interface BrowserAction {
  kind: 'navigate' | 'click' | 'extract' | 'fill' | 'wait';
  url?: string;
  selector?: string;
  text?: string;
}

export interface BrowserWorkerInput extends WorkerJobInput {
  action: BrowserAction;
  allowedSites?: string[];
}

export interface BrowserWorkerOutput extends WorkerJobOutput {}

export interface BrowserWorker extends Worker<BrowserWorkerInput> {
  readonly kind: 'browser';
}

export class FakeBrowserWorker implements BrowserWorker {
  readonly kind = 'browser' as const;
  async *exec(input: BrowserWorkerInput, _token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (input.allowedSites && input.action.url && !input.allowedSites.includes(input.action.url)) {
      yield { type: 'failed', failureClass: 'permission', error: { code: 'security.unauthorized_tool', message: 'site not in allowlist' } };
      return;
    }
    yield { type: 'stderr', text: '[fake-browser] deferred until Playwright ships in M3' };
    yield { type: 'completed', output: { ok: false, message: 'browser fake returning early' } };
  }
}
