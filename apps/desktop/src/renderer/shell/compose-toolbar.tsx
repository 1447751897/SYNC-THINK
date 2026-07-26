// NewMax-style Compose toolbar menus: permission / reasoning / model picker.
// Menus render via portal + fixed position so parent overflow cannot clip them.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  Lock,
  MessageSquare,
  Shield,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import type { ModelOption } from './NewConversationDialog.js';

export type PermissionMode = 'ask' | 'workspace' | 'full-access';
/** Fixed NewMax-style effort ladder (full set always shown). */
export type ReasoningEffort =
  | 'auto'
  | 'off'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export const PERMISSION_OPTIONS: Array<{
  value: PermissionMode;
  title: string;
  desc: string;
  Icon: typeof Shield;
}> = [
  {
    value: 'ask',
    title: '询问批准',
    desc: '写文件 / 执行命令前会弹出确认卡，需你批准',
    Icon: Lock,
  },
  {
    value: 'workspace',
    title: '为我批准',
    desc: '项目目录内自动允许读写与命令',
    Icon: Shield,
  },
  {
    value: 'full-access',
    title: '完全访问',
    desc: '尽量少打断；当前仍限制在绑定项目目录内',
    Icon: Zap,
  },
];

/** Compact text-only ladder (no icons / no long descriptions — NewMax dense list). */
export const REASONING_OPTIONS: Array<{
  value: ReasoningEffort;
  title: string;
}> = [
  { value: 'auto', title: '自动' },
  { value: 'off', title: '关闭' },
  { value: 'low', title: '低' },
  { value: 'medium', title: '中' },
  { value: 'high', title: '高' },
  { value: 'xhigh', title: '超高' },
  { value: 'max', title: '极限' },
];

export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  auto: '自动',
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极限',
};

/** Full fixed ladder — always show every rung (no per-model filtering). */
export function reasoningLevelsForModel(
  _modelId?: string,
): readonly ReasoningEffort[] {
  return REASONING_OPTIONS.map((o) => o.value);
}

/** @deprecated kept for tests — selection is always valid on the fixed ladder. */
export function coerceReasoningEffort(
  value: ReasoningEffort,
  allowed: readonly ReasoningEffort[] = reasoningLevelsForModel(),
): ReasoningEffort {
  return allowed.includes(value) ? value : 'auto';
}

/**
 * Rough context window by model id / display name family.
 * Used only when 设置 → 模型 has not configured contextWindow yet.
 */
export function estimateContextWindow(modelId: string | undefined): number {
  const id = (modelId || '').toLowerCase();
  if (!id) return 128_000;
  if (id.includes('gpt-5.6') || id.includes('gpt-5.5') || id.includes('gpt-5.4')) {
    return 400_000;
  }
  if (id.includes('grok-4.5') || id.includes('grok 4.5')) return 500_000;
  if (id.includes('grok-4') || id.includes('grok 4')) return 256_000;
  if (id.includes('glm-5') || id.includes('glm 5')) return 200_000;
  if (
    id.includes('opus') ||
    id.includes('sonnet-4') ||
    id.includes('sonnet 4') ||
    id.includes('gpt-4.1') ||
    id.includes('fable')
  ) {
    return 200_000;
  }
  if (id.includes('gpt-4o') || id.includes('claude') || id.includes('gemini')) return 128_000;
  if (id.includes('mini') || id.includes('haiku') || id.includes('flash') || id.includes('luna')) {
    return 128_000;
  }
  return 128_000;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

function rectFromEl(el: HTMLElement | null): AnchorRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    bottom: r.bottom,
    left: r.left,
    right: r.right,
    width: r.width,
    height: r.height,
  };
}

/**
 * Floating menu portal. Anchors above the trigger; falls back below if not enough space.
 * Uses fixed coordinates so ancestors with overflow:hidden cannot clip it.
 */
