/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  BrowserAutomationTaskSummary,
  BrowserProfileSummary,
  BrowserRecordingSummary,
  BrowserSiteSessionSummary,
  BrowserWorkflowDraftSummary,
  BrowserWorkflowVersionSummary,
  GetBrowserRecordingPayload,
  GetBrowserRecordingResponse,
  GetBrowserWorkflowResponse,
  ReviewBrowserWorkflowDraftResponse,
} from '@sync-think/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserStage } from './BrowserStage.js';

const defaultProfile: BrowserProfileSummary = {
  id: 'default',
  name: '默认浏览器',
  revision: 1,
  isDefault: true,
  inUse: false,
  siteCount: 1,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
  lastUsedAt: '2026-08-05T04:00:00.000Z',
};

const workProfile: BrowserProfileSummary = {
  ...defaultProfile,
  id: 'profile-work',
  name: '工作号',
  isDefault: false,
  siteCount: 0,
};

const exampleSession: BrowserSiteSessionSummary = {
  profileId: 'default',
  siteKey: 'example.com',
  origins: ['https://app.example.com'],
  state: 'verified',
  cookieCount: 2,
  storageBytes: 1024,
  storageTypes: ['cookies', 'local_storage'],
  lastSeenAt: '2026-08-05T04:00:00.000Z',
  lastVerifiedAt: '2026-08-05T03:59:00.000Z',
  lastCheckedAt: '2026-08-05T04:00:00.000Z',
  updatedAt: '2026-08-05T04:00:00.000Z',
};

const activeRecording: BrowserRecordingSummary = {
  id: 'recording-active',
  profileId: 'default',
  status: 'recording',
  revision: 2,
  stepCount: 1,
  startUrl: 'https://example.com/start',
  currentUrl: 'https://example.com/account',
  createdAt: '2026-08-05T04:10:00.000Z',
  startedAt: '2026-08-05T04:10:01.000Z',
  updatedAt: '2026-08-05T04:10:02.000Z',
};

const stoppingRecording: BrowserRecordingSummary = {
  ...activeRecording,
  status: 'stopping',
  revision: 3,
  stopReason: 'user',
  updatedAt: '2026-08-05T04:10:30.000Z',
};

const stoppedRecording: BrowserRecordingSummary = {
  ...activeRecording,
  status: 'stopped',
  revision: 3,
  stopReason: 'user',
  stoppedAt: '2026-08-05T04:11:00.000Z',
  updatedAt: '2026-08-05T04:11:00.000Z',
};

const failedRecording: BrowserRecordingSummary = {
  ...activeRecording,
  status: 'failed',
  revision: 3,
  stopReason: 'capture_failed',
  stoppedAt: '2026-08-05T04:11:00.000Z',
  updatedAt: '2026-08-05T04:11:00.000Z',
};

const interruptedRecording: BrowserRecordingSummary = {
  ...activeRecording,
  status: 'interrupted',
  revision: 3,
  stopReason: 'page_closed',
  stoppedAt: '2026-08-05T04:11:00.000Z',
  updatedAt: '2026-08-05T04:11:00.000Z',
};

const draftTask: BrowserAutomationTaskSummary = {
  id: 'browser-task-weekly-report',
  profileId: 'default',
  name: '提交每周销售报表',
  instruction: '打开销售后台并提交本周销售报表。',
  startUrl: 'https://example.com/reports',
  source: 'manual',
  status: 'draft',
  revision: 1,
  currentDraftId: 'browser-draft-weekly-report',
  successCount: 0,
  failureCount: 0,
  createdAt: '2026-08-05T04:00:00.000Z',
  updatedAt: '2026-08-05T04:00:00.000Z',
};

const workflowDraft: BrowserWorkflowDraftSummary = {
  id: 'browser-draft-weekly-report',
  taskId: draftTask.id,
  status: 'editing',
  revision: 1,
  steps: [],
  stepCount: 0,
  createdAt: '2026-08-05T04:00:00.000Z',
  updatedAt: '2026-08-05T04:00:00.000Z',
};

const pendingTask: BrowserAutomationTaskSummary = {
  ...draftTask,
  status: 'pending_review',
  revision: 2,
  updatedAt: '2026-08-05T04:12:00.000Z',
};

const pendingDraft: BrowserWorkflowDraftSummary = {
  ...workflowDraft,
  recordingId: activeRecording.id,
  status: 'pending_review',
  revision: 2,
  steps: [
    {
      kind: 'fill',
      locator: { strategy: 'label', value: '登录密码' },
      value: { kind: 'secret' },
    },
  ],
  stepCount: 1,
  submittedAt: '2026-08-05T04:12:00.000Z',
  updatedAt: '2026-08-05T04:12:00.000Z',
};

const publishedVersion: BrowserWorkflowVersionSummary = {
  id: 'browser-version-weekly-report-v1',
  taskId: draftTask.id,
  draftId: workflowDraft.id,
  versionNumber: 1,
  steps: pendingDraft.steps,
  stepCount: 1,
  createdAt: '2026-08-05T04:13:00.000Z',
  publishedAt: '2026-08-05T04:13:00.000Z',
};

