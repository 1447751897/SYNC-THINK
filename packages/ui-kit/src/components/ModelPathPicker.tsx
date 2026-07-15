import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
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

export interface ModelPathPickerProps {
  models: readonly ModelPathTreeInput[];
  /** Selected model UUID; null/empty means Agent default when allowDefault. */
  value: string | null;
  onChange: (modelId: string | null) => void;
  disabled?: boolean;
  /** Show "Agent 默认" option that clears selection. Default true. */
  allowDefault?: boolean;
  defaultLabel?: string;
  /** Accessible name / test id prefix. */
  id?: string;
  'data-testid'?: string;
  className?: string;
  /** Compact trigger for compose bar. */
  size?: 'sm' | 'md';
}

const SURFACE_ICON: Record<ProviderSurface, typeof Box> = {
  codex: Terminal,
  claude: Bot,
  kiro: CircleDot,
  gemini: Sparkles,
  generic: Puzzle,
};

/**
 * CC Switch–style hierarchical model picker:
 * App rail (Codex / Claude Code / Kiro…) → Group → Model.
 * Value is always a modelId (or null for Agent default).
 */
export function ModelPathPicker(props: ModelPathPickerProps) {
  const {
    models,
    value,
    onChange,
    disabled = false,
    allowDefault = true,
    defaultLabel = 'Agent 默认（自动）',
    id = 'st-model-path',
    size = 'md',
  } = props;
  const testId = props['data-testid'] ?? 'model-path-picker';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const tree = useMemo(() => buildSurfaceTree(models), [models]);
  const path = useMemo(() => findModelPath(tree, value), [tree, value]);

  const selectedLabel = useMemo(() => {
    if (!value) return defaultLabel;
    const hit = models.find((m) => m.modelId === value);
    if (!hit) return value.slice(0, 12);
    const pathHit = findModelPath(tree, value);
    const surfaceLabel = pathHit
      ? tree.find((s) => s.surface === pathHit.surface)?.label
      : undefined;
    const modelPart = hit.providerModelId ?? hit.label;
    const groupPart = hit.providerName;
    if (surfaceLabel && groupPart) {
      return `${surfaceLabel} · ${groupPart} · ${modelPart}`;
    }
    if (groupPart) {
      return `${groupPart} · ${modelPart}`;
    }
    return hit.label;
  }, [value, models, defaultLabel, tree]);

  const [surface, setSurface] = useState<ProviderSurface | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);

  // Sync navigation when value or tree changes
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

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open]);

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
    onChange(modelId);
    setOpen(false);
  };

  const selectedModelMeta = value
    ? models.find((m) => m.modelId === value)
    : null;

  return (
    <div
      ref={rootRef}
      className={`st-model-path ${props.className ?? ''}`.trim()}
      data-testid={testId}
      data-open={open ? '1' : '0'}
      data-size={size}
      data-has-value={value ? '1' : '0'}
    >
      <button
        type="button"
        id={id}
        className="st-model-path__trigger"
        data-testid={`${testId}-trigger`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || models.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
        <span className="st-model-path__trigger-text">{selectedLabel}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          aria-hidden="true"
          className="st-model-path__chevron"
        />
      </button>

      {open ? (
        <div
          className="st-model-path__panel"
          data-testid={`${testId}-panel`}
          role="dialog"
          aria-label="选择模型：分组 → 供应商 → 模型"
        >
          <header className="st-model-path__header">
            <div className="st-model-path__header-title">
              <Layers3 size={14} strokeWidth={1.8} aria-hidden="true" />
              <div>
                <strong>选择模型</strong>
                <p>先选分组，再选供应商，最后点模型</p>
              </div>
            </div>
            {allowDefault ? (
              <button
                type="button"
                className="st-model-path__default"
                data-testid={`${testId}-default`}
                data-selected={!value ? '1' : '0'}
                onClick={() => pickModel(null)}
                title={defaultLabel}
              >
                <Layers3 size={12} strokeWidth={1.8} aria-hidden="true" />
                <span>Agent 默认</span>
              </button>
            ) : null}
          </header>

          {tree.length === 0 ? (
            <p className="st-model-path__empty">暂无可用模型 — 请先在 Provider 中心添加或导入</p>
          ) : (
            <>
              <div className="st-model-path__search">
                <Search size={13} strokeWidth={1.8} aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  className="st-model-path__search-input"
                  data-testid={`${testId}-search`}
                  placeholder="搜索供应商或模型…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="搜索供应商或模型"
                />
              </div>

              <div className="st-model-path__board" role="presentation">
                <section className="st-model-path__col st-model-path__col--apps" aria-label="分组">
                  <p className="st-model-path__section-label">1 · 分组</p>
                  <div className="st-model-path__apps" role="tablist" aria-label="分组（Codex / Claude Code / Kiro…）">
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

                <section className="st-model-path__col st-model-path__col--groups" aria-label="供应商">
                  <p className="st-model-path__section-label">
                    2 · 供应商
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
                        onClick={() => setGroupId(g.providerId)}
                      >
                        <span className="st-model-path__group-name">{g.name}</span>
                        <small>{g.models.length}</small>
                      </button>
                    ))}
                    {filteredGroups.length === 0 ? (
                      <p className="st-model-path__empty">无匹配供应商</p>
                    ) : null}
                  </div>
                </section>

                <section className="st-model-path__col st-model-path__col--models" aria-label="模型">
                  <p className="st-model-path__section-label">
                    3 · 模型
                    {activeGroup ? (
                      <span className="st-model-path__section-hint">{activeGroup.name}</span>
                    ) : null}
                  </p>
                  <div className="st-model-path__models" role="listbox" aria-label="模型列表">
                    {filteredModels.map((m) => {
                      const active = value === m.modelId;
                      return (
                        <button
                          key={m.modelId}
                          type="button"
                          role="option"
                          className="st-model-path__model"
                          data-testid={`${testId}-model-${m.modelId}`}
                          data-selected={active ? '1' : '0'}
                          aria-selected={active}
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
                          ) : null}
                        </button>
                      );
                    })}
                    {filteredModels.length === 0 ? (
                      <p className="st-model-path__empty">
                        {activeGroup ? '该供应商下暂无模型' : '先选左侧分组与供应商'}
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>

              <footer className="st-model-path__footer" data-testid={`${testId}-crumb`}>
                <div className="st-model-path__crumb">
                  {activeSurface ? (
                    <>
                      <span className="st-model-path__crumb-step" data-step="app">
                        {activeSurface.label}
                      </span>
                      {activeGroup ? (
                        <>
                          <span className="st-model-path__crumb-sep">→</span>
                          <span className="st-model-path__crumb-step" data-step="group">
                            {activeGroup.name}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="st-model-path__crumb-sep">→</span>
                          <span className="st-model-path__crumb-hint">选供应商</span>
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
                          <span className="st-model-path__crumb-hint">点模型确认</span>
                        </>
                      )}
                    </>
                  ) : (
                    <span>选择 分组 → 供应商 → 模型</span>
                  )}
                </div>
                {value && selectedModelMeta ? (
                  <span className="st-model-path__current-tag">本轮覆盖已选</span>
                ) : allowDefault ? (
                  <span className="st-model-path__current-tag st-model-path__current-tag--muted">
                    将用 Agent 默认
                  </span>
                ) : null}
              </footer>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