function MenuShell(props: {
  open: boolean;
  onClose(): void;
  anchorEl: HTMLElement | null;
  align?: 'left' | 'right';
  width?: number;
  /** Extra portal roots (e.g. model flyout) that should not count as outside clicks. */
  satelliteEls?: Array<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const width = props.width ?? 280;

  useLayoutEffect(() => {
    if (!props.open) {
      setAnchor(null);
      return;
    }
    const update = () => setAnchor(rectFromEl(props.anchorEl));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [props.open, props.anchorEl]);

  useEffect(() => {
    if (!props.open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (props.anchorEl?.contains(t)) return;
      // Model flyout (and any other satellite portal) lives outside menuRef;
      // treating it as outside would close the picker before the click lands.
      if (props.satelliteEls?.some((el) => el?.contains(t))) return;
      props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [props.open, props.onClose, props.anchorEl, props.satelliteEls]);

  if (!props.open || !anchor || typeof document === 'undefined') return null;

  const gap = 8;
  const maxH = Math.min(420, Math.floor(window.innerHeight * 0.6));
  const spaceAbove = anchor.top - gap;
  const spaceBelow = window.innerHeight - anchor.bottom - gap;
  const placeAbove = spaceAbove >= 160 || spaceAbove >= spaceBelow;
  const available = placeAbove ? spaceAbove : spaceBelow;
  const menuMaxH = Math.max(160, Math.min(maxH, available));

  let left = props.align === 'right' ? anchor.right - width : anchor.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

  const style: React.CSSProperties = {
    position: 'fixed',
    width,
    maxHeight: menuMaxH,
    zIndex: 10000,
    left,
    ...(placeAbove
      ? { bottom: window.innerHeight - anchor.top + gap }
      : { top: anchor.bottom + gap }),
  };

  return createPortal(
    <div ref={menuRef} className="shell-menu shell-menu--portal" style={style} role="menu">
      {props.children}
    </div>,
    document.body,
  );
}

export function PermissionMenu(props: {
  open: boolean;
  value: PermissionMode;
  anchorEl: HTMLElement | null;
  onClose(): void;
  onChange(value: PermissionMode): void;
}) {
  return (
    <MenuShell open={props.open} onClose={props.onClose} anchorEl={props.anchorEl} width={300}>
      <div className="shell-menu__heading">权限模式</div>
      <div className="shell-menu__scroll">
        {PERMISSION_OPTIONS.map((opt) => {
          const active = opt.value === props.value;
          const Icon = opt.Icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`shell-menu__item ${active ? 'is-active' : ''}`}
              onClick={() => {
                props.onChange(opt.value);
                props.onClose();
              }}
            >
              <span className="shell-menu__item-icon-wrap" data-active={active ? '1' : '0'}>
                <Icon size={15} />
              </span>
              <div className="shell-menu__item-text">
                <div className="shell-menu__item-title">{opt.title}</div>
                <div className="shell-menu__item-desc">{opt.desc}</div>
              </div>
              {active ? <Check size={14} className="shell-menu__check" /> : null}
            </button>
          );
        })}
      </div>
    </MenuShell>
  );
}

/** 输入框「对话对象」选择菜单里的一个可选身份（模型/智能体/小队）。 */
export interface IdentityOption {
  track: 'model' | 'agent' | 'team';
  targetRef: string;
  name: string;
  desc?: string;
}

/**
 * 对话对象选择菜单：切换当前对话由谁来回答——纯模型 / 某个智能体 / 某个小队。
 * 选择后调用 conversation.rebindTarget 换绑，下一条消息即生效。
 */
export function IdentityPickerMenu(props: {
  open: boolean;
  agents: readonly { id: string; name: string; description?: string }[];
  teams: readonly { id: string; name: string; description?: string }[];
  currentTrack: 'model' | 'agent' | 'team';
  currentTargetRef: string;
  anchorEl: HTMLElement | null;
  onClose(): void;
  onPick(option: IdentityOption): void;
}) {
  const TRACK_ICONS = { model: MessageSquare, agent: Bot, team: Users } as const;
  const sections: Array<{
    key: 'agent' | 'team';
    heading: string;
    items: readonly { id: string; name: string; description?: string }[];
  }> = [
    { key: 'agent', heading: '智能体', items: props.agents },
    { key: 'team', heading: '小队', items: props.teams },
  ];
  return (
    <MenuShell open={props.open} onClose={props.onClose} anchorEl={props.anchorEl} width={300}>
      <div className="shell-menu__heading">对话对象</div>
      <div className="shell-menu__scroll">
        <button
          type="button"
          role="menuitemradio"
          aria-checked={props.currentTrack === 'model'}
          className={`shell-menu__item ${props.currentTrack === 'model' ? 'is-active' : ''}`}
          onClick={() => {
            props.onPick({ track: 'model', targetRef: '', name: '直接跟模型聊' });
            props.onClose();
          }}
        >
          <span
            className="shell-menu__item-icon-wrap"
            data-active={props.currentTrack === 'model' ? '1' : '0'}
          >
            <MessageSquare size={15} />
          </span>
          <div className="shell-menu__item-text">
            <div className="shell-menu__item-title">直接跟模型聊</div>
            <div className="shell-menu__item-desc">不经过智能体人设，右侧模型选择器决定用哪个模型</div>
          </div>
          {props.currentTrack === 'model' ? <Check size={14} className="shell-menu__check" /> : null}
        </button>
        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <div key={section.key}>
              <div className="shell-menu__heading shell-menu__heading--sub">{section.heading}</div>
              {section.items.map((item) => {
                const active =
                  props.currentTrack === section.key && props.currentTargetRef === String(item.id);
                const Icon = TRACK_ICONS[section.key];
                return (
                  <button
                    key={`${section.key}-${item.id}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    data-testid={`identity-option-${section.key}-${item.id}`}
                    className={`shell-menu__item ${active ? 'is-active' : ''}`}
                    onClick={() => {
                      props.onPick({
                        track: section.key,
                        targetRef: String(item.id),
                        name: item.name,
                        desc: item.description,
                      });
                      props.onClose();
                    }}
                  >
                    <span className="shell-menu__item-icon-wrap" data-active={active ? '1' : '0'}>
                      <Icon size={15} />
                    </span>
                    <div className="shell-menu__item-text">
                      <div className="shell-menu__item-title">{item.name}</div>
                      {item.description ? (
                        <div className="shell-menu__item-desc">{item.description}</div>
                      ) : null}
                    </div>
                    {active ? <Check size={14} className="shell-menu__check" /> : null}
                  </button>
                );
              })}
            </div>
          ),
        )}
      </div>
    </MenuShell>
  );
}

export function ReasoningMenu(props: {
  open: boolean;
  value: ReasoningEffort;
  anchorEl: HTMLElement | null;
  onClose(): void;
  onChange(value: ReasoningEffort): void;
}) {
  return (
    <MenuShell open={props.open} onClose={props.onClose} anchorEl={props.anchorEl} width={160}>
      <div className="shell-menu__heading">推理强度</div>
      <div className="shell-menu__scroll">
        {REASONING_OPTIONS.map((opt) => {
          const active = opt.value === props.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`shell-menu__item shell-menu__item--compact ${active ? 'is-active' : ''}`}
              onClick={() => {
                props.onChange(opt.value);
                props.onClose();
              }}
            >
              <div className="shell-menu__item-text">
                <div className="shell-menu__item-title">{opt.title}</div>
              </div>
              {active ? <Check size={14} className="shell-menu__check" /> : null}
            </button>
          );
        })}
      </div>
    </MenuShell>
  );
}

/**
 * NewMax model picker:
 * - The trigger opens a compact provider menu.
 * - Hover/focus a provider opens a Radix submenu containing its models.
 *
 * Radix/Popper owns collision detection, flipping and resize/scroll updates. Keeping
 * the provider row and model panel in one menu tree avoids the stale DOMRect and
 * hover-gap races that made the old hand-positioned portal drift across viewports.
 */
export function ModelPickerMenu(props: {
  open: boolean;
  models: readonly ModelOption[];
  selectedModelId: string;
  defaultLabel: string;
  anchorEl: HTMLElement | null;
  onClose(): void;
  onPick(modelId: string): void;
}) {
  const providers = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const model of props.models) {
      const list = map.get(model.providerName) ?? [];
      list.push(model);
      map.set(model.providerName, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [props.models]);

  const [triggerRect, setTriggerRect] = useState<AnchorRect | null>(null);
  useLayoutEffect(() => {
    if (!props.open || !props.anchorEl) {
      setTriggerRect(null);
      return;
    }
    const update = () => setTriggerRect(rectFromEl(props.anchorEl));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [props.open, props.anchorEl]);

  const selectedProviderOfModel = props.models.find(
    (model) => model.modelId === props.selectedModelId,
  )?.providerName;

  return (
    <DropdownMenu.Root
      dir="rtl"
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      modal={false}
    >
      <DropdownMenu.Trigger asChild>
        <span
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: triggerRect?.left ?? 0,
            top: triggerRect?.top ?? 0,
            width: triggerRect?.width ?? 0,
            height: triggerRect?.height ?? 0,
            pointerEvents: 'none',
          }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="shell-menu shell-menu--portal shell-menu--model-providers"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          avoidCollisions
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={props.onClose}
        >
          <div className="shell-menu__scroll">
            {providers.length === 0 ? (
              <div className="shell-menu__empty">没有可用模型</div>
            ) : (
              providers.map(([providerName, models]) => {
                const ownsSelected = selectedProviderOfModel === providerName;
                return (
                  <DropdownMenu.Sub key={providerName}>
                    <DropdownMenu.SubTrigger
                      data-testid={`model-provider-${providerName}`}
                      className={`shell-menu__item shell-menu__item--provider ${
                        ownsSelected ? 'is-active' : ''
                      }`}
                    >
                      <div className="shell-menu__item-text" dir="ltr">
                        <div className="shell-menu__item-title">{providerName}</div>
                      </div>
                      {ownsSelected ? <Check size={14} className="shell-menu__check" /> : null}
                      <ChevronLeft size={14} className="shell-menu__chevron" />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent
                        data-testid="model-flyout"
                        className="shell-menu shell-menu--portal shell-menu--model-flyout"
                        sideOffset={6}
                        alignOffset={-6}
                        collisionPadding={8}
                        avoidCollisions
                      >
                        <div className="shell-menu__scroll">
                          {models.length === 0 ? (
                            <div className="shell-menu__empty">该供应商暂无模型</div>
                          ) : (
                            models.map((model) => {
                              const active = model.modelId === props.selectedModelId;
                              return (
                                <DropdownMenu.Item
                                  key={model.modelId}
                                  className={`shell-menu__item shell-menu__item--model ${
                                    active ? 'is-active' : ''
                                  }`}
                                  onSelect={() => {
                                    props.onPick(model.modelId);
                                    props.onClose();
                                  }}
                                >
                                  <Sparkles size={13} className="shell-menu__item-icon" />
                                  <div className="shell-menu__item-text" dir="ltr">
                                    <div className="shell-menu__item-title">{model.displayName}</div>
                                  </div>
                                  {active ? (
                                    <Check size={14} className="shell-menu__check" />
                                  ) : null}
                                </DropdownMenu.Item>
                              );
                            })
                          )}
                        </div>
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                );
              })
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Context occupancy ring. Hover shows a NewMax-style "上下文窗口" card.
 * Session cost/duration hover lives on the message footer metrics instead.
 */
export function ContextRing(props: {
  /** Context occupancy used by the ring (input-side tokens). */
  used: number;
  /** Context window limit for the ring. */
  limit: number;
  /** 本会话累计时长（ms），tooltip 里展示。 */
  sessionDurationMs?: number;
  /** 本会话累计消耗 tokens（输入+输出跨全部轮次），tooltip 里展示。 */
  sessionTokens?: number;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);

  const ratio = props.limit > 0 ? Math.min(1, Math.max(0, props.used / props.limit)) : 0;
  const r = 8;
  const c = 2 * Math.PI * r;
  const dash = `${(ratio * c).toFixed(2)} ${c.toFixed(2)}`;
  const pct = Math.round(ratio * 100);
  const usedLabel = formatTokenCount(props.used);
  const limitLabel = formatTokenCount(props.limit);
  const remaining = Math.max(0, props.limit - props.used);
  const remainingLabel = formatTokenCount(remaining);
  // 会话累计（跨全部轮次的总消耗），与「当前上下文占用」是两个口径：
  // 占用 = 最近一次请求的 input tokens（提示词+全部历史，即模型此刻真实
  // 看到的内容量）；累计 = 本会话所有轮次 in+out 之和，只增不减。
  const sessionTokens = props.sessionTokens ?? 0;
  const sessionTokensLabel = sessionTokens > 0 ? formatTokenCount(sessionTokens) : null;
  const sessionDurationLabel = (() => {
    const ms = props.sessionDurationMs ?? 0;
    if (ms <= 0) return null;
    const totalMin = Math.round(ms / 60000);
    if (totalMin < 1) return '<1 分钟';
    if (totalMin < 60) return `${totalMin} 分钟`;
    return `${Math.floor(totalMin / 60)} 小时 ${totalMin % 60} 分钟`;
  })();

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const show = () => {
    cancelClose();
    setAnchor(rectFromEl(btnRef.current));
    setOpen(true);
  };
  const hide = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => cancelClose(), []);

  let tipStyle: React.CSSProperties | undefined;
  if (open && anchor && typeof window !== 'undefined') {
    const tipW = 220;
    const left = Math.max(8, Math.min(anchor.right - tipW, window.innerWidth - tipW - 8));
    tipStyle = {
      position: 'fixed',
      left,
      bottom: window.innerHeight - anchor.top + 8,
      width: tipW,
      zIndex: 10000,
    };
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="shell-compose__ctx"
        data-testid="context-ring"
        aria-label={`上下文 ${usedLabel} / ${limitLabel}（约 ${pct}%）`}
        title={props.title}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <circle
            cx="11"
            cy="11"
            r={r}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="2.2"
          />
          <circle
            cx="11"
            cy="11"
            r={r}
            fill="none"
            stroke={ratio > 0.9 ? 'var(--color-error)' : 'var(--color-accent)'}
            strokeWidth="2.2"
            strokeDasharray={dash}
            strokeLinecap="round"
            transform="rotate(-90 11 11)"
          />
        </svg>
      </button>
      {open && tipStyle && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="shell-ctx-tooltip"
              style={tipStyle}
              role="tooltip"
              data-testid="context-ring-tooltip"
              onMouseEnter={cancelClose}
              onMouseLeave={hide}
            >
              <div className="shell-ctx-tooltip__title">上下文窗口</div>
              <div className="shell-ctx-tooltip__row">
                <span>当前占用</span>
                <strong>
                  {usedLabel}
                  <span className="shell-ctx-tooltip__pct"> · {pct}%</span>
                </strong>
              </div>
              <div className="shell-ctx-tooltip__row">
                <span>上限</span>
                <strong>{limitLabel}</strong>
              </div>
              <div className="shell-ctx-tooltip__row">
                <span>剩余</span>
                <strong>{remainingLabel}</strong>
              </div>
              <div className="shell-ctx-tooltip__hint">
                占用 = 最近一次请求送入模型的内容量（含全部历史），随对话增长
              </div>
              {sessionTokensLabel || sessionDurationLabel ? (
                <div className="shell-ctx-tooltip__divider" aria-hidden="true" />
              ) : null}
              {sessionTokensLabel ? (
                <div className="shell-ctx-tooltip__row">
                  <span>会话累计消耗</span>
                  <strong>{sessionTokensLabel}</strong>
                </div>
              ) : null}
              {sessionDurationLabel ? (
                <div className="shell-ctx-tooltip__row">
                  <span>会话时长</span>
                  <strong>{sessionDurationLabel}</strong>
                </div>
              ) : null}
              <div className="shell-ctx-tooltip__bar" aria-hidden="true">
                <div
                  className="shell-ctx-tooltip__bar-fill"
                  style={{
                    width: `${pct}%`,
                    background:
                      ratio > 0.9 ? 'var(--color-error)' : 'var(--color-accent)',
                  }}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function ModelTrigger(props: {
  label: string;
  open: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onClick(): void;
}) {
  return (
    <button
      ref={props.buttonRef}
      type="button"
      className="shell-compose__model-btn"
      data-open={props.open ? '1' : '0'}
      onClick={props.onClick}
      title="切换模型"
    >
      <span className="shell-compose__model-label">{props.label}</span>
      <ChevronDown size={12} />
    </button>
  );
}
