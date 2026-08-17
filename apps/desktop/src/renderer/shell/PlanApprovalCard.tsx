/**
 * 方案卡（可编辑审批卡）——plan/exec 流程的核心 UI。
 *
 * 生命周期：规划模型 plan_submit → draft 出现 → 用户直接在卡片上编辑
 * （标题/目标/范围/假设/决策/步骤/风险/总验收）→「保存修改」走
 * conversation.plan.revise 生成新版本 →「批准并执行」→ 执行模型执行。
 *
 * 规则：
 *  - 有未保存改动时「批准并执行」禁用（先保存为新版本再批准）；
 *  - 版本历史可回看（只读），返回最新版本恢复编辑；
 *  - 「要求修改」切回规划模式让模型重新出方案。
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, History, LoaderCircle, Plus, Save, Trash2, X } from 'lucide-react';
import type {
  ChatPlanRevision,
  ChatPlanStep,
  ChatPlanSubmission,
  ConversationId,
  ConversationPlanSummary,
} from '@sync-think/shared';

export interface PlanApprovalCardProps {
  conversationId: ConversationId;
  /** 当前会话的计划聚合（draft 状态时渲染本卡）。 */
  plan: ConversationPlanSummary;
  /** 计划变化后回写（保存修订后更新、批准/取消后清除）。 */
  onPlanUpdated(plan: ConversationPlanSummary | undefined): void;
  /** 批准后发出执行指令（ChatView.sendUserText）。 */
  onExecute(instruction: string): void | Promise<void>;
  /** 切换对话交互模式（plan/execute）。 */
  onSwitchMode(mode: 'plan' | 'execute'): void | Promise<void>;
  /** 操作反馈（信息/错误提示条）。 */
  onNotify(tone: 'info' | 'error', text: string): void;
}

function bridge() {
  return window.syncThink?.runtime;
}

/**
 * Build the user-turn instruction that starts the execution run for an
 * approved conversation plan. The full plan is embedded so the executing
 * kernel never needs to re-read it, and the revision id is pinned.
 */
export function buildPlanExecutionInstruction(plan: ChatPlanRevision, revision: number): string {
  const summary = plan.plan.steps
    .map((step, index) => `${index + 1}. ${step.title}（验收：${step.acceptanceChecks.length} 项）`)
    .join('\n');
  return [
    `【执行已批准计划 v${revision}】`,
    `计划：${plan.plan.title}`,
    `目标：${plan.plan.goal}`,
    '',
    `步骤概览：\n${summary}`,
    '',
    '请严格按以下已批准计划执行，每步完成后按该步验收标准自检，最终按总验收标准逐项核对；如发现计划不再适用，暂停并说明偏差，不要擅自扩大范围。',
    '',
    `【已批准计划 v${revision} 全文】`,
    JSON.stringify(plan.plan, null, 2),
  ].join('\n');
}

function clonePlan(plan: ChatPlanSubmission): ChatPlanSubmission {
  return {
    title: plan.title,
    goal: plan.goal,
    scope: [...(plan.scope ?? [])],
    assumptions: [...(plan.assumptions ?? [])],
    decisions: [...(plan.decisions ?? [])],
    steps: (plan.steps ?? []).map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      expectedFiles: [...(step.expectedFiles ?? [])],
      acceptanceChecks: [...(step.acceptanceChecks ?? [])],
    })),
    risks: (plan.risks ?? []).map((risk) => ({
      description: risk.description,
      mitigation: risk.mitigation,
    })),
    finalAcceptanceChecks: [...(plan.finalAcceptanceChecks ?? [])],
  };
}

function planEqual(left: ChatPlanSubmission, right: ChatPlanSubmission): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nextStepId(steps: readonly ChatPlanStep[]): string {
  const used = new Set(steps.map((step) => String(step.id)));
  let index = steps.length + 1;
  while (used.has(`step-${index}`)) index += 1;
  return `step-${index}`;
}

