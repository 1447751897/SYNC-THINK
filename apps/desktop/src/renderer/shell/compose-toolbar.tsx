// NewMax-style Compose toolbar menus: permission / reasoning / model picker.
// Menus render via portal + fixed position so parent overflow cannot clip them.
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  ImagePlus,
  Lock,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  Puzzle,
  Shield,
  Sparkles,
  Square,
  Users,
  Zap,
  X,
} from 'lucide-react';
import type { ContextStatusSection, ContextStatusSectionType } from '@sync-think/protocol';
import type { KernelDetectionResult } from '@sync-think/shared';
import { AgentAvatarView } from './AgentAvatarView.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo, resolveKernelDisplayName } from './brand-icons.js';
import type { ModelOption } from './NewConversationDialog.js';
import { ComposerMenuHighlight } from './ComposerMenuHighlight.js';

export type PermissionMode = 'ask' | 'workspace' | 'full-access';
/** Fixed NewMax-style effort ladder (full set always shown). */
export type ReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL = 1;
export const SKILL_COLLAPSED_TOOLBAR_LEVEL = 2;
export type ComposerToolbarCollapseLevel = 0 | 1 | 2;

export function resolveToolbarCollapseLevel(params: {
  expandedWidth: number;
  availableWidth: number;
  permissionCollapseWidth: number;
}): ComposerToolbarCollapseLevel {
  if (params.expandedWidth <= params.availableWidth) return 0;
  return params.expandedWidth - params.permissionCollapseWidth <= params.availableWidth
    ? PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL
    : SKILL_COLLAPSED_TOOLBAR_LEVEL;
}

const COMPOSER_TOOLBAR_GAP = 8;
const COMPOSER_TOOLBAR_HORIZONTAL_PADDING = 16;

function measureToolbarChildren(element: HTMLElement): number {
  let width = 0;
  for (const child of element.children) {
    const childWidth = (child as HTMLElement).offsetWidth;
    if (childWidth === 0) continue;
    if (width > 0) width += COMPOSER_TOOLBAR_GAP;
    width += childWidth;
  }
  return width;
}

export interface ComposerToolbarCollapseOptions {
  permissionMenuOpen?: boolean;
  onPermissionMenuOpenChange?(open: boolean): void;
}

export interface ComposerToolbarCollapseController {
  collapseLevel: ComposerToolbarCollapseLevel;
  outerRef: MutableRefObject<HTMLDivElement | null>;
  leftRef: MutableRefObject<HTMLDivElement | null>;
  rightRef: MutableRefObject<HTMLDivElement | null>;
  permissionRef: MutableRefObject<HTMLDivElement | null>;
  measure(): void;
}

/**
 * NewMax toolbar collapse state. The caller owns the markup and hides permission
 * at level 1, then Skill/secondary controls at level 2.
 */
export function useComposerToolbarCollapse(
  options: ComposerToolbarCollapseOptions = {},
): ComposerToolbarCollapseController {
  const permissionMenuOpen = options.permissionMenuOpen ?? false;
  const onPermissionMenuOpenChange = options.onPermissionMenuOpenChange;
  const [collapseLevel, setCollapseLevel] = useState<ComposerToolbarCollapseLevel>(0);
  const collapseLevelRef = useRef<ComposerToolbarCollapseLevel>(0);
  const outerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const permissionRef = useRef<HTMLDivElement>(null);
  const expandedWidthRef = useRef<number | null>(null);
  const permissionCollapseWidthRef = useRef(0);
  const permissionMenuOpenRef = useRef(permissionMenuOpen);
  const onPermissionMenuOpenChangeRef = useRef(onPermissionMenuOpenChange);
  permissionMenuOpenRef.current = permissionMenuOpen;
  onPermissionMenuOpenChangeRef.current = onPermissionMenuOpenChange;

  const measure = useCallback(() => {
    const outer = outerRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!outer || !left || !right) return;

    const availableWidth = Math.max(0, outer.clientWidth - COMPOSER_TOOLBAR_HORIZONTAL_PADDING);
    const measuredWidth =
      measureToolbarChildren(left) + COMPOSER_TOOLBAR_GAP + measureToolbarChildren(right);

    if (collapseLevelRef.current === 0) {
      expandedWidthRef.current = measuredWidth;
      permissionCollapseWidthRef.current =
        (permissionRef.current?.offsetWidth ?? 0) + COMPOSER_TOOLBAR_GAP;
    }

    const nextLevel = resolveToolbarCollapseLevel({
      expandedWidth: expandedWidthRef.current ?? measuredWidth,
      availableWidth,
      permissionCollapseWidth: permissionCollapseWidthRef.current,
    });
    if (nextLevel === collapseLevelRef.current) return;

    collapseLevelRef.current = nextLevel;
    if (nextLevel > 0 && permissionMenuOpenRef.current) {
      onPermissionMenuOpenChangeRef.current?.(false);
    }
    setCollapseLevel(nextLevel);
  }, []);

  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => queueMicrotask(measure));
    observer.observe(outer);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (collapseLevel > 0 && permissionMenuOpen) {
      onPermissionMenuOpenChange?.(false);
    }
  }, [collapseLevel, onPermissionMenuOpenChange, permissionMenuOpen]);

  return { collapseLevel, outerRef, leftRef, rightRef, permissionRef, measure };
}

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
  { value: 'max', title: '最高' },
];

