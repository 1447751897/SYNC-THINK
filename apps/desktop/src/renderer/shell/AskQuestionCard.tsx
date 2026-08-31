/**
 * 问询卡片（模型主动问询 ask_user_question）——接管 composer 展示。
 *
 * 对齐 DSH QuestionComposer 的全部细节：
 *  - 通用形态：一次一题（多问题分页）、选项单选编号/多选 checkbox、
 *    推荐徽章（label 带「（推荐）」/「(Recommended)」后缀 → 剥离渲染徽章）、
 *    自定义答案输入（Enter 提交，IME 保护）、跳过、提交校验、取消整组；
 *  - plan-review 特例（单问题 + intent.kind=plan-review + 二选一含 approve
 *    label）：渲染「方案待审」卡——警示条 + Markdown 方案全文 + 拒绝/确认执行。
 *
 * 回答/取消走 conversation.ask.answer / conversation.ask.cancel 回填为
 * 工具结果；成功后由父组件清除挂起状态。
 */
import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  LoaderCircle,
  X,
} from 'lucide-react';
import type {
  AskQuestion,
  AskQuestionAnswer,
  ConversationAskPendingResponse,
} from '@sync-think/protocol';
import type { ChatPlanSubmission } from '@sync-think/shared';
import { parsePlanMarkdown } from '@sync-think/shared';
import { MarkdownContent } from './MarkdownContent.js';

export type PendingAsk = NonNullable<ConversationAskPendingResponse['ask']>;

function bridge() {
  return window.syncThink?.runtime;
}

/** 剥离「（推荐）」/「(Recommended)」后缀并标记推荐态（不改动回答值）。 */
function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  return suffix.test(label)
    ? { label: label.replace(suffix, '').trim(), recommended: true }
    : { label, recommended: false };
}

/** 是否为 plan-review 特例：单问题 + intent + detail + 二选一（含 approve label）。 */
export function planReviewOf(questions: readonly AskQuestion[]): {
  id: string;
  question: string;
  plan: string;
  approveLabel: string;
  declineLabel?: string;
} | null {
  if (questions.length !== 1) return null;
  const question = questions[0];
  if (question.intent?.kind !== 'plan-review' || !question.detail) return null;
  if (question.multiSelect === true) return null;
  const options = question.options ?? [];
  if (options.length > 2) return null;
  const approve = options.find((option) => option.label === question.intent?.approve);
  if (!approve) return null;
  const decline = options.find((option) => option.label !== question.intent?.approve);
  return {
    id: question.id,
    question: question.question,
    plan: question.detail,
    approveLabel: approve.label,
    ...(decline ? { declineLabel: decline.label } : {}),
  };
}

/**
 * 把 plan-review 问询的 Markdown 方案宽松解析为结构化计划草稿
 * （§12.18 方案卡入口：模型仍以 ask plan-review 提交 → 前端转成可编辑/可审批的
 * ConversationPlanSummary 草稿）。解析是尽力而为：标题取自问题文本，步骤取
 * Markdown 标题/编号/列表项，验收取自 checkbox；解析不到步骤时生成一个兜底
 * 步骤，保证 conversation.plan.submit 校验可通过，用户可在方案卡上编辑补全。
 */
export function parsePlanReviewDetail(question: string, detail: string): ChatPlanSubmission {
  return parsePlanMarkdown(question, detail);
}

function isComposing(event: React.KeyboardEvent): boolean {
  return Boolean((event.nativeEvent as KeyboardEvent).isComposing) || event.nativeEvent.keyCode === 229;
}

/**
 * 把 ask_user_question 工具结果 JSON 渲染为可读文本（消息流工具行展示）：
 * 「你选择了：A、B」/「你的回答：xxx」/「已跳过」；解析失败返回 undefined。
 */