export function PlanApprovalCard({
  conversationId,
  plan,
  onPlanUpdated,
  onExecute,
  onSwitchMode,
  onNotify,
}: PlanApprovalCardProps) {
  const latest = plan.latest;
  const [draft, setDraft] = useState<ChatPlanSubmission>(() => clonePlan(latest.plan));
  const [viewingRevision, setViewingRevision] = useState<number | null>(null);
  const [action, setAction] = useState<'save' | 'approve' | 'cancel' | null>(null);

  // 新版本（保存修订后 / 会话切换后）到来时，以最新版为编辑底稿。
  useEffect(() => {
    setDraft(clonePlan(latest.plan));
    setViewingRevision(null);
  }, [latest.id, latest.revision, latest.plan]);

  const revisions = useMemo(
    () => [...plan.revisions].sort((left, right) => right.revision - left.revision),
    [plan.revisions],
  );
  const viewing =
    viewingRevision === null
      ? latest
      : (plan.revisions.find((item) => item.revision === viewingRevision) ?? latest);
  const editable = plan.state === 'draft' && viewingRevision === null;
  const dirty = editable && !planEqual(draft, latest.plan);
  const valid =
    draft.title.trim().length > 0 &&
    draft.steps.length > 0 &&
    draft.steps.every((step) => step.title.trim().length > 0 && step.description.trim().length > 0);
  const busy = action !== null;

  const notifyError = (raw: unknown, fallback: string) => {
    onNotify('error', `${fallback}: ${raw instanceof Error ? raw.message : String(raw)}`);
  };

  const handleSave = async () => {
    if (!editable || !dirty || !valid || busy) return;
    const api = bridge();
    if (!api?.conversationPlanRevise) {
      onNotify('error', '保存失败: Runtime 未连接');
      return;
    }
    setAction('save');
    try {
      const res = await api.conversationPlanRevise({
        conversationId,
        expectedRevision: latest.revision,
        plan: draft,
      });
      onPlanUpdated(res.plan);
    } catch (error) {
      notifyError(error, '保存计划失败');
    } finally {
      setAction(null);
    }
  };

  const handleApprove = async () => {
    if (!editable || dirty || busy) return;
    const api = bridge();
    if (!api?.conversationPlanApprove) {
      onNotify('error', '批准失败: Runtime 未连接');
      return;
    }
    setAction('approve');
    try {
      const rev = latest.revision;
      await api.conversationPlanApprove({ conversationId, revision: rev });
      await onSwitchMode('execute');
      await onExecute(buildPlanExecutionInstruction(latest, rev));
      onPlanUpdated(undefined);
    } catch (error) {
      notifyError(error, '批准计划失败');
    } finally {
      setAction(null);
    }
  };

  const handleCancel = async () => {
    if (busy) return;
    const api = bridge();
    if (!api?.conversationPlanCancel) {
      onNotify('error', '取消失败: Runtime 未连接');
      return;
    }
    setAction('cancel');
    try {
      await api.conversationPlanCancel({ conversationId });
      onPlanUpdated(undefined);
    } catch (error) {
      notifyError(error, '取消计划失败');
    } finally {
      setAction(null);
    }
  };

  const handleRequestChanges = async () => {
    if (busy) return;
    await onSwitchMode('plan');
    onNotify('info', '已切回规划模式。请描述需要修改的地方，模型将修订计划并生成新版本');
  };

  const isHistory = viewingRevision !== null;
  /** 编辑态渲染 draft（未保存改动即时回显）；历史回看渲染该版本内容（只读）。 */
  const editorPlan = editable ? draft : viewing.plan;

  return (
    <section className="shell-plan-card" data-testid="plan-approval-card" aria-label="执行方案">
      <header className="shell-plan-card__head">
        <div className="shell-plan-card__title-wrap">
          {editable ? (
            <input
              className="shell-plan-card__title-input"
              aria-label="计划标题"
              value={draft.title}
              disabled={busy}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
          ) : (
            <span className="shell-plan-card__title">{viewing.plan.title || '执行方案'}</span>
          )}
          <span className="shell-plan-card__rev">v{viewing.revision}</span>
        </div>
        <div className="shell-plan-card__history" role="group" aria-label="版本历史">
          <History size={12} aria-hidden="true" />
          {revisions.map((item) => {
            const active = item.revision === (viewingRevision ?? latest.revision);
            return (
              <button
                key={item.revision}
                type="button"
                className="shell-plan-card__rev-chip"
                data-active={active ? '1' : '0'}
                disabled={busy}
                onClick={() =>
                  item.revision === latest.revision
                    ? setViewingRevision(null)
                    : setViewingRevision(item.revision)
                }
                title={
                  item.revision === latest.revision
                    ? '最新版本'
                    : `查看历史版本 v${item.revision}（只读）`
                }
              >
                v{item.revision}
              </button>
            );
          })}
        </div>
      </header>

      {isHistory ? (
        <p className="shell-plan-card__note" data-testid="plan-history-note" role="status">
          正在查看历史版本 v{viewing.revision}（只读）。点击「返回编辑最新版本」继续修改。
        </p>
      ) : null}
      {dirty ? (
        <p className="shell-plan-card__note" data-testid="plan-dirty-note" role="status">
          当前修改尚未保存。请先「保存修改」生成新版本，再批准执行。
        </p>
      ) : null}
      {!valid && editable ? (
        <p className="shell-plan-card__note is-warn" role="alert">
          计划标题、至少一个步骤（含标题与描述）为必填。
        </p>
      ) : null}

      <div className="shell-plan-card__body">
        <label className="shell-plan-card__field">
          <span>目标</span>
          <textarea
            rows={2}
            aria-label="计划目标"
            value={editorPlan.goal}
            disabled={!editable || busy}
            onChange={(event) =>
              setDraft((current) => ({ ...current, goal: event.target.value }))
            }
          />
        </label>

        <div className="shell-plan-card__grid">
          <StringListEditor
            label="范围"
            items={editorPlan.scope}
            disabled={!editable || busy}
            onChange={(items) => setDraft((current) => ({ ...current, scope: items }))}
          />
          <StringListEditor
            label="假设"
            items={editorPlan.assumptions}
            disabled={!editable || busy}
            onChange={(items) => setDraft((current) => ({ ...current, assumptions: items }))}
          />
          <StringListEditor
            label="决策"
            items={editorPlan.decisions}
            disabled={!editable || busy}
            onChange={(items) => setDraft((current) => ({ ...current, decisions: items }))}
          />
        </div>

        <div className="shell-plan-card__steps">
          <span className="shell-plan-card__section-label">步骤</span>
          {editorPlan.steps.map((step, index) => (
            <div className="shell-plan-card__step-editor" key={String(step.id)}>
              <div className="shell-plan-card__step-editor-head">
                <span className="shell-plan-card__step-no">{String(index + 1).padStart(2, '0')}</span>
                <input
                  aria-label={`步骤 ${index + 1} 标题`}
                  value={step.title}
                  disabled={!editable || busy}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      steps: current.steps.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, title: event.target.value } : item,
                      ),
                    }))
                  }
                />
                <button
                  type="button"
                  className="shell-plan-card__icon-btn"
                  aria-label={`删除步骤 ${index + 1}`}
                  title="删除步骤"
                  disabled={!editable || busy || editorPlan.steps.length === 1}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      steps: current.steps.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <textarea
                rows={2}
                aria-label={`步骤 ${index + 1} 描述`}
                placeholder="描述此步骤要做的事"
                value={step.description}
                disabled={!editable || busy}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    steps: current.steps.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, description: event.target.value } : item,
                    ),
                  }))
                }
              />
              <div className="shell-plan-card__step-lists">
                <StringListEditor
                  label="验收标准"
                  items={step.acceptanceChecks}
                  disabled={!editable || busy}
                  onChange={(items) =>
                    setDraft((current) => ({
                      ...current,
                      steps: current.steps.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, acceptanceChecks: items } : item,
                      ),
                    }))
                  }
                />
                <StringListEditor
                  label="期望文件"
                  items={step.expectedFiles ?? []}
                  disabled={!editable || busy}
                  onChange={(items) =>
                    setDraft((current) => ({
                      ...current,
                      steps: current.steps.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, expectedFiles: items } : item,
                      ),
                    }))
                  }
                />
              </div>
            </div>
          ))}
          {editable ? (
            <button
              type="button"
              className="shell-plan-card__add"
              disabled={busy}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  steps: [
                    ...current.steps,
                    {
                      id: nextStepId(current.steps),
                      title: '',
                      description: '',
                      expectedFiles: [],
                      acceptanceChecks: [],
                    },
                  ],
                }))
              }
            >
              <Plus size={12} /> 添加步骤
            </button>
          ) : null}
        </div>

        <div className="shell-plan-card__risks">
          <span className="shell-plan-card__section-label">风险</span>
          {editorPlan.risks.map((risk, index) => (
            <div className="shell-plan-card__risk-row" key={`${index}-${risk.description}`}>
              <input
                aria-label={`风险 ${index + 1} 描述`}
                placeholder="风险描述"
                value={risk.description}
                disabled={!editable || busy}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    risks: current.risks.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, description: event.target.value } : item,
                    ),
                  }))
                }
              />
              <input
                aria-label={`风险 ${index + 1} 缓解`}
                placeholder="缓解措施"
                value={risk.mitigation}
                disabled={!editable || busy}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    risks: current.risks.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, mitigation: event.target.value } : item,
                    ),
                  }))
                }
              />
              <button
                type="button"
                className="shell-plan-card__icon-btn"
                aria-label={`删除风险 ${index + 1}`}
                disabled={!editable || busy}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    risks: current.risks.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {editable ? (
            <button
              type="button"
              className="shell-plan-card__add"
              disabled={busy}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  risks: [...current.risks, { description: '', mitigation: '' }],
                }))
              }
            >
              <Plus size={12} /> 添加风险
            </button>
          ) : null}
        </div>

        <StringListEditor
          label="总验收标准"
          items={editorPlan.finalAcceptanceChecks}
          disabled={!editable || busy}
          onChange={(items) => setDraft((current) => ({ ...current, finalAcceptanceChecks: items }))}
        />
      </div>

      <div className="shell-plan-card__actions">
        {isHistory ? (
          <button
            type="button"
            className="shell-plan-card__secondary"
            disabled={busy}
            onClick={() => setViewingRevision(null)}
          >
            返回编辑最新版本
          </button>
        ) : (
          <button
            type="button"
            className="shell-plan-card__secondary"
            data-testid="plan-save"
            disabled={!editable || !dirty || !valid || busy}
            onClick={() => void handleSave()}
          >
            {action === 'save' ? <LoaderCircle size={14} className="shell-process-spin" /> : <Save size={14} />}
            保存修改
          </button>
        )}
        <button
          type="button"
          className="shell-plan-card__approve"
          data-testid="plan-approve"
          disabled={!editable || dirty || busy}
          onClick={() => void handleApprove()}
        >
          {action === 'approve' ? <LoaderCircle size={14} className="shell-process-spin" /> : <Check size={15} />}
          批准并执行 v{latest.revision}
        </button>
        <button
          type="button"
          className="shell-plan-card__revise"
          disabled={busy}
          onClick={() => void handleRequestChanges()}
        >
          要求修改
        </button>
        <button
          type="button"
          className="shell-plan-card__cancel"
          disabled={busy}
          onClick={() => void handleCancel()}
        >
          {action === 'cancel' ? '取消中…' : '取消计划'}
        </button>
      </div>
    </section>
  );
}

/** 字符串列表编辑器（范围/假设/决策/验收标准/期望文件/总验收）。 */
function StringListEditor({
  label,
  items,
  disabled,
  onChange,
}: {
  label: string;
  items: readonly string[];
  disabled: boolean;
  onChange(items: string[]): void;
}) {
  const list = items ?? [];
  return (
    <div className="shell-plan-card__list">
      <span className="shell-plan-card__section-label">{label}</span>
      {list.map((item, index) => (
        <div className="shell-plan-card__tag-row" key={`${label}-${index}`}>
          <input
            aria-label={`${label} ${index + 1}`}
            value={item}
            disabled={disabled}
            onChange={(event) =>
              onChange(list.map((value, valueIndex) => (valueIndex === index ? event.target.value : value)))
            }
          />
          <button
            type="button"
            className="shell-plan-card__icon-btn"
            aria-label={`删除${label}项 ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(list.filter((_, valueIndex) => valueIndex !== index))}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {!disabled ? (
        <button
          type="button"
          className="shell-plan-card__add"
          disabled={disabled}
          onClick={() => onChange([...list, ''])}
        >
          <Plus size={12} /> 添加
        </button>
      ) : null}
    </div>
  );
}
