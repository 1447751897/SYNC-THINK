import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Layers3,
  Search,
  Sparkles,
  Terminal,
  Bot,
  CircleDot,
  Puzzle,
} from 'lucide-react';
import type { ProviderSurface } from '@sync-think/shared';
import {
  buildSurfaceTree,
  findModelPath,
  type ModelPathTreeInput,
} from '../model-path-tree.js';

export interface ModelPathBoardProps {
  models: readonly ModelPathTreeInput[];
  /** Selected model UUID (single-select). Ignored for multi-select highlight when multiSelectedIds provided. */
  value: string | null;
  onChange: (modelId: string | null) => void;
  disabled?: boolean;
  /** Show clear / Agent default control. */
  allowDefault?: boolean;
  defaultLabel?: string;
  /** Compact embed (popup) vs full workspace board. */
  variant?: 'popup' | 'embedded';
  /** Column labels — Agent center uses 分组 → 供应商 → 模型. */
  labels?: {
    group?: string;
    provider?: string;
    model?: string;
  };
  showSearch?: boolean;
  showPathFooter?: boolean;
  /**
   * Optional multi-select highlight set (e.g. Fallback chain).
   * When set, model rows in this set show multiSelectedBadge and data-multi-selected.
   * Click still goes through onChange(modelId) so parent can toggle membership.
   */
  multiSelectedIds?: readonly string[];
  /** Badge text for multi-selected models (default: 已选). */
  multiSelectedBadge?: string;
  id?: string;
  'data-testid'?: string;
  className?: string;
}

const SURFACE_ICON: Record<ProviderSurface, typeof Box> = {
  codex: Terminal,
  claude: Bot,
  kiro: CircleDot,
  gemini: Sparkles,
  generic: Puzzle,
};

const DEFAULT_LABELS = {
  group: '分组',
  provider: '供应商',
  model: '模型',
} as const;

/**
 * Embeddable 3-column model path board:
 * 分组 (surface) → 供应商 (provider) → 模型.
 * Value is always a modelId (or null when allowDefault clears).
 */
