import { useEffect, useMemo, useState } from 'react';
import type { PlanRevision, PlanStepDraft } from '@sync-think/shared';
import { Check, ChevronRight, Clock3, GitCompareArrows, Plus, Save, Trash2 } from 'lucide-react';

export interface PlanReviseInput {
  planId: string;
  expectedRevision: number;
  title: string;
  steps: PlanStepDraft[];
}

export interface PlanApproveInput {
  planId: string;
  revision: number;
}

export interface PlanRevisionPanelProps {
  revision: PlanRevision;
  revisions: readonly PlanRevision[];
  busy?: boolean;
  error?: string | null;
  onRevise?: (input: PlanReviseInput) => void | Promise<void>;
  onApprove?: (input: PlanApproveInput) => void | Promise<void>;
  onSelectRevision?: (revision: number) => void;
}

const STATE_LABEL: Record<PlanRevision['state'], string> = {
  draft: '草稿',
  approved: '已批准',
  superseded: '历史版本',
};

function cloneSteps(steps: readonly PlanStepDraft[]): PlanStepDraft[] {
  return steps.map((step) => ({ ...step, dependsOn: [...step.dependsOn] }));
}

function nextStepId(steps: readonly PlanStepDraft[]): string {
  const used = new Set(steps.map((step) => String(step.id)));
  let index = steps.length + 1;
  while (used.has(`step-${index}`)) index += 1;
  return `step-${index}`;
}

function normalizedSteps(steps: readonly PlanStepDraft[]) {
  return steps.map((step) => ({
    id: String(step.id),
    kind: step.kind ?? 'execution',
    title: step.title,
    instructions: step.instructions,
    agentVersionId: String(step.agentVersionId),
    modelOverrideId: step.modelOverrideId ? String(step.modelOverrideId) : null,
    dependsOn: step.dependsOn.map(String),
  }));
}

