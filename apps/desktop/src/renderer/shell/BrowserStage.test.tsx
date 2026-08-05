/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  BrowserProfileSummary,
  BrowserRecordingSummary,
  BrowserSiteSessionSummary,
} from '@sync-think/protocol';
import type { BrowserRecordingStepRecord } from '@sync-think/shared';
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
      async (): Promise<{
        recording: BrowserRecordingSummary;
        steps: BrowserRecordingStepRecord[];
      }> => ({
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
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime: api },
  });
});

afterEach(() => cleanup());

describe('BrowserStage Runtime Profiles', () => {
  it('loads Runtime Profiles and cached sanitized site sessions without mounting a webview', async () => {
    render(<BrowserStage />);
    expect(screen.getByText('浏览器自动化')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy());
    expect(screen.getByText('已验证登录')).toBeTruthy();
    expect(screen.getByText(/2 Cookie/)).toBeTruthy();
    expect(api.listBrowserSiteSessions).toHaveBeenCalledWith({
      profileId: 'default',
      refresh: false,
    });
    expect(document.querySelector('webview')).toBeNull();
  });

  it('exposes only the implemented login-state and recording views', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    expect(screen.getByRole('button', { name: '登录状态' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
    await waitFor(() =>
      expect(api.browserRecording.list).toHaveBeenCalledWith({ profileId: 'default', limit: 20 }),
    );
    expect(screen.getByTestId('browser-recording-start-url')).toBeTruthy();
    expect(screen.getByTestId('browser-recording-start')).toBeTruthy();
    expect(screen.queryByText('自动化任务')).toBeNull();
  });

  it('starts a recording, polls its durable steps, and never renders a secret value', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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

    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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
      fireEvent.click(screen.getByRole('button', { name: '录制' }));
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

  it('stops an active recording and releases the Profile selection lock', async () => {
    render(<BrowserStage />);
    await waitFor(() => expect(screen.getAllByText('默认浏览器')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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
    fireEvent.click(screen.getByRole('button', { name: '录制' }));

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
    fireEvent.click(screen.getByRole('button', { name: '录制' }));
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
