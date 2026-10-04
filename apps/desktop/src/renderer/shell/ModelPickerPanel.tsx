import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check, ChevronDown, Cpu, Search, X, LoaderCircle } from 'lucide-react';
import {
  REASONING_EFFORT_LEVELS,
  isKernelExecutable,
  isKernelExecutionSupported,
  kernelExecutionUnavailableReason,
  type KernelDetectionResult,
} from '@sync-think/shared';
import type { ModelOption } from './NewConversationDialog.js';
import type { FloatingAnchorRect, KernelInstallState, ReasoningEffort } from './composer-toolbar-types.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo, resolveKernelDisplayName } from './brand-icons.js';
import { ProviderIdentityMark } from './ProviderIdentityMark.js';
import { listenForFrameCoalescedViewportChange } from './viewport-frame.js';

interface Props {
  open: boolean;
  models: readonly ModelOption[];
  selectedModelId: string;
  defaultLabel: string;
  reasoningEffort?: ReasoningEffort;
  anchorEl: HTMLElement | null;
  trigger?: React.ReactElement;
  kernels?: readonly KernelDetectionResult[];
  selectedKernelId?: string;
  kernelInstallStates?: Readonly<Record<string, KernelInstallState | undefined>>;
  onPickKernel?(kernelId: string): void;
  onInstallKernel?(kernelId: string): void;
  onClose(): void;
  onPick(modelId: string): void;
  onReasoningChange?(value: ReasoningEffort): void;
  reasoningLabels: Record<ReasoningEffort, string>;
  positionMenu(
    anchor: FloatingAnchorRect,
    viewport: { width: number; height: number },
    options: { width: number; maxHeight: number; align?: 'left' | 'right' },
  ): CSSProperties;
}
const EFFORT_LEVELS: readonly ReasoningEffort[] = REASONING_EFFORT_LEVELS.filter(level => level !== 'auto' && level !== 'off');
const providerKey = (model: ModelOption) => model.providerId || 'name:' + model.providerName;

