import { TaskSelect } from './TaskSelect.js';
import { ProfileCreateDialog } from './ProfileCreateDialog.js';
import { useEffect, useState } from 'react';
import type {
  BrowserAutomationTaskSummary,
  BrowserProfileSummary,
  GetBrowserWorkflowResponse,
} from '@sync-think/protocol';
import type {
  CollaborationCommand,
  CollaborationSnapshot,
  ScheduledTask,
  WorkspaceId,
} from '@sync-think/shared';
import { BrowserHandoffCard, BrowserHandoffQueryError } from './BrowserHandoffCard.js';
import { useBrowserHandoffs } from './use-browser-handoffs.js';

export function GroupBrowserSettings({
  snapshot,
  busy,
  onCommand,
  section = 'all',
}: {
  snapshot: CollaborationSnapshot;
  section?: 'all' | 'browser' | 'schedules';
  busy: boolean;
  onCommand(command: CollaborationCommand): unknown;
}) {
  const [profiles, setProfiles] = useState<BrowserProfileSummary[]>([]);
  const [flows, setFlows] = useState<BrowserAutomationTaskSummary[]>([]);
  const [detail, setDetail] = useState<GetBrowserWorkflowResponse>();
  const [variables, setVariables] = useState<Record<string, string>>(
    snapshot.conversation.policy.browserWorkflowVariables ?? {},
  );
  const [minutes, setMinutes] = useState(60);
  const [instruction, setInstruction] = useState(snapshot.conversation.room?.goal ?? '');
  const [schedules, setSchedules] = useState<ScheduledTask[]>([]);
  const [error, setError] = useState('');
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const policy = snapshot.conversation.policy;
  const profileId = policy.browserProfileId ?? 'default';
  useEffect(() => {
    const api = window.syncThink?.runtime;
    setInstruction(snapshot.conversation.room?.goal ?? '');
    setMinutes(60);
    setSchedules([]);
    setError('');
    let disposed = false;
    Promise.all([
      api?.listBrowserProfiles?.(),
      api?.browserWorkflow?.list?.({}),
      api?.listScheduledTasks?.({}),
    ])
      .then(([p, f, s]) => {
        if (disposed) return;
        setProfiles(p?.profiles ?? []);
        setFlows(f?.tasks ?? []);
        setSchedules(
          (s?.tasks ?? []).filter((task) => task.conversationId === snapshot.conversation.id),
        );
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
    };
  }, [snapshot.conversation.id]);
  useEffect(() => {
    let disposed = false;
    setDetail(undefined);
    setVariables(policy.browserWorkflowVariables ?? {});
    if (policy.browserWorkflowTaskId)
      window.syncThink?.runtime?.browserWorkflow
        ?.get({ taskId: policy.browserWorkflowTaskId })
        .then((value) => {
          if (!disposed) setDetail(value);
        })
        .catch((cause) => {
          if (!disposed) setError(String(cause));
        });
    return () => {
      disposed = true;
    };
  }, [snapshot.conversation.id, policy.browserWorkflowTaskId, policy.browserWorkflowVariables]);
  const names = [
    ...new Set(
      detail?.version?.steps.flatMap((step) =>
        (step.kind === 'fill' || step.kind === 'select') && step.value.kind === 'variable'
          ? [step.value.name]
          : [],
      ) ?? [],
    ),
  ];
  const saveSchedule = async () => {
    const api = window.syncThink?.runtime;
    const coordinator = snapshot.members.find(
      (member) => member.id === snapshot.conversation.coordinatorMemberId,
    );
    if (!api?.createScheduledTask || !coordinator?.agentId) {
      setError('请先指定可执行的协调员，并连接定时任务服务。');
      return;
    }
    if (!instruction.trim() || minutes < 5 || minutes > 10080) {
      setError('填写监控目标，间隔需为 5–10080 分钟。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await api.createScheduledTask({
        name: snapshot.conversation.title + ' · 定时监控',
        instruction: instruction.trim(),
        target: { kind: 'agent', agentId: coordinator.agentId },
        rule: { kind: 'every', intervalMinutes: minutes },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        workspaceId: snapshot.conversation.workspaceId,
        collaborationConversationId: snapshot.conversation.id,
        enabled: true,
      });
      setSchedules((current) => [...current, result.task]);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-label="群聊浏览器与监控" className="collab-automation-settings">
      <div hidden={section === 'schedules'}>
        <label className="collab-field">
          浏览器账号 Profile
          <TaskSelect
            aria-label="群聊浏览器 Profile"
            value={profileId}
            disabled={busy || saving}
            onChange={(event) =>
              onCommand({
                action: 'policy',
                conversationId: snapshot.conversation.id,
                policy: {
                  browserProfileId: event.target.value,
                  browserWorkflowTaskId: '',
                  browserWorkflowVariables: {},
                },
              })
            }
          >
            {!profiles.some((profile) => profile.id === profileId) && (
              <option value={profileId}>
                {profileId === 'default' ? '默认浏览器' : profileId}
              </option>
            )}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </TaskSelect>
          <small>
            同类任务复用这一份登录态；登录过期时只暂停相关任务。普通 Chrome 的其他账号窗口不等于此
            Profile。
          </small>
        </label>
        <label className="collab-field">
          复用已发布操作流程
          <TaskSelect
            aria-label="群聊复用流程"
            value={policy.browserWorkflowTaskId ?? ''}
            disabled={busy || saving}
            onChange={(event) =>
              onCommand({
                action: 'policy',
                conversationId: snapshot.conversation.id,
                policy: { browserWorkflowTaskId: event.target.value, browserWorkflowVariables: {} },
              })
            }
          >
            <option value="">不绑定，由协调员根据目标安排</option>
            {flows
              .filter(
                (flow) =>
                  flow.status === 'enabled' &&
                  flow.profileId === profileId &&
                  (!flow.workspaceId || flow.workspaceId === snapshot.conversation.workspaceId),
              )
              .map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name}
                </option>
              ))}
          </TaskSelect>
          <small>操作流程用于复用网页步骤，不替代小队的动态协作，也不代表目标已经验收。</small>
        </label>
        {names.map((name) => (
          <label className="collab-field" key={name}>
            参数：{name}
            <input
              aria-label={'流程参数 ' + name}
              value={variables[name] ?? ''}
              onChange={(event) =>
                setVariables((current) => ({ ...current, [name]: event.target.value }))
              }
              onBlur={() =>
                onCommand({
                  action: 'policy',
                  conversationId: snapshot.conversation.id,
                  policy: { browserWorkflowVariables: variables },
                })
              }
            />
          </label>
        ))}
        <button
          type="button"
          className="task-experience-inline"
          disabled={busy || saving}
          onClick={() => setCreatingProfile(true)}
        >
          ＋ 新建 Profile
        </button>
      </div>
      <details open={section === 'schedules'} hidden={section === 'browser'}>
        <summary>定时监控 · 在本群执行</summary>
        <p className="task-experience-note">
          周期触发当前协调员，在本群继续工作；继承本群的
          Profile、网页流程、权限和联网设置。表格等交付要求请写进监控目标。复杂的结构化验收、MCP /
          Gmail 交付在定时任务中心配置。
        </p>
        <label className="collab-field">
          监控目标
          <textarea
            aria-label="定时监控目标"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        <label className="collab-field">
          间隔（分钟）
          <input
            aria-label="定时监控间隔"
            type="number"
            min={5}
            max={10080}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
        </label>
        <button
          className="collab-link"
          disabled={busy || saving || schedules.some((task) => task.enabled)}
          onClick={() => void saveSchedule()}
        >
          启用本群定时监控
        </button>
        <small>任务忙、等待登录或本群暂停时合并跳过，不新建另一个群聊，不以入队视为完成。</small>
        {schedules.map((task) => (
          <div key={task.id} className="collab-toolbar">
            <span>
              {task.name} · {task.enabled ? '已启用' : '已暂停'}
            </span>
            <button
              className="collab-link"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const response = await window.syncThink!.runtime.updateScheduledTask({
                    taskId: task.id,
                    patch: { enabled: !task.enabled },
                  });
                  setSchedules((current) =>
                    current.map((item) => (item.id === task.id ? response.task : item)),
                  );
                } catch (cause) {
                  setError(String(cause));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {task.enabled ? '暂停监控' : '恢复监控'}
            </button>
          </div>
        ))}
      </details>
      {creatingProfile && (
        <ProfileCreateDialog
          onClose={() => setCreatingProfile(false)}
          onCreated={(profile) => {
            setProfiles((current) => [
              ...current.filter((item) => item.id !== profile.id),
              profile,
            ]);
            onCommand({
              action: 'policy',
              conversationId: snapshot.conversation.id,
              policy: {
                browserProfileId: profile.id,
                browserWorkflowTaskId: '',
                browserWorkflowVariables: {},
              },
            });
            setCreatingProfile(false);
          }}
        />
      )}
      {error && (
        <p role="alert" className="collab-notice">
          {error}
        </p>
      )}
    </section>
  );
}

