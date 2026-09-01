import * as Dialog from '@radix-ui/react-dialog';
import type {
  BrowserAutomationSource,
  BrowserProfileSummary,
  BrowserRecordingSummary,
  BrowserSiteSessionSummary,
  BrowserSiteSessionState,
} from '@sync-think/protocol';
import type {
  BrowserRecordingLocator,
  BrowserRecordingStatus,
  BrowserRecordingStepInput,
  BrowserRecordingStepRecord,
} from '@sync-think/shared';
import {
  Check,
  CircleStop,
  CornerDownLeft,
  Database,
  Globe2,
  History,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MousePointerClick,
  Navigation,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  SquareCheckBig,
  TextCursorInput,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  BrowserWorkflowPanel,
  type BrowserWorkflowAiTaskRequest,
  type BrowserWorkflowDraftContext,
} from './BrowserWorkflowPanel.js';

type Feedback = { kind: 'success' | 'error'; text: string };
type BrowserView = 'tasks' | 'sessions' | 'recordings';

export function BrowserStage(
  props: { onStartAiTask?(request: BrowserWorkflowAiTaskRequest): void } = {},
): JSX.Element {
  const [profiles, setProfiles] = useState<BrowserProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>();
  const [sessions, setSessions] = useState<BrowserSiteSessionSummary[]>([]);
  const [checkedAt, setCheckedAt] = useState<string>();
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingProfile, setRenamingProfile] = useState<BrowserProfileSummary>();
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BrowserProfileSummary>();
  const [clearTarget, setClearTarget] = useState<BrowserSiteSessionSummary>();
  const [view, setView] = useState<BrowserView>('tasks');
  const [recordingLockedProfileId, setRecordingLockedProfileId] = useState<string>();
  const [workflowDraft, setWorkflowDraft] = useState<BrowserWorkflowDraftContext>();
  const [workflowRefreshToken, setWorkflowRefreshToken] = useState(0);
  const sessionRequest = useRef(0);
  const newInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId),
    [activeProfileId, profiles],
  );
  const profileMaintenanceLocked = Boolean(recordingLockedProfileId);

  const applyProfile = useCallback((profile: BrowserProfileSummary) => {
    setProfiles((current) =>
      current.map((candidate) => (candidate.id === profile.id ? profile : candidate)),
    );
  }, []);

  const loadProfiles = useCallback(async (preserveFeedback = false) => {
    setProfilesLoading(true);
    try {
      const response = await browserRuntime().listBrowserProfiles();
      setProfiles(response.profiles);
      setActiveProfileId((current) => {
        if (current && response.profiles.some((profile) => profile.id === current)) return current;
        return (
          response.profiles.find((profile) => profile.isDefault)?.id ?? response.profiles[0]?.id
        );
      });
      if (!preserveFeedback) setFeedback(undefined);
    } catch (error) {
      setFeedback({ kind: 'error', text: browserProfileErrorMessage(error) });
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  const handleRecordingActivityChange = useCallback((profileId: string, active: boolean) => {
    setRecordingLockedProfileId((current) => {
      if (active) return profileId;
      return current === profileId ? undefined : current;
    });
  }, []);

  const refreshProfilesAfterRecording = useCallback(() => {
    void loadProfiles(true);
  }, [loadProfiles]);

  const loadSessions = useCallback(
    async (profileId: string, refresh: boolean): Promise<boolean> => {
      const requestId = ++sessionRequest.current;
      if (refresh) setRefreshing(true);
      else setSessionsLoading(true);
      try {
        const response = await browserRuntime().listBrowserSiteSessions({ profileId, refresh });
        if (requestId !== sessionRequest.current) return false;
        setSessions(response.sessions);
        setCheckedAt(response.checkedAt);
        applyProfile(response.profile);
        if (refresh) {
          setFeedback({ kind: 'success', text: `已刷新 ${response.sessions.length} 个站点会话` });
        }
        return true;
      } catch (error) {
        if (requestId !== sessionRequest.current) return false;
        setFeedback({ kind: 'error', text: browserProfileErrorMessage(error) });
        return false;
      } finally {
        if (requestId === sessionRequest.current) {
          setRefreshing(false);
          setSessionsLoading(false);
        }
      }
    },
    [applyProfile],
  );

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!activeProfileId) return;
    setSessions([]);
    setCheckedAt(undefined);
    setWorkflowDraft(undefined);
    void loadSessions(activeProfileId, false);
  }, [activeProfileId, loadSessions]);

  useEffect(() => {
    if (creating) newInputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (renamingProfile) renameInputRef.current?.focus();
  }, [renamingProfile]);

  const createProfile = useCallback(async () => {
    const name = newName.trim();
    if (!name || busyAction || profileMaintenanceLocked) return;
    setBusyAction('create');
    try {
      const response = await browserRuntime().createBrowserProfile({ name });
      setProfiles((current) => [...current, response.profile]);
      setActiveProfileId(response.profile.id);
      setCreating(false);
      setNewName('');
      setFeedback({ kind: 'success', text: `已创建 Profile「${response.profile.name}」` });
    } catch (error) {
      setFeedback({ kind: 'error', text: browserProfileErrorMessage(error) });
    } finally {
      setBusyAction(undefined);
    }
  }, [busyAction, newName, profileMaintenanceLocked]);

  const renameProfile = useCallback(async () => {
    const name = renameValue.trim();
    if (!renamingProfile || !name || busyAction || profileMaintenanceLocked) return;
    setBusyAction(`rename:${renamingProfile.id}`);
    try {
      const response = await browserRuntime().renameBrowserProfile({
        profileId: renamingProfile.id,
        name,
        expectedRevision: renamingProfile.revision,
      });
      applyProfile(response.profile);
      setRenamingProfile(undefined);
      setRenameValue('');
      setFeedback({ kind: 'success', text: `Profile 已重命名为「${response.profile.name}」` });
    } catch (error) {
      setFeedback({ kind: 'error', text: browserProfileErrorMessage(error) });
    } finally {
      setBusyAction(undefined);
    }
  }, [applyProfile, busyAction, profileMaintenanceLocked, renameValue, renamingProfile]);

  const deleteProfile = useCallback(async () => {
    if (!deleteTarget || busyAction || profileMaintenanceLocked) return;
    setBusyAction(`delete:${deleteTarget.id}`);
    try {
      await browserRuntime().deleteBrowserProfile({
        profileId: deleteTarget.id,
        expectedRevision: deleteTarget.revision,
      });
      const remaining = profiles.filter((profile) => profile.id !== deleteTarget.id);
      setProfiles(remaining);
      if (activeProfileId === deleteTarget.id) {
        setActiveProfileId(remaining.find((profile) => profile.isDefault)?.id ?? remaining[0]?.id);
      }
      setDeleteTarget(undefined);
      setFeedback({ kind: 'success', text: `已删除 Profile「${deleteTarget.name}」` });
    } catch (error) {
      if (isProfileWorkflowReferenceError(error)) setDeleteTarget(undefined);
      setFeedback({ kind: 'error', text: browserProfileErrorMessage(error) });
    } finally {
      setBusyAction(undefined);
    }
  }, [activeProfileId, busyAction, deleteTarget, profileMaintenanceLocked, profiles]);

  const clearSiteSession = useCallback(async () => {
    if (!activeProfile || !clearTarget || busyAction || profileMaintenanceLocked) return;
    setBusyAction(`clear:${clearTarget.siteKey}`);
    try {
      await browserRuntime().clearBrowserSiteSession({
        profileId: activeProfile.id,
        siteKey: clearTarget.siteKey,
      });
      setClearTarget(undefined);
      const loaded = await loadSessions(activeProfile.id, false);
      if (!loaded) return;
      setFeedback({ kind: 'success', text: `已清除 ${clearTarget.siteKey} 的站点会话` });
    } catch (error) {
      setFeedback({ kind: 'error', text: browserProfileErrorMessage(error) });
    } finally {
      setBusyAction(undefined);
    }
  }, [activeProfile, busyAction, clearTarget, loadSessions, profileMaintenanceLocked]);

  return (
    <div className="browser-automation" data-testid="browser-stage">
      <aside className="browser-automation__profiles">
        <header className="browser-automation__profiles-header">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <h2 className="truncate text-[13px] font-semibold text-text">Profile</h2>
              <span className="text-[10.5px] tabular-nums text-text-faint">
                {profiles.length}
              </span>
            </div>
            <p className="mt-1 max-w-[178px] text-[10.5px] leading-4 text-text-faint">
              每个 Profile 拥有独立的 Cookie 和登录态，可管理多账号
            </p>
          </div>
          <button
            type="button"
            className={clsx(
              'browser-automation__record-shortcut',
              view === 'recordings' && 'is-active',
            )}
            aria-label="录制浏览器操作"
            aria-pressed={view === 'recordings'}
            onClick={() => setView('recordings')}
          >
            <Radio size={12} />
            录制
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
          <button
            type="button"
            data-testid="browser-profile-new"
            className="browser-automation__new-profile"
            disabled={Boolean(busyAction) || profileMaintenanceLocked}
            onClick={() => {
              setCreating(true);
              setNewName('');
            }}
          >
            <Plus size={14} />
            新建 Profile
          </button>
          {creating ? (
            <div className="mt-2 flex items-center gap-1 rounded-lg border border-accent bg-chat px-1.5 py-1">
              <input
                ref={newInputRef}
                data-testid="browser-profile-new-input"
                className="h-7 min-w-0 flex-1 bg-transparent px-1 text-[12px] text-text placeholder:text-text-faint focus:outline-none"
                placeholder="Profile 名称"
                value={newName}
                maxLength={80}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createProfile();
                  if (event.key === 'Escape') setCreating(false);
                }}
              />
              <IconButton
                label="确认创建"
                disabled={!newName.trim() || busyAction === 'create' || profileMaintenanceLocked}
                onClick={() => void createProfile()}
              >
                {busyAction === 'create' ? (
                  <LoaderCircle className="animate-spin" size={13} />
                ) : (
                  <Check size={13} />
                )}
              </IconButton>
              <IconButton label="取消创建" onClick={() => setCreating(false)}>
                <X size={13} />
              </IconButton>
            </div>
          ) : null}

          {profilesLoading ? <ProfileListSkeleton /> : null}
          {!profilesLoading && profiles.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-text-faint">
              暂无可用 Profile
            </div>
          ) : null}
          <div className="mt-2 space-y-1.5" data-testid="browser-profile-list">
            {profiles.map((profile) => {
              const active = profile.id === activeProfileId;
              const renaming = renamingProfile?.id === profile.id;
              const recordingLocked = recordingLockedProfileId === profile.id;
              const inUse = profile.inUse || recordingLocked;
              const selectionLocked = profileMaintenanceLocked;
              return (
                <div
                  key={profile.id}
                  data-testid={`browser-profile-item-${profile.id}`}
                  className={clsx(
                    'browser-automation__profile-card group relative',
                    active
                      ? 'is-active'
                      : 'hover:border-border-strong hover:bg-hover',
                  )}
                >
                  <button
                    type="button"
                    className={clsx('absolute inset-0 rounded-md', renaming ? 'z-0' : 'z-10')}
                    aria-label={`选择 Profile ${profile.name}`}
                    title={selectionLocked ? '录制期间不能切换 Profile' : undefined}
                    disabled={selectionLocked}
                    onClick={() => {
                      setFeedback(undefined);
                      setActiveProfileId(profile.id);
                    }}
                  />
                  <div
                    className={clsx(
                      'browser-automation__profile-icon relative',
                      active ? 'is-active' : '',
                    )}
                  >
                    <Globe2 size={14} />
                  </div>
                  <div className={clsx('relative min-w-0 flex-1', renaming && 'z-20')}>
                    {renaming ? (
                      <input
                        ref={renameInputRef}
                        data-testid={`browser-profile-rename-input-${profile.id}`}
                        className="h-7 w-full rounded border border-accent bg-surface px-1.5 text-[12px] text-text focus:outline-none"
                        value={renameValue}
                        maxLength={80}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void renameProfile();
                          if (event.key === 'Escape') setRenamingProfile(undefined);
                        }}
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] font-medium text-text">
                            {profile.name}
                          </span>
                          {profile.isDefault ? (
                            <span className="shrink-0 text-[10px] text-accent-text">默认</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-[10.5px] text-text-faint">
                          {profile.isDefault ? '与应用共享登录态' : `${profile.siteCount} 个站点`}
                          {!profile.isDefault && profile.lastUsedAt
                            ? ` · ${formatProfileActivity(profile.lastUsedAt)}`
                            : ''}
                        </div>
                      </>
                    )}
                  </div>
                  {inUse ? (
                    <span className="relative shrink-0 text-[10px] text-warning">
                      {recordingLocked ? '录制占用' : '使用中'}
                    </span>
                  ) : null}
                  {!renaming ? (
                    <div className="relative z-20 flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      <IconButton
                        label="重命名 Profile"
                        disabled={Boolean(busyAction) || inUse || profileMaintenanceLocked}
                        testId={`browser-profile-rename-${profile.id}`}
                        onClick={() => {
                          setRenamingProfile(profile);
                          setRenameValue(profile.name);
                        }}
                      >
                        <Pencil size={12} />
                      </IconButton>
                      {!profile.isDefault ? (
                        <IconButton
                          label={inUse ? 'Profile 使用中' : '删除 Profile'}
                          disabled={inUse || Boolean(busyAction) || profileMaintenanceLocked}
                          testId={`browser-profile-delete-${profile.id}`}
                          danger
                          onClick={() => setDeleteTarget(profile)}
                        >
                          <Trash2 size={12} />
                        </IconButton>
                      ) : null}
                    </div>
                  ) : (
                    <div className="relative z-20 flex shrink-0 items-center">
                      <IconButton
                        label="确认重命名"
                        disabled={
                          !renameValue.trim() || Boolean(busyAction) || profileMaintenanceLocked
                        }
                        onClick={() => void renameProfile()}
                      >
                        <Check size={12} />
                      </IconButton>
                      <IconButton label="取消重命名" onClick={() => setRenamingProfile(undefined)}>
                        <X size={12} />
                      </IconButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="browser-automation__stage">
        <header className="browser-automation__stage-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[14px] font-semibold text-text">浏览器自动化</h1>
              {activeProfile ? (
                <span className="browser-automation__active-profile-name">
                  {activeProfile.name}
                </span>
              ) : null}
              {activeProfile &&
              (activeProfile.inUse || recordingLockedProfileId === activeProfile.id) ? (
                <span className="shrink-0 text-[10.5px] font-medium text-warning">
                  Profile 使用中
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-text-faint">
              {activeProfile
                ? view === 'tasks'
                  ? `使用「${activeProfile.name}」创建、审核并运行可复用任务`
                  : view === 'sessions'
                    ? `${sessions.length} 个站点会话${checkedAt ? ` · 检查于 ${formatDateTime(checkedAt)}` : ''}`
                    : recordingLockedProfileId === activeProfile.id
                      ? '系统浏览器正在记录语义动作'
                      : workflowDraft
                        ? `正在编辑任务「${workflowDraft.taskName}」`
                        : '录制记录保存在当前 Runtime Profile'
                : '选择一个 Profile 查看登录状态'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div
              className="browser-automation__view-switcher"
              role="group"
              aria-label="浏览器工作区"
            >
              {(
                [
                  ['tasks', '自动化任务'],
                  ['sessions', '登录状态'],
                  ['recordings', '录制记录'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={clsx(
                    'browser-automation__view-option',
                    view === value
                      ? 'is-active'
                      : '',
                  )}
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === 'sessions' ? (
              <button
                type="button"
                data-testid="browser-site-session-refresh"
                className="browser-automation__secondary-button"
                disabled={
                  !activeProfile ||
                  activeProfile.inUse ||
                  profileMaintenanceLocked ||
                  refreshing ||
                  Boolean(busyAction)
                }
                title={
                  activeProfile?.inUse || profileMaintenanceLocked
                    ? 'Profile 正在被任务使用'
                    : '刷新站点会话'
                }
                onClick={() => activeProfile && void loadSessions(activeProfile.id, true)}
              >
                <RefreshCw className={clsx(refreshing && 'animate-spin')} size={13} />
                刷新
              </button>
            ) : null}
          </div>
        </header>

        {feedback ? (
          <div
            data-testid="browser-profile-feedback"
            className={clsx(
              'mx-4 mt-3 flex min-h-8 items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-[11.5px]',
              feedback.kind === 'error'
                ? 'border-error/30 bg-error/10 text-error'
                : 'border-success/30 bg-success/10 text-success',
            )}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-hover"
              aria-label="关闭提示"
              onClick={() => setFeedback(undefined)}
            >
              <X size={12} />
            </button>
          </div>
        ) : null}

        {activeProfile ? (
          <div
            className={clsx('min-h-0 flex-1', view !== 'tasks' && 'hidden')}
            aria-hidden={view !== 'tasks'}
          >
            <BrowserWorkflowPanel
              key={activeProfile.id}
              profile={activeProfile}
              refreshToken={workflowRefreshToken}
              onStartAiTask={props.onStartAiTask}
              onRecordWorkflow={(context) => {
                setWorkflowDraft(context);
                setView('recordings');
              }}
            />
          </div>
        ) : null}
        <div
          className={clsx('min-h-0 flex-1 overflow-y-auto', view !== 'sessions' && 'hidden')}
          aria-hidden={view !== 'sessions'}
        >
          {sessionsLoading ? <SessionListSkeleton /> : null}
          {!sessionsLoading && activeProfile && sessions.length === 0 ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center px-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-elevated text-text-faint">
                <KeyRound size={18} />
              </div>
              <div className="mt-3 text-[13px] font-medium text-text">暂无站点会话</div>
              <div className="mt-1 max-w-[340px] text-[11.5px] leading-5 text-text-faint">
                登录站点后刷新，此处会显示该 Profile 中的脱敏会话摘要。
              </div>
            </div>
          ) : null}
          {!sessionsLoading && sessions.length > 0 ? (
            <div className="px-4 py-2" data-testid="browser-site-session-list">
              <div className="grid h-8 grid-cols-[minmax(0,1fr)_140px_96px_32px] items-center gap-3 border-b border-border px-2 text-[10.5px] font-medium text-text-faint">
                <span>站点</span>
                <span>状态</span>
                <span>最近检查</span>
                <span className="sr-only">操作</span>
              </div>
              {sessions.map((session) => (
                <SiteSessionRow
                  key={session.siteKey}
                  session={session}
                  disabled={
                    Boolean(busyAction) || activeProfile?.inUse === true || profileMaintenanceLocked
                  }
                  onClear={() => setClearTarget(session)}
                />
              ))}
            </div>
          ) : null}
        </div>
        {activeProfile ? (
          <div
            className={clsx('min-h-0 flex-1', view !== 'recordings' && 'hidden')}
            aria-hidden={view !== 'recordings'}
          >
            <RecordingPanel
              key={`${activeProfile.id}:${workflowDraft?.draftId ?? 'history'}`}
              profile={activeProfile}
              workflowDraft={workflowDraft}
              onActivityChange={handleRecordingActivityChange}
              onProfileRefresh={refreshProfilesAfterRecording}
              onExitWorkflow={() => {
                setWorkflowDraft(undefined);
                setWorkflowRefreshToken((current) => current + 1);
                setView('tasks');
              }}
              onWorkflowSubmitted={() => {
                setWorkflowDraft(undefined);
                setWorkflowRefreshToken((current) => current + 1);
                setView('tasks');
              }}
            />
          </div>
        ) : null}
      </main>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除 Browser Profile"
        confirmLabel="删除 Profile"
        busy={Boolean(deleteTarget && busyAction === `delete:${deleteTarget.id}`)}
        disabled={profileMaintenanceLocked}
        onOpenChange={(open) => !open && !busyAction && setDeleteTarget(undefined)}
        onConfirm={() => void deleteProfile()}
      >
        <p>
          将删除 Profile「{deleteTarget?.name}」及其专用浏览器目录中的 Cookie、站点存储和登录态。
        </p>
        <p className="mt-2 text-text-faint">
          已有关联自动化任务时会保留该 Profile，避免录制草稿和已发布版本失去登录环境。
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(clearTarget)}
        title={`清除 ${clearTarget?.siteKey ?? ''} 会话`}
        confirmLabel="清除站点会话"
        busy={Boolean(clearTarget && busyAction === `clear:${clearTarget.siteKey}`)}
        disabled={profileMaintenanceLocked}
        onOpenChange={(open) => !open && !busyAction && setClearTarget(undefined)}
        onConfirm={() => void clearSiteSession()}
      >
        <p>将清除主站及其子域的以下数据：</p>
        <div className="mt-3 rounded-md border border-border bg-elevated px-3 py-2.5">
          <div className="text-[11.5px] font-medium text-text">{clearTarget?.siteKey}</div>
          <div className="mt-1 text-[11px] leading-5 text-text-faint">
            {(clearTarget?.origins ?? []).map(originHostname).filter(Boolean).join('、') ||
              '已知子域'}
          </div>
          <div className="mt-2 text-[11px] text-text-secondary">
            {formatStorageTypes(clearTarget?.storageTypes ?? [])}
            {(clearTarget?.cookieCount ?? 0) > 0 ? `，${clearTarget?.cookieCount} 个 Cookie` : ''}
          </div>
        </div>
        <p className="mt-2 text-text-faint">Google、Microsoft 等第三方 SSO 站点默认保留。</p>
      </ConfirmDialog>
    </div>
  );
}

function RecordingPanel(props: {
  profile: BrowserProfileSummary;
  workflowDraft?: {
    taskId: string;
    draftId: string;
    taskName: string;
    startUrl: string;
    source: BrowserAutomationSource;
    status: BrowserWorkflowDraftContext['status'];
    recordingId?: string;
  };
  onActivityChange(profileId: string, active: boolean): void;
  onProfileRefresh(): void;
  onExitWorkflow(): void;
  onWorkflowSubmitted(taskId: string): void;
}): JSX.Element {
  const {
    profile,
    workflowDraft,
    onActivityChange,
    onProfileRefresh,
    onExitWorkflow,
    onWorkflowSubmitted,
  } = props;
  const [recordings, setRecordings] = useState<BrowserRecordingSummary[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string>();
  const [snapshot, setSnapshot] = useState<{
    recording: BrowserRecordingSummary;
    steps: BrowserRecordingStepRecord[];
  }>();
  const [startUrl, setStartUrl] = useState(workflowDraft?.startUrl ?? '');
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<'start' | 'stop' | 'submit'>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [startReconciliation, setStartReconciliation] = useState<{
    feedback: Feedback;
    previousWorkflowRecordingId?: string;
  }>();
  const [profileActiveRecordingId, setProfileActiveRecordingId] = useState<string>();
  const snapshotRequest = useRef(0);
  const activityRef = useRef(false);
  const profileActiveRecordingIdRef = useRef<string>();
  const workflowRecordingId = useRef<string>();
  const workflowMode = Boolean(workflowDraft);

  const publishActivity = useCallback(
    (active: boolean) => {
      const previous = activityRef.current;
      activityRef.current = active;
      if (previous === active) return;
      onActivityChange(profile.id, active);
      if (previous && !active) onProfileRefresh();
    },
    [onActivityChange, onProfileRefresh, profile.id],
  );

  const applySnapshot = useCallback(
    (next: { recording: BrowserRecordingSummary; steps: BrowserRecordingStepRecord[] }) => {
      const wasActiveRecording = profileActiveRecordingIdRef.current === next.recording.id;
      setSnapshot(next);
      setRecordings((current) =>
        workflowMode ? [next.recording] : upsertRecording(current, next.recording),
      );
      if (isActiveRecording(next.recording.status)) {
        profileActiveRecordingIdRef.current = next.recording.id;
        setProfileActiveRecordingId(next.recording.id);
        publishActivity(true);
      } else if (profileActiveRecordingIdRef.current === next.recording.id) {
        profileActiveRecordingIdRef.current = undefined;
        setProfileActiveRecordingId(undefined);
        publishActivity(false);
      }
      if (isAbnormalTerminalRecording(next.recording.status)) {
        setFeedback((current) => (current?.kind === 'success' ? undefined : current));
      } else if (next.recording.status === 'stopped' && wasActiveRecording) {
        setFeedback((current) =>
          current?.kind === 'error' ? current : { kind: 'success', text: '录制已停止' },
        );
      }
    },
    [publishActivity, workflowMode],
  );

  const selectRecording = useCallback(
    async (recordingId: string, quiet = false) => {
      const requestId = ++snapshotRequest.current;
      setSelectedRecordingId(recordingId);
      if (!quiet) setSnapshotLoading(true);
      try {
        const response = await browserRuntime().browserRecording.get({
          recordingId,
          afterSequence: 0,
          limit: 200,
        });
        if (requestId !== snapshotRequest.current) return;
        applySnapshot(response);
        setFeedback(undefined);
      } catch (error) {
        if (requestId !== snapshotRequest.current) return;
        setFeedback({ kind: 'error', text: browserRecordingErrorMessage(error) });
      } finally {
        if (requestId === snapshotRequest.current && !quiet) setSnapshotLoading(false);
      }
    },
    [applySnapshot],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setFeedback(undefined);
      setRecordings([]);
      setSelectedRecordingId(undefined);
      setSnapshot(undefined);
      setStartUrl(workflowDraft?.startUrl ?? '');
      setStartReconciliation(undefined);
      profileActiveRecordingIdRef.current = undefined;
      setProfileActiveRecordingId(undefined);
      workflowRecordingId.current =
        workflowDraft?.status === 'editing' ? workflowDraft.recordingId : undefined;
      try {
        const response = await browserRuntime().browserRecording.list({
          profileId: profile.id,
          limit: 20,
        });
        if (cancelled) return;
        const active = response.recordings.find((recording) => isActiveRecording(recording.status));
        profileActiveRecordingIdRef.current = active?.id;
        setProfileActiveRecordingId(active?.id);
        publishActivity(Boolean(active));
        if (workflowDraft) {
          setRecordings([]);
          const recordingId = workflowDraft.recordingId;
          if (!recordingId) return;
          setSelectedRecordingId(recordingId);
          const details = await browserRuntime().browserRecording.get({
            recordingId,
            afterSequence: 0,
            limit: 200,
          });
          if (cancelled) return;
          applySnapshot(details);
          return;
        }
        setRecordings(response.recordings);
        const selected = active ?? response.recordings[0];
        if (!selected) return;
        setSelectedRecordingId(selected.id);
        const details = await browserRuntime().browserRecording.get({
          recordingId: selected.id,
          afterSequence: 0,
          limit: 200,
        });
        if (cancelled) return;
        applySnapshot(details);
      } catch (error) {
        if (!cancelled) {
          setFeedback({ kind: 'error', text: browserRecordingErrorMessage(error) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot, profile.id, publishActivity, workflowDraft]);

  const activeRecording = useMemo(
    () => recordings.find((recording) => isActiveRecording(recording.status)),
    [recordings],
  );
  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedRecordingId),
    [recordings, selectedRecordingId],
  );
  const selectedSnapshot = snapshot?.recording.id === selectedRecordingId ? snapshot : undefined;
  const currentRecording = selectedSnapshot?.recording ?? selectedRecording;
  const currentSteps = selectedSnapshot?.steps ?? ([] as BrowserRecordingStepRecord[]);

  useEffect(() => {
    if (!profileActiveRecordingId) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await browserRuntime().browserRecording.get({
          recordingId: profileActiveRecordingId,
          afterSequence: 0,
          limit: 200,
        });
        if (cancelled) return;
        if (
          !workflowDraft ||
          workflowDraft.recordingId === profileActiveRecordingId ||
          workflowRecordingId.current === profileActiveRecordingId
        ) {
          setSelectedRecordingId(profileActiveRecordingId);
          applySnapshot(response);
        } else if (!isActiveRecording(response.recording.status)) {
          profileActiveRecordingIdRef.current = undefined;
          setProfileActiveRecordingId(undefined);
          publishActivity(false);
        }
      } catch (error) {
        if (!cancelled) {
          setFeedback({ kind: 'error', text: browserRecordingErrorMessage(error) });
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 800);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [applySnapshot, profileActiveRecordingId, publishActivity, workflowDraft]);

  useEffect(() => {
    if (!startReconciliation) return;
    let cancelled = false;
    let timer: number | undefined;
    const reconcile = async () => {
      try {
        if (workflowDraft) {
          const workflow = await browserRuntime().browserWorkflow.get({
            taskId: workflowDraft.taskId,
          });
          if (cancelled) return;
          const recordingId = workflow.draft?.recordingId;
          if (!recordingId || recordingId === startReconciliation.previousWorkflowRecordingId) {
            setStartReconciliation(undefined);
            profileActiveRecordingIdRef.current = undefined;
            setProfileActiveRecordingId(undefined);
            publishActivity(false);
            setFeedback(startReconciliation.feedback);
            return;
          }
          const details = await browserRuntime().browserRecording.get({
            recordingId,
            afterSequence: 0,
            limit: 200,
          });
          if (cancelled) return;
          workflowRecordingId.current = recordingId;
          setSelectedRecordingId(recordingId);
          setStartUrl(details.recording.startUrl ?? '');
          applySnapshot(details);
          setStartReconciliation(undefined);
          setFeedback(
            isActiveRecording(details.recording.status)
              ? { kind: 'success', text: '录制已开始' }
              : startReconciliation.feedback,
          );
          return;
        }
        const response = await browserRuntime().browserRecording.list({
          profileId: profile.id,
          limit: 20,
        });
        if (cancelled) return;
        const active = response.recordings.find((recording) => isActiveRecording(recording.status));
        setRecordings(response.recordings);
        setStartReconciliation(undefined);
        if (active) {
          profileActiveRecordingIdRef.current = active.id;
          setProfileActiveRecordingId(active.id);
          setSelectedRecordingId(active.id);
          setSnapshot(undefined);
          setStartUrl(active.startUrl ?? '');
          publishActivity(true);
          setFeedback({ kind: 'success', text: '录制已开始' });
        } else {
          profileActiveRecordingIdRef.current = undefined;
          setProfileActiveRecordingId(undefined);
          publishActivity(false);
          setFeedback(startReconciliation.feedback);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(reconcile, 500);
      }
    };
    timer = window.setTimeout(reconcile, 500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [applySnapshot, profile.id, publishActivity, startReconciliation, workflowDraft]);

  const startRecording = useCallback(async () => {
    if (busyAction || activeRecording || profileActiveRecordingId) return;
    const candidateUrl = startUrl.trim();
    if (candidateUrl && !isHttpUrl(candidateUrl)) {
      setFeedback({ kind: 'error', text: '请输入有效的 HTTP 或 HTTPS 起始网址。' });
      return;
    }
    setBusyAction('start');
    setFeedback(undefined);
    setStartReconciliation(undefined);
    publishActivity(true);
    try {
      const response = await browserRuntime().browserRecording.start({
        profileId: profile.id,
        expectedProfileRevision: profile.revision,
        ...(workflowDraft ? { draftId: workflowDraft.draftId } : {}),
        ...(candidateUrl ? { startUrl: candidateUrl } : {}),
      });
      setRecordings((current) =>
        workflowDraft ? [response.recording] : upsertRecording(current, response.recording),
      );
      setSelectedRecordingId(response.recording.id);
      setSnapshot({ recording: response.recording, steps: [] });
      setStartUrl(response.recording.startUrl ?? '');
      if (workflowDraft) workflowRecordingId.current = response.recording.id;
      profileActiveRecordingIdRef.current = response.recording.id;
      setProfileActiveRecordingId(response.recording.id);
      setStartReconciliation(undefined);
      publishActivity(true);
      setFeedback({ kind: 'success', text: '录制已开始' });
    } catch (error) {
      const failureFeedback: Feedback = {
        kind: 'error',
        text: browserRecordingErrorMessage(error),
      };
      try {
        if (workflowDraft) {
          const workflow = await browserRuntime().browserWorkflow.get({
            taskId: workflowDraft.taskId,
          });
          const recordingId = workflow.draft?.recordingId;
          if (recordingId && recordingId !== workflowDraft.recordingId) {
            const details = await browserRuntime().browserRecording.get({
              recordingId,
              afterSequence: 0,
              limit: 200,
            });
            workflowRecordingId.current = recordingId;
            setSelectedRecordingId(recordingId);
            setStartUrl(details.recording.startUrl ?? '');
            applySnapshot(details);
            setStartReconciliation(undefined);
            setFeedback(
              isActiveRecording(details.recording.status)
                ? { kind: 'success', text: '录制已开始' }
                : failureFeedback,
            );
          } else {
            profileActiveRecordingIdRef.current = undefined;
            setProfileActiveRecordingId(undefined);
            setStartReconciliation(undefined);
            publishActivity(false);
            setFeedback(failureFeedback);
          }
          return;
        }
        const response = await browserRuntime().browserRecording.list({
          profileId: profile.id,
          limit: 20,
        });
        const active = response.recordings.find((recording) => isActiveRecording(recording.status));
        setRecordings(response.recordings);
        if (active) {
          profileActiveRecordingIdRef.current = active.id;
          setProfileActiveRecordingId(active.id);
          setSelectedRecordingId(active.id);
          setSnapshot(undefined);
          publishActivity(true);
          setStartUrl(active.startUrl ?? '');
          setStartReconciliation(undefined);
          setFeedback({ kind: 'success', text: '录制已开始' });
        } else {
          profileActiveRecordingIdRef.current = undefined;
          setProfileActiveRecordingId(undefined);
          setStartReconciliation(undefined);
          publishActivity(false);
          setFeedback(failureFeedback);
        }
      } catch {
        setStartReconciliation({
          feedback: failureFeedback,
          previousWorkflowRecordingId: workflowDraft?.recordingId,
        });
        setFeedback(failureFeedback);
      }
    } finally {
      setBusyAction(undefined);
    }
  }, [
    activeRecording,
    busyAction,
    applySnapshot,
    profile.id,
    profile.revision,
    profileActiveRecordingId,
    publishActivity,
    startUrl,
    workflowDraft,
  ]);

  const stopRecording = useCallback(async () => {
    if (!activeRecording || busyAction) return;
    setBusyAction('stop');
    setFeedback(undefined);
    try {
      const response = await browserRuntime().browserRecording.stop({
        recordingId: activeRecording.id,
      });
      const previousSteps = snapshot?.recording.id === activeRecording.id ? snapshot.steps : [];
      setSelectedRecordingId(response.recording.id);
      applySnapshot({ recording: response.recording, steps: previousSteps });
      setFeedback({ kind: 'success', text: '录制已停止' });
      try {
        const finalSnapshot = await browserRuntime().browserRecording.get({
          recordingId: response.recording.id,
          afterSequence: 0,
          limit: 200,
        });
        applySnapshot({
          recording: isActiveRecording(finalSnapshot.recording.status)
            ? response.recording
            : finalSnapshot.recording,
          steps: finalSnapshot.steps,
        });
      } catch (error) {
        setFeedback({
          kind: 'error',
          text: `录制已停止，但最终步骤刷新失败：${browserRecordingErrorMessage(error)}`,
        });
      }
    } catch (error) {
      setFeedback({ kind: 'error', text: browserRecordingErrorMessage(error) });
    } finally {
      setBusyAction(undefined);
    }
  }, [activeRecording, applySnapshot, busyAction, snapshot]);

  const submitWorkflow = useCallback(async () => {
    if (
      !workflowDraft ||
      !currentRecording ||
      currentRecording.status !== 'stopped' ||
      currentSteps.length < 1 ||
      busyAction
    ) {
      return;
    }
    if (workflowRecordingId.current !== currentRecording.id) {
      setFeedback({ kind: 'error', text: '请选择本次任务对应的录制记录后再提交。' });
      return;
    }
    setBusyAction('submit');
    setFeedback(undefined);
    try {
      await browserRuntime().browserWorkflow.submit({
        draftId: workflowDraft.draftId,
        recordingId: currentRecording.id,
      });
      onWorkflowSubmitted(workflowDraft.taskId);
    } catch (error) {
      setFeedback({ kind: 'error', text: browserWorkflowErrorMessage(error) });
    } finally {
      setBusyAction(undefined);
    }
  }, [busyAction, currentRecording, currentSteps.length, onWorkflowSubmitted, workflowDraft]);

  const status = recordingStatus(currentRecording?.status);
  const StatusIcon = status.icon;
  const startBlocked =
    (profile.inUse || activityRef.current || Boolean(profileActiveRecordingId)) && !activeRecording;
  const terminalNote = currentRecording ? recordingTerminalNote(currentRecording) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="browser-recording-panel">
      {workflowDraft ? (
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b border-accent/30 bg-accent-soft px-4 py-2"
          data-testid="browser-workflow-recording-context"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[11.5px] font-medium text-text">
                {workflowDraft.taskName}
              </span>
              <span className="shrink-0 text-[10px] text-accent-text">
                {workflowDraft.source === 'ai' ? 'AI 草稿' : '手动草稿'}
              </span>
            </div>
            <div className="mt-0.5 text-[10.5px] text-text-faint">
              完成录制并检查步骤后，提交给你审核。
            </div>
          </div>
          <button
            type="button"
            className="h-7 shrink-0 rounded-md px-2.5 text-[10.5px] font-medium text-text-secondary hover:bg-hover hover:text-text disabled:opacity-45"
            disabled={Boolean(activeRecording) || Boolean(busyAction)}
            onClick={onExitWorkflow}
          >
            返回任务
          </button>
        </div>
      ) : null}
      <div className="shrink-0 border-b border-border bg-elevated px-4 py-3">
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[10.5px] font-medium text-text-secondary">
              起始网址
            </span>
            <input
              data-testid="browser-recording-start-url"
              className="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-[11.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              value={startUrl}
              placeholder="https://example.com"
              maxLength={2048}
              disabled={Boolean(activeRecording) || Boolean(busyAction)}
              onChange={(event) => setStartUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void startRecording();
              }}
            />
          </label>
          {activeRecording ? (
            <button
              type="button"
              data-testid="browser-recording-stop"
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-error/40 bg-error/10 px-3 text-[11.5px] font-medium text-error hover:bg-error/15 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={busyAction === 'stop'}
              onClick={() => void stopRecording()}
            >
              {busyAction === 'stop' || activeRecording.status === 'stopping' ? (
                <LoaderCircle className="animate-spin" size={13} />
              ) : (
                <CircleStop size={13} />
              )}
              {busyAction === 'stop'
                ? '正在停止'
                : activeRecording.status === 'stopping'
                  ? '重试停止'
                  : '停止录制'}
            </button>
          ) : (
            <button
              type="button"
              data-testid="browser-recording-start"
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={busyAction === 'start' || loading || startBlocked}
              title={startBlocked ? 'Profile 正在被其他任务使用' : '开始录制'}
              onClick={() => void startRecording()}
            >
              {busyAction === 'start' ? (
                <LoaderCircle className="animate-spin" size={13} />
              ) : (
                <Radio size={13} />
              )}
              开始录制
            </button>
          )}
        </div>

        <div className="mt-3 flex min-w-0 items-center gap-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[10.5px] text-text-faint">
            <History size={12} />
            <span className="shrink-0">最近录制</span>
            <select
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[10.5px] text-text-secondary focus:border-accent focus:outline-none disabled:opacity-50"
              value={selectedRecordingId ?? ''}
              disabled={recordings.length === 0 || Boolean(activeRecording)}
              onChange={(event) => void selectRecording(event.target.value)}
            >
              {recordings.length === 0 ? <option value="">暂无记录</option> : null}
              {recordings.map((recording) => (
                <option key={recording.id} value={recording.id}>
                  {formatRecordingOption(recording)}
                </option>
              ))}
            </select>
          </label>
          {currentRecording ? (
            <div
              className={clsx('flex shrink-0 items-center gap-1.5 text-[10.5px]', status.className)}
            >
              <StatusIcon className={clsx(status.spin && 'animate-spin')} size={12} />
              <span>{status.label}</span>
            </div>
          ) : null}
          <span className="shrink-0 text-[10.5px] tabular-nums text-text-faint">
            {currentRecording?.stepCount ?? 0}/200 步
          </span>
          {workflowDraft &&
          currentRecording?.status === 'stopped' &&
          workflowRecordingId.current === currentRecording.id &&
          currentSteps.length > 0 ? (
            <button
              type="button"
              data-testid="browser-workflow-submit"
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[10.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-45"
              disabled={busyAction === 'submit'}
              onClick={() => void submitWorkflow()}
            >
              {busyAction === 'submit' ? (
                <LoaderCircle className="animate-spin" size={12} />
              ) : (
                <ShieldCheck size={12} />
              )}
              提交审核
            </button>
          ) : null}
        </div>

        {feedback ? (
          <div
            data-testid="browser-recording-feedback"
            className={clsx(
              'mt-2 flex min-h-7 items-center justify-between gap-2 rounded-md border px-2.5 py-1 text-[10.5px]',
              feedback.kind === 'error'
                ? 'border-error/30 bg-error/10 text-error'
                : 'border-success/30 bg-success/10 text-success',
            )}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-hover"
              aria-label="关闭录制提示"
              onClick={() => setFeedback(undefined)}
            >
              <X size={11} />
            </button>
          </div>
        ) : null}
        {terminalNote ? (
          <div
            data-testid="browser-recording-terminal-note"
            className={clsx(
              'mt-2 rounded-md border px-2.5 py-1 text-[10.5px]',
              currentRecording?.status === 'failed'
                ? 'border-error/30 bg-error/10 text-error'
                : 'border-warning/30 bg-warning/10 text-warning',
            )}
          >
            {terminalNote}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading || snapshotLoading ? <RecordingListSkeleton /> : null}
        {!loading && !snapshotLoading && !currentRecording ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-elevated text-text-faint">
              <Radio size={18} />
            </div>
            <div className="mt-3 text-[13px] font-medium text-text">暂无录制</div>
          </div>
        ) : null}
        {!loading && !snapshotLoading && currentRecording && currentSteps.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-elevated text-text-faint">
              {isActiveRecording(currentRecording.status) ? (
                <Radio size={18} />
              ) : (
                <ListChecks size={18} />
              )}
            </div>
            <div className="mt-3 text-[13px] font-medium text-text">
              {isActiveRecording(currentRecording.status) ? '等待页面操作' : '没有录制步骤'}
            </div>
          </div>
        ) : null}
        {!loading && !snapshotLoading && currentSteps.length > 0 ? (
          <div className="px-4 py-2" data-testid="browser-recording-step-list">
            <div className="grid h-8 grid-cols-[34px_112px_minmax(0,1fr)_76px] items-center gap-3 border-b border-border px-2 text-[10.5px] font-medium text-text-faint">
              <span>#</span>
              <span>动作</span>
              <span>目标</span>
              <span>时间</span>
            </div>
            {currentSteps.map((record) => (
              <RecordingStepRow key={record.sequence} record={record} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecordingStepRow(props: { record: BrowserRecordingStepRecord }): JSX.Element {
  const presentation = recordingStepPresentation(props.record.step);
  const StepIcon = presentation.icon;
  return (
    <div
      data-testid={`browser-recording-step-${props.record.sequence}`}
      className="grid min-h-[58px] grid-cols-[34px_112px_minmax(0,1fr)_76px] items-center gap-3 border-b border-border px-2 last:border-b-0 hover:bg-hover"
    >
      <span className="text-[10.5px] tabular-nums text-text-faint">{props.record.sequence}</span>
      <div className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-text">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-text-secondary">
          <StepIcon size={13} />
        </span>
        <span className="truncate">{presentation.label}</span>
      </div>
      <div className="min-w-0 truncate text-[10.5px] text-text-secondary">
        {presentation.detail}
      </div>
      <span className="text-[10.5px] tabular-nums text-text-faint">
        {formatTime(props.record.recordedAt)}
      </span>
    </div>
  );
}

function RecordingListSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 px-6 py-4" aria-label="正在加载录制步骤">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-[58px] animate-pulse rounded-md bg-hover" />
      ))}
    </div>
  );
}

function recordingStepPresentation(step: BrowserRecordingStepInput): {
  label: string;
  detail: string;
  icon: typeof Navigation;
} {
  if (step.kind === 'navigate') {
    return { label: '打开页面', detail: boundedDisplayText(step.url), icon: Navigation };
  }
  const locator = formatRecordingLocator(step.locator);
  if (step.kind === 'click') {
    return {
      label: '点击',
      detail: joinStepDetail(locator, step.resultUrl ? `跳转 ${step.resultUrl}` : undefined),
      icon: MousePointerClick,
    };
  }
  if (step.kind === 'fill') {
    return {
      label: '填写',
      detail: joinStepDetail(locator, recordingValueText(step.value)),
      icon: TextCursorInput,
    };
  }
  if (step.kind === 'select') {
    return {
      label: '选择',
      detail: joinStepDetail(locator, recordingValueText(step.value)),
      icon: ListChecks,
    };
  }
  if (step.kind === 'check') {
    return {
      label: step.checked ? '勾选' : '取消勾选',
      detail: locator,
      icon: SquareCheckBig,
    };
  }
  return {
    label: '按下 Enter',
    detail: joinStepDetail(locator, step.resultUrl ? `跳转 ${step.resultUrl}` : undefined),
    icon: CornerDownLeft,
  };
}

function formatRecordingLocator(locator: BrowserRecordingLocator): string {
  if (locator.strategy === 'role') {
    return boundedDisplayText(
      locator.name ? `角色 ${locator.role}，名称 ${locator.name}` : `角色 ${locator.role}`,
    );
  }
  const labels: Record<Exclude<BrowserRecordingLocator['strategy'], 'role'>, string> = {
    'test-id': '测试标识',
    label: '标签',
    placeholder: '占位文本',
    id: 'ID',
    name: '名称',
    css: '选择器',
  };
  return boundedDisplayText(`${labels[locator.strategy]} ${locator.value}`);
}

function recordingValueText(
  value: Extract<BrowserRecordingStepInput, { kind: 'fill' | 'select' }>['value'],
): string {
  if (value.kind === 'secret') return '敏感值，运行时填写';
  if (value.kind === 'variable') return `变量 {{${value.name}}}`;
  return `固定值 ${boundedDisplayText(value.value)}`;
}

function joinStepDetail(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function boundedDisplayText(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function upsertRecording(
  current: BrowserRecordingSummary[],
  recording: BrowserRecordingSummary,
): BrowserRecordingSummary[] {
  const next = current.filter((candidate) => candidate.id !== recording.id);
  return [recording, ...next].slice(0, 20);
}

function isActiveRecording(status: BrowserRecordingStatus): boolean {
  return status === 'starting' || status === 'recording' || status === 'stopping';
}

function isAbnormalTerminalRecording(status: BrowserRecordingStatus): boolean {
  return status === 'failed' || status === 'interrupted';
}

function recordingStatus(status?: BrowserRecordingStatus): {
  label: string;
  className: string;
  icon: typeof Radio;
  spin?: boolean;
} {
  if (status === 'starting') {
    return { label: '正在启动', className: 'text-warning', icon: LoaderCircle, spin: true };
  }
  if (status === 'recording') {
    return { label: '录制中', className: 'text-error', icon: Radio };
  }
  if (status === 'stopping') {
    return { label: '正在停止', className: 'text-warning', icon: LoaderCircle, spin: true };
  }
  if (status === 'stopped') {
    return { label: '已停止', className: 'text-success', icon: Check };
  }
  if (status === 'failed') {
    return { label: '录制失败', className: 'text-error', icon: X };
  }
  if (status === 'interrupted') {
    return { label: '录制中断', className: 'text-warning', icon: CircleStop };
  }
  return { label: '未选择', className: 'text-text-faint', icon: History };
}

function formatRecordingOption(recording: BrowserRecordingSummary): string {
  const status = recordingStatus(recording.status).label;
  return `${formatDateTime(recording.createdAt)} · ${status} · ${recording.stepCount} 步`;
}

function recordingTerminalNote(recording: BrowserRecordingSummary): string | undefined {
  if (recording.stopReason === 'step_limit') return '已达到 200 步上限，录制自动停止。';
  if (recording.stopReason === 'page_closed') return '系统浏览器页面已关闭，本次录制已中断。';
  if (recording.stopReason === 'browser_closed') return '系统浏览器已退出，本次录制已中断。';
  if (recording.stopReason === 'runtime_restarted') return 'Runtime 曾重启，本次录制已中断。';
  if (recording.stopReason === 'start_failed') return '系统浏览器未完成启动，请检查后重新录制。';
  if (recording.stopReason === 'capture_failed') return '页面动作捕获失败，请重新录制。';
  return undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未知';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function SiteSessionRow(props: {
  session: BrowserSiteSessionSummary;
  disabled: boolean;
  onClear(): void;
}): JSX.Element {
  const status = sessionStatus(props.session.state);
  const StatusIcon = status.icon;
  return (
    <div
      data-testid={`browser-site-session-${props.session.siteKey}`}
      className="grid min-h-[62px] grid-cols-[minmax(0,1fr)_140px_96px_32px] items-center gap-3 border-b border-border px-2 last:border-b-0 hover:bg-hover"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-text-secondary">
          <Globe2 size={15} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-text">{props.session.siteKey}</div>
          <div className="mt-0.5 truncate text-[10.5px] text-text-faint">
            {props.session.origins.length} 个 origin · {props.session.cookieCount} Cookie ·{' '}
            {formatBytes(props.session.storageBytes)}
          </div>
        </div>
      </div>
      <div className={clsx('flex min-w-0 items-center gap-1.5 text-[11px]', status.className)}>
        <StatusIcon size={13} />
        <span className="truncate">{status.label}</span>
      </div>
      <div className="text-[10.5px] text-text-faint">
        {formatDateTime(props.session.lastCheckedAt)}
      </div>
      <IconButton
        label={props.disabled ? 'Profile 使用中' : `清除 ${props.session.siteKey} 会话`}
        disabled={props.disabled}
        testId={`browser-site-session-clear-${props.session.siteKey}`}
        danger
        onClick={props.onClear}
      >
        <Trash2 size={13} />
      </IconButton>
    </div>
  );
}

function ConfirmDialog(props: {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}): JSX.Element {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[210] bg-[color-mix(in_srgb,var(--color-page)_68%,transparent)] backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[211] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-overlay p-4 shadow-xl focus:outline-none">
          <Dialog.Title className="text-[14px] font-semibold text-text">{props.title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-2 text-[11.5px] leading-5 text-text-secondary">{props.children}</div>
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="h-8 rounded-md border border-border bg-surface px-3 text-[11.5px] font-medium text-text-secondary hover:bg-hover disabled:opacity-45"
                disabled={props.busy}
              >
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-testid="browser-confirm-danger"
              className="flex h-8 items-center gap-1.5 rounded-md bg-error px-3 text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-45"
              disabled={props.busy || props.disabled}
              onClick={props.onConfirm}
            >
              {props.busy ? (
                <LoaderCircle className="animate-spin" size={13} />
              ) : (
                <Trash2 size={13} />
              )}
              {props.confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function IconButton(props: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={props.testId}
      className={clsx(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-hover disabled:cursor-not-allowed disabled:opacity-35',
        props.danger ? 'text-text-faint hover:text-error' : 'text-text-secondary hover:text-text',
      )}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

function ProfileListSkeleton(): JSX.Element {
  return (
    <div className="space-y-1 px-1 py-1" aria-label="正在加载 Profile">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-[54px] animate-pulse rounded-md bg-hover" />
      ))}
    </div>
  );
}

function SessionListSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 px-6 py-4" aria-label="正在加载站点会话">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-[62px] animate-pulse rounded-md bg-hover" />
      ))}
    </div>
  );
}

function sessionStatus(state: BrowserSiteSessionState): {
  label: string;
  className: string;
  icon: typeof ShieldCheck;
} {
  if (state === 'verified') {
    return { label: '已验证登录', className: 'text-success', icon: ShieldCheck };
  }
  if (state === 'reauth_required') {
    return { label: '需要重新登录', className: 'text-warning', icon: KeyRound };
  }
  return { label: '存在会话数据', className: 'text-text-secondary', icon: Database };
}

function formatProfileActivity(value?: string): string {
  return value ? `最近 ${formatDateTime(value)}` : '尚未使用';
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatStorageTypes(types: readonly string[]): string {
  const labels: Record<string, string> = {
    cookies: 'Cookie',
    local_storage: 'LocalStorage',
    indexed_db: 'IndexedDB',
    cache_storage: 'Cache Storage',
    service_workers: 'Service Worker',
  };
  return types.map((type) => labels[type] ?? type).join('、') || '站点存储';
}

function originHostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return '';
  }
}

function browserProfileErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/request timed out: browser\.profile/i.test(message)) {
    return '浏览器启动或 Profile 维护超时，请确认系统浏览器可用后重试。';
  }
  if (/Storage\.clearDataForOrigin|profile[-_. ]site[-_. ]clear/i.test(message)) {
    return '系统浏览器未能清除站点数据，请关闭该 Profile 的浏览器窗口后重试。';
  }
  if (isProfileWorkflowReferenceError(error)) {
    return '该 Profile 仍被自动化任务引用，当前需要保留。任务完成重绑或归档后才能删除。';
  }
  if (/profile[-_. ]in[-_. ]use/i.test(message))
    return 'Profile 正在被任务使用，请先结束任务或人工接管。';
  if (/revision[-_. ]conflict/i.test(message)) return 'Profile 已被其他操作更新，请刷新后重试。';
  if (/default[-_. ]profile[-_. ]immutable/i.test(message))
    return '默认 Profile 受保护，不能删除。';
  if (/site[-_. ]session[-_. ]not[-_. ]found/i.test(message))
    return '站点会话已变化，请刷新后重试。';
  if (/profile[-_. ]not[-_. ]found/i.test(message)) return 'Profile 已不存在，请刷新列表。';
  return message.trim() || '浏览器 Profile 操作失败，请稍后重试。';
}

function isProfileWorkflowReferenceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /profile[-_. ]has[-_. ]workflows/i.test(message);
}

function browserRecordingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/request timed out: browser\.recording/i.test(message)) {
    return '系统浏览器启动或停止录制超时，请确认浏览器状态后重试。';
  }
  if (/profile[-_. ]in[-_. ]use|recording[-_. ]profile[-_. ]in[-_. ]use/i.test(message)) {
    return 'Profile 正在被其他任务使用，请先结束当前操作。';
  }
  if (/revision[-_. ]conflict/i.test(message)) return 'Profile 已更新，请刷新后重新开始录制。';
  if (/recording[-_. ]not[-_. ]found/i.test(message)) return '录制记录已不存在，请重新选择。';
  if (/recording[-_. ]host[-_. ]unavailable|recording[-_. ]unsupported/i.test(message)) {
    return '当前系统浏览器不支持语义录制，请确认 Edge 或 Chrome 可用。';
  }
  if (/recording[-_. ]conflict|already[-_. ]started/i.test(message)) {
    return '该 Profile 已有进行中的录制。';
  }
  return message.trim() || '浏览器录制操作失败，请稍后重试。';
}

function browserWorkflowErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/workflow-not-found|not[-_. ]found/i.test(message)) {
    return '自动化任务或草稿已不存在，请刷新后重试。';
  }
  if (/workflow-conflict|state[-_. ]conflict|not[-_. ]stopped/i.test(message)) {
    return '当前录制还不能提交，请确认录制已停止且包含有效步骤。';
  }
  if (/request timed out: browser\.workflow/i.test(message)) {
    return '提交审核超时，请确认 Runtime 正常后重试。';
  }
  return message || '自动化任务操作失败，请重试。';
}

function browserRuntime(): NonNullable<Window['syncThink']>['runtime'] {
  const runtime = window.syncThink?.runtime;
  if (!runtime) throw new Error('浏览器 Runtime 尚未连接。');
  return runtime;
}