export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  auto: '自动',
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
};

/** Full fixed ladder — always show every rung (no per-model filtering). */
export function reasoningLevelsForModel(_modelId?: string): readonly ReasoningEffort[] {
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
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export interface FloatingAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

function rectFromEl(el: HTMLElement | null): FloatingAnchorRect | null {
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

export function resolveFloatingMenuStyle(
  anchor: FloatingAnchorRect,
  viewport: { width: number; height: number },
  options: {
    width: number;
    maxHeight: number;
    align?: 'left' | 'right';
    gap?: number;
    padding?: number;
    minSpaceBeforeFlip?: number;
  },
): React.CSSProperties {
  const gap = options.gap ?? 8;
  const padding = options.padding ?? 8;
  const minSpaceBeforeFlip = options.minSpaceBeforeFlip ?? 160;
  const width = Math.max(0, Math.min(options.width, viewport.width - padding * 2));
  const spaceAbove = Math.max(0, anchor.top - gap - padding);
  const spaceBelow = Math.max(0, viewport.height - anchor.bottom - gap - padding);
  const placeAbove = spaceAbove >= minSpaceBeforeFlip || spaceAbove >= spaceBelow;
  const available = placeAbove ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(0, Math.min(options.maxHeight, available));
  const preferredLeft = options.align === 'right' ? anchor.right - width : anchor.left;
  const maxLeft = Math.max(padding, viewport.width - width - padding);
  const left = Math.max(padding, Math.min(preferredLeft, maxLeft));

  return {
    position: 'fixed',
    width,
    maxHeight,
    zIndex: 10000,
    left,
    ...(placeAbove ? { bottom: viewport.height - anchor.top + gap } : { top: anchor.bottom + gap }),
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
  role?: React.AriaRole;
  ariaLabel?: string;
  /** Extra portal roots (e.g. model flyout) that should not count as outside clicks. */
  satelliteEls?: Array<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const open = props.open;
  const onClose = props.onClose;
  const anchorEl = props.anchorEl;
  const satelliteEls = props.satelliteEls;
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<FloatingAnchorRect | null>(null);
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
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorEl?.contains(t)) return;
      // Model flyout (and any other satellite portal) lives outside menuRef;
      // treating it as outside would close the picker before the click lands.
      if (satelliteEls?.some((el) => el?.contains(t))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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
  }, [anchorEl, onClose, open, satelliteEls]);

  if (!props.open || !anchor || typeof document === 'undefined') return null;

  const maxH = Math.min(420, Math.floor(window.innerHeight * 0.6));
  const style = resolveFloatingMenuStyle(
    anchor,
    { width: window.innerWidth, height: window.innerHeight },
    { width, maxHeight: maxH, align: props.align },
  );

  return createPortal(
    <div
      ref={menuRef}
      className="shell-menu shell-menu--portal"
      style={style}
      role={props.role ?? 'menu'}
      aria-label={props.ariaLabel}
    >
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
  agents: readonly { id: string; name: string; description?: string; avatar?: string }[];
  teams: readonly { id: string; name: string; description?: string; avatar?: string }[];
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
    items: readonly { id: string; name: string; description?: string; avatar?: string }[];
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
            <div className="shell-menu__item-desc">
              不经过智能体人设，右侧模型选择器决定用哪个模型
            </div>
          </div>
          {props.currentTrack === 'model' ? (
            <Check size={14} className="shell-menu__check" />
          ) : null}
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
                      {item.avatar?.trim() ? (
                        <AgentAvatarView name={item.name} avatar={item.avatar} size={22} />
                      ) : (
                        <Icon size={15} />
                      )}
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
      <div className="shell-menu__heading">思考强度</div>
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

export function NetworkSearchSetting(props: {
  enabled: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
  onDismiss?(): void;
  onChange(enabled: boolean): void;
}) {
  return (
    <div
      ref={props.rootRef}
      className="shell-mention-setting"
      data-testid="compose-network-setting"
      onKeyDown={(event) => {
        if (!props.onDismiss) return;
        const firstSegment = event.currentTarget.querySelector<HTMLButtonElement>(
          '.shell-mention-setting__segment',
        );
        const returnToInput =
          event.key === 'Escape' ||
          (event.key === 'Tab' && event.shiftKey && event.target === firstSegment);
        if (!returnToInput) return;
        event.preventDefault();
        event.stopPropagation();
        props.onDismiss();
      }}
    >
      <div className="shell-mention-setting__identity">
        <span className="shell-mention-setting__icon" aria-hidden="true">
          <Globe size={15} />
        </span>
        <span className="shell-mention-setting__label">联网搜索</span>
      </div>
      <div className="shell-mention-setting__segments" role="group" aria-label="联网搜索">
        <button
          type="button"
          className="shell-mention-setting__segment"
          data-active={props.enabled ? '1' : '0'}
          aria-pressed={props.enabled}
          aria-label="开启联网搜索"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onChange(true)}
        >
          开启
        </button>
        <button
          type="button"
          className="shell-mention-setting__segment"
          data-active={!props.enabled ? '1' : '0'}
          aria-pressed={!props.enabled}
          aria-label="关闭联网搜索"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onChange(false)}
        >
          关闭
        </button>
      </div>
    </div>
  );
}

export function ComposeAtSettingsMenu(props: {
  open: boolean;
  enabled: boolean;
  anchorEl: HTMLElement | null;
  networkSettingRef?: React.Ref<HTMLDivElement>;
  onClose(): void;
  onDismiss(): void;
  onChange(enabled: boolean): void;
  onUpload?(): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  return (
    <MenuShell
      open={props.open}
      onClose={props.onClose}
      anchorEl={props.anchorEl}
      width={Math.max(320, props.anchorEl?.getBoundingClientRect().width ?? 320)}
      role="dialog"
      ariaLabel="添加上下文和设置"
    >
      <div ref={menuRef} className="shell-mention-pop--context shell-compose-at-menu">
        <ComposerMenuHighlight containerRef={menuRef} activeIndex={activeIndex} />
        <div className="shell-mention-pop__section-label">来源与上下文</div>
        {props.onUpload ? (
          <button
            type="button"
            className="shell-mention-pop__upload"
            data-composer-menu-index={0}
            onMouseEnter={() => setActiveIndex(0)}
            onClick={() => {
              props.onClose();
              props.onUpload?.();
            }}
          >
            <ImagePlus size={13} aria-hidden="true" />
            <span>上传图片</span>
            <span className="shell-mention-pop__upload-hint">PNG / JPG</span>
          </button>
        ) : null}
        <div
          className="shell-mention-pop__settings"
          data-composer-menu-index={props.onUpload ? 1 : 0}
          onMouseEnter={() => setActiveIndex(props.onUpload ? 1 : 0)}
        >
          <NetworkSearchSetting
            enabled={props.enabled}
            rootRef={props.networkSettingRef}
            onDismiss={props.onDismiss}
            onChange={props.onChange}
          />
        </div>
        <div className="shell-composer-menu__hint">输入以添加来源和上下文</div>
      </div>
    </MenuShell>
  );
}

export interface SkillPickerOption {
  skillVersionId: string;
  name: string;
  version: string;
  description: string;
}

export function SkillPickerMenu(props: {
  open: boolean;
  options: readonly SkillPickerOption[];
  selectedSkillVersionIds: readonly string[];
  loading?: boolean;
  error?: string;
  anchorEl: HTMLElement | null;
  onClose(): void;
  onToggle(skillVersionId: string): void;
  onClear(): void;
  onRetry?(): void;
}) {
  const selected = new Set(props.selectedSkillVersionIds);
  return (
    <MenuShell open={props.open} onClose={props.onClose} anchorEl={props.anchorEl} width={320}>
      <div className="shell-menu__heading">
        <span className="min-w-0 flex-1">本轮 Skill · {selected.size}/8</span>
        {selected.size > 0 ? (
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-hover hover:text-text"
            aria-label="清除本轮 Skill"
            title="清除本轮 Skill"
            onClick={props.onClear}
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      <div className="shell-menu__scroll">
        {props.loading ? (
          <div className="shell-menu__empty" role="status">
            正在加载 Skill…
          </div>
        ) : props.error ? (
          <div className="shell-menu__empty text-error" role="alert">
            <div>{props.error}</div>
            {props.onRetry ? (
              <button
                type="button"
                className="mt-2 text-[12px] font-medium text-accent hover:underline"
                data-testid="turn-skill-retry"
                onClick={props.onRetry}
              >
                重试
              </button>
            ) : null}
          </div>
        ) : props.options.length === 0 ? (
          <div className="shell-menu__empty">当前工作区没有已激活 Skill</div>
        ) : (
          props.options.map((skill) => {
            const active = selected.has(skill.skillVersionId);
            const disabled = !active && selected.size >= 8;
            return (
              <button
                key={skill.skillVersionId}
                type="button"
                role="menuitemcheckbox"
                aria-checked={active}
                disabled={disabled}
                data-testid={`turn-skill-option-${skill.skillVersionId}`}
                className={`shell-menu__item ${active ? 'is-active' : ''} disabled:cursor-not-allowed disabled:opacity-40`}
                onClick={() => props.onToggle(skill.skillVersionId)}
              >
                <span className="shell-menu__item-icon-wrap" data-active={active ? '1' : '0'}>
                  <Puzzle size={15} />
                </span>
                <div className="shell-menu__item-text">
                  <div className="shell-menu__item-title">
                    {skill.name}{' '}
                    <span className="font-normal text-text-faint">@{skill.version}</span>
                  </div>
                  {skill.description ? (
                    <div className="shell-menu__item-desc">{skill.description}</div>
                  ) : null}
                </div>
                {active ? <Check size={14} className="shell-menu__check" /> : null}
              </button>
            );
          })
        )}
      </div>
      <div className="shell-menu__footer">当前会话临时设置</div>
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
export type KernelInstallState =
  | { status: 'installing' }
  | { status: 'verifying' }
  | { status: 'success' }
  | { status: 'error'; error: string };

/**
 * Compact transparent kernel mark used by the picker and the compose chip.
 * The fixed box normalises optical size without adding a tile or border.
 */
function KernelBadge({ iconKey, name }: { iconKey: string; name: string }) {
  const brandLogo = resolveKernelBrandLogo(iconKey);
  return (
    <span
      className={`shell-kernel-badge shell-kernel-badge--${iconKey}`}
      data-testid={`kernel-badge-${iconKey}`}
      title={name}
      aria-label={brandLogo ? undefined : name}
      role={brandLogo ? undefined : 'img'}
    >
      {brandLogo ? <BrandLogoMark logo={brandLogo} size={18} /> : <Sparkles size={16} />}
    </span>
  );
}

export function ModelPickerMenu(props: {
  open: boolean;
  models: readonly ModelOption[];
  selectedModelId: string;
  defaultLabel: string;
  reasoningEffort?: ReasoningEffort;
  anchorEl: HTMLElement | null;
  /** Use the real compose button as the Radix trigger when mounted in ChatView. */
  trigger?: React.ReactElement;
  /** Kernel selector data (Slice 6); empty hides the kernel group. */
  kernels?: readonly KernelDetectionResult[];
  selectedKernelId?: string;
  kernelInstallStates?: Readonly<Record<string, KernelInstallState | undefined>>;
  onPickKernel?(kernelId: string): void;
  onInstallKernel?(kernelId: string): void;
  onClose(): void;
  onPick(modelId: string): void;
  onReasoningChange?(value: ReasoningEffort): void;
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

  const [triggerRect, setTriggerRect] = useState<FloatingAnchorRect | null>(null);
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
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) setOpenSubmenu(null);
  }, [props.open]);

  const setSubmenuState = (key: string, open: boolean) => {
    setOpenSubmenu((current) => (open ? key : current === key ? null : current));
  };

  return (
    <DropdownMenu.Root
      dir="ltr"
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setOpenSubmenu(null);
          props.onClose();
        }
      }}
      modal={false}
    >
      {props.trigger ? (
        <DropdownMenu.Trigger asChild>{props.trigger}</DropdownMenu.Trigger>
      ) : typeof document !== 'undefined' ? (
        createPortal(
          <DropdownMenu.Trigger asChild>
            <span
              aria-hidden="true"
              data-testid="model-picker-anchor"
              style={{
                // The chat column owns a container query. A fixed element
                // inside it is still measured in that container's coordinate
                // space in Chromium, which moves Radix menus off-screen.
                // Keep the virtual anchor under body so its fixed rect is
                // genuinely viewport-relative.
                position: 'fixed',
                left: triggerRect?.left ?? 0,
                top: triggerRect?.top ?? 0,
                width: triggerRect?.width ?? 0,
                height: triggerRect?.height ?? 0,
                pointerEvents: 'none',
              }}
            />
          </DropdownMenu.Trigger>,
          document.body,
        )
      ) : null}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="shell-menu shell-menu--portal shell-menu--model-providers"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          avoidCollisions
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Radix renders Provider items in a second portal; keep the root
          // menu mounted while focus crosses into that flyout.
          onFocusOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={props.onClose}
        >
          <div className="shell-menu__scroll">
            {props.kernels && props.kernels.length > 0 ? (
              <>
                <div className="shell-menu__group-label">内核</div>
                {props.kernels.map((kernel) => {
                  const displayName = resolveKernelDisplayName(kernel.kernelId, kernel.name);
                  const active = kernel.kernelId === props.selectedKernelId;
                  const installState = props.kernelInstallStates?.[kernel.kernelId];
                  const installPending =
                    installState?.status === 'installing' || installState?.status === 'verifying';
                  const canInstall =
                    kernel.kernelId === 'pi' && !kernel.installed && Boolean(props.onInstallKernel);
                  const disabled = installPending || (!kernel.installed && !canInstall);
                  // Installed kernels show a version badge on the right; install /
                  // missing / error copy also stays on that same trailing slot so
                  // every kernel row keeps NewMax's single-line height.
                  const healthyInstalled =
                    kernel.installed && !installPending && installState?.status !== 'error';
                  const showVersionBadge = Boolean(healthyInstalled && kernel.version);
                  const showStatus = !healthyInstalled;
                  let hint: string;
                  if (installState?.status === 'installing') {
                    hint = '安装中 · npm i -g pi';
                  } else if (installState?.status === 'verifying') {
                    hint = '安装成功 · 正在检测';
                  } else if (installState?.status === 'error') {
                    hint = `安装失败 · ${installState.error}`;
                  } else if (installState?.status === 'success' && kernel.installed) {
                    hint = kernel.version ? `安装成功 v${kernel.version}` : '安装成功';
                  } else if (kernel.installed) {
                    hint = kernel.version
                      ? `已安装 v${kernel.version}${kernel.knownGood ? '' : '（版本未验证）'}`
                      : '已安装';
                  } else {
                    hint = kernel.installCommand ? `未安装 · ${kernel.installCommand}` : '未安装';
                  }
                  return (
                    <DropdownMenu.Item
                      key={kernel.kernelId}
                      role="menuitemradio"
                      aria-checked={active}
                      disabled={disabled}
                      data-testid={`kernel-option-${kernel.kernelId}`}
                      aria-label={`${displayName}${kernel.version ? ` v${kernel.version}` : ''} · ${hint}`}
                      className={`shell-menu__item shell-menu__item--kernel ${
                        active ? 'is-active' : ''
                      } ${disabled ? 'is-disabled' : ''}`}
                      onSelect={(event) => {
                        if (kernel.installed && props.onPickKernel) {
                          props.onPickKernel(kernel.kernelId);
                          props.onClose();
                          return;
                        }
                        if (canInstall && !installPending && props.onInstallKernel) {
                          event.preventDefault();
                          props.onInstallKernel(kernel.kernelId);
                        }
                      }}
                    >
                      <span className="shell-menu__selection-slot" aria-hidden="true">
                        {installPending ? (
                          <LoaderCircle size={14} className="shell-menu__kernel-spinner" />
                        ) : active ? (
                          <Check size={14} />
                        ) : null}
                      </span>
                      <KernelBadge iconKey={kernel.icon} name={displayName} />
                      <span className="shell-menu__kernel-name">{displayName}</span>
                      {showVersionBadge ? (
                        <span
                          className="shell-menu__kernel-version"
                          data-testid={`kernel-version-${kernel.kernelId}`}
                          title={`版本 ${kernel.version}`}
                        >
                          v{kernel.version}
                        </span>
                      ) : showStatus ? (
                        <span
                          className={`shell-menu__kernel-status ${
                            installState?.status === 'error' ? 'is-error' : ''
                          }`}
                          data-testid={`kernel-status-${kernel.kernelId}`}
                          title={hint}
                        >
                          {hint}
                        </span>
                      ) : null}
                    </DropdownMenu.Item>
                  );
                })}
                <div className="shell-menu__separator" />
              </>
            ) : null}
            {providers.length === 0 ? (
              <div className="shell-menu__empty">没有可用模型</div>
            ) : (
              providers.map(([providerName, models]) => {
                const ownsSelected = selectedProviderOfModel === providerName;
                const submenuKey = `provider:${providerName}`;
                return (
                  <DropdownMenu.Sub
                    key={providerName}
                    open={openSubmenu === submenuKey}
                    onOpenChange={(open) => setSubmenuState(submenuKey, open)}
                  >
                    <DropdownMenu.SubTrigger
                      data-testid={`model-provider-${providerName}`}
                      className={`shell-menu__item shell-menu__item--provider ${
                        ownsSelected ? 'is-active' : ''
                      }`}
                      onClick={() => setOpenSubmenu(submenuKey)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowRight') {
                          event.preventDefault();
                          setOpenSubmenu(submenuKey);
                        }
                      }}
                    >
                      <span className="shell-menu__selection-slot" aria-hidden="true">
                        {ownsSelected ? <Check size={14} /> : null}
                      </span>
                      <div className="shell-menu__item-text">
                        <div className="shell-menu__item-title">{providerName}</div>
                      </div>
                      <ChevronRight size={14} className="shell-menu__chevron" />
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
                                  role="menuitemradio"
                                  aria-checked={active}
                                  className={`shell-menu__item shell-menu__item--model ${
                                    active ? 'is-active' : ''
                                  }`}
                                  onSelect={() => {
                                    props.onPick(model.modelId);
                                    props.onClose();
                                  }}
                                >
                                  <Sparkles size={13} className="shell-menu__item-icon" />
                                  <div className="shell-menu__item-text">
                                    <div className="shell-menu__item-title">
                                      {model.displayName}
                                    </div>
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
          {props.reasoningEffort && props.onReasoningChange ? (
            <div className="shell-menu__model-footer">
              <DropdownMenu.Sub
                open={openSubmenu === 'reasoning'}
                onOpenChange={(open) => setSubmenuState('reasoning', open)}
              >
                <DropdownMenu.SubTrigger
                  data-testid="model-reasoning-trigger"
                  className="shell-menu__item shell-menu__item--reasoning"
                  onClick={() => setOpenSubmenu('reasoning')}
                >
                  <Brain size={14} className="shell-menu__item-icon" />
                  <div className="shell-menu__item-text">
                    <div className="shell-menu__item-title">思考强度</div>
                  </div>
                  <span className="shell-menu__reasoning-value">
                    {REASONING_LABELS[props.reasoningEffort]}
                  </span>
                  <ChevronRight size={14} className="shell-menu__chevron" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    data-testid="model-reasoning-flyout"
                    className="shell-menu shell-menu--portal shell-menu--reasoning-flyout"
                    sideOffset={6}
                    alignOffset={-6}
                    collisionPadding={8}
                    avoidCollisions
                  >
                    <div className="shell-menu__scroll">
                      {REASONING_OPTIONS.filter((option) =>
                        reasoningLevelsForModel(props.selectedModelId).includes(option.value),
                      ).map((option) => {
                        const active = option.value === props.reasoningEffort;
                        return (
                          <DropdownMenu.Item
                            key={option.value}
                            data-testid={`model-reasoning-option-${option.value}`}
                            role="menuitemradio"
                            aria-checked={active}
                            className={`shell-menu__item shell-menu__item--compact ${
                              active ? 'is-active' : ''
                            }`}
                            onSelect={() => {
                              props.onReasoningChange?.(option.value);
                              props.onClose();
                            }}
                          >
                            <span className="shell-menu__selection-slot" aria-hidden="true">
                              {active ? <Check size={14} /> : null}
                            </span>
                            <div className="shell-menu__item-text">
                              <div className="shell-menu__item-title">{option.title}</div>
                            </div>
                          </DropdownMenu.Item>
                        );
                      })}
                    </div>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </div>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const CONTEXT_SECTION_LABELS: Record<ContextStatusSectionType, string> = {
  system: '系统指令',
  agent: '智能体 / 小队',
  project: '项目上下文',
  summary: '已保存摘要',
  messages: '消息历史',
  tools: '工具定义',
};

function formatContextTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const now = new Date();
  return new Intl.DateTimeFormat('zh-CN', {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
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
  /** Context capacity configured on the selected Provider model. */
  modelContextWindow?: number;
  /** True when the runtime fell back to 128k because the model has no window metadata. */
  contextWindowEstimated?: boolean;
  /**
   * Why the displayed limit may differ from the model's configured window:
   * 'configured' / 'kernel-capped' (non-overridable kernel native cap, e.g.
   * Claude Code 200k) / 'estimated' (no metadata, fell back to 128k).
   */
  contextWindowSource?: 'configured' | 'kernel-capped' | 'estimated';
  /** Runtime-computed ratio; may exceed 1 when the request is over the window. */
  usageRatio?: number;
  /** Runtime-owned auto-compact threshold (currently 70%). */
  compactThreshold?: number;
  /** Timestamp of the latest successful durable context compact. */
  compactedAt?: string;
  /** Audit-only Runtime breakdown. It contains category names and token counts only. */
  sections?: ContextStatusSection[];
  /**
   * True when `used` comes from an external kernel's reported context watermark
   * (claude-code / codex) instead of the host estimate. The host cannot see the
   * kernel's internal breakdown, so the section audit is hidden and replaced by
   * a "kernel-managed" note.
   */
  kernelSelfManaged?: boolean;
  /** 本会话累计时长（ms），tooltip 里展示。 */
  sessionDurationMs?: number;
  /** 本会话累计消耗 tokens（输入+输出跨全部轮次），tooltip 里展示。 */
  sessionTokens?: number;
  /** Active kernel label, shown in the context header for subprocess kernels. */
  kernelLabel?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<FloatingAnchorRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);

  const rawRatio =
    typeof props.usageRatio === 'number' && Number.isFinite(props.usageRatio)
      ? Math.max(0, props.usageRatio)
      : props.limit > 0
        ? Math.max(0, props.used / props.limit)
        : 0;
  const visualRatio = Math.min(1, rawRatio);
  const r = 8;
  const c = 2 * Math.PI * r;
  const dash = `${(visualRatio * c).toFixed(2)} ${c.toFixed(2)}`;
  const pct = Math.round(rawRatio * 100);
  const sections = props.sections ?? [];
  const compactThreshold =
    typeof props.compactThreshold === 'number' &&
    Number.isFinite(props.compactThreshold) &&
    props.compactThreshold > 0
      ? Math.min(1, props.compactThreshold)
      : 0.7;
  const compactPct = Math.round(compactThreshold * 100);
  const compactAtTokens =
    props.limit > 0 ? Math.max(0, Math.round(props.limit * compactThreshold)) : 0;
  const tokensUntilCompact = Math.max(0, compactAtTokens - props.used);
  const compactThresholdReached = compactAtTokens > 0 && props.used >= compactAtTokens;
  const compactedAtLabel = formatContextTimestamp(props.compactedAt);
  const usedLabel = formatTokenCount(props.used);
  const limitLabel = formatTokenCount(props.limit);
  const remaining = Math.max(0, props.limit - props.used);
  const remainingLabel = formatTokenCount(remaining);
  const compactAtLabel = formatTokenCount(compactAtTokens);
  const tokensUntilCompactLabel = formatTokenCount(tokensUntilCompact);
  const exactTokenTitle = (tokens: number) =>
    `${Math.max(0, Math.round(tokens)).toLocaleString('en-US')} Token`;
  // 会话累计（跨全部轮次的总消耗），与「当前上下文窗口」是两个口径：
  // 窗口 = Runtime 当前准备提供给模型的完整上下文；累计 = 本会话所有
  // Provider 请求的 in+out 之和。没有 usage 事件时必须保留“未上报”语义。
  const sessionTokensLabel =
    props.sessionTokens === undefined ? undefined : formatTokenCount(props.sessionTokens);
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
    const tipW = Math.min(292, Math.max(0, window.innerWidth - 16));
    const left = Math.max(8, Math.min(anchor.right - tipW, window.innerWidth - tipW - 8));
    tipStyle = {
      position: 'fixed',
      left,
      bottom: window.innerHeight - anchor.top + 8,
      width: tipW,
      maxHeight: Math.max(180, anchor.top - 16),
      zIndex: 10000,
    };
  }
  const occupancyColor =
    rawRatio >= 0.9
      ? 'var(--color-error)'
      : !props.kernelSelfManaged && rawRatio >= compactThreshold
        ? 'var(--color-warning)'
        : 'var(--color-accent)';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="shell-compose__ctx"
        data-testid="context-ring"
        aria-label={`上下文 ${usedLabel} / ${limitLabel}（约 ${pct}%）`}
        aria-expanded={open}
        title={props.title}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
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
            stroke={occupancyColor}
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
              <div className="shell-ctx-tooltip__header">
                <div>
                  <div className="shell-ctx-tooltip__title-row">
                    <div className="shell-ctx-tooltip__title">当前上下文窗口</div>
                    {props.kernelLabel ? (
                      <span
                        className="shell-ctx-tooltip__kernel"
                        data-testid="context-kernel-label"
                        title={`当前内核：${props.kernelLabel}`}
                      >
                        {props.kernelLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="shell-ctx-tooltip__subtitle">
                    当前模型实际可见的完整上下文窗口
                  </div>
                </div>
                <strong className="shell-ctx-tooltip__headline">
                  {usedLabel}
                  <span> / {limitLabel}</span>
                </strong>
              </div>
              <div
                className="shell-ctx-tooltip__bar"
                role="progressbar"
                aria-label="当前对话上下文容量"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, props.limit)}
                aria-valuenow={Math.max(0, Math.min(props.used, props.limit || props.used))}
              >
                <div
                  className="shell-ctx-tooltip__bar-fill"
                  style={{
                    width: `${visualRatio * 100}%`,
                    background: occupancyColor,
                  }}
                />
                {!props.kernelSelfManaged ? (
                  <span
                    className="shell-ctx-tooltip__bar-threshold"
                    style={{ left: `${compactThreshold * 100}%` }}
                    title={`自动压缩阈值：${compactPct}%`}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              {!props.kernelSelfManaged ? (
                <div
                  className="shell-ctx-tooltip__status"
                  data-state={compactThresholdReached ? 'threshold' : 'healthy'}
                >
                  <span aria-hidden="true" />
                  {compactThresholdReached
                    ? '已达到阈值，发送下一条消息前会自动压缩'
                    : `达到 ${compactPct}% 时，在发送下一条消息前自动压缩`}
                </div>
              ) : null}
              <div className="shell-ctx-tooltip__row">
                <span>当前占用</span>
                <strong data-testid="context-used-value" title={exactTokenTitle(props.used)}>
                  {usedLabel}
                  <span className="shell-ctx-tooltip__pct"> · {pct}%</span>
                </strong>
              </div>
              <div className="shell-ctx-tooltip__row">
                <span>容量上限</span>
                <strong title={exactTokenTitle(props.limit)}>
                  {limitLabel}
                  {props.contextWindowEstimated ? (
                    <span className="shell-ctx-tooltip__pct" data-testid="context-limit-estimated">
                      {' '}
                      · 估算
                    </span>
                  ) : props.contextWindowSource === 'kernel-capped' ? (
                    <span
                      className="shell-ctx-tooltip__pct"
                      data-testid="context-limit-kernel-capped"
                    >
                      {' '}
                      · 受内核限制
                    </span>
                  ) : null}
                </strong>
              </div>
              {props.modelContextWindow !== undefined ? (
                <div className="shell-ctx-tooltip__row">
                  <span>模型配置</span>
                  <strong
                    data-testid="context-model-default"
                    title={exactTokenTitle(props.modelContextWindow)}
                  >
                    {formatTokenCount(props.modelContextWindow)}
                  </strong>
                </div>
              ) : null}
              <div className="shell-ctx-tooltip__row">
                <span>窗口剩余</span>
                <strong title={exactTokenTitle(remaining)}>{remainingLabel}</strong>
              </div>
              {!props.kernelSelfManaged ? (
                <>
                  <div className="shell-ctx-tooltip__row">
                    <span>自动压缩</span>
                    <strong title={exactTokenTitle(compactAtTokens)}>
                      {compactAtLabel}
                      <span className="shell-ctx-tooltip__pct"> · {compactPct}%</span>
                    </strong>
                  </div>
                  <div className="shell-ctx-tooltip__row">
                    <span>距离压缩</span>
                    <strong
                      data-testid="context-compact-distance"
                      title={
                        compactThresholdReached
                          ? '已达到自动压缩阈值'
                          : exactTokenTitle(tokensUntilCompact)
                      }
                    >
                      {compactThresholdReached ? '已达阈值' : tokensUntilCompactLabel}
                    </strong>
                  </div>
                  <div className="shell-ctx-tooltip__row">
                    <span>最近压缩</span>
                    <strong data-testid="context-compacted-at">
                      {compactedAtLabel ?? '尚未发生'}
                    </strong>
                  </div>
                </>
              ) : null}
              {props.kernelSelfManaged ? (
                <div className="shell-ctx-tooltip__hint" data-testid="context-kernel-self-managed">
                  当前占用来自外部内核（Claude Code /
                  Codex）上报的最后一次请求水位；内核历史由内核自管，宿主不可见明细。
                </div>
              ) : (
                <div className="shell-ctx-tooltip__hint">
                  当前占用来自 Runtime 将发送给模型的完整对话上下文，不是单条回复的 Token。
                </div>
              )}
              {props.kernelSelfManaged ? null : sections.length > 0 ? (
                <>
                  <div className="shell-ctx-tooltip__divider" aria-hidden="true" />
                  <div className="shell-ctx-tooltip__title shell-ctx-tooltip__title--section">
                    当前对话上下文构成
                  </div>
                  {sections.map((section) => (
                    <div
                      key={section.type}
                      className="shell-ctx-tooltip__row"
                      data-testid={`context-section-${section.type}`}
                    >
                      <span>{CONTEXT_SECTION_LABELS[section.type]}</span>
                      <strong title={exactTokenTitle(section.tokens)}>
                        {formatTokenCount(section.tokens)}
                      </strong>
                    </div>
                  ))}
                  <div
                    className="shell-ctx-tooltip__row shell-ctx-tooltip__row--muted"
                    data-testid="context-section-total"
                  >
                    <span>构成合计</span>
                    <strong title={exactTokenTitle(props.used)}>{usedLabel}</strong>
                  </div>
                  <p className="shell-ctx-tooltip__hint">
                    各构成按字节估算，四舍五入后合计与「当前占用」一致；工具定义与消息同样为估算值。
                  </p>
                </>
              ) : null}
              <div className="shell-ctx-tooltip__divider" aria-hidden="true" />
              <div className="shell-ctx-tooltip__title shell-ctx-tooltip__title--section">
                会话累计
              </div>
              <div className="shell-ctx-tooltip__row">
                <span>累计 Token 消耗</span>
                <strong
                  data-testid="context-session-tokens"
                  title={
                    props.sessionTokens === undefined
                      ? undefined
                      : exactTokenTitle(props.sessionTokens)
                  }
                >
                  {sessionTokensLabel ?? '尚未上报'}
                </strong>
              </div>
              {sessionDurationLabel ? (
                <div className="shell-ctx-tooltip__row">
                  <span>会话时长</span>
                  <strong>{sessionDurationLabel}</strong>
                </div>
              ) : null}
              <div className="shell-ctx-tooltip__hint">
                会话累计 =
                全部轮次输入与输出的总和，可大于窗口上限；与「当前窗口占用」是两个独立口径，不参与自动压缩判定。
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export type ComposerActionKind = 'voice' | 'send' | 'stop';

export function resolveComposerActionKind(params: {
  hasContent: boolean;
  running: boolean;
  voiceActive?: boolean;
}): ComposerActionKind {
  if (params.running) return params.hasContent ? 'send' : 'stop';
  if (params.voiceActive) return 'voice';
  return params.hasContent ? 'send' : 'voice';
}

export interface ComposerActionSlotProps {
  hasContent: boolean;
  running: boolean;
  /** Optional stable prefix for entry-point-specific regression selectors. */
  testIdPrefix?: string;
  voiceActive?: boolean;
  disabled?: boolean;
  voiceDisabled?: boolean;
  sendDisabled?: boolean;
  stopDisabled?: boolean;
  voiceStartLabel?: string;
  voiceStopLabel?: string;
  sendLabel?: string;
  stopLabel?: string;
  onVoice(): void;
  onSend(): void;
  onStop(): void;
}

/** One NewMax action slot: microphone -> send -> stop as composer state changes. */
export function ComposerActionSlot(props: ComposerActionSlotProps) {
  const kind = resolveComposerActionKind(props);
  const voiceLabel = props.voiceActive
    ? (props.voiceStopLabel ?? '停止语音输入')
    : (props.voiceStartLabel ?? '开始语音输入');
  const label =
    kind === 'stop'
      ? (props.stopLabel ?? '停止当前任务')
      : kind === 'send'
        ? (props.sendLabel ?? '发送 (Enter)')
        : voiceLabel;
  const disabled =
    props.disabled ||
    (kind === 'stop'
      ? props.stopDisabled
      : kind === 'send'
        ? props.sendDisabled
        : props.voiceDisabled);
  const className =
    kind === 'voice'
      ? `shell-compose__voice${props.voiceActive ? ' is-active' : ''}`
      : `shell-compose__send${kind === 'stop' ? ' is-stop' : ''}`;

  return (
    <button
      type="button"
      className={className}
      data-testid={`${props.testIdPrefix ?? 'compose'}-${kind}`}
      data-action={kind}
      aria-label={label}
      aria-pressed={kind === 'voice' ? Boolean(props.voiceActive) : undefined}
      title={label}
      disabled={Boolean(disabled)}
      onClick={kind === 'stop' ? props.onStop : kind === 'send' ? props.onSend : props.onVoice}
    >
      {kind === 'stop' ? (
        <Square size={12} fill="currentColor" aria-hidden="true" />
      ) : kind === 'send' ? (
        <ArrowUp size={18} aria-hidden="true" />
      ) : props.voiceActive ? (
        <MicOff size={15} aria-hidden="true" />
      ) : (
        <Mic size={15} aria-hidden="true" />
      )}
    </button>
  );
}

export type ComposerModelMode = 'execute' | 'plan' | 'goal';

export interface ModelTriggerProps {
  label: string;
  reasoningLabel?: string;
  mode?: ComposerModelMode;
  planLabel?: string;
  planReasoningLabel?: string;
  open: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onClick(): void;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as React.MutableRefObject<T | null>).current = value;
}

export const ModelTrigger = forwardRef<HTMLButtonElement, ModelTriggerProps>(
  function ModelTrigger(props, forwardedRef) {
    const planMode = props.mode === 'plan';
    const displayLabel = planMode && props.planLabel?.trim() ? props.planLabel : props.label;
    const displayReasoningLabel =
      planMode && props.planReasoningLabel ? props.planReasoningLabel : props.reasoningLabel;
    const actionLabel = planMode ? '切换规划模型' : '切换模型';
    return (
      <button
        ref={(node) => {
          assignRef(props.buttonRef, node);
          assignRef(forwardedRef, node);
        }}
        type="button"
        className="shell-compose__model-btn"
        data-open={props.open ? '1' : '0'}
        data-model-mode={planMode ? 'plan' : 'execute'}
        aria-haspopup="menu"
        aria-expanded={props.open}
        onClick={props.onClick}
        title={
          displayReasoningLabel ? `${actionLabel}，思考强度：${displayReasoningLabel}` : actionLabel
        }
      >
        <span className="shell-compose__model-label">{displayLabel}</span>
        {displayReasoningLabel ? (
          <span className="shell-compose__model-reasoning">{displayReasoningLabel}</span>
        ) : null}
        <ChevronDown size={12} />
      </button>
    );
  },
);
ModelTrigger.displayName = 'ModelTrigger';
