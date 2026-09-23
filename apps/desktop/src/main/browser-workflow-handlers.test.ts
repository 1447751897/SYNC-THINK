import { describe, expect, it, vi } from 'vitest';
import {
  registerBrowserWorkflowHandlers,
  type BrowserWorkflowHost,
} from './browser-workflow-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { ok: true };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestBrowserWorkflow: request as BrowserWorkflowHost<string>['requestBrowserWorkflow'],
  };
  registerBrowserWorkflowHandlers(host);
  return { handlers, host, order, request, response };
}

describe('browser workflow IPC boundary', () => {
  it('registers the complete Workflow command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:browser-workflow-list',
      'runtime:browser-workflow-get',
      'runtime:browser-workflow-create-draft',
      'runtime:browser-workflow-create-revision-draft',
      'runtime:browser-workflow-submit',
      'runtime:browser-workflow-review',
      'runtime:browser-workflow-save',
      'runtime:browser-workflow-publish',
      'runtime:browser-workflow-import-chat',
      'runtime:browser-workflow-execute',
      'runtime:browser-workflow-execute-draft',
      'runtime:browser-workflow-approve-execute',
      'runtime:browser-workflow-update-schedule',
    ]);
  });

  it.each([
    [
      'runtime:browser-workflow-list',
      { profileId: 'profile-1', query: ' checkout ', limit: 20 },
      'browser.workflow.list',
      { profileId: 'profile-1', query: 'checkout', limit: 20 },
    ],
    [
      'runtime:browser-workflow-get',
      { taskId: 'task-1' },
      'browser.workflow.get',
      { taskId: 'task-1' },
    ],
    [
      'runtime:browser-workflow-create-draft',
      {
        profileId: 'profile-1',
        name: ' Checkout ',
        instruction: ' Complete checkout ',
        startUrl: ' https://example.test/cart ',
        source: 'manual',
      },
      'browser.workflow.createDraft',
      {
        profileId: 'profile-1',
        name: 'Checkout',
        instruction: 'Complete checkout',
        startUrl: 'https://example.test/cart',
        source: 'manual',
      },
    ],
    [
      'runtime:browser-workflow-create-revision-draft',
      { taskId: 'task-1', expectedTaskRevision: 2 },
      'browser.workflow.createRevisionDraft',
      { taskId: 'task-1', expectedTaskRevision: 2 },
    ],
    [
      'runtime:browser-workflow-submit',
      { draftId: 'draft-1', recordingId: 'recording-1' },
      'browser.workflow.submit',
      { draftId: 'draft-1', recordingId: 'recording-1' },
    ],
    [
      'runtime:browser-workflow-review',
      { draftId: 'draft-1', decision: 'approve', note: ' Ready ' },
      'browser.workflow.review',
      { draftId: 'draft-1', decision: 'approve', note: 'Ready' },
    ],
    [
      'runtime:browser-workflow-execute',
      { taskId: 'task-1', variables: { keyword: 'sync' } },
      'browser.workflow.execute',
      { taskId: 'task-1', variables: { keyword: 'sync' } },
    ],
    [
      'runtime:browser-workflow-approve-execute',
      {
        taskId: 'task-1',
        origins: [' https://example.test ', 'https://example.test'],
        variables: { keyword: 'sync' },
      },
      'browser.workflow.approveAndExecute',
      {
        taskId: 'task-1',
        origins: ['https://example.test'],
        variables: { keyword: 'sync' },
      },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get('runtime:browser-workflow-execute')!('untrusted', {
        taskId: 'task 1',
      }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:browser-workflow-review')!('trusted', {
        draftId: 'draft-1',
        decision: 'skip',
      }),
    ).rejects.toThrow('Invalid review-browser-workflow-draft payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:browser-workflow-list')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:browser-workflow-execute')!('trusted', {
        taskId: 'task-1',
      }),
    ).rejects.toBe(failure);
  });
});
