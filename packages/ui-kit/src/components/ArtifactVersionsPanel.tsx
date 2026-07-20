import { useEffect, useMemo, useState } from 'react';
import type {
  ArtifactComparison,
  ArtifactMergeConflictResolutionStrategy,
} from '@sync-think/shared';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  GitCompareArrows,
  GitMerge,
  Layers3,
} from 'lucide-react';

export interface ArtifactVersionView {
  id: string;
  artifactId: string;
  version: number;
  sourceStepId: string;
  status: string;
  contentHash: string;
  mimeType: string;
  parentVersionIds: readonly string[];
  createdAt: string;
  content?: string;
}

export interface ArtifactVersionsView {
  id: string;
  name: string;
  selectedVersionId?: string;
  versions: readonly ArtifactVersionView[];
}

export interface ArtifactComparisonView {
  leftVersionId: string;
  rightVersionId: string;
  comparison: ArtifactComparison;
}

export interface ArtifactMergeStepView {
  id: string;
  title: string;
  dependsOn: readonly string[];
}

export interface ArtifactMergeConflictView {
  id: string;
  artifactId: string;
  baseVersionId: string;
  leftVersionId: string;
  rightVersionId: string;
  sourceStepId?: string;
  createdAt: string;
  resolution?: {
    strategy: ArtifactMergeConflictResolutionStrategy;
    resolutionVersionId: string;
  };
}

export interface ArtifactVersionsPanelProps {
  artifact: ArtifactVersionsView;
  comparison?: ArtifactComparisonView | null;
  mergeSteps?: readonly ArtifactMergeStepView[];
  conflicts?: readonly ArtifactMergeConflictView[];
  busy?: boolean;
  onCompare?: (leftVersionId: string, rightVersionId: string) => void | Promise<void>;
  onSelect?: (artifactId: string, versionId: string) => void | Promise<void>;
  onMerge?: (
    artifactId: string,
    leftVersionId: string,
    rightVersionId: string,
    sourceStepId: string,
  ) => void | Promise<void>;
  onResolveConflict?: (
    conflictId: string,
    strategy: ArtifactMergeConflictResolutionStrategy,
    content?: string,
  ) => void | Promise<void>;
}

const STATUS_LABEL: Record<string, string> = {
  candidate: '候选',
  selected: '已选',
  rejected: '未采用',
  incomplete: '未完成',
  merged: '已合并',
};

const RESOLUTION_LABEL: Record<ArtifactMergeConflictResolutionStrategy, string> = {
  left: '采用左侧',
  right: '采用右侧',
  manual: '手工合并',
};

const EMPTY_MERGE_STEPS: readonly ArtifactMergeStepView[] = [];
const EMPTY_CONFLICTS: readonly ArtifactMergeConflictView[] = [];

