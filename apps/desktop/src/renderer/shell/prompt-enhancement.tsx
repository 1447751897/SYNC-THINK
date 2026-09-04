import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, WandSparkles, X } from 'lucide-react';
import type { PromptEnhancePayload } from '@sync-think/protocol';
import {
  matchesShortcut,
  readShortcutPreferences,
  type ShortcutPreference,
} from './preferences-store.js';

export interface PromptEnhancementModelOption {
  modelId: string;
}

export interface PromptEnhancementModelResolution {
  modelId: string | null;
  usedFallback: boolean;
}

export function resolvePromptEnhancementModel(input: {
  configuredModelId?: string | null;
  currentModelId?: string | null;
  models: readonly PromptEnhancementModelOption[];
}): PromptEnhancementModelResolution {
  const available = new Set(input.models.map((model) => model.modelId));
  const configured = input.configuredModelId?.trim() ?? '';
  const current = input.currentModelId?.trim() ?? '';
  if (configured && available.has(configured)) {
    return { modelId: configured, usedFallback: false };
  }
  if (current && available.has(current)) {
    return { modelId: current, usedFallback: Boolean(configured) };
  }
  return {
    modelId: input.models[0]?.modelId ?? null,
    usedFallback: Boolean(configured),
  };
}

export function canShowPromptEnhancementButton(input: {
  enabled: boolean;
  value: string;
  busy: boolean;
  disabled?: boolean;
}): boolean {
  if (!input.enabled || input.disabled) return false;
  if (input.busy) return true;
  const text = input.value.trim();
  return Boolean(text) && !text.startsWith('/');
}

export function shouldHandlePromptEnhancementShortcut(input: {
  event: KeyboardEvent;
  enabled: boolean;
  accelerator: string;
  available: boolean;
}): boolean {
  if (!input.enabled || !input.available) return false;
  if (input.event.repeat || input.event.isComposing) return false;
  return matchesShortcut(input.event, input.accelerator);
}

export function tryHandlePromptEnhancementShortcut(
  event: { preventDefault(): void; nativeEvent: KeyboardEvent },
  enhancement: Pick<PromptEnhancementController, 'visible' | 'busy' | 'enhance' | 'cancel'>,
  shortcut?: ShortcutPreference,
): boolean {
  const preference = shortcut ?? readShortcutPreferences().promptEnhancement;
  if (
    !shouldHandlePromptEnhancementShortcut({
      event: event.nativeEvent,
      enabled: preference.enabled,
      accelerator: preference.accelerator,
      available: enhancement.visible,
    })
  ) {
    return false;
  }
  event.preventDefault();
  if (enhancement.busy) enhancement.cancel();
  else void enhancement.enhance();
  return true;
}

export function usePromptEnhancementShortcutEnabled(): boolean {
  const [enabled, setEnabled] = useState(
    () => readShortcutPreferences().promptEnhancement.enabled,
  );
  useEffect(() => {
    const sync = () => setEnabled(readShortcutPreferences().promptEnhancement.enabled);
    window.addEventListener('shell-shortcuts-changed', sync);
    return () => window.removeEventListener('shell-shortcuts-changed', sync);
  }, []);
  return enabled;
}

export function shouldApplyPromptEnhancementResult(input: {
  capturedValue: string;
  currentValue: string;
  result: string;
}): boolean {
  return input.capturedValue === input.currentValue && Boolean(input.result.trim());
}

function nextPromptEnhancementRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface PromptEnhancementController {
  visible: boolean;
  busy: boolean;
  feedback?: string;
  enhance(): Promise<void>;
  cancel(): void;
}