function beside(
  button: HTMLElement | null,
  width: number,
  height: number,
  panel: HTMLElement | null,
): CSSProperties {
  if (!button) return { display: 'none' };
  const rect = button.getBoundingClientRect();
  const edge = panel?.getBoundingClientRect() ?? rect;
  const right = edge.right + 8;
  const left = right + width <= window.innerWidth - 8 ? right : edge.left - width - 8;
  return {
    position: 'fixed',
    width: Math.min(width, window.innerWidth - 16),
    left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(rect.top - 8, window.innerHeight - height - 8)),
    zIndex: 10031,
  };
}
function navigateButtons(event: React.KeyboardEvent, selector: string) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(selector));
  if (!buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

/** Reference-inspired model menu; provider identity and execution settings stay application-owned. */
export function ModelPickerPanel(props: Props) {
  const providers = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; name: string; providerId?: string; models: ModelOption[] }
    >();
    for (const model of props.models) {
      const id = providerKey(model);
      const group = groups.get(id) ?? {
        id,
        name: model.providerName,
        providerId: model.providerId,
        models: [],
      };
      group.models.push(model);
      groups.set(id, group);
    }
    return [...groups.values()];
  }, [props.models]);
  const selected = props.models.find((model) => model.modelId === props.selectedModelId);
  const selectedProvider = selected ? providerKey(selected) : providers[0]?.id;
  const [provider, setProvider] = useState(selectedProvider);
  const activeProvider =
    providers.find((group) => group.id === provider) ??
    providers.find((group) => group.id === selectedProvider) ??
    providers[0];
  const [query, setQuery] = useState('');
  const [popover, setPopover] = useState<'effort' | 'kernel'>();
  const [anchor, setAnchor] = useState<FloatingAnchorRect>();
  const root = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const effortButton = useRef<HTMLButtonElement>(null);
  const kernelButton = useRef<HTMLButtonElement>(null);
  const kernelPicker = useRef<HTMLDivElement>(null);
  const kernelMenu = useRef<HTMLDivElement>(null);
  const modelList = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const kernelMenuId = useId();
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    if (!props.open) return;
    setProvider(selectedProvider);
    setQuery('');
    setPopover(undefined);
    // Reset only when the picker opens; browsing another provider is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);
  useLayoutEffect(() => {
    if (!props.open || !props.anchorEl) {
      setAnchor(undefined);
      return;
    }
    const update = () => {
      const rect = props.anchorEl!.getBoundingClientRect();
      setAnchor({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      });
    };
    update();
    return listenForFrameCoalescedViewportChange(update);
  }, [props.open, props.anchorEl]);
  const positioned = Boolean(anchor);
  useLayoutEffect(() => {
    if (props.open && positioned) search.current?.focus();
  }, [props.open, positioned]);
  useEffect(() => {
    if (!props.open) return;
    const outside = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !props.anchorEl?.contains(event.target as Node)
      )
        onClose.current();
      else if (popover === 'kernel' && !kernelPicker.current?.contains(event.target as Node))
        setPopover(undefined);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (popover) {
        (popover === 'kernel' ? kernelButton : effortButton).current?.focus();
        setPopover(undefined);
      } else {
        onClose.current();
        props.anchorEl?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [props.open, props.anchorEl, popover]);
  const needle = query.trim().toLocaleLowerCase();
  const models = needle
    ? props.models.filter((model) =>
        (model.displayName + ' ' + model.providerName).toLocaleLowerCase().includes(needle),
      )
    : (activeProvider?.models ?? []);
  const currentEffort = props.reasoningEffort ?? 'auto';
  const effortIndex = Math.max(0, EFFORT_LEVELS.indexOf(currentEffort));
  const hasSearch = Boolean(needle);
  useLayoutEffect(() => {
    if (!props.open || !positioned || !modelList.current) return;
    modelList.current.scrollTop = 0;
    if (!hasSearch)
      modelList.current
        .querySelector<HTMLElement>('[aria-checked="true"]')
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [props.open, positioned, activeProvider?.id, query, hasSearch]);
  const menuHeight = props.kernels?.length ? 326 : 280;
  const currentKernelId = props.selectedKernelId ?? 'native';
  const currentKernel = props.kernels?.find((item) => item.kernelId === currentKernelId);
  const currentKernelName = resolveKernelDisplayName(
    currentKernelId,
    currentKernel?.name ?? 'Sync-Think',
  );
  const currentKernelLogo = resolveKernelBrandLogo(currentKernel?.icon ?? currentKernelId);
  useLayoutEffect(() => {
    if (!props.open || popover !== 'kernel') return;
    const menu = kernelMenu.current;
    const selectedOption = menu?.querySelector<HTMLButtonElement>(
      '[aria-checked="true"]:not(:disabled)',
    );
    (selectedOption ?? menu?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
  }, [props.open, popover]);
  const chooseEffort = (value: ReasoningEffort) => props.onReasoningChange?.(value);
  // A modal owns pointer events, focus and its accessibility subtree. Portalling
  // to body from inside that modal makes this panel visible but inert. Mount at
  // the dialog root (not the scrolling field) while keeping viewport positioning.
  // Standalone chat pickers still escape their composer through the body portal.
  const portalContainer =
    props.anchorEl?.closest('dialog, [role="dialog"], [role="alertdialog"]') ?? document.body;
  const content =
    props.open && anchor
      ? createPortal(
          <div
            ref={root}
            role="dialog"
            aria-label="选择模型"
            className="shell-model-picker"
            data-has-kernels={Boolean(props.kernels?.length) || undefined}
            style={{
              ...props.positionMenu(
                anchor,
                { width: window.innerWidth, height: window.innerHeight },
                { width: 368, maxHeight: menuHeight, align: 'right' },
              ),
              height: menuHeight,
              gridTemplateRows: props.kernels?.length ? 'minmax(96px, 1fr) 42px' : undefined,
              zIndex: 10030,
            }}
          >
            <aside
              className="shell-model-picker__providers"
              role="tablist"
              aria-label="供应商"
              aria-orientation="vertical"
              onKeyDown={(event) => navigateButtons(event, '[role=tab]')}
            >
              {providers.map((group) => (
                <button
                  type="button"
                  role="tab"
                  key={group.id}
                  title={group.name}
                  aria-label={group.name}
                  aria-selected={activeProvider?.id === group.id}
                  aria-controls={panelId}
                  tabIndex={activeProvider?.id === group.id ? 0 : -1}
                  data-testid={'model-provider-' + group.name}
                  onClick={() => {
                    setProvider(group.id);
                    setQuery('');
                    setPopover(undefined);
                  }}
                  onFocus={() => {
                    setProvider(group.id);
                    setQuery('');
                    setPopover(undefined);
                  }}
                >
                  <span className="shell-model-picker__provider-mark">
                    <ProviderIdentityMark
                      providerId={group.providerId}
                      name={group.name}
                      size={20}
                    />
                  </span>
                </button>
              ))}
            </aside>
            <div className="shell-model-picker__main" id={panelId}>
              <header className="shell-model-picker__header">
                <span>{needle ? '搜索结果' : '模型'}</span>
                <label className="shell-model-picker__search">
                  <input
                    ref={search}
                    value={query}
                    aria-label="搜索模型"
                    placeholder="快速搜索"
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => setPopover(undefined)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        root.current
                          ?.querySelector<HTMLButtonElement>('[data-model-option]')
                          ?.focus();
                      }
                    }}
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="清空搜索"
                      onClick={() => {
                        setQuery('');
                        search.current?.focus();
                      }}
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <Search size={14} />
                  )}
                </label>
              </header>
              <div
                ref={modelList}
                className="shell-model-picker__models"
                role="menu"
                aria-label={needle ? '模型搜索结果' : (activeProvider?.name ?? '模型')}
                onKeyDown={(event) => navigateButtons(event, '[data-model-option]')}
              >
                <div
                  className="shell-model-picker__items"
                  key={hasSearch ? 'search' : activeProvider?.id}
                >
                  {models.map((model) => {
                    const active = model.modelId === props.selectedModelId;
                    return (
                      <div
                        key={model.modelId}
                        className="shell-model-picker__row"
                        data-selected={active || undefined}
                        role="none"
                      >
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          data-model-option
                          title={model.displayName}
                          onClick={() => {
                            setPopover(undefined);
                            props.onPick(model.modelId);
                          }}
                        >
                          <ProviderIdentityMark
                            providerId={model.providerId}
                            name={model.providerName}
                            size={17}
                          />
                          <span className="shell-model-picker__model-name">
                            {model.displayName}
                            {needle ? <small>{model.providerName}</small> : null}
                          </span>
                        </button>
                        {active && props.reasoningEffort && props.onReasoningChange ? (
                          <button
                            type="button"
                            ref={effortButton}
                            className="shell-model-picker__effort"
                            data-testid="model-reasoning-trigger"
                            aria-label={'思考强度：' + props.reasoningLabels[currentEffort]}
                            aria-haspopup="dialog"
                            aria-expanded={popover === 'effort'}
                            onClick={() =>
                              setPopover((value) => (value === 'effort' ? undefined : 'effort'))
                            }
                          >
                            {props.reasoningLabels[currentEffort]}
                            <ChevronDown size={12} />
                          </button>
                        ) : null}
                        <span
                          className="shell-model-picker__radio"
                          aria-hidden="true"
                          data-checked={active || undefined}
                        />
                      </div>
                    );
                  })}
                </div>
                {!models.length ? (
                  <div className="shell-model-picker__empty">
                    {needle ? '没有匹配的模型' : '没有可用模型'}
                    <small>
                      {needle ? '试试模型名称或供应商名称' : '请先在模型设置中添加并启用模型'}
                    </small>
                  </div>
                ) : null}
              </div>
            </div>
            {popover === 'effort' && props.onReasoningChange ? (
              <div
                className="shell-model-picker__popover shell-model-picker__effort-popover"
                role="dialog"
                aria-label="思考强度"
                data-testid="model-reasoning-flyout"
                style={beside(effortButton.current, 274, 182, root.current)}
              >
                <header>
                  <Brain size={14} />
                  <span>
                    思考强度 <strong>{props.reasoningLabels[currentEffort]}</strong>
                  </span>
                </header>
                <div className="shell-model-picker__effort-modes">
                  {(['auto', 'off'] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={currentEffort === value}
                      data-testid={'model-reasoning-option-' + value}
                      onClick={() => chooseEffort(value)}
                    >
                      {props.reasoningLabels[value]}
                    </button>
                  ))}
                </div>
                <div className="shell-model-picker__effort-scale">
                  <span>更快</span>
                  <span>更深入</span>
                </div>
                <div
                  className="shell-model-picker__slider"
                  data-mode={currentEffort}
                  style={
                    {
                      '--effort-progress': EFFORT_LEVELS.includes(currentEffort)
                        ? (effortIndex / (EFFORT_LEVELS.length - 1)) * 100 + '%'
                        : '0%',
                    } as CSSProperties
                  }
                >
                  <span className="shell-model-picker__track" aria-hidden="true">
                    <span className="shell-model-picker__fill" />
                  </span>
                  <span className="shell-model-picker__ticks" aria-hidden="true">
                    {EFFORT_LEVELS.map((value, index) => (
                      <i
                        key={value}
                        data-active={
                          (EFFORT_LEVELS.includes(currentEffort) && index <= effortIndex) ||
                          undefined
                        }
                      />
                    ))}
                  </span>
                  <input
                    type="range"
                    aria-label="思考强度档位"
                    min={0}
                    max={EFFORT_LEVELS.length - 1}
                    step={1}
                    value={effortIndex}
                    aria-valuetext={props.reasoningLabels[currentEffort]}
                    onChange={(event) => chooseEffort(EFFORT_LEVELS[Number(event.target.value)]!)}
                  />
                </div>
                <div className="shell-model-picker__effort-stops">
                  {EFFORT_LEVELS.map((value) => (
                    <button
                      type="button"
                      key={value}
                      data-testid={'model-reasoning-option-' + value}
                      aria-pressed={currentEffort === value}
                      onClick={() => chooseEffort(value)}
                    >
                      {props.reasoningLabels[value]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {props.kernels?.length ? (
              <div ref={kernelPicker} className="shell-model-picker__kernel-row">
                <button
                  ref={kernelButton}
                  type="button"
                  className="shell-model-picker__kernel-trigger"
                  data-testid="model-kernel-trigger"
                  aria-label={'选择内核，当前：' + currentKernelName}
                  title={currentKernelName}
                  aria-haspopup="menu"
                  aria-expanded={popover === 'kernel'}
                  aria-controls={popover === 'kernel' ? kernelMenuId : undefined}
                  onClick={() => setPopover((value) => (value === 'kernel' ? undefined : 'kernel'))}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      setPopover('kernel');
                    }
                  }}
                >
                  <span>内核</span>
                  <span className="shell-model-picker__kernel-current" aria-hidden="true">
                    <span
                      className="shell-kernel-badge"
                      data-testid="model-kernel-current"
                      data-kernel-id={currentKernelId}
                    >
                      {currentKernelLogo ? (
                        <BrandLogoMark logo={currentKernelLogo} size={18} />
                      ) : (
                        <Cpu size={18} />
                      )}
                    </span>
                    <ChevronDown size={12} />
                  </span>
                </button>
                {popover === 'kernel' ? (
                  <div
                    ref={kernelMenu}
                    id={kernelMenuId}
                    role="menu"
                    aria-label="选择内核"
                    className="shell-model-picker__kernels"
                    style={{
                      maxHeight: Math.max(
                        48,
                        (root.current?.getBoundingClientRect().height || menuHeight) - 56,
                      ),
                    }}
                    onKeyDown={(event) => navigateButtons(event, 'button:not(:disabled)')}
                  >
                    {props.kernels?.map((item) => {
                      const state = props.kernelInstallStates?.[item.kernelId];
                      const pending =
                        state?.status === 'installing' ||
                        state?.status === 'verifying' ||
                        (state?.status === 'checking' && !item.installed);
                      const supported = isKernelExecutionSupported(item),
                        executable = isKernelExecutable(item);
                      const name = resolveKernelDisplayName(item.kernelId, item.name),
                        logo = resolveKernelBrandLogo(item.icon);
                      const hint =
                        state?.status === 'installing'
                          ? '安装中 · 应用私有目录'
                          : state?.status === 'verifying'
                            ? '安装成功 · 正在检测'
                            : state?.status === 'checking'
                              ? '正在检查更新'
                              : state?.status === 'error' && !item.installed
                                ? '安装失败 · ' + state.error
                                : item.installed && !supported
                                  ? (item.executionUnavailableReason ??
                                    kernelExecutionUnavailableReason(name))
                                  : !item.installed
                                    ? '未安装' +
                                      (item.installCommand ? ' · ' + item.installCommand : '')
                                    : state?.status === 'success'
                                      ? '安装成功'
                                      : '可用';
                      return (
                        <button
                          type="button"
                          key={item.kernelId}
                          role="menuitemradio"
                          aria-checked={currentKernelId === item.kernelId}
                          data-testid={'kernel-option-' + item.kernelId}
                          aria-label={
                            name +
                            (item.installed && item.version ? ' · 已安装 v' + item.version : '') +
                            ' · ' +
                            hint
                          }
                          disabled={pending || !executable}
                          aria-disabled={pending || !executable}
                          title={hint}
                          onClick={() => {
                            if (executable) {
                              setPopover(undefined);
                              props.onPickKernel?.(item.kernelId);
                              kernelButton.current?.focus();
                            }
                          }}
                        >
                          <span
                            className="shell-kernel-badge"
                            data-testid={'kernel-badge-' + item.kernelId}
                          >
                            {logo ? <BrandLogoMark logo={logo} size={17} /> : <Cpu size={17} />}
                          </span>
                          <span>{name}</span>
                          {item.installed && item.version && !pending ? (
                            <small data-testid={'kernel-version-' + item.kernelId}>
                              v{item.version}
                            </small>
                          ) : null}
                          {pending ? (
                            <LoaderCircle size={13} className="shell-process-spin" />
                          ) : currentKernelId === item.kernelId && executable ? (
                            <Check size={14} />
                          ) : null}
                          {pending || !item.installed || !supported ? (
                            <small data-testid={'kernel-status-' + item.kernelId}>
                              {item.installed && !supported && !pending ? '执行尚未接通' : hint}
                            </small>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>,
          portalContainer,
        )
      : null;
  return (
    <>
      {props.trigger}
      {content}
    </>
  );
}