export function formatAskToolResult(resultText: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return undefined;
  }
  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  if (!root || !Array.isArray(root.answers)) return undefined;
  const lines: string[] = [];
  for (const raw of root.answers) {
    if (!raw || typeof raw !== 'object') continue;
    const answer = raw as Record<string, unknown>;
    const selected = Array.isArray(answer.selected) ? answer.selected.filter((s) => typeof s === 'string') : [];
    const custom = typeof answer.custom === 'string' ? answer.custom.trim() : '';
    if (custom) {
      lines.push(`你的回答：${custom}`);
    } else if (selected.length > 0) {
      lines.push(`你选择了：${selected.join('、')}`);
    } else {
      lines.push('已跳过');
    }
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

export interface AskQuestionCardProps {
  ask: PendingAsk;
  /** 回答成功后（含取消）父组件清除挂起状态。 */
  onSettled(): void;
}

export function AskQuestionCard({ ask, onSettled }: AskQuestionCardProps) {
  const review = useMemo(() => planReviewOf(ask.questions), [ask.questions]);
  return review ? (
    <PlanReviewCard ask={ask} review={review} onSettled={onSettled} />
  ) : (
    <QuestionFlow ask={ask} onSettled={onSettled} />
  );
}

// ─── plan-review 特例卡 ─────────────────────────────────────────────────────

function PlanReviewCard({
  ask,
  review,
  onSettled,
}: {
  ask: PendingAsk;
  review: NonNullable<ReturnType<typeof planReviewOf>>;
  onSettled(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (label: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const api = bridge();
      if (!api?.conversationAskAnswer) {
        setError('Runtime 未连接');
        setBusy(false);
        return;
      }
      await api.conversationAskAnswer({
        askId: ask.askId,
        answers: [{ id: review.id, selected: [label] }],
      });
      onSettled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const discuss = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const api = bridge();
      if (!api?.conversationAskCancel) {
        setError('Runtime 未连接');
        setBusy(false);
        return;
      }
      await api.conversationAskCancel({ askId: ask.askId });
      onSettled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <section
      className="shell-ask-card is-plan-review"
      data-testid="ask-plan-review-card"
      data-ask-key={ask.askId}
      aria-label={review.question}
    >
      <div className="shell-ask-card__strip">
        <span className="shell-ask-card__dot" aria-hidden="true" />
        方案待审
      </div>
      <div className="shell-ask-card__body" data-testid="ask-plan-review-body">
        <MarkdownContent text={review.plan} />
      </div>
      <div className="shell-ask-card__footer">
        <div className="shell-ask-card__feedback" role="status">
          {error}
        </div>
        <div className="shell-ask-card__actions">
          <button
            type="button"
            className="shell-ask-card__btn is-discuss"
            disabled={busy}
            onClick={() => void discuss()}
          >
            <Edit3 size={14} />
            去聊天里说
          </button>
          {review.declineLabel !== undefined ? (
            <button
              type="button"
              className="shell-ask-card__btn is-decline"
              disabled={busy}
              onClick={() => void decide(review.declineLabel!)}
            >
              拒绝
            </button>
          ) : null}
          <button
            type="button"
            className="shell-ask-card__btn is-approve"
            disabled={busy}
            onClick={() => void decide(review.approveLabel)}
          >
            {busy ? <LoaderCircle size={14} className="shell-process-spin" /> : <Check size={14} />}
            确认执行
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── 通用问询流 ──────────────────────────────────────────────────────────────

interface Draft {
  selected: string[];
  custom: string;
  skipped: boolean;
}

function QuestionFlow({ ask, onSettled }: { ask: PendingAsk; onSettled(): void }) {
  const questions = ask.questions;
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    questions.map(() => ({ selected: [], custom: '', skipped: false })),
  );
  const [busy, setBusy] = useState<'answer' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const question = questions[index];
  const draft = drafts[index];
  const hasOptions = (question.options?.length ?? 0) > 0;

  const updateDraft = (update: (current: Draft) => Draft) => {
    setDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? update(item) : item)));
    setError(null);
  };

  const answered = (item: Draft) => item.selected.length > 0 || item.custom.trim() !== '';
  const completed = (item: Draft) => answered(item) || item.skipped;

  const choose = (label: string) => {
    updateDraft((current) => {
      if (question.multiSelect === true) {
        const selected = current.selected.includes(label)
          ? current.selected.filter((item) => item !== label)
          : [...current.selected, label];
        return { ...current, selected, skipped: false };
      }
      return { selected: [label], custom: '', skipped: false };
    });
    if (question.multiSelect !== true && index < questions.length - 1) {
      setIndex((current) => current + 1);
    }
  };

  const submitDrafts = async (values: Draft[]) => {
    const missing = values.findIndex((item) => !completed(item));
    if (missing >= 0) {
      setIndex(missing);
      setError('请先完成这道问题。');
      return;
    }
    const api = bridge();
    if (!api?.conversationAskAnswer) {
      setError('Runtime 未连接');
      return;
    }
    setBusy('answer');
    setError(null);
    try {
      const answers: AskQuestionAnswer[] = questions.map((item, itemIndex) => {
        const value = values[itemIndex];
        if (value.skipped) return { id: item.id, selected: [] };
        const custom = value.custom.trim();
        return {
          id: item.id,
          selected: custom === '' || item.multiSelect === true ? value.selected : [],
          ...(custom === '' ? {} : { custom }),
        };
      });
      await api.conversationAskAnswer({ askId: ask.askId, answers });
      onSettled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  };

  const continueFlow = () => {
    if (!answered(draft)) {
      setError('请选择一个选项或填写自定义答案。');
      return;
    }
    if (index < questions.length - 1) {
      setIndex((current) => current + 1);
      setError(null);
      return;
    }
    void submitDrafts(drafts);
  };

  const skipQuestion = () => {
    const nextDrafts = drafts.map((item, itemIndex) =>
      itemIndex === index ? { selected: [], custom: '', skipped: true } : item,
    );
    setDrafts(nextDrafts);
    setError(null);
    if (index < questions.length - 1) {
      setIndex((current) => current + 1);
      return;
    }
    void submitDrafts(nextDrafts);
  };

  const cancelFlow = async () => {
    if (busy) return;
    const api = bridge();
    if (!api?.conversationAskCancel) {
      setError('Runtime 未连接');
      return;
    }
    setBusy('cancel');
    setError(null);
    try {
      await api.conversationAskCancel({ askId: ask.askId });
      onSettled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  };

  const draftCustom = (value: string) => {
    updateDraft((current) => ({
      ...current,
      selected: question.multiSelect === true ? current.selected : [],
      custom: value,
      skipped: false,
    }));
  };

  const continueFromCustom = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return;
    event.preventDefault();
    continueFlow();
  };

  const busyAny = busy !== null;

  return (
    <div className="shell-ask-card-wrap" data-ask-key={ask.askId}>
      <section className="shell-ask-card" data-testid="ask-question-card" aria-labelledby={`ask-q-${ask.askId}-${index}`}>
        <header className="shell-ask-card__head">
          <div className="shell-ask-card__heading-block">
            {question.header !== undefined ? (
              <div className="shell-ask-card__eyebrow">{question.header}</div>
            ) : null}
            <h2 className="shell-ask-card__title" id={`ask-q-${ask.askId}-${index}`}>
              {question.question}
            </h2>
          </div>
          <button
            type="button"
            className="shell-ask-card__icon-btn"
            aria-label="放弃整组问题"
            title="放弃整组问题"
            disabled={busyAny}
            onClick={() => void cancelFlow()}
          >
            <X size={16} />
          </button>
        </header>

        <div className="shell-ask-card__body">
          {question.detail !== undefined ? (
            <div className="shell-ask-card__detail">
              <MarkdownContent text={question.detail} />
            </div>
          ) : null}
          <div className="shell-ask-card__options" role={question.multiSelect === true ? 'group' : 'radiogroup'}>
            {(question.options ?? []).map((option, optionIndex) => {
              const selected = draft.selected.includes(option.label);
              const display = parseRecommendedLabel(option.label);
              return (
                <button
                  key={`${option.label}-${optionIndex}`}
                  type="button"
                  role={question.multiSelect === true ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                  aria-label={display.label}
                  className="shell-ask-card__option"
                  data-selected={selected ? '1' : '0'}
                  disabled={busyAny}
                  onClick={() => choose(option.label)}
                >
                  {question.multiSelect === true ? (
                    <span className="shell-ask-card__checkbox" aria-hidden="true">
                      {selected ? <Check size={12} /> : null}
                    </span>
                  ) : (
                    <span className="shell-ask-card__number" aria-hidden="true">
                      {optionIndex + 1}
                    </span>
                  )}
                  <span className="shell-ask-card__option-copy">
                    <span className="shell-ask-card__option-line">
                      <span className="shell-ask-card__option-label">{display.label}</span>
                      {display.recommended ? (
                        <span className="shell-ask-card__badge">推荐</span>
                      ) : null}
                      {option.description !== undefined ? (
                        <span className="shell-ask-card__option-description">{option.description}</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}
            {hasOptions ? (
              <div className="shell-ask-card__custom-row" data-active={draft.custom !== '' ? '1' : '0'}>
                {question.multiSelect === true ? (
                  <span className="shell-ask-card__checkbox" aria-hidden="true">
                    {draft.custom !== '' ? <Check size={12} /> : null}
                  </span>
                ) : (
                  <span className="shell-ask-card__number" aria-hidden="true">
                    <Edit3 size={12} />
                  </span>
                )}
                <input
                  type="text"
                  className="shell-ask-card__custom-input"
                  value={draft.custom}
                  disabled={busyAny}
                  placeholder="输入你的答案"
                  onChange={(event) => draftCustom(event.target.value)}
                  onKeyDown={continueFromCustom}
                />
              </div>
            ) : (
              <textarea
                autoFocus
                className="shell-ask-card__custom-textarea"
                value={draft.custom}
                disabled={busyAny}
                rows={2}
                placeholder="输入你的答案"
                onChange={(event) => draftCustom(event.target.value)}
                onKeyDown={continueFromCustom}
              />
            )}
          </div>
        </div>

        <footer className="shell-ask-card__footer">
          <div className="shell-ask-card__pager">
            <button
              type="button"
              className="shell-ask-card__icon-btn"
              aria-label="上一题"
              disabled={index === 0 || busyAny}
              onClick={() => {
                setIndex(index - 1);
                setError(null);
              }}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="shell-ask-card__progress">
              {index + 1} / {questions.length}
            </span>
            <button
              type="button"
              className="shell-ask-card__icon-btn"
              aria-label="下一题"
              disabled={index === questions.length - 1 || busyAny}
              onClick={() => {
                setIndex(index + 1);
                setError(null);
              }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="shell-ask-card__feedback" role="status">
            {error ? (
              <>
                <AlertCircle size={12} />
                {error}
              </>
            ) : null}
          </div>
          <div className="shell-ask-card__actions">
            <button
              type="button"
              className="shell-ask-card__btn is-skip"
              disabled={busyAny}
              onClick={skipQuestion}
            >
              跳过本题
            </button>
            <button
              type="button"
              className="shell-ask-card__btn is-primary"
              disabled={busyAny || !answered(draft)}
              onClick={continueFlow}
            >
              {busy === 'answer' ? (
                <LoaderCircle size={14} className="shell-process-spin" />
              ) : null}
              {busy === 'answer'
                ? '提交中…'
                : index === questions.length - 1
                  ? '提交'
                  : '下一题'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