export function GroupBrowserHandoffs({
  snapshot,
  active,
}: {
  snapshot?: CollaborationSnapshot;
  active: boolean;
}) {
  const { handoffs, status, busyId, queryError, actionError, refresh, decide } = useBrowserHandoffs(
    {
      identity: snapshot?.conversation.id ?? '',
      enabled: active && Boolean(snapshot?.conversation.id),
      conversationId: snapshot?.conversation.id,
      workspaceId: snapshot?.conversation.workspaceId as WorkspaceId | undefined,
      refreshRevision: snapshot?.revision,
    },
  );
  return (
    <>
      {active && queryError && (
        <BrowserHandoffQueryError
          error={queryError}
          busy={status === 'loading' || Boolean(busyId)}
          onRetry={() => void refresh()}
        />
      )}
      {active && actionError && handoffs.length === 0 && <p role="alert">{actionError}</p>}
      {handoffs.map((handoff) => (
        <div key={handoff.handoffId} data-testid="group-browser-login-handoff">
          <small>本群 Profile：{handoff.profileId ?? 'default'} · 原任务尚未完成</small>
          <BrowserHandoffCard
            handoff={handoff}
            busy={Boolean(busyId)}
            error={actionError}
            onContinue={() => void decide(handoff, 'continue')}
            onCancel={() => void decide(handoff, 'cancel')}
          />
        </div>
      ))}
    </>
  );
}
