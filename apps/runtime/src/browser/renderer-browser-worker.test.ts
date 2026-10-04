import { describe, expect, it, vi } from 'vitest';
import type { BrowserWorkerInput, WorkerEvent, WorkerToken } from '@sync-think/workers';
import { RendererBrowserWorker, type RendererBrowserCommandResult } from './renderer-browser-worker.js';

const input: BrowserWorkerInput = {
  workingDir: 'D:/fixture', profileId: 'embedded', ownerId: 'conversation-thread',
  action: { kind: 'read' },
};
const token: WorkerToken = { token: 'fixture', allowedRoot: 'D:/fixture', timeoutMs: 1000 };
async function events(result: RendererBrowserCommandResult): Promise<WorkerEvent[]> {
  const worker = new RendererBrowserWorker({
    toolName: 'browser_read', runId: 'run-2', threadId: 'conversation-thread',
    toolCallId: 'tool-1', onRequest: async () => result,
  });
  const output: WorkerEvent[] = [];
  for await (const event of worker.exec(input, token)) output.push(event);
  return output;
}
describe('renderer browser result boundary', () => {
  it.each(['invalid-selector', 'ambiguous-target', 'disabled-target', 'target-not-found', 'occluded-target', 'page-not-ready', 'trusted-click-failed', 'input-target-invalid'])('preserves the actionable %s code', async reason => {
    const output = await events({ ok: false, resultJson: JSON.stringify({ ok: false, code: `browser.${reason}` }) });
    expect(output.at(-1)).toMatchObject({ type: 'failed', failureClass: 'acceptance', error: { code: `browser.${reason}` } });
  });
  it.each(['{"code":"guest-arbitrary-message"}', 'invalid json', '{}'])('ignores non-allowlisted error codes', async resultJson => {
    expect((await events({ ok: false, resultJson })).at(-1)).toMatchObject({ type: 'failed', error: { code: 'browser.renderer-command-failed' } });
  });
  it('routes a new run to the existing conversation owner, not to its run id', async () => {
    const onRequest = vi.fn(async () => ({ ok: true, resultJson: '{"controls":[]}' }));
    const worker = new RendererBrowserWorker({ toolName: 'browser_read', runId: 'new-run', threadId: 'conversation-thread', toolCallId: 'tool-2', onRequest });
    const output: WorkerEvent[] = [];
    for await (const event of worker.exec(input, token)) output.push(event);
    expect(output.at(-1)).toMatchObject({ type: 'completed' });
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'conversation-thread', runId: 'new-run' }));
  });
});