export function PlanRevisionPanel({
  revision,
  revisions,
  busy = false,
  error,
  onRevise,
  onApprove,
  onSelectRevision,
}: PlanRevisionPanelProps) {
  const [title, setTitle] = useState(revision.title);
  const [steps, setSteps] = useState<PlanStepDraft[]>(() => cloneSteps(revision.steps));

  useEffect(() => {
    setTitle(revision.title);
    setSteps(cloneSteps(revision.steps));
  }, [revision.id, revision.revision, revision.steps, revision.title]);

  const orderedRevisions = useMemo(
    () => [...revisions].sort((left, right) => right.revision - left.revision),
    [revisions],
  );
  const editable = revision.state === 'draft' && Boolean(onRevise);
  const dirty =
    title !== revision.title ||
    JSON.stringify(normalizedSteps(steps)) !== JSON.stringify(normalizedSteps(revision.steps));
  const stepIds = new Set(steps.map((step) => String(step.id)));
  const valid =
    title.trim().length > 0 &&
    steps.length > 0 &&
    steps.every((step) => {
      const id = String(step.id);
      const dependencies = step.dependsOn.map(String);
      return (
        id.trim().length > 0 &&
        step.title.trim().length > 0 &&
        step.instructions.trim().length > 0 &&
        String(step.agentVersionId).trim().length > 0 &&
        dependencies.every((dependency) => dependency !== id && stepIds.has(dependency)) &&
        new Set(dependencies).size === dependencies.length &&
        ((step.kind ?? 'execution') !== 'merge' || dependencies.length >= 2)
      );
    });

  const updateStep = (index: number, patch: Partial<PlanStepDraft>) => {
    setSteps((current) =>
      current.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)),
    );
  };

  const addStep = () => {
    const id = nextStepId(steps);
    setSteps((current) => [
      ...current,
      {
        id: id as PlanStepDraft['id'],
        kind: 'execution',
        title: '新步骤',
        instructions: '描述此步骤的可交付结果。',
        agentVersionId: '' as PlanStepDraft['agentVersionId'],
        dependsOn: [],
      },
    ]);
  };

  const removeStep = (index: number) => {
    const removedId = String(steps[index]?.id ?? '');
    setSteps((current) =>
      current
        .filter((_, stepIndex) => stepIndex !== index)
        .map((step) => ({
          ...step,
          dependsOn: step.dependsOn.filter((dependency) => String(dependency) !== removedId),
        })),
    );
  };

  return (
    <section className="st-plan" data-testid="plan-editor" aria-label="执行计划">
      <header className="st-plan__header">
        <div className="st-plan__identity">
          <span className="st-plan__kicker">执行计划</span>
          <div className="st-plan__title-row">
            <strong>版本 {revision.revision}</strong>
            <span data-state={revision.state}>{STATE_LABEL[revision.state]}</span>
          </div>
        </div>
        <div className="st-plan__actions">
          <button
            type="button"
            className="st-plan__secondary"
            onClick={addStep}
            disabled={!editable || busy}
          >
            <Plus aria-hidden="true" size={14} />
            添加步骤
          </button>
          <button
            type="button"
            className="st-plan__secondary"
            disabled={!editable || !onRevise || !valid || busy}
            onClick={() =>
              onRevise?.({
                planId: String(revision.planId),
                expectedRevision: revision.revision,
                title: title.trim(),
                steps: cloneSteps(steps),
              })
            }
          >
            <Save aria-hidden="true" size={14} />
            保存新版本
          </button>
          <button
            type="button"
            className="st-plan__approve"
            disabled={!onApprove || revision.state !== 'draft' || dirty || busy}
            onClick={() =>
              onApprove?.({
                planId: String(revision.planId),
                revision: revision.revision,
              })
            }
          >
            <Check aria-hidden="true" size={15} />
            批准版本 {revision.revision}
          </button>
        </div>
      </header>

      {error ? (
        <p className="st-plan__error" role="alert">
          {error}
        </p>
      ) : null}
      {dirty ? (
        <p className="st-plan__dirty-note" data-testid="plan-dirty-note" role="status">
          当前修改尚未保存。请先保存为新版本，再批准新版本。
        </p>
      ) : null}

      <div className="st-plan__body">
        <div className="st-plan__editor">
          <label className="st-plan__field st-plan__field--title">
            <span>计划标题</span>
            <input
              aria-label="计划标题"
              value={title}
              disabled={!editable || busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <ol className="st-plan__steps" aria-label="计划步骤">
            {steps.map((step, index) => (
              <li
                key={String(step.id)}
                className="st-plan__step"
                data-testid={`plan-step-${String(step.id)}`}
              >
                <div className="st-plan__step-index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div className="st-plan__step-fields">
                  <label className="st-plan__field">
                    <span>步骤 {index + 1} 标题</span>
                    <input
                      aria-label={`步骤 ${index + 1} 标题`}
                      value={step.title}
                      disabled={!editable || busy}
                      onChange={(event) => updateStep(index, { title: event.target.value })}
                    />
                  </label>
                  <label className="st-plan__field">
                    <span>步骤类型</span>
                    <select
                      aria-label={`步骤 ${index + 1} 类型`}
                      value={step.kind ?? 'execution'}
                      disabled={!editable || busy}
                      onChange={(event) =>
                        updateStep(index, {
                          kind: event.target.value as NonNullable<PlanStepDraft['kind']>,
                        })
                      }
                    >
                      <option value="execution">执行</option>
                      <option value="merge">合并</option>
                    </select>
                  </label>
                  <label className="st-plan__field st-plan__field--wide">
                    <span>指令</span>
                    <textarea
                      aria-label={`步骤 ${index + 1} 指令`}
                      value={step.instructions}
                      disabled={!editable || busy}
                      rows={2}
                      onChange={(event) => updateStep(index, { instructions: event.target.value })}
                    />
                  </label>
                  <label className="st-plan__field">
                    <span>AgentVersion</span>
                    <input
                      aria-label={`步骤 ${index + 1} AgentVersion`}
                      value={String(step.agentVersionId)}
                      disabled={!editable || busy}
                      onChange={(event) =>
                        updateStep(index, {
                          agentVersionId: event.target.value as PlanStepDraft['agentVersionId'],
                        })
                      }
                    />
                    <code className="st-plan__exact-id">{String(step.agentVersionId)}</code>
                  </label>
                  <label className="st-plan__field">
                    <span>模型覆盖</span>
                    <input
                      aria-label={`步骤 ${index + 1} 模型覆盖`}
                      value={String(step.modelOverrideId ?? '')}
                      placeholder="沿用 Agent 默认"
                      disabled={!editable || busy}
                      onChange={(event) =>
                        updateStep(index, {
                          modelOverrideId: event.target.value.trim()
                            ? (event.target.value as PlanStepDraft['modelOverrideId'])
                            : undefined,
                        })
                      }
                    />
                    <code className="st-plan__exact-id">
                      {String(step.modelOverrideId ?? 'Agent 默认')}
                    </code>
                  </label>
                  <label className="st-plan__field st-plan__field--wide">
                    <span>依赖步骤 ID</span>
                    <input
                      aria-label={`步骤 ${index + 1} 依赖`}
                      value={step.dependsOn.map(String).join(', ')}
                      placeholder="无依赖，可并行"
                      disabled={!editable || busy}
                      onChange={(event) =>
                        updateStep(index, {
                          dependsOn: event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean) as PlanStepDraft['dependsOn'],
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="st-plan__remove"
                  aria-label={`删除步骤 ${index + 1}`}
                  title="删除步骤"
                  disabled={!editable || busy || steps.length === 1}
                  onClick={() => removeStep(index)}
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </li>
            ))}
          </ol>
        </div>

        <aside className="st-plan__history" aria-label="计划版本历史">
          <div className="st-plan__history-head">
            <Clock3 aria-hidden="true" size={14} />
            <strong>版本历史</strong>
          </div>
          <div className="st-plan__history-list">
            {orderedRevisions.map((item) => {
              const active = item.id === revision.id;
              return (
                <button
                  key={String(item.id)}
                  type="button"
                  data-testid={`plan-revision-${item.revision}`}
                  data-active={active ? '1' : '0'}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelectRevision?.(item.revision)}
                >
                  <span>
                    <strong>v{item.revision}</strong>
                    <small>{STATE_LABEL[item.state]}</small>
                  </span>
                  <span className="st-plan__history-diff">
                    <GitCompareArrows aria-hidden="true" size={12} />+
                    {item.diffFromPrevious.added.length} / -{item.diffFromPrevious.removed.length}
                  </span>
                  <ChevronRight aria-hidden="true" size={13} />
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </section>
  );
}
