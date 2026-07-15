import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ParticipationMode, ProviderSurface } from '@sync-think/shared';
import { ArrowUp, CircleAlert, RefreshCw, Settings2, Square } from 'lucide-react';
import { ModelPathPicker } from './ModelPathPicker.js';

// Compose — multi-line input with mode indicator, model picker, and send.
// Optional cancel while streaming. Model selection is a Run override (§5.3).

export interface ComposeModelOption {
  modelId: string;
  /** Short line shown in the selector, e.g. "OpenAI · gpt-4o-mini". */
  label: string;
  providerName?: string;
  providerModelId?: string;
  providerId?: string;
  surface?: ProviderSurface;
  protocol?: string;
}

export interface ComposeSendOptions {
  /** Explicit Run model override. Absent / undefined → Agent default. */
  modelId?: string;
}

export interface ComposeProps {
  mode: ParticipationMode;
  /**
   * Fired on submit. Second arg carries Run overrides (modelId).
   * Back-compat: callers that only need text may ignore the second parameter.
   */
  onSend: (
    text: string,
    options?: ComposeSendOptions,
  ) => void | boolean | Promise<void | boolean>;
  placeholder?: string;
  disabled?: boolean;
  /** When true, shows a cancel control for the active stream. */
  streaming?: boolean;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  /**
   * Registered catalog models available for this Run override.
   * When omitted, the model row is hidden (legacy callers).
   * When provided as empty array, show empty-registry hint.
   */
  models?: readonly ComposeModelOption[];
  /**
   * Controlled selection. `null` / empty → Agent default (no run override).
   * When uncontrolled, Compose keeps an internal selection starting at null.
   */
  selectedModelId?: string | null;
  onModelChange?: (modelId: string | null) => void;
  /** Label for the auto / agent-default option. */
  defaultModelLabel?: string;
  /** Number of Agent fallback models (observability only). */
  agentFallbackCount?: number;
  /** When true, show multi-provider continuity hint. */
  multiProvider?: boolean;
  /**
   * Soft observability: Runtime connection for send-ready strip.
   * Does not change send gating (parent still owns `disabled`).
   */
  connectionState?: 'online' | 'connecting' | 'offline' | string;
  /** Soft observability: whether a task is open. */
  hasActiveTask?: boolean;
  /** Soft observability: Agent default model is configured. */
  agentDefaultSet?: boolean;
  /** Optional compact recovery action shown only when Runtime is unavailable. */
  onReconnect?: () => void;
  /** Optional compact recovery action shown when no model can be resolved. */
  onConfigureModel?: () => void;
}


export type ComposeSendReadinessLevel =
  | 'ready'
  | 'partial'
  | 'blocked'
  | 'streaming'
  | 'empty';

export interface ComposeSendReadiness {
  level: ComposeSendReadinessLevel;
  badge: string;
  textOk: boolean;
  connectionOk: boolean;
  connectionState: string;
  taskResolvedOk: boolean;
  taskKnown: boolean;
  modelsOk: boolean;
  multiOk: boolean;
  agentOk: boolean;
  overrideOk: boolean;
  sourceTag: string;
  modelCount: number;
  note: string;
}

export interface ComposeSendReadinessInput {
  text?: string | null;
  connectionState?: string | null;
  hasActiveTask?: boolean;
  agentDefaultSet?: boolean;
  multiProvider?: boolean;
  streaming?: boolean;
  disabled?: boolean;
  /** When models array is provided (even empty), model gate is active. */
  modelsProvided?: boolean;
  hasModels?: boolean;
  modelCount?: number;
  selectedModelId?: string | null;
}

/**
 * Pure projector for tests + UI — Compose send readiness (§5 multi-model turn).
 * Soft observability only; does not close M1.
 */
export function projectComposeSendReadiness(
  input: ComposeSendReadinessInput,
): ComposeSendReadiness {
  const textOk = Boolean((input.text ?? '').trim());
  const connectionState = input.connectionState ?? 'unknown';
  const connectionOk = connectionState === 'online';
  const taskKnown = input.hasActiveTask !== undefined;
  const taskResolvedOk = taskKnown ? Boolean(input.hasActiveTask) : true;
  const modelsProvided = Boolean(input.modelsProvided);
  const hasModels = Boolean(input.hasModels);
  const modelsOk = !modelsProvided || hasModels;
  const multiOk = Boolean(input.multiProvider);
  const agentOk =
    input.agentDefaultSet === undefined ? true : Boolean(input.agentDefaultSet);
  const overrideOk = Boolean(input.selectedModelId);
  const streaming = Boolean(input.streaming);
  const blocked = Boolean(input.disabled) && !streaming;
  const modelCount = Math.max(0, Number(input.modelCount ?? 0) || 0);

  let level: ComposeSendReadinessLevel = 'partial';
  if (streaming) level = 'streaming';
  else if (blocked) level = 'blocked';
  else if (!modelsOk && !textOk) level = 'empty';
  else if (
    !blocked &&
    modelsOk &&
    taskResolvedOk &&
    (connectionOk || connectionState === 'unknown')
  )
    level = textOk ? 'ready' : 'partial';
  else level = 'partial';

  const badge =
    level === 'streaming'
      ? '流式中'
      : level === 'blocked'
        ? '暂不可发送'
        : level === 'ready'
          ? '可发送'
          : level === 'empty'
            ? '等待配置'
            : '准备中';

  const sourceTag = overrideOk ? '本轮覆盖' : 'Agent 默认';
  const notes: string[] = [];
  if (streaming) notes.push('Esc 可取消流式');
  else if (blocked) {
    if (taskKnown && !taskResolvedOk) notes.push('先打开任务');
    else if (connectionState === 'offline') notes.push('Runtime 未连接');
    else if (connectionState === 'connecting') notes.push('Runtime 连接中');
    else if (!modelsOk) notes.push('尚无注册模型');
    else notes.push('等待可发送条件');
  } else if (!textOk) notes.push('输入内容后发送 · Ctrl+Enter');
  else notes.push('发送后写入轨迹与 Manifest');

  return {
    level,
    badge,
    textOk,
    connectionOk,
    connectionState,
    taskResolvedOk,
    taskKnown,
    modelsOk,
    multiOk,
    agentOk,
    overrideOk,
    sourceTag,
    modelCount,
    note: notes.join(' · '),
  };
}

