import { useEffect, useRef } from 'react';
import { Pause, Play, RotateCcw, Square } from 'lucide-react';

export interface ExecutionGraphRunView {
  id: string;
  state: string;
  planRevisionId?: string;
}

export interface ExecutionGraphStepView {
  id: string;
  title: string;
  agentVersionId: string;
  state: string;
  dependsOn: readonly string[];
  modelId?: string;
  modelOverrideId?: string;
  retries: number;
  reviewIteration?: number;
  currentArtifactVersion?: number;
}

export interface ExecutionGraphView {
  run: ExecutionGraphRunView;
  steps: readonly ExecutionGraphStepView[];
}

export interface ExecutionGraphPanelProps {
  graph: ExecutionGraphView;
  selectedStepId?: string | null;
  busy?: boolean;
  onPause?: (runId: string) => void | Promise<void>;
  onResume?: (runId: string) => void | Promise<void>;
  onCancel?: (runId: string) => void | Promise<void>;
}

const STEP_STATE_LABEL: Record<string, string> = {
  pending: '等待',
  ready: '就绪',
  running: '执行中',
  awaitingApproval: '待批准',
  reviewing: '评审中',
  revising: '返工中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  paused: '已暂停',
};

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled']);

function graphLayers(steps: readonly ExecutionGraphStepView[]): ExecutionGraphStepView[][] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  const depthFor = (step: ExecutionGraphStepView): number => {
    const cached = depths.get(step.id);
    if (cached !== undefined) return cached;
    if (visiting.has(step.id)) return 0;
    visiting.add(step.id);
    const parentDepths = step.dependsOn
      .map((id) => byId.get(id))
      .filter((item): item is ExecutionGraphStepView => Boolean(item))
      .map(depthFor);
    visiting.delete(step.id);
    const depth = parentDepths.length === 0 ? 0 : Math.max(...parentDepths) + 1;
    depths.set(step.id, depth);
    return depth;
  };

  const layers: ExecutionGraphStepView[][] = [];
  for (const step of steps) {
    const depth = depthFor(step);
    (layers[depth] ??= []).push(step);
  }
  return layers;
}

export function ExecutionGraphPanel({
  graph,
  selectedStepId,
  busy = false,
  onPause,
  onResume,
  onCancel,
}: ExecutionGraphPanelProps) {
  const selectedStepRef = useRef<HTMLElement | null>(null);
  const layers = graphLayers(graph.steps);
  const terminal = TERMINAL_RUN_STATES.has(graph.run.state);
  const paused = graph.run.state === 'paused';

  useEffect(() => {
    const target = selectedStepRef.current;
    if (!selectedStepId || !target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedStepId, graph.run.id]);

  return (
    <section className="st-graph" data-testid="execution-graph" aria-label="执行图">
      <header className="st-graph__header">
        <div>
          <span className="st-graph__kicker">Run {graph.run.id}</span>
          <strong>{graph.run.state}</strong>
          {graph.run.planRevisionId ? <small>计划 {graph.run.planRevisionId}</small> : null}
        </div>
        <div className="st-graph__controls">
          {paused ? (
            <button
              type="button"
              disabled={!onResume || busy || terminal}
              onClick={() => onResume?.(graph.run.id)}
            >
              <Play aria-hidden="true" size={14} />
              继续运行
            </button>
          ) : (
            <button
              type="button"
              disabled={!onPause || busy || terminal}
              onClick={() => onPause?.(graph.run.id)}
            >
              <Pause aria-hidden="true" size={14} />
              暂停运行
            </button>
          )}
          <button
            type="button"
            className="st-graph__cancel"
            disabled={!onCancel || busy || terminal}
            onClick={() => onCancel?.(graph.run.id)}
          >
            <Square aria-hidden="true" size={13} />
            取消运行
          </button>
        </div>
      </header>

      {graph.steps.length === 0 ? (
        <p className="st-graph__empty">这个 Run 尚未创建步骤。</p>
      ) : (
        <div className="st-graph__canvas" data-layers={layers.length}>
          {layers.map((layer, layerIndex) => (
            <div
              key={`layer-${layerIndex}`}
              className="st-graph__layer"
              data-layer={layerIndex}
            >
              <span className="st-graph__layer-label">{String(layerIndex + 1).padStart(2, '0')}</span>
              <div className="st-graph__lane">
                {layer.map((step) => (
                  <article
                    key={step.id}
                    ref={step.id === selectedStepId ? selectedStepRef : undefined}
                    className="st-graph__node"
                    data-testid={`step-${step.id}`}
                    data-state={step.state}
                    data-selected={step.id === selectedStepId ? '1' : '0'}
                    aria-current={step.id === selectedStepId ? 'step' : undefined}
                    tabIndex={step.id === selectedStepId ? 0 : -1}
                  >
                    <header>
                      <span className="st-graph__state" data-state={step.state}>
                        {STEP_STATE_LABEL[step.state] ?? step.state}
                      </span>
                      <strong>{step.title}</strong>
                    </header>
                    <dl>
                      <div>
                        <dt>Agent</dt>
                        <dd title={step.agentVersionId}>{step.agentVersionId}</dd>
                      </div>
                      <div>
                        <dt>模型</dt>
                        <dd>{step.modelOverrideId ?? step.modelId ?? '未解析模型'}</dd>
                      </div>
                      <div>
                        <dt>依赖</dt>
                        <dd>{step.dependsOn.length > 0 ? step.dependsOn.join(', ') : '无 · 可并行'}</dd>
                      </div>
                    </dl>
                    <footer>
                      <span>
                        <RotateCcw aria-hidden="true" size={11} />
                        重试 {step.retries}
                      </span>
                      {typeof step.reviewIteration === 'number' ? (
                        <span>返工 {step.reviewIteration}</span>
                      ) : null}
                      {typeof step.currentArtifactVersion === 'number' ? (
                        <span>产物 v{step.currentArtifactVersion}</span>
                      ) : null}
                    </footer>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
