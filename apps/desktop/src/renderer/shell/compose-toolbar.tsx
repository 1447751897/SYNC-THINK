import { ModelPickerPanel } from './ModelPickerPanel.js';
// NewMax-style Compose toolbar menus: permission / reasoning / model picker.
// Menus render via portal + fixed position so parent overflow cannot clip them.
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { listenForFrameCoalescedViewportChange } from './viewport-frame.js';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Lock,
  MessageSquare,
  Mic,
  MicOff,
  Puzzle,
  Shield,
  Square,
  Users,
  Zap,
  X,
} from 'lucide-react';
import type { ContextStatusSection } from '@sync-think/protocol';
import {
  type KernelDetectionResult,
} from '@sync-think/shared';
import { AgentAvatarView } from './AgentAvatarView.js';
import { AgentLimitsCard } from './agent-limits-card.js';
import type { ModelOption } from './NewConversationDialog.js';

export type PermissionMode = 'ask' | 'workspace' | 'full-access';
/** Fixed NewMax-style effort ladder (full set always shown). */
export type ReasoningEffort =
  'auto' | 'minimal' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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
  { value: 'minimal', title: '极低' },
  { value: 'off', title: '关闭' },
  { value: 'low', title: '低' },
  { value: 'medium', title: '中' },
  { value: 'high', title: '高' },
  { value: 'xhigh', title: '超高' },
  { value: 'max', title: '最高' },
];

export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  auto: '自动',
  minimal: '极低',
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

/**
 * Live catalog capacity wins over a stale run snapshot. Changing a model's
 * context window in 设置 must update the ring immediately, even if the last
 * snapshot still carries the previous 128k estimate.
 */