export function Compose(props: ComposeProps) {
  const [val, setVal] = useState('');
  const [internalModelId, setInternalModelId] = useState<string | null>(null);

  const modelsProvided = props.models !== undefined;
  const models = props.models ?? [];
  const isControlled = props.selectedModelId !== undefined;
  const selectedModelId = isControlled
    ? (props.selectedModelId ?? null)
    : internalModelId;

  const showModelRow = modelsProvided;
  const hasModels = models.length > 0;
  const defaultLabel = props.defaultModelLabel ?? 'Agent 默认（自动）';

  const blocker = useMemo(() => {
    if (props.streaming) return null;
    if (props.connectionState === 'offline') {
      return { message: 'Runtime 未连接', action: 'reconnect' as const };
    }
    if (props.connectionState === 'connecting') {
      return { message: 'Runtime 连接中', action: null };
    }
    if (props.hasActiveTask === false) {
      return { message: '请先打开一个任务', action: null };
    }
    if (modelsProvided && !hasModels) {
      return { message: '尚未配置模型', action: 'configure' as const };
    }
    if (props.agentDefaultSet === false && !selectedModelId) {
      return { message: '当前 Agent 尚未配置默认模型', action: 'configure' as const };
    }
    return null;
  },
    [
      props.connectionState,
      props.hasActiveTask,
      props.agentDefaultSet,
      props.streaming,
      modelsProvided,
      hasModels,
      selectedModelId,
    ],
  );

  const sendBlocked = Boolean(props.disabled || blocker);

  const setSelected = (next: string | null) => {
    if (!isControlled) setInternalModelId(next);
    props.onModelChange?.(next);
  };

  const sendCurrentValue = () => {
    if (!val.trim() || sendBlocked) return;
    const submittedValue = val;
    const modelId = selectedModelId || undefined;
    try {
      const result = props.onSend(submittedValue, { modelId });
      if (result && typeof (result as PromiseLike<void | boolean>).then === 'function') {
        void Promise.resolve(result).then(
          (succeeded) => {
            if (succeeded !== false) {
              setVal((current) => (current === submittedValue ? '' : current));
            }
          },
          () => undefined,
        );
        return;
      }
      if (result !== false) setVal('');
    } catch {
      // Keep the draft. The parent owns the actionable send error.
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendCurrentValue();
  };

  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && props.streaming && props.onCancel && !props.cancelDisabled) {
      event.preventDefault();
      props.onCancel();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendCurrentValue();
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="st-compose"
      aria-label="Message compose"
      data-mode={props.mode}
      data-streaming={props.streaming ? '1' : '0'}
      data-has-models={showModelRow ? (hasModels ? '1' : '0') : undefined}
    >
      {blocker ? (
        <div className="st-compose__blocker" data-testid="compose-blocker" role="status">
          <CircleAlert aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>{blocker.message}</span>
          {blocker.action === 'reconnect' && props.onReconnect ? (
            <button type="button" onClick={props.onReconnect} aria-label="重新连接 Runtime">
              <RefreshCw aria-hidden="true" size={13} strokeWidth={1.8} />
              重连
            </button>
          ) : blocker.action === 'configure' && props.onConfigureModel ? (
            <button type="button" onClick={props.onConfigureModel} aria-label="配置模型">
              <Settings2 aria-hidden="true" size={13} strokeWidth={1.8} />
              配置
            </button>
          ) : null}
        </div>
      ) : null}

      <textarea
        aria-label="消息输入"
        className="st-compose__input"
        placeholder={props.placeholder ?? '输入指令、粘贴上下文，或继续当前任务…'}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={onTextareaKeyDown}
        disabled={props.disabled && !props.streaming}
      />
      <div className="st-compose__toolbar">
        <div className="st-compose__model-control">
          {showModelRow ? (
            hasModels ? (
              <div className="st-compose__model-select-wrap">
                <ModelPathPicker
                  id="st-compose-model"
                  data-testid="compose-model-path"
                  models={models}
                  value={selectedModelId}
                  onChange={setSelected}
                  disabled={props.streaming}
                  allowDefault
                  defaultLabel={defaultLabel}
                  size="sm"
                />
              </div>
            ) : (
              <span className="st-compose__model-empty" data-testid="compose-model-empty">
                暂无模型
              </span>
            )
          ) : null}
        </div>
        <div className="st-compose__actions">
          {props.streaming && props.onCancel ? (
            <button
              type="button"
              className="st-compose__cancel"
              aria-label="停止生成"
              title="停止生成（Esc）"
              disabled={props.cancelDisabled}
              onClick={() => props.onCancel?.()}
            >
              <Square aria-hidden="true" size={13} fill="currentColor" strokeWidth={1.8} />
            </button>
          ) : (
            <button
              type="submit"
              className="st-compose__send"
              aria-label="发送"
              title="发送（Ctrl+Enter）"
              disabled={sendBlocked || !val.trim()}
            >
              <ArrowUp aria-hidden="true" size={17} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