export function ModelPathBoard(props: ModelPathBoardProps) {
  const {
    models,
    value,
    onChange,
    disabled = false,
    allowDefault = false,
    defaultLabel = 'Agent 默认（自动）',
    variant = 'embedded',
    showSearch = true,
    showPathFooter = true,
    multiSelectedIds,
    multiSelectedBadge = '已选',
  } = props;
  const multiSet = useMemo(
    () => new Set(multiSelectedIds ?? []),
    [multiSelectedIds],
  );
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const testId = props['data-testid'] ?? 'model-path-board';

  const tree = useMemo(() => buildSurfaceTree(models), [models]);
  const path = useMemo(() => findModelPath(tree, value), [tree, value]);

  const [surface, setSurface] = useState<ProviderSurface | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (path) {
      setSurface(path.surface);
      setGroupId(path.providerId);
      return;
    }
    if (tree.length > 0) {
      setSurface((prev) => prev ?? tree[0]!.surface);
      const s = tree.find((t) => t.surface === (surface ?? tree[0]!.surface)) ?? tree[0]!;
      setGroupId((prev) => {
        if (prev && s.groups.some((g) => g.providerId === prev)) return prev;
        return s.groups[0]?.providerId ?? null;
      });
    }
  }, [path, tree]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSurface = tree.find((t) => t.surface === surface) ?? tree[0] ?? null;
  const activeGroup =
    activeSurface?.groups.find((g) => g.providerId === groupId) ??
    activeSurface?.groups[0] ??
    null;

  const q = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    const groups = activeSurface?.groups ?? [];
    if (!q) return groups;
    return groups.filter((g) => {
      if (g.name.toLowerCase().includes(q)) return true;
      return g.models.some(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          (m.providerModelId ?? '').toLowerCase().includes(q),
      );
    });
  }, [activeSurface, q]);

  const filteredModels = useMemo(() => {
    const list = activeGroup?.models ?? [];
    if (!q) return list;
    if (activeGroup && activeGroup.name.toLowerCase().includes(q)) return list;
    return list.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        (m.providerModelId ?? '').toLowerCase().includes(q),
    );
  }, [activeGroup, q]);

  useEffect(() => {
    if (!q || !activeSurface) return;
    if (filteredGroups.length === 0) return;
    if (!filteredGroups.some((g) => g.providerId === activeGroup?.providerId)) {
      setGroupId(filteredGroups[0]!.providerId);
    }
  }, [q, activeSurface, filteredGroups, activeGroup?.providerId]);

  const pickSurface = (s: ProviderSurface) => {
    setSurface(s);
    const node = tree.find((t) => t.surface === s);
    setGroupId(node?.groups[0]?.providerId ?? null);
  };

  const pickModel = (modelId: string | null) => {
    if (disabled) return;
    onChange(modelId);
  };

  const selectedModelMeta = value ? models.find((m) => m.modelId === value) : null;

  const pathLabel = useMemo(() => {
    if (!value) {
      if (multiSet.size > 0) return `已选 ${multiSet.size} 个 · 点击模型切换链中状态`;
      return allowDefault ? defaultLabel : '未选择模型';
    }
    const hit = models.find((m) => m.modelId === value);
    if (!hit) return value.slice(0, 12);
    const pathHit = findModelPath(tree, value);
    const surfaceLabel = pathHit
      ? tree.find((s) => s.surface === pathHit.surface)?.label
      : undefined;
    const modelPart = hit.providerModelId ?? hit.label;
    const groupPart = hit.providerName;
    if (surfaceLabel && groupPart) {
      return `${surfaceLabel} → ${groupPart} → ${modelPart}`;
    }
    if (groupPart) return `${groupPart} → ${modelPart}`;
    return hit.label;
  }, [value, models, defaultLabel, allowDefault, tree, multiSet]);

  return (
    <div
      className={`st-model-path-board st-model-path-board--${variant} ${props.className ?? ''}`.trim()}
      data-testid={testId}
      data-variant={variant}
      data-has-value={value ? '1' : '0'}
      data-disabled={disabled ? '1' : '0'}
    >
      {variant === 'embedded' ? (
        <header className="st-model-path-board__path" data-testid={`${testId}-path`}>
          <Layers3 size={14} strokeWidth={1.8} aria-hidden="true" />
          <div className="st-model-path-board__path-text">
            <span className="st-model-path-board__path-label">当前运行时</span>
            <strong title={pathLabel}>{pathLabel}</strong>
          </div>
          {allowDefault ? (
            <button
              type="button"
              className="st-model-path__default"
              data-testid={`${testId}-default`}
              data-selected={!value ? '1' : '0'}
              disabled={disabled}
              onClick={() => pickModel(null)}
              title={defaultLabel}
            >
              清除
            </button>
          ) : null}
        </header>
      ) : null}

      {tree.length === 0 ? (
        <p className="st-model-path__empty" data-testid={`${testId}-empty`}>
          暂无可用模型 — 请先在 Provider 中心添加或导入
        </p>
      ) : (
        <>
          {showSearch ? (
            <div className="st-model-path__search">
              <Search size={13} strokeWidth={1.8} aria-hidden="true" />
              <input
                type="search"
                className="st-model-path__search-input"
                data-testid={`${testId}-search`}
                placeholder={`搜索${labels.provider}或${labels.model}…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={`搜索${labels.provider}或${labels.model}`}
                disabled={disabled}
              />
            </div>
          ) : null}

          <div className="st-model-path__board" role="presentation">
            <section
              className="st-model-path__col st-model-path__col--apps"
              aria-label={labels.group}
            >
              <p className="st-model-path__section-label">1 · {labels.group}</p>
              <div
                className="st-model-path__apps"
                role="tablist"
                aria-label={`${labels.group}（Codex / Claude Code / Kiro…）`}
              >
                {tree.map((s) => {
                  const Icon = SURFACE_ICON[s.surface] ?? Box;
                  const active = activeSurface?.surface === s.surface;
                  return (
                    <button
                      key={s.surface}
                      type="button"
                      role="tab"
                      className="st-model-path__app"
                      data-testid={`${testId}-surface-${s.surface}`}
                      data-active={active ? '1' : '0'}
                      aria-selected={active}
                      disabled={disabled}
                      onClick={() => pickSurface(s.surface)}
                    >
                      <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                      <span className="st-model-path__app-name">{s.label}</span>
                      <small className="st-model-path__app-count">{s.modelCount}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section
              className="st-model-path__col st-model-path__col--groups"
              aria-label={labels.provider}
            >
              <p className="st-model-path__section-label">
                2 · {labels.provider}
                {activeSurface ? (
                  <span className="st-model-path__section-hint">{activeSurface.label}</span>
                ) : null}
              </p>
              <div className="st-model-path__groups" role="list">
                {filteredGroups.map((g) => (
                  <button
                    key={g.providerId}
                    type="button"
                    className="st-model-path__group"
                    data-testid={`${testId}-group-${g.providerId}`}
                    data-active={activeGroup?.providerId === g.providerId ? '1' : '0'}
                    disabled={disabled}
                    onClick={() => setGroupId(g.providerId)}
                  >
                    <span className="st-model-path__group-name">{g.name}</span>
                    <small>{g.models.length}</small>
                  </button>
                ))}
                {filteredGroups.length === 0 ? (
                  <p className="st-model-path__empty">无匹配{labels.provider}</p>
                ) : null}
              </div>
            </section>

            <section
              className="st-model-path__col st-model-path__col--models"
              aria-label={labels.model}
            >
              <p className="st-model-path__section-label">
                3 · {labels.model}
                {activeGroup ? (
                  <span className="st-model-path__section-hint">{activeGroup.name}</span>
                ) : null}
              </p>
              <div className="st-model-path__models" role="listbox" aria-label={`${labels.model}列表`}>
                {filteredModels.map((m) => {
                  const active = value === m.modelId;
                  const multi = multiSet.has(m.modelId);
                  const highlighted = active || multi;
                  return (
                    <button
                      key={m.modelId}
                      type="button"
                      role="option"
                      className="st-model-path__model"
                      data-testid={`${testId}-model-${m.modelId}`}
                      data-selected={highlighted ? '1' : '0'}
                      data-multi-selected={multi ? '1' : '0'}
                      aria-selected={highlighted}
                      disabled={disabled}
                      onClick={() => pickModel(m.modelId)}
                    >
                      <span className="st-model-path__model-id">
                        {m.providerModelId ?? m.label}
                      </span>
                      {m.providerModelId && m.label !== m.providerModelId ? (
                        <span className="st-model-path__model-label">{m.label}</span>
                      ) : null}
                      {active ? (
                        <span className="st-model-path__model-badge">当前</span>
                      ) : multi ? (
                        <span className="st-model-path__model-badge st-model-path__model-badge--multi">
                          {multiSelectedBadge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {filteredModels.length === 0 ? (
                  <p className="st-model-path__empty">
                    {activeGroup
                      ? `该${labels.provider}下暂无${labels.model}`
                      : `先选左侧${labels.group}与${labels.provider}`}
                  </p>
                ) : null}
              </div>
            </section>
          </div>

          {showPathFooter ? (
            <footer className="st-model-path__footer" data-testid={`${testId}-crumb`}>
              <div className="st-model-path__crumb">
                {activeSurface ? (
                  <>
                    <span className="st-model-path__crumb-step" data-step="group">
                      {activeSurface.label}
                    </span>
                    {activeGroup ? (
                      <>
                        <span className="st-model-path__crumb-sep">→</span>
                        <span className="st-model-path__crumb-step" data-step="provider">
                          {activeGroup.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="st-model-path__crumb-sep">→</span>
                        <span className="st-model-path__crumb-hint">选{labels.provider}</span>
                      </>
                    )}
                    {value && path && selectedModelMeta ? (
                      <>
                        <span className="st-model-path__crumb-sep">→</span>
                        <span className="st-model-path__crumb-model">
                          {selectedModelMeta.providerModelId ?? selectedModelMeta.label}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="st-model-path__crumb-sep">→</span>
                        <span className="st-model-path__crumb-hint">点{labels.model}确认</span>
                      </>
                    )}
                  </>
                ) : (
                  <span>
                    选择 {labels.group} → {labels.provider} → {labels.model}
                  </span>
                )}
              </div>
              {value && selectedModelMeta ? (
                <span className="st-model-path__current-tag">已选</span>
              ) : allowDefault ? (
                <span className="st-model-path__current-tag st-model-path__current-tag--muted">
                  将用 Agent 默认
                </span>
              ) : null}
            </footer>
          ) : null}
        </>
      )}
    </div>
  );
}

export function formatModelPathLabel(
  models: readonly ModelPathTreeInput[],
  modelId: string | null | undefined,
  emptyLabel = '未配置',
): string {
  if (!modelId) return emptyLabel;
  const tree = buildSurfaceTree(models);
  const hit = models.find((m) => m.modelId === modelId);
  if (!hit) return modelId.slice(0, 12);
  const pathHit = findModelPath(tree, modelId);
  const surfaceLabel = pathHit
    ? tree.find((s) => s.surface === pathHit.surface)?.label
    : undefined;
  const modelPart = hit.providerModelId ?? hit.label;
  const groupPart = hit.providerName;
  if (surfaceLabel && groupPart) return `${surfaceLabel} → ${groupPart} → ${modelPart}`;
  if (groupPart) return `${groupPart} → ${modelPart}`;
  return hit.label;
}