const enabledTask: BrowserAutomationTaskSummary = {
  ...pendingTask,
  status: 'enabled',
  revision: 3,
  publishedVersionId: publishedVersion.id,
  updatedAt: '2026-08-05T04:13:00.000Z',
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function createManualWorkflowDraft(): Promise<void> {
  await waitFor(() => expect(screen.getByText('还没有自动化任务')).toBeTruthy());
  fireEvent.click(screen.getByTestId('browser-workflow-create-manual'));
  fireEvent.change(screen.getByTestId('browser-workflow-name'), {
    target: { value: draftTask.name },
  });
  fireEvent.change(screen.getByTestId('browser-workflow-instruction'), {
    target: { value: draftTask.instruction },
  });
  fireEvent.change(screen.getByTestId('browser-workflow-start-url'), {
    target: { value: draftTask.startUrl },
  });
  fireEvent.click(screen.getByTestId('browser-workflow-create-submit'));
  await screen.findByTestId('browser-workflow-recording-context');
}

const api = {
  listBrowserProfiles: vi.fn(async () => ({ profiles: [defaultProfile, workProfile] })),
  createBrowserProfile: vi.fn(async ({ name }: { name: string }) => ({
    profile: { ...workProfile, id: 'profile-new', name },
  })),
  renameBrowserProfile: vi.fn(async ({ name }: { name: string }) => ({
    profile: { ...workProfile, name, revision: 2 },
  })),
  deleteBrowserProfile: vi.fn(async ({ profileId }: { profileId: string }) => ({
    profileId,
    deleted: true as const,
  })),
  listBrowserSiteSessions: vi.fn(
    async ({ profileId, refresh }: { profileId: string; refresh?: boolean }) => ({
      profile: profileId === 'default' ? defaultProfile : workProfile,
      sessions: profileId === 'default' ? [exampleSession] : [],
      refreshed: refresh === true,
      checkedAt: '2026-08-05T04:00:00.000Z',
    }),
  ),
  clearBrowserSiteSession: vi.fn(
    async ({ profileId, siteKey }: { profileId: string; siteKey: string }) => ({
      profileId,
      siteKey,
      clearedOrigins: ['https://app.example.com'],
      deletedCookieCount: 2,
      checkedAt: '2026-08-05T04:01:00.000Z',
    }),
  ),
  browserRecording: {
    list: vi.fn(async () => ({ recordings: [] as BrowserRecordingSummary[] })),
    get: vi.fn(
      async (_payload: GetBrowserRecordingPayload): Promise<GetBrowserRecordingResponse> => ({
        recording: activeRecording,
        steps: [
          {
            recordingId: activeRecording.id,
            sequence: 1,
            step: {
              kind: 'fill' as const,
              locator: { strategy: 'label' as const, value: '登录密码' },
              value: { kind: 'secret' as const },
            },
            recordedAt: '2026-08-05T04:10:02.000Z',
            updatedAt: '2026-08-05T04:10:02.000Z',
          },
        ],
      }),
    ),
    start: vi.fn(async () => ({ recording: activeRecording })),
    stop: vi.fn(async () => ({ recording: stoppedRecording })),
  },
  browserWorkflow: {
    list: vi.fn(async () => ({ tasks: [] as BrowserAutomationTaskSummary[] })),
    get: vi.fn(async (): Promise<GetBrowserWorkflowResponse> => ({
      task: draftTask,
      draft: workflowDraft,
    })),
    createDraft: vi.fn(async () => ({ task: draftTask, draft: workflowDraft })),
    submit: vi.fn(async () => ({ task: pendingTask, draft: pendingDraft })),
    review: vi.fn(async (): Promise<ReviewBrowserWorkflowDraftResponse> => ({
      task: enabledTask,
      draft: { ...pendingDraft, status: 'approved' as const },
      version: publishedVersion,
    })),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.browserRecording.list.mockReset().mockResolvedValue({ recordings: [] });
  api.browserRecording.get.mockReset().mockResolvedValue({
    recording: activeRecording,
    steps: [
      {
        recordingId: activeRecording.id,
        sequence: 1,
        step: {
          kind: 'fill',
          locator: { strategy: 'label', value: '登录密码' },
          value: { kind: 'secret' },
        },
        recordedAt: '2026-08-05T04:10:02.000Z',
        updatedAt: '2026-08-05T04:10:02.000Z',
      },
    ],
  });
  api.browserRecording.start.mockReset().mockResolvedValue({ recording: activeRecording });
  api.browserRecording.stop.mockReset().mockResolvedValue({ recording: stoppedRecording });
  api.browserWorkflow.list.mockReset().mockResolvedValue({ tasks: [] });
  api.browserWorkflow.get.mockReset().mockResolvedValue({ task: draftTask, draft: workflowDraft });
  api.browserWorkflow.createDraft
    .mockReset()
    .mockResolvedValue({ task: draftTask, draft: workflowDraft });
  api.browserWorkflow.submit
    .mockReset()
    .mockResolvedValue({ task: pendingTask, draft: pendingDraft });
  api.browserWorkflow.review.mockReset().mockResolvedValue({
    task: enabledTask,
    draft: { ...pendingDraft, status: 'approved' },
    version: publishedVersion,
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime: api },
  });
});

afterEach(() => cleanup());

