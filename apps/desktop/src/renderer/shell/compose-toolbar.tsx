// NewMax-style Compose toolbar menus: permission / reasoning / model picker.
// Menus render via portal + fixed position so parent overflow cannot clip them.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lock,
  Search,
  Shield,
  Sparkles,
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
    desc: '项目目录内自动允许读写与命令（默认）',
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

/** Rough context window by model id family — used for the usage ring until catalog fields exist. */
export function estimateContextWindow(modelId: string | undefined): number {
  const id = (modelId || '').toLowerCase();
  if (!id) return 128_000;
  if (id.includes('opus') || id.includes('sonnet-4') || id.includes('gpt-4.1')) return 200_000;
  if (id.includes('gpt-4o') || id.includes('claude') || id.includes('gemini')) return 128_000;
  if (id.includes('mini') || id.includes('haiku') || id.includes('flash')) return 64_000;
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
  }, [props.open, props.onClose, props.anchorEl]);

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
 * NewMax two-level model picker:
 * 1) provider list  2) models under that provider
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
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const q = query.trim().toLowerCase();

  const providers = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const model of props.models) {
      if (
        q &&
        !model.displayName.toLowerCase().includes(q) &&
        !model.modelId.toLowerCase().includes(q) &&
        !model.providerName.toLowerCase().includes(q)
      ) {
        continue;
      }
      const list = map.get(model.providerName) ?? [];
      list.push(model);
      map.set(model.providerName, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [props.models, q]);

  useEffect(() => {
    if (!props.open) {
      setProvider(null);
      setQuery('');
    }
  }, [props.open]);

  const selected = props.models.find((m) => m.modelId === props.selectedModelId);

  return (
    <MenuShell
      open={props.open}
      onClose={props.onClose}
      anchorEl={props.anchorEl}
      align="right"
      width={300}
    >
      <div className="shell-menu__heading">
        {provider ? (
          <button
            type="button"
            className="shell-menu__back"
            onClick={() => setProvider(null)}
            title="返回厂商列表"
          >
            <ChevronLeft size={14} />
          </button>
        ) : null}
        <span>{provider ? provider : '选择模型'}</span>
      </div>

      <div className="shell-menu__search">
        <Search size={12} />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setProvider(null);
          }}
          placeholder={provider ? '搜索模型…' : '搜索厂商或模型…'}
          autoFocus
        />
      </div>

      <div className="shell-menu__scroll">
        {!provider ? (
          <>
            <button
              type="button"
              className={`shell-menu__item ${!props.selectedModelId ? 'is-active' : ''}`}
              onClick={() => {
                props.onPick('');
                props.onClose();
              }}
            >
              <div className="shell-menu__item-text">
                <div className="shell-menu__item-title">{props.defaultLabel || '默认模型'}</div>
                <div className="shell-menu__item-desc">使用对话绑定的模型</div>
              </div>
              {!props.selectedModelId ? <Check size={14} className="shell-menu__check" /> : null}
            </button>

            {providers.length === 0 ? (
              <div className="shell-menu__empty">没有匹配的模型</div>
            ) : (
              providers.map(([name, models]) => (
                <button
                  key={name}
                  type="button"
                  className="shell-menu__item"
                  onClick={() => {
                    if (q && models.length === 1) {
                      props.onPick(models[0]!.modelId);
                      props.onClose();
                      return;
                    }
                    setProvider(name);
                  }}
                >
                  <div className="shell-menu__item-text">
                    <div className="shell-menu__item-title">{name}</div>
                    <div className="shell-menu__item-desc">{models.length} 个模型</div>
                  </div>
                  <ChevronRight size={14} className="shell-menu__chevron" />
                </button>
              ))
            )}
          </>
        ) : (
          <>
            {(providers.find(([n]) => n === provider)?.[1] ?? []).map((model) => {
              const active = model.modelId === props.selectedModelId;
              return (
                <button
                  key={model.modelId}
                  type="button"
                  className={`shell-menu__item ${active ? 'is-active' : ''}`}
                  onClick={() => {
                    props.onPick(model.modelId);
                    props.onClose();
                  }}
                >
                  <Sparkles size={13} className="shell-menu__item-icon" />
                  <div className="shell-menu__item-text">
                    <div className="shell-menu__item-title">{model.displayName}</div>
                    <div className="shell-menu__item-desc">{model.modelId}</div>
                  </div>
                  {active ? <Check size={14} className="shell-menu__check" /> : null}
                </button>
              );
            })}
          </>
        )}
      </div>

      {selected ? <div className="shell-menu__footer">当前：{selected.displayName}</div> : null}
    </MenuShell>
  );
}

export function ContextRing(props: {
  used: number;
  limit: number;
  title?: string;
}) {
  const ratio = props.limit > 0 ? Math.min(1, Math.max(0, props.used / props.limit)) : 0;
  const r = 8;
  const c = 2 * Math.PI * r;
  const dash = `${(ratio * c).toFixed(2)} ${c.toFixed(2)}`;
  const pct = Math.round(ratio * 100);
  return (
    <span
      className="shell-compose__ctx"
      title={
        props.title ||
        `上下文 ${formatTokenCount(props.used)} / ${formatTokenCount(props.limit)}（约 ${pct}%）`
      }
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
    </span>
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