export function resolveDisplayedContextWindow(input: {
  catalogContextWindow?: number;
  snapshotContextWindow?: number;
  snapshotModelContextWindow?: number;
  snapshotEstimated?: boolean;
  modelId?: string;
}): {
  modelContextWindow: number;
  contextWindow: number;
  estimated: boolean;
} {
  const catalog =
    typeof input.catalogContextWindow === 'number' && input.catalogContextWindow > 0
      ? input.catalogContextWindow
      : undefined;
  const snapshotModel =
    typeof input.snapshotModelContextWindow === 'number' && input.snapshotModelContextWindow > 0
      ? input.snapshotModelContextWindow
      : undefined;
  const snapshotWindow =
    typeof input.snapshotContextWindow === 'number' && input.snapshotContextWindow > 0
      ? input.snapshotContextWindow
      : undefined;
  const modelContextWindow = catalog ?? snapshotModel ?? estimateContextWindow(input.modelId);
  return {
    modelContextWindow,
    contextWindow: catalog ?? snapshotWindow ?? modelContextWindow,
    estimated: !catalog && input.snapshotEstimated === true,
  };
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
    return listenForFrameCoalescedViewportChange(update);
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

/** The current permission is always legible, in both new and existing conversations. */
export const PermissionTrigger = forwardRef<HTMLButtonElement, {
  value: PermissionMode;
  open: boolean;
  onClick(): void;
}>(function PermissionTrigger({ value, open, onClick }, ref) {
  const option = PERMISSION_OPTIONS.find((candidate) => candidate.value === value) ?? PERMISSION_OPTIONS[0]!;
  const Icon = option.Icon;
  return (
    <button
      ref={ref}
      type="button"
      className="shell-compose__tool shell-compose__permission"
      data-mode={value}
      data-open={open ? '1' : '0'}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={'权限：' + option.title}
      title={'权限：' + option.title}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden="true" />
      <span className="shell-compose__tool-label">{option.title}</span>
    </button>
  );
});

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
/** Display only. Conversation selection belongs to the sidebar and new-chat flow. */
export function ComposerIdentity(props: {
  track: 'model' | 'agent' | 'team';
  label: string;
  avatar?: { name: string; avatar?: string };
  testId?: string;
}) {
  const Icon = props.track === 'agent' ? Bot : props.track === 'team' ? Users : MessageSquare;
  return (
    <span className="shell-compose__identity" data-testid={props.testId} title={`对话对象：${props.label}`}>
      {props.avatar?.avatar?.trim() ? (
        <AgentAvatarView name={props.avatar.name} avatar={props.avatar.avatar} size={18} />
      ) : (
        <Icon size={15} />
      )}
      <span className="shell-compose__identity-label">{props.label}</span>
    </span>
  );
}

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
        <span className="min-w-0 flex-1">
          {selected.size > 0 ? `本轮 Skill · ${selected.size}` : '本轮 Skill'}
        </span>
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
            return (
              <button
                key={skill.skillVersionId}
                type="button"
                role="menuitemcheckbox"
                aria-checked={active}
                data-testid={`turn-skill-option-${skill.skillVersionId}`}
                className={`shell-menu__item ${active ? 'is-active' : ''}`}
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
  | { status: 'checking' }
  | { status: 'installing' }
  | { status: 'verifying' }
  | { status: 'success' }
  | { status: 'error'; error: string };

/**
 * Compact transparent kernel mark used by the picker and the compose chip.
 * The fixed box normalises optical size without adding a tile or border.
 */
export function ModelPickerMenu(props: {
  open: boolean;
  models: readonly ModelOption[];
  selectedModelId: string;
  defaultLabel: string;
  reasoningEffort?: ReasoningEffort;
  anchorEl: HTMLElement | null;
  /** Render the real compose button beside the portalled menu when mounted in ChatView. */
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
  return <ModelPickerPanel {...props}
    reasoningLabels={REASONING_LABELS} positionMenu={resolveFloatingMenuStyle} />;
}

/**
 * Context occupancy ring. Hover shows a NewMax-style "上下文窗口" card
 * (see AgentLimitsCard: window bar + collapsible token breakdown + quotas).
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
   * 'configured' / 'kernel-capped' (non-overridable kernel native cap) /
   * 'estimated' (no metadata, fell back to 128k) /
   * 'kernel-reported' (Claude /context or Codex tokenUsage window).
   */
  contextWindowSource?: 'configured' | 'kernel-capped' | 'estimated' | 'kernel-reported';
  /** Runtime-computed ratio; may exceed 1 when the request is over the window. */
  usageRatio?: number;
  /** Runtime-owned auto-compact threshold (currently 70%). */
  compactThreshold?: number;
  /** Timestamp of the latest successful durable context compact. */
  compactedAt?: string;
  /** Audit-only Runtime breakdown. It contains category names and token counts only. */
  sections?: ContextStatusSection[];
  /**
   * True when `used` comes from an external kernel's reported occupancy
   * (claude-code / codex) instead of the host estimate. Host 70% auto-compact
   * copy stays hidden; kernel-reported category rows still show when present.
   */
  kernelSelfManaged?: boolean;
  /** Kernel `/context` or tokenUsage breakdown; names and token counts only. */
  occupancySections?: Array<{ name: string; tokens: number }>;
  /** 本会话累计时长（ms），tooltip 里展示。 */
  sessionDurationMs?: number;
  /** 本会话累计消耗 tokens（输入+输出跨全部轮次），tooltip 里展示。 */
  sessionTokens?: number;
  /** Active kernel label, shown in the context header for subprocess kernels. */
  kernelLabel?: string;
  /** Kernel id used to resolve the brand mark in the header badge. */
  kernelId?: string;
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
  const compactThreshold =
    typeof props.compactThreshold === 'number' &&
    Number.isFinite(props.compactThreshold) &&
    props.compactThreshold > 0
      ? Math.min(1, props.compactThreshold)
      : 0.7;
  const usedLabel = formatTokenCount(props.used);
  const limitLabel = formatTokenCount(props.limit);

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
              <AgentLimitsCard
                used={props.used}
                limit={props.limit}
                modelContextWindow={props.modelContextWindow}
                contextWindowEstimated={props.contextWindowEstimated}
                contextWindowSource={props.contextWindowSource}
                usageRatio={props.usageRatio}
                compactThreshold={props.compactThreshold}
                compactedAt={props.compactedAt}
                kernelSelfManaged={props.kernelSelfManaged}
                kernelLabel={props.kernelLabel}
                kernelId={props.kernelId}
                sections={props.sections}
                occupancySections={props.occupancySections}
                sessionDurationMs={props.sessionDurationMs}
                sessionTokens={props.sessionTokens}
              />
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
        aria-haspopup="dialog"
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