describe('BrowserStage Runtime Profiles', () => {
  it('loads Profiles, automation tasks, and cached sessions without mounting a webview', async () => {
    render(<BrowserStage />);
    expect(screen.getByText('浏览器自动化')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    await waitFor(() =>
      expect(api.browserWorkflow.list).toHaveBeenCalledWith({
        profileId: 'default',
        limit: 100,
      }),
    );
    expect(screen.getByRole('button', { name: '自动化任务' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy());
    expect(screen.getByText('已验证登录')).toBeTruthy();
    expect(screen.getByText(/2 Cookie/)).toBeTruthy();
    expect(api.listBrowserSiteSessions).toHaveBeenCalledWith({
      profileId: 'default',
      refresh: false,
    });
    expect(document.querySelector('webview')).toBeNull();
  });

  it('defaults to automation tasks and preserves login-state and recording views', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    expect(screen.getByRole('button', { name: '自动化任务' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '登录状态' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '录制记录' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '登录状态' }));
    expect(screen.getByTestId('browser-site-session-refresh')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    await waitFor(() =>
      expect(api.browserRecording.list).toHaveBeenCalledWith({ profileId: 'default', limit: 20 }),
    );
    expect(screen.getByTestId('browser-recording-start-url')).toBeTruthy();
    expect(screen.getByTestId('browser-recording-start')).toBeTruthy();
  });

  it('creates a manual workflow draft and enters the task recording workspace', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getByText('还没有自动化任务')).toBeTruthy());
    fireEvent.click(screen.getByTestId('browser-workflow-create-manual'));
    fireEvent.change(screen.getByTestId('browser-workflow-name'), {
      target: { value: '提交每周销售报表' },
    });
    fireEvent.change(screen.getByTestId('browser-workflow-instruction'), {
      target: { value: '打开销售后台并提交本周销售报表。' },
    });
    fireEvent.change(screen.getByTestId('browser-workflow-start-url'), {
      target: { value: 'https://example.com/reports' },
    });
    fireEvent.click(screen.getByTestId('browser-workflow-create-submit'));

    await waitFor(() =>
      expect(api.browserWorkflow.createDraft).toHaveBeenCalledWith({
        profileId: 'default',
        name: '提交每周销售报表',
        instruction: '打开销售后台并提交本周销售报表。',
        startUrl: 'https://example.com/reports',
        source: 'manual',
      }),
    );
    expect(await screen.findByTestId('browser-workflow-recording-context')).toBeTruthy();
    expect((screen.getByTestId('browser-recording-start-url') as HTMLInputElement).value).toBe(
      'https://example.com/reports',
    );
    expect(screen.getByRole('button', { name: '录制记录' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('keeps a new workflow draft empty instead of showing an old Profile recording', async () => {
    api.browserRecording.list.mockResolvedValue({ recordings: [stoppedRecording] });
    api.browserRecording.get.mockResolvedValue({
      recording: stoppedRecording,
      steps: [
        {
          recordingId: stoppedRecording.id,
          sequence: 1,
          step: { kind: 'navigate', url: 'https://example.com/old' },
          recordedAt: stoppedRecording.updatedAt,
          updatedAt: stoppedRecording.updatedAt,
        },
      ],
    });
    render(<BrowserStage />);

    await createManualWorkflowDraft();

    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('combobox').textContent).toContain('暂无记录');
    expect(screen.queryByTestId('browser-workflow-submit')).toBeNull();
    expect(screen.queryByText('https://example.com/old')).toBeNull();
  });

  it('restores only the recording persisted on an editing workflow draft', async () => {
    const workflowRecording = {
      ...stoppedRecording,
      id: 'recording-workflow-durable',
      startUrl: draftTask.startUrl,
      currentUrl: draftTask.startUrl,
    };
    const draftWithRecording = {
      ...workflowDraft,
      recordingId: workflowRecording.id,
    };
    api.browserWorkflow.createDraft.mockResolvedValueOnce({
      task: draftTask,
      draft: draftWithRecording,
    });
    api.browserRecording.list.mockResolvedValue({
      recordings: [{ ...stoppedRecording, id: 'recording-unrelated' }],
    });
    api.browserRecording.get.mockImplementation(
      async ({
        recordingId,
      }: GetBrowserRecordingPayload): Promise<GetBrowserRecordingResponse> => ({
        recording:
          recordingId === workflowRecording.id
            ? workflowRecording
            : { ...stoppedRecording, id: recordingId },
        steps: [
          {
            recordingId,
            sequence: 1,
            step: { kind: 'navigate', url: 'https://example.com/restored' },
            recordedAt: stoppedRecording.updatedAt,
            updatedAt: stoppedRecording.updatedAt,
          },
        ],
      }),
    );
    render(<BrowserStage />);

    await createManualWorkflowDraft();

    await waitFor(() =>
      expect(api.browserRecording.get).toHaveBeenCalledWith({
        recordingId: workflowRecording.id,
        afterSequence: 0,
        limit: 200,
      }),
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(workflowRecording.id);
    expect(screen.getByTestId('browser-workflow-submit')).toBeTruthy();
    expect(screen.queryByText('recording-unrelated')).toBeNull();
  });

  it('keeps an unrelated active Profile recording locked without binding it to a new draft', async () => {
    api.browserRecording.list.mockResolvedValue({ recordings: [activeRecording] });
    api.browserRecording.get.mockResolvedValue({ recording: activeRecording, steps: [] });
    render(<BrowserStage />);

    await createManualWorkflowDraft();

    await waitFor(() =>
      expect((screen.getByTestId('browser-recording-start') as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(screen.queryByTestId('browser-recording-stop')).toBeNull();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByTestId('browser-workflow-submit')).toBeNull();
  });

  it('submits the final durable recording steps for workflow review', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getByText('还没有自动化任务')).toBeTruthy());
    fireEvent.click(screen.getByTestId('browser-workflow-create-manual'));
    fireEvent.change(screen.getByTestId('browser-workflow-name'), {
      target: { value: draftTask.name },
    });
    fireEvent.change(screen.getByTestId('browser-workflow-instruction'), {
      target: { value: draftTask.instruction },
    });
    fireEvent.change(screen.getByTestId('browser-workflow-start-url'), {
      target: { value: draftTask.startUrl },
    });
    fireEvent.click(screen.getByTestId('browser-workflow-create-submit'));
    await screen.findByTestId('browser-workflow-recording-context');
    const startButton = screen.getByTestId('browser-recording-start');
    await waitFor(() => expect((startButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(startButton);
    await waitFor(() =>
      expect(api.browserRecording.start).toHaveBeenCalledWith({
        profileId: 'default',
        expectedProfileRevision: 1,
        draftId: workflowDraft.id,
        startUrl: draftTask.startUrl,
      }),
    );
    const stopButton = await screen.findByTestId('browser-recording-stop');
    fireEvent.click(stopButton);
    await waitFor(() =>
      expect(api.browserRecording.stop).toHaveBeenCalledWith({
        recordingId: activeRecording.id,
      }),
    );
    fireEvent.click(await screen.findByTestId('browser-workflow-submit'));

    await waitFor(() =>
      expect(api.browserWorkflow.submit).toHaveBeenCalledWith({
        draftId: workflowDraft.id,
        recordingId: activeRecording.id,
      }),
    );
    expect(screen.getByRole('button', { name: '自动化任务' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('requires a rejected workflow to bind a new recording before resubmission', async () => {
    const oldRecording = {
      ...stoppedRecording,
      id: 'recording-rejected-old',
      startUrl: draftTask.startUrl,
    };
    const newRecording = {
      ...activeRecording,
      id: 'recording-rejected-new',
      startUrl: draftTask.startUrl,
    };
    const newStoppedRecording = {
      ...stoppedRecording,
      id: newRecording.id,
      startUrl: draftTask.startUrl,
    };
    const rejectedDraft = {
      ...pendingDraft,
      recordingId: oldRecording.id,
      status: 'rejected' as const,
      revision: 3,
    };
    let newRecordingStopped = false;
    api.browserWorkflow.list.mockResolvedValue({ tasks: [draftTask] });
    api.browserWorkflow.get.mockResolvedValue({ task: draftTask, draft: rejectedDraft });
    api.browserRecording.list.mockResolvedValue({ recordings: [] });
    api.browserRecording.start.mockResolvedValueOnce({ recording: newRecording });
    api.browserRecording.stop.mockImplementationOnce(async () => {
      newRecordingStopped = true;
      return { recording: newStoppedRecording };
    });
    api.browserRecording.get.mockImplementation(
      async ({ recordingId }: GetBrowserRecordingPayload): Promise<GetBrowserRecordingResponse> => {
        const recording =
          recordingId === oldRecording.id
            ? oldRecording
            : newRecordingStopped
              ? newStoppedRecording
              : newRecording;
        return {
          recording,
          steps: [
            {
              recordingId,
              sequence: 1,
              step: { kind: 'navigate', url: draftTask.startUrl },
              recordedAt: recording.updatedAt,
              updatedAt: recording.updatedAt,
            },
          ],
        };
      },
    );
    render(<BrowserStage />);

    fireEvent.click(await screen.findByRole('button', { name: /继续录制/ }));
    await waitFor(() =>
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(oldRecording.id),
    );
    expect(screen.queryByTestId('browser-workflow-submit')).toBeNull();

    fireEvent.click(screen.getByTestId('browser-recording-start'));
    await waitFor(() =>
      expect(api.browserRecording.start).toHaveBeenCalledWith({
        profileId: defaultProfile.id,
        expectedProfileRevision: defaultProfile.revision,
        draftId: rejectedDraft.id,
        startUrl: draftTask.startUrl,
      }),
    );
    fireEvent.click(await screen.findByTestId('browser-recording-stop'));
    fireEvent.click(await screen.findByTestId('browser-workflow-submit'));

    await waitFor(() =>
      expect(api.browserWorkflow.submit).toHaveBeenCalledWith({
        draftId: rejectedDraft.id,
        recordingId: newRecording.id,
      }),
    );
  });

  it('reconciles a timed-out workflow start from the recording persisted on its draft', async () => {
    const reconciledRecording = {
      ...activeRecording,
      id: 'recording-workflow-reconciled',
      startUrl: draftTask.startUrl,
    };
    api.browserRecording.start.mockRejectedValueOnce(
      new Error('Runtime request timed out: browser.recording.start'),
    );
    api.browserWorkflow.get.mockResolvedValueOnce({
      task: draftTask,
      draft: { ...workflowDraft, recordingId: reconciledRecording.id, revision: 2 },
    });
    api.browserRecording.get.mockResolvedValue({
      recording: reconciledRecording,
      steps: [],
    });
    render(<BrowserStage />);

    await createManualWorkflowDraft();
    fireEvent.click(screen.getByTestId('browser-recording-start'));

    await waitFor(() =>
      expect(api.browserWorkflow.get).toHaveBeenCalledWith({
        taskId: draftTask.id,
      }),
    );
    expect(await screen.findByTestId('browser-recording-stop')).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(reconciledRecording.id);
    expect(api.browserRecording.list).toHaveBeenCalledTimes(2);
  });

  it('reviews a pending workflow and publishes immutable version V1', async () => {
    api.browserWorkflow.list
      .mockResolvedValueOnce({ tasks: [pendingTask] })
      .mockResolvedValue({ tasks: [enabledTask] });
    api.browserWorkflow.get
      .mockResolvedValueOnce({ task: pendingTask, draft: pendingDraft })
      .mockResolvedValue({
        task: enabledTask,
        draft: { ...pendingDraft, status: 'approved' },
        version: publishedVersion,
      });
    render(<BrowserStage />);
    fireEvent.click(await screen.findByRole('button', { name: '审核' }));
    expect(await screen.findByText('审核自动化任务')).toBeTruthy();
    expect(screen.getByText(/敏感值，运行时填写/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('browser-workflow-approve'));

    await waitFor(() =>
      expect(api.browserWorkflow.review).toHaveBeenCalledWith({
        draftId: pendingDraft.id,
        decision: 'approve',
      }),
    );
    expect(await screen.findByText(/已发布为 V1/)).toBeTruthy();
    expect(await screen.findByText('已发布')).toBeTruthy();
  });

  it('rejects a pending workflow and exposes the re-record action', async () => {
    const rejectedDraft = { ...pendingDraft, status: 'rejected' as const, revision: 3 };
    api.browserWorkflow.list
      .mockResolvedValueOnce({ tasks: [pendingTask] })
      .mockResolvedValue({ tasks: [draftTask] });
    api.browserWorkflow.get
      .mockResolvedValueOnce({ task: pendingTask, draft: pendingDraft })
      .mockResolvedValue({ task: draftTask, draft: rejectedDraft });
    api.browserWorkflow.review.mockResolvedValueOnce({
      task: draftTask,
      draft: rejectedDraft,
    });
    render(<BrowserStage />);
    fireEvent.click(await screen.findByRole('button', { name: '审核' }));
    fireEvent.change(screen.getByTestId('browser-workflow-review-note'), {
      target: { value: '重新录制提交按钮后的确认步骤。' },
    });
    fireEvent.click(screen.getByTestId('browser-workflow-reject'));

    await waitFor(() =>
      expect(api.browserWorkflow.review).toHaveBeenCalledWith({
        draftId: pendingDraft.id,
        decision: 'reject',
        note: '重新录制提交按钮后的确认步骤。',
      }),
    );
    expect(await screen.findByText('已驳回')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /继续录制/ })).toBeTruthy();
  });

  it('starts a recording, polls its durable steps, and never renders a secret value', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    fireEvent.change(screen.getByTestId('browser-recording-start-url'), {
      target: { value: 'https://example.com/start?token=renderer-secret' },
    });
    fireEvent.click(screen.getByTestId('browser-recording-start'));
    await waitFor(() =>
      expect(api.browserRecording.start).toHaveBeenCalledWith({
        profileId: 'default',
        expectedProfileRevision: 1,
        startUrl: 'https://example.com/start?token=renderer-secret',
      }),
    );
    await waitFor(() =>
      expect(api.browserRecording.get).toHaveBeenCalledWith({
        recordingId: activeRecording.id,
        afterSequence: 0,
        limit: 200,
      }),
    );
    expect(await screen.findByText(/敏感值，运行时填写/)).toBeTruthy();
    expect((screen.getByTestId('browser-recording-start-url') as HTMLInputElement).value).toBe(
      'https://example.com/start',
    );
    expect(document.body.textContent).not.toContain('renderer-secret');
    expect(
      (screen.getByRole('button', { name: '选择 Profile 工作号' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('locks every Profile as soon as a recording start request is pending', async () => {
    const startRequest = deferred<{ recording: BrowserRecordingSummary }>();
    api.browserRecording.start.mockReturnValueOnce(startRequest.promise);
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    const startButton = (await screen.findByTestId('browser-recording-start')) as HTMLButtonElement;
    await waitFor(() => expect(startButton.disabled).toBe(false));
    fireEvent.click(startButton);

    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: '选择 Profile 工作号',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    expect(
      (screen.getByRole('button', { name: '选择 Profile 默认浏览器' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByTestId('browser-profile-new') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => startRequest.resolve({ recording: activeRecording }));
    expect(await screen.findByTestId('browser-recording-stop')).toBeTruthy();
  });

  it('blocks other Profile maintenance and pre-opened confirmations during start pending', async () => {
    const startRequest = deferred<{ recording: BrowserRecordingSummary }>();
    api.browserRecording.start.mockReturnValueOnce(startRequest.promise);
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    const startButton = (await screen.findByTestId('browser-recording-start')) as HTMLButtonElement;
    await waitFor(() => expect(startButton.disabled).toBe(false));

    fireEvent.click(screen.getByTestId('browser-profile-new'));
    const createInput = screen.getByTestId('browser-profile-new-input');
    fireEvent.change(createInput, { target: { value: '稍后创建' } });
    fireEvent.click(screen.getByTestId('browser-profile-rename-default'));
    const renameInput = screen.getByTestId('browser-profile-rename-input-default');
    fireEvent.change(renameInput, { target: { value: '稍后重命名' } });

    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    fireEvent.click(startButton);

    await waitFor(() =>
      expect((screen.getByRole('button', { name: '确认创建' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect((screen.getByRole('button', { name: '确认重命名' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByTestId('browser-profile-rename-profile-work') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('browser-profile-delete-profile-work') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.keyDown(createInput, { key: 'Enter' });
    fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(api.createBrowserProfile).not.toHaveBeenCalled();
    expect(api.renameBrowserProfile).not.toHaveBeenCalled();

    await act(async () => startRequest.resolve({ recording: activeRecording }));
    expect(await screen.findByTestId('browser-recording-stop')).toBeTruthy();
  });

  it('disables a pre-opened Profile deletion confirmation when an active recording is recovered', async () => {
    const listRequest = deferred<{ recordings: BrowserRecordingSummary[] }>();
    api.browserRecording.list.mockReturnValueOnce(listRequest.promise);
    render(<BrowserStage />);
    await waitFor(() =>
      expect(screen.getByTestId('browser-profile-delete-profile-work')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('browser-profile-delete-profile-work'));
    expect(screen.getByText('删除 Browser Profile')).toBeTruthy();

    await act(async () => listRequest.resolve({ recordings: [activeRecording] }));

    await waitFor(() =>
      expect((screen.getByTestId('browser-confirm-danger') as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    fireEvent.click(screen.getByTestId('browser-confirm-danger'));
    expect(api.deleteBrowserProfile).not.toHaveBeenCalled();
  });

  it('reconciles a timed-out start against Runtime and keeps the recovered recording locked', async () => {
    api.browserRecording.list
      .mockResolvedValueOnce({ recordings: [] })
      .mockResolvedValueOnce({ recordings: [activeRecording] });
    api.browserRecording.start.mockRejectedValueOnce(
      new Error('Runtime request timed out: browser.recording.start'),
    );
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    const startButton = (await screen.findByTestId('browser-recording-start')) as HTMLButtonElement;
    await waitFor(() => expect(startButton.disabled).toBe(false));
    fireEvent.click(startButton);

    await waitFor(() => expect(api.browserRecording.list).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('browser-recording-stop')).toBeTruthy();
    expect(screen.getByText('录制中')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '选择 Profile 工作号' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('releases the pending lock only when Runtime confirms there is no active recording', async () => {
    api.browserRecording.list
      .mockResolvedValueOnce({ recordings: [] })
      .mockResolvedValueOnce({ recordings: [] });
    api.browserRecording.start.mockRejectedValueOnce(
      new Error('Runtime request timed out: browser.recording.start'),
    );
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    const startButton = (await screen.findByTestId('browser-recording-start')) as HTMLButtonElement;
    await waitFor(() => expect(startButton.disabled).toBe(false));
    fireEvent.click(startButton);

    await waitFor(() => expect(api.browserRecording.list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '选择 Profile 工作号' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect((screen.getByTestId('browser-profile-new') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/系统浏览器启动或停止录制超时/)).toBeTruthy();
  });

  it('keeps recording and Profile actions locked when start reconciliation also fails', async () => {
    api.browserRecording.list
      .mockResolvedValueOnce({ recordings: [] })
      .mockRejectedValueOnce(new Error('Runtime unavailable'));
    api.browserRecording.start.mockRejectedValueOnce(
      new Error('Runtime request timed out: browser.recording.start'),
    );
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    const startButton = (await screen.findByTestId('browser-recording-start')) as HTMLButtonElement;
    await waitFor(() => expect(startButton.disabled).toBe(false));
    fireEvent.click(startButton);

    await waitFor(() => expect(api.browserRecording.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(startButton.disabled).toBe(true));
    expect(
      (screen.getByRole('button', { name: '选择 Profile 工作号' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByTestId('browser-profile-new') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps reconciling an unknown start until Runtime explicitly confirms there is no recording', async () => {
    api.browserRecording.list
      .mockResolvedValueOnce({ recordings: [] })
      .mockRejectedValueOnce(new Error('Runtime unavailable'))
      .mockResolvedValueOnce({ recordings: [] });
    api.browserRecording.start.mockRejectedValueOnce(
      new Error('Runtime request timed out: browser.recording.start'),
    );
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    const startButton = (await screen.findByTestId('browser-recording-start')) as HTMLButtonElement;
    await waitFor(() => expect(startButton.disabled).toBe(false));
    fireEvent.click(startButton);

    await waitFor(() => expect(api.browserRecording.list).toHaveBeenCalledTimes(3), {
      timeout: 3_000,
    });
    await waitFor(() => expect(startButton.disabled).toBe(false));
    expect(
      (screen.getByRole('button', { name: '选择 Profile 工作号' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it.each([
    ['failed', failedRecording, '页面动作捕获失败，请重新录制。'],
    ['interrupted', interruptedRecording, '系统浏览器页面已关闭，本次录制已中断。'],
  ] as const)(
    'shows the terminal reason after an active recording becomes %s',
    async (_, terminal, note) => {
      const pollRequest = deferred<{
        recording: BrowserRecordingSummary;
        steps: [];
      }>();
      api.browserRecording.get.mockReturnValueOnce(pollRequest.promise);
      render(<BrowserStage />);
      await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
      fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
      const startButton = (await screen.findByTestId(
        'browser-recording-start',
      )) as HTMLButtonElement;
      await waitFor(() => expect(startButton.disabled).toBe(false));
      fireEvent.click(startButton);
      expect(await screen.findByText('录制已开始')).toBeTruthy();

      await act(async () => pollRequest.resolve({ recording: terminal, steps: [] }));

      expect(await screen.findByText(note)).toBeTruthy();
      expect(screen.queryByText('录制已开始')).toBeNull();
    },
  );

  it('shows stopped feedback when the page overlay stops an active recording', async () => {
    const pollRequest = deferred<{
      recording: BrowserRecordingSummary;
      steps: [];
    }>();
    api.browserRecording.get.mockReturnValueOnce(pollRequest.promise);
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    const startButton = (await screen.findByTestId('browser-recording-start')) as HTMLButtonElement;
    await waitFor(() => expect(startButton.disabled).toBe(false));
    fireEvent.click(startButton);
    expect(await screen.findByText('录制已开始')).toBeTruthy();

    await act(async () => pollRequest.resolve({ recording: stoppedRecording, steps: [] }));

    expect(await screen.findByText('录制已停止')).toBeTruthy();
    expect(screen.queryByText('录制已开始')).toBeNull();
  });

  it('stops an active recording and releases the Profile selection lock', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    fireEvent.click(screen.getByTestId('browser-recording-start'));
    await waitFor(() => expect(screen.getByTestId('browser-recording-stop')).toBeTruthy());
    fireEvent.click(screen.getByTestId('browser-recording-stop'));
    await waitFor(() =>
      expect(api.browserRecording.stop).toHaveBeenCalledWith({
        recordingId: activeRecording.id,
      }),
    );
    await waitFor(() => expect(screen.getByText('已停止')).toBeTruthy());
    expect(
      (screen.getByRole('button', { name: '选择 Profile 工作号' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('reloads the final durable steps after stop drains pending mutations', async () => {
    const finalRecording = { ...stoppedRecording, stepCount: 2, revision: 4 };
    const finalSteps = [
      {
        recordingId: activeRecording.id,
        sequence: 1,
        step: {
          kind: 'fill' as const,
          locator: { strategy: 'label' as const, value: '登录密码' },
          value: { kind: 'secret' as const },
        },
        recordedAt: '2026-08-05T04:10:02.000Z',
        updatedAt: '2026-08-05T04:10:02.000Z',
      },
      {
        recordingId: activeRecording.id,
        sequence: 2,
        step: {
          kind: 'fill' as const,
          locator: { strategy: 'label' as const, value: '备注' },
          value: { kind: 'literal' as const, value: '停止前最后输入' },
        },
        recordedAt: '2026-08-05T04:10:03.000Z',
        updatedAt: '2026-08-05T04:10:03.000Z',
      },
    ];
    api.browserRecording.stop.mockResolvedValueOnce({ recording: finalRecording });
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    fireEvent.click(screen.getByTestId('browser-recording-start'));
    await waitFor(() => expect(api.browserRecording.get).toHaveBeenCalled());
    api.browserRecording.get.mockResolvedValue({ recording: finalRecording, steps: finalSteps });

    fireEvent.click(await screen.findByTestId('browser-recording-stop'));

    expect((await screen.findByTestId('browser-recording-step-2')).textContent).toContain(
      '停止前最后输入',
    );
    expect(api.browserRecording.get).toHaveBeenLastCalledWith({
      recordingId: activeRecording.id,
      afterSequence: 0,
      limit: 200,
    });
  });

  it('keeps a stopping recording retryable after cleanup did not finish', async () => {
    api.browserRecording.list.mockResolvedValueOnce({ recordings: [stoppingRecording] });
    api.browserRecording.get.mockResolvedValue({ recording: stoppingRecording, steps: [] });
    api.browserRecording.stop.mockRejectedValueOnce(new Error('Browser cleanup timed out'));
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));

    const stopButton = (await screen.findByTestId('browser-recording-stop')) as HTMLButtonElement;
    expect(stopButton.disabled).toBe(false);
    expect(stopButton.textContent).toContain('重试停止');
    fireEvent.click(stopButton);

    await waitFor(() =>
      expect(api.browserRecording.stop).toHaveBeenCalledWith({
        recordingId: stoppingRecording.id,
      }),
    );
  });

  it('recovers an active durable recording when the Browser page is reopened', async () => {
    api.browserRecording.list.mockResolvedValueOnce({ recordings: [activeRecording] });
    render(<BrowserStage />);
    await waitFor(() => expect(api.browserRecording.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '录制记录' }));
    expect(await screen.findByTestId('browser-recording-stop')).toBeTruthy();
    expect(screen.getByText('录制中')).toBeTruthy();
  });

  it('creates and selects a Runtime Profile', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByTestId('browser-profile-new'));
    const input = screen.getByTestId('browser-profile-new-input');
    fireEvent.change(input, { target: { value: '运营号' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.createBrowserProfile).toHaveBeenCalledWith({ name: '运营号' }));
    await waitFor(() => expect(screen.getAllByText('运营号')).toHaveLength(2));
    expect(api.listBrowserSiteSessions).toHaveBeenCalledWith({
      profileId: 'profile-new',
      refresh: false,
    });
    expect(screen.getByTestId('browser-profile-feedback').textContent).toContain(
      '已创建 Profile「运营号」',
    );
  });

  it('keeps row selection clickable above the profile content', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getByText('工作号')).toBeTruthy());
    const selector = screen.getByRole('button', { name: '选择 Profile 工作号' });
    expect(selector.className).toContain('z-10');
    fireEvent.click(selector);
    await waitFor(() =>
      expect(api.listBrowserSiteSessions).toHaveBeenCalledWith({
        profileId: 'profile-work',
        refresh: false,
      }),
    );
  });

  it('refreshes the selected Profile explicitly', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '登录状态' }));
    fireEvent.click(screen.getByTestId('browser-site-session-refresh'));
    await waitFor(() =>
      expect(api.listBrowserSiteSessions).toHaveBeenCalledWith({
        profileId: 'default',
        refresh: true,
      }),
    );
    await waitFor(() => expect(screen.getByText('已刷新 1 个站点会话')).toBeTruthy());
  });

  it('projects Browser Profile maintenance timeouts to an actionable message', async () => {
    api.listBrowserSiteSessions.mockRejectedValueOnce(
      new Error('Runtime request timed out: browser.profile.listSiteSessions'),
    );
    render(<BrowserStage />);
    await waitFor(() =>
      expect(
        screen.getByText('浏览器启动或 Profile 维护超时，请确认系统浏览器可用后重试。'),
      ).toBeTruthy(),
    );
  });

  it('disables refresh and deletion while the selected Profile is in use', async () => {
    const busyProfile = { ...workProfile, inUse: true };
    api.listBrowserProfiles.mockResolvedValueOnce({ profiles: [defaultProfile, busyProfile] });
    api.listBrowserSiteSessions
      .mockResolvedValueOnce({
        profile: defaultProfile,
        sessions: [exampleSession],
        refreshed: false,
        checkedAt: exampleSession.lastCheckedAt,
      })
      .mockResolvedValueOnce({
        profile: busyProfile,
        sessions: [],
        refreshed: false,
        checkedAt: busyProfile.updatedAt,
      });
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getByText('工作号')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '选择 Profile 工作号' }));
    await waitFor(() => expect(screen.getByText('Profile 使用中')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '登录状态' }));
    expect((screen.getByTestId('browser-site-session-refresh') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByTestId('browser-profile-delete-profile-work') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('renames a Profile with optimistic revision', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getByText('工作号')).toBeTruthy());
    fireEvent.click(screen.getByTestId('browser-profile-rename-profile-work'));
    const input = screen.getByTestId('browser-profile-rename-input-profile-work');
    fireEvent.change(input, { target: { value: '运营号' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(api.renameBrowserProfile).toHaveBeenCalledWith({
        profileId: 'profile-work',
        name: '运营号',
        expectedRevision: 1,
      }),
    );
  });

  it('clears one site only after a single confirmation dialog', async () => {
    api.listBrowserSiteSessions
      .mockResolvedValueOnce({
        profile: defaultProfile,
        sessions: [exampleSession],
        refreshed: false,
        checkedAt: exampleSession.lastCheckedAt,
      })
      .mockResolvedValueOnce({
        profile: { ...defaultProfile, siteCount: 0 },
        sessions: [],
        refreshed: false,
        checkedAt: '2026-08-05T04:01:00.000Z',
      });
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy());
    fireEvent.click(screen.getByTestId('browser-site-session-clear-example.com'));
    expect(screen.getByText('清除 example.com 会话')).toBeTruthy();
    expect(screen.getByText(/第三方 SSO 站点默认保留/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('browser-confirm-danger'));
    await waitFor(() =>
      expect(api.clearBrowserSiteSession).toHaveBeenCalledWith({
        profileId: 'default',
        siteKey: 'example.com',
      }),
    );
    await waitFor(() => expect(screen.getByText('暂无站点会话')).toBeTruthy());
  });

  it('keeps the clear result in an error state when the post-clear reload fails', async () => {
    api.listBrowserSiteSessions
      .mockResolvedValueOnce({
        profile: defaultProfile,
        sessions: [exampleSession],
        refreshed: false,
        checkedAt: exampleSession.lastCheckedAt,
      })
      .mockRejectedValueOnce(
        new Error('Runtime request timed out: browser.profile.listSiteSessions'),
      );
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy());
    fireEvent.click(screen.getByTestId('browser-site-session-clear-example.com'));
    fireEvent.click(screen.getByTestId('browser-confirm-danger'));
    await waitFor(() =>
      expect(
        screen.getByText('浏览器启动或 Profile 维护超时，请确认系统浏览器可用后重试。'),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('已清除 example.com 的站点会话')).toBeNull();
  });

  it('deletes a non-default Profile through a confirmation dialog', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getByText('工作号')).toBeTruthy());
    fireEvent.click(screen.getByTestId('browser-profile-delete-profile-work'));
    expect(screen.getByText('删除 Browser Profile')).toBeTruthy();
    fireEvent.click(screen.getByTestId('browser-confirm-danger'));
    await waitFor(() =>
      expect(api.deleteBrowserProfile).toHaveBeenCalledWith({
        profileId: 'profile-work',
        expectedRevision: 1,
      }),
    );
    await waitFor(() => expect(screen.queryByText('工作号')).toBeNull());
    expect(screen.queryByTestId('browser-profile-delete-default')).toBeNull();
  });
});