export function usePromptEnhancement(input: {
  value: string;
  onValueChange(value: string): void;
  enabled: boolean;
  configuredModelId?: string | null;
  currentModelId?: string | null;
  models: readonly PromptEnhancementModelOption[];
  disabled?: boolean;
}): PromptEnhancementController {
  const {
    value,
    onValueChange,
    enabled,
    configuredModelId,
    currentModelId,
    models,
    disabled = false,
  } = input;
  const valueRef = useRef(value);
  valueRef.current = value;
  const generationRef = useRef(0);
  const activeRequestRef = useRef<{ generation: number; requestId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();

  const cancel = useCallback(() => {
    const active = activeRequestRef.current;
    if (!active) return;
    generationRef.current += 1;
    activeRequestRef.current = null;
    setBusy(false);
    const cancelPromptEnhancement = window.syncThink?.runtime?.cancelPromptEnhancement;
    if (cancelPromptEnhancement) {
      void Promise.resolve(cancelPromptEnhancement({ requestId: active.requestId })).catch(
        () => undefined,
      );
    }
  }, []);

  useEffect(() => {
    if ((disabled || !enabled) && activeRequestRef.current) cancel();
  }, [cancel, disabled, enabled]);

  const enhance = useCallback(async () => {
    if (activeRequestRef.current || disabled || !enabled) return;
    const capturedValue = valueRef.current;
    const trimmed = capturedValue.trim();
    if (!trimmed || trimmed.startsWith('/')) return;
    const api = window.syncThink?.runtime;
    if (!api?.enhancePrompt) {
      setFeedback('提示词优化服务尚未连接');
      return;
    }
    const resolution = resolvePromptEnhancementModel({
      configuredModelId,
      currentModelId,
      models,
    });
    if (!resolution.modelId) {
      setFeedback('请先配置一个可用模型');
      return;
    }

    const requestId = nextPromptEnhancementRequestId();
    const generation = ++generationRef.current;
    activeRequestRef.current = { generation, requestId };
    setBusy(true);
    setFeedback(resolution.usedFallback ? '配置的优化模型不可用，已使用当前模型' : undefined);
    try {
      const response = await api.enhancePrompt({
        requestId,
        text: capturedValue,
        modelId: resolution.modelId as PromptEnhancePayload['modelId'],
      });
      if (generation !== generationRef.current) return;
      const enhanced = response.text.trim();
      if (
        !shouldApplyPromptEnhancementResult({
          capturedValue,
          currentValue: valueRef.current,
          result: enhanced,
        })
      ) {
        if (valueRef.current !== capturedValue) {
          setFeedback('草稿已变化，已忽略这次优化结果');
          return;
        }
        throw new Error('模型没有返回有效的优化结果');
      }
      onValueChange(enhanced);
    } catch (error) {
      if (generation !== generationRef.current) return;
      setFeedback(error instanceof Error ? error.message : '提示词优化失败');
    } finally {
      if (generation === generationRef.current) {
        activeRequestRef.current = null;
        setBusy(false);
      }
    }
  }, [configuredModelId, currentModelId, disabled, enabled, models, onValueChange]);

  useEffect(() => {
    if (!busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.isComposing ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [busy, cancel]);

  useEffect(
    () => () => {
      const active = activeRequestRef.current;
      if (!active) return;
      generationRef.current += 1;
      activeRequestRef.current = null;
      const cancelPromptEnhancement = window.syncThink?.runtime?.cancelPromptEnhancement;
      if (cancelPromptEnhancement) {
        void Promise.resolve(cancelPromptEnhancement({ requestId: active.requestId })).catch(
          () => undefined,
        );
      }
    },
    [],
  );

  return {
    visible: canShowPromptEnhancementButton({
      enabled,
      value,
      busy,
      disabled,
    }),
    busy,
    feedback,
    enhance,
    cancel,
  };
}

export function PromptEnhancementAction(props: {
  enhancement: PromptEnhancementController;
  testId?: string;
}) {
  const [hovered, setHovered] = useState(false);
  if (!props.enhancement.visible) return null;
  const label = props.enhancement.busy ? '取消优化提示词' : '优化提示词';
  const title = props.enhancement.feedback
    ? `${props.enhancement.feedback} · ${label}`
    : props.enhancement.busy
      ? `${label}（Esc）`
      : label;
  return (
    <span className="shell-compose__prompt-enhance-wrap">
      <button
        type="button"
        className="shell-compose__prompt-enhance"
        data-busy={props.enhancement.busy ? '1' : '0'}
        data-state={props.enhancement.busy ? 'busy' : props.enhancement.feedback ? 'error' : 'idle'}
        data-testid={props.testId}
        aria-label={label}
        title={title}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          if (props.enhancement.busy) props.enhancement.cancel();
          else void props.enhancement.enhance();
        }}
      >
        {props.enhancement.busy ? (
          hovered ? (
            <X size={14} aria-hidden="true" />
          ) : (
            <LoaderCircle
              className="shell-compose__prompt-enhance-spinner"
              size={14}
              aria-hidden="true"
            />
          )
        ) : (
          <WandSparkles size={14} aria-hidden="true" />
        )}
      </button>
      {props.enhancement.busy ? (
        <span className="sr-only" role="status">
          正在优化提示词
        </span>
      ) : props.enhancement.feedback ? (
        <span className="shell-compose__prompt-enhance-feedback" role="alert">
          {props.enhancement.feedback}
        </span>
      ) : null}
    </span>
  );
}