export function ArtifactVersionsPanel({
  artifact,
  comparison,
  mergeSteps = EMPTY_MERGE_STEPS,
  conflicts = EMPTY_CONFLICTS,
  busy = false,
  onCompare,
  onSelect,
  onMerge,
  onResolveConflict,
}: ArtifactVersionsPanelProps) {
  const versions = useMemo(
    () => [...artifact.versions].sort((left, right) => left.version - right.version),
    [artifact.versions],
  );
  const [leftId, setLeftId] = useState(versions[0]?.id ?? '');
  const [rightId, setRightId] = useState(versions[1]?.id ?? versions[0]?.id ?? '');

  useEffect(() => {
    setLeftId(versions[0]?.id ?? '');
    setRightId(versions[1]?.id ?? versions[0]?.id ?? '');
  }, [artifact.id, versions]);

  const left = versions.find((version) => version.id === leftId);
  const right = versions.find((version) => version.id === rightId);
  const canPair = Boolean(left && right && left.id !== right.id);
  const eligibleMergeSteps = useMemo(
    () =>
      left && right
        ? mergeSteps.filter(
            (step) =>
              step.dependsOn.includes(left.sourceStepId) &&
              step.dependsOn.includes(right.sourceStepId),
          )
        : [],
    [left, mergeSteps, right],
  );
  const [mergeStepId, setMergeStepId] = useState('');
  const [resolutionDrafts, setResolutionDrafts] = useState<
    Record<string, { strategy: ArtifactMergeConflictResolutionStrategy; content: string }>
  >({});

  useEffect(() => {
    setMergeStepId((current) =>
      eligibleMergeSteps.some((step) => step.id === current)
        ? current
        : (eligibleMergeSteps[0]?.id ?? ''),
    );
  }, [eligibleMergeSteps]);

  const visibleConflicts = useMemo(
    () => conflicts.filter((conflict) => conflict.artifactId === artifact.id),
    [artifact.id, conflicts],
  );
  const openConflicts = visibleConflicts.filter((conflict) => !conflict.resolution);
  const resolvedConflicts = visibleConflicts.filter((conflict) => conflict.resolution);
  const versionLabel = (versionId: string) => {
    const version = versions.find((candidate) => candidate.id === versionId);
    return version ? `v${version.version}` : versionId.slice(0, 12);
  };

  if (versions.length === 1) {
    const version = versions[0]!;
    return (
      <section
        className="st-artifacts st-artifacts--single"
        data-testid="artifact-versions"
        aria-label="产物内容"
      >
        <header className="st-artifacts__single-header">
          <span>
            <strong>{artifact.name}</strong>
            <small>
              {STATUS_LABEL[version.status] ?? version.status} · v{version.version} ·{' '}
              {new Date(version.createdAt).toLocaleString('zh-CN')}
            </small>
          </span>
          <em>{version.mimeType}</em>
        </header>
        <section className="st-artifacts__preview" aria-label="内容预览">
          <h3>内容预览</h3>
          <pre>{version.content ?? '正在读取内容…'}</pre>
        </section>
      </section>
    );
  }

  return (
    <section className="st-artifacts" data-testid="artifact-versions" aria-label="产物版本">
      <header className="st-artifacts__header">
        <div>
          <span className="st-artifacts__kicker">Artifact</span>
          <strong>{artifact.name}</strong>
          <small>{versions.length} 个不可变版本</small>
        </div>
        <div className="st-artifacts__actions">
          <label className="st-artifacts__merge-field">
            <span>合并步骤</span>
            <select
              aria-label="合并步骤"
              value={mergeStepId}
              disabled={!canPair || eligibleMergeSteps.length === 0 || busy}
              onChange={(event) => setMergeStepId(event.target.value)}
            >
              {eligibleMergeSteps.length === 0 ? (
                <option value="">没有就绪的合并步骤</option>
              ) : (
                eligibleMergeSteps.map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.title}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            disabled={!onCompare || !canPair || busy}
            aria-label={
              left && right ? `比较版本 ${left.version} 与版本 ${right.version}` : '比较版本'
            }
            onClick={() => left && right && onCompare?.(left.id, right.id)}
          >
            <GitCompareArrows aria-hidden="true" size={14} />
            比较
          </button>
          <button
            type="button"
            disabled={!onMerge || !canPair || !mergeStepId || busy}
            aria-label={
              left && right ? `合并版本 ${left.version} 与版本 ${right.version}` : '合并版本'
            }
            onClick={() =>
              left && right && mergeStepId && onMerge?.(artifact.id, left.id, right.id, mergeStepId)
            }
          >
            <GitMerge aria-hidden="true" size={14} />
            合并
          </button>
        </div>
      </header>

      <div className="st-artifacts__body">
        <div className="st-artifacts__shelf" aria-label="版本架">
          {versions.map((version) => {
            const selected = artifact.selectedVersionId === version.id;
            return (
              <article
                key={version.id}
                className="st-artifacts__version"
                data-testid={`artifact-version-${version.id}`}
                data-selected={selected ? '1' : '0'}
              >
                <header>
                  <span>v{version.version}</span>
                  <strong>{STATUS_LABEL[version.status] ?? version.status}</strong>
                </header>
                <dl>
                  <div>
                    <dt>来源</dt>
                    <dd>{version.sourceStepId}</dd>
                  </div>
                  <div>
                    <dt>类型</dt>
                    <dd>{version.mimeType}</dd>
                  </div>
                  <div>
                    <dt>Hash</dt>
                    <dd title={version.contentHash}>{version.contentHash.slice(0, 12)}</dd>
                  </div>
                  <div>
                    <dt>父版本</dt>
                    <dd>
                      {version.parentVersionIds.length > 0
                        ? version.parentVersionIds.join(', ')
                        : '初始版本'}
                    </dd>
                  </div>
                </dl>
                <div className="st-artifacts__pickers">
                  <label>
                    <input
                      type="radio"
                      name={`artifact-${artifact.id}-left`}
                      checked={leftId === version.id}
                      onChange={() => setLeftId(version.id)}
                    />
                    左侧
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`artifact-${artifact.id}-right`}
                      checked={rightId === version.id}
                      onChange={() => setRightId(version.id)}
                    />
                    右侧
                  </label>
                </div>
                <button
                  type="button"
                  className="st-artifacts__select"
                  disabled={!onSelect || selected || busy}
                  aria-label={`选择版本 ${version.version}`}
                  onClick={() => onSelect?.(artifact.id, version.id)}
                >
                  <Check aria-hidden="true" size={13} />
                  {selected ? '当前版本' : '设为当前'}
                </button>
              </article>
            );
          })}
        </div>

        <div className="st-artifacts__comparison" data-testid="artifact-comparison">
          <div className="st-artifacts__comparison-head">
            <Layers3 aria-hidden="true" size={14} />
            <strong>版本对照</strong>
            {comparison ? (
              <small>
                {comparison.leftVersionId} ↔ {comparison.rightVersionId}
              </small>
            ) : null}
          </div>
          {!comparison ? (
            <p>选择左右版本并运行比较。</p>
          ) : comparison.comparison.kind === 'reference' ? (
            <div className="st-artifacts__reference-diff">
              <span>{comparison.comparison.leftHash}</span>
              <span>{comparison.comparison.rightHash}</span>
              <strong>{comparison.comparison.equal ? '内容一致' : '引用不同'}</strong>
            </div>
          ) : comparison.comparison.hunks.length === 0 ? (
            <p>{comparison.comparison.equal ? '两个版本内容一致。' : '没有可显示的文本差异。'}</p>
          ) : (
            <div className="st-artifacts__diff">
              {comparison.comparison.hunks.map((hunk, index) => (
                <div key={`${hunk.leftStartLine}-${hunk.rightStartLine}-${index}`}>
                  <small>
                    @@ -{hunk.leftStartLine} +{hunk.rightStartLine} @@
                  </small>
                  {hunk.removedLines.map((line, lineIndex) => (
                    <pre key={`remove-${lineIndex}`} data-kind="remove">
                      - {line}
                    </pre>
                  ))}
                  {hunk.addedLines.map((line, lineIndex) => (
                    <pre key={`add-${lineIndex}`} data-kind="add">
                      + {line}
                    </pre>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {visibleConflicts.length > 0 ? (
          <section className="st-artifacts__conflicts" aria-label="合并冲突">
            {openConflicts.length > 0 ? (
              <div className="st-artifacts__conflict-group" data-state="open">
                <header className="st-artifacts__conflict-heading">
                  <AlertTriangle aria-hidden="true" size={14} />
                  <strong>需要处理</strong>
                  <small>{openConflicts.length} 个合并冲突</small>
                </header>
                <div className="st-artifacts__conflict-list">
                  {openConflicts.map((conflict) => {
                    const draft = resolutionDrafts[conflict.id] ?? {
                      strategy: 'left' as const,
                      content: '',
                    };
                    const manualContentMissing =
                      draft.strategy === 'manual' && draft.content.trim().length === 0;
                    const setStrategy = (strategy: ArtifactMergeConflictResolutionStrategy) => {
                      setResolutionDrafts((current) => ({
                        ...current,
                        [conflict.id]: {
                          strategy,
                          content: current[conflict.id]?.content ?? '',
                        },
                      }));
                    };

                    return (
                      <article
                        key={conflict.id}
                        className="st-artifacts__conflict"
                        data-testid={`artifact-conflict-${conflict.id}`}
                      >
                        <header>
                          <strong>
                            {versionLabel(conflict.leftVersionId)} 与{' '}
                            {versionLabel(conflict.rightVersionId)}
                          </strong>
                          <small>合并步骤 {conflict.sourceStepId ?? '旧版本未知'}</small>
                        </header>
                        <div
                          className="st-artifacts__resolution-strategies"
                          role="group"
                          aria-label="冲突处理方式"
                        >
                          <button
                            type="button"
                            aria-label="采用左侧版本"
                            aria-pressed={draft.strategy === 'left'}
                            data-selected={draft.strategy === 'left' ? '1' : '0'}
                            disabled={!onResolveConflict || busy}
                            onClick={() => setStrategy('left')}
                          >
                            左侧 {versionLabel(conflict.leftVersionId)}
                          </button>
                          <button
                            type="button"
                            aria-label="采用右侧版本"
                            aria-pressed={draft.strategy === 'right'}
                            data-selected={draft.strategy === 'right' ? '1' : '0'}
                            disabled={!onResolveConflict || busy}
                            onClick={() => setStrategy('right')}
                          >
                            右侧 {versionLabel(conflict.rightVersionId)}
                          </button>
                          <button
                            type="button"
                            aria-label="手工合并"
                            aria-pressed={draft.strategy === 'manual'}
                            data-selected={draft.strategy === 'manual' ? '1' : '0'}
                            disabled={!onResolveConflict || busy}
                            onClick={() => setStrategy('manual')}
                          >
                            手工合并
                          </button>
                        </div>
                        {draft.strategy === 'manual' ? (
                          <label className="st-artifacts__manual-resolution">
                            <span>手工合并内容</span>
                            <textarea
                              aria-label="手工合并内容"
                              rows={5}
                              value={draft.content}
                              disabled={!onResolveConflict || busy}
                              onChange={(event) =>
                                setResolutionDrafts((current) => ({
                                  ...current,
                                  [conflict.id]: {
                                    strategy: 'manual',
                                    content: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                        ) : null}
                        <button
                          type="button"
                          className="st-artifacts__resolve"
                          disabled={!onResolveConflict || manualContentMissing || busy}
                          onClick={() =>
                            onResolveConflict?.(
                              conflict.id,
                              draft.strategy,
                              draft.strategy === 'manual' ? draft.content.trim() : undefined,
                            )
                          }
                        >
                          <CheckCircle2 aria-hidden="true" size={14} />
                          解决冲突
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {resolvedConflicts.length > 0 ? (
              <div className="st-artifacts__conflict-group" data-state="resolved">
                <header className="st-artifacts__conflict-heading">
                  <CheckCircle2 aria-hidden="true" size={14} />
                  <strong>已解决</strong>
                  <small>{resolvedConflicts.length} 条记录</small>
                </header>
                <ol className="st-artifacts__resolution-history">
                  {resolvedConflicts.map((conflict) => (
                    <li key={conflict.id}>
                      <span>
                        {versionLabel(conflict.leftVersionId)} /{' '}
                        {versionLabel(conflict.rightVersionId)}
                      </span>
                      <strong>
                        {conflict.resolution ? RESOLUTION_LABEL[conflict.resolution.strategy] : ''}
                      </strong>
                      <code>
                        {conflict.resolution
                          ? versionLabel(conflict.resolution.resolutionVersionId)
                          : ''}
                      </code>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
}
