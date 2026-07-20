import type { RunGraphResponse } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';
import type {
  TaskProgressParticipant,
  TaskProgressState,
  TaskProgressStep,
  TaskProgressSummary,
} from './conversation-detail-rail.js';
import type {
  ConversationLogAgentIdentity,
  ConversationLogStage,
  ConversationLogTurn,
} from './conversation-log-projection.js';

export interface ProgressAgentIdentity extends ConversationLogAgentIdentity {
  defaultModelId?: string;
}

export interface ConversationTaskProgressProjection {
  summary: TaskProgressSummary;
  steps: TaskProgressStep[];
  participants: TaskProgressParticipant[];
}

export function toTaskProgressState(state?: string): TaskProgressState {
  if (state === 'completed' || state === 'skipped') return 'completed';
  if (state === 'failed' || state === 'blocked') return 'failed';
  if (state === 'paused') return 'paused';
  if (state === 'cancelled') return 'cancelled';
  if (
    state === 'active' ||
    state === 'conversation' ||
    state === 'running' ||
    state === 'reviewing' ||
    state === 'revising'
  ) {
    return 'running';
  }
  if (
    state === 'queued' ||
    state === 'ready' ||
    state === 'pending' ||
    state === 'awaitingApproval' ||
    state === 'awaitingToolApproval' ||
    state === 'awaitingPlanApproval' ||
    state === 'planDraft'
  ) {
    return 'waiting';
  }
  return 'unknown';
}

function elapsedBetween(startedAt?: string, endedAt?: string): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return undefined;
  return ended - started;
}

const STATE_PRIORITY: Record<TaskProgressState, number> = {
  failed: 7,
  running: 6,
  paused: 5,
  waiting: 4,
  unknown: 3,
  cancelled: 2,
  completed: 1,
  'not-started': 0,
};

function participantFromStage(stage: ConversationLogStage): TaskProgressParticipant | undefined {
  if (!stage.agentVersionId) return undefined;
  return {
    id: stage.agentVersionId,
    name: stage.agentName,
    role: stage.role,
    responsibility: stage.responsibility,
    modelLabel: stage.modelLabel,
    state: stage.state,
    color: stage.color,
    avatarUrl: stage.avatarUrl,
  };
}

function dedupeStageParticipants(
  stages: readonly ConversationLogStage[],
): TaskProgressParticipant[] {
  const participants = new Map<string, TaskProgressParticipant>();
  for (const stage of stages) {
    const next = participantFromStage(stage);
    if (!next) continue;
    const current = participants.get(next.id);
    if (!current || STATE_PRIORITY[next.state] >= STATE_PRIORITY[current.state]) {
      participants.set(next.id, next);
    }
  }
  return [...participants.values()];
}

function directTurnSteps(turn: ConversationLogTurn, events: readonly Event[]): TaskProgressStep[] {
  const runId = turn.runIds[turn.runIds.length - 1];
  if (!runId) {
    return turn.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      state: stage.state,
      agentName: stage.agentName,
    }));
  }
  const runEvents = events.filter((event) => String(event.runId ?? '') === runId);
  if (runEvents.some((event) => event.type.startsWith('group.'))) {
    return turn.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      state: stage.state,
      agentName: stage.agentName,
    }));
  }

  return [{
    id: `${runId}:response`,
    title: '完成本轮需求并整理结果',
    state: turn.state,
    agentName: turn.stages.find((stage) => stage.agentVersionId)?.agentName,
  }];
}

function runDuration(input: {
  graph: RunGraphResponse;
  events: readonly Event[];
  nowMs: number;
  state: TaskProgressState;
}): number | undefined {
  const runId = String(input.graph.run.id);
  const runEvents = input.events.filter((event) => String(event.runId ?? '') === runId);
  const startedAt = runEvents.find((event) => event.type === 'run.started')?.occurredAt;
  if (!startedAt) return undefined;
  const terminalAt = [...runEvents]
    .reverse()
    .find((event) =>
      ['run.completed', 'run.failed', 'run.paused', 'run.cancelled'].includes(event.type),
    )?.occurredAt;
  const endedAt =
    input.state === 'running'
      ? new Date(input.nowMs).toISOString()
      : (terminalAt ?? input.graph.run.updatedAt);
  return elapsedBetween(startedAt, endedAt);
}

export function projectConversationTaskProgress(input: {
  runGraph: RunGraphResponse | null;
  turns: readonly ConversationLogTurn[];
  events: readonly Event[];
  agents: ReadonlyMap<string, ProgressAgentIdentity>;
  modelLabelsById: ReadonlyMap<string, string>;
  nowMs: number;
}): ConversationTaskProgressProjection {
  const latestTurn = input.turns[input.turns.length - 1];
  if (!input.runGraph) {
    if (!latestTurn || (latestTurn.runIds.length === 0 && latestTurn.stages.length === 0)) {
      return {
        summary: { state: 'not-started', completedSteps: 0, totalSteps: 0 },
        steps: [],
        participants: [],
      };
    }
    const state = latestTurn.state;
    const steps = directTurnSteps(latestTurn, input.events);
    return {
      summary: {
        runId: latestTurn.runIds[latestTurn.runIds.length - 1],
        state,
        completedSteps: steps.filter((step) => step.state === 'completed').length,
        totalSteps: steps.length,
        durationMs:
          latestTurn.durationMs ??
          (state === 'running'
            ? elapsedBetween(latestTurn.startedAt, new Date(input.nowMs).toISOString())
            : undefined),
      },
      steps,
      participants: dedupeStageParticipants(latestTurn.stages),
    };
  }

  const graph = input.runGraph;
  const state = toTaskProgressState(graph.run.state);
  const stageByStepId = new Map<string, ConversationLogStage>();
  for (const turn of input.turns) {
    if (!turn.runIds.includes(String(graph.run.id))) continue;
    for (const stage of turn.stages) {
      if (stage.id.startsWith('step:')) stageByStepId.set(stage.id.slice('step:'.length), stage);
    }
  }
  const orderedSteps = [...graph.steps].sort((left, right) => left.planOrder - right.planOrder);
  const graphEvents = input.events.filter(
    (event) => String(event.runId ?? '') === String(graph.run.id),
  );
  const delegationDecision = graphEvents.find((event) => event.type === 'group.delegation-decided');
  const delegatedGoals = new Map<string, string>();
  for (const event of graphEvents) {
    if (event.type !== 'group.subtask-delegated') continue;
    const agentVersionId = String(event.payload.toAgentVersionId ?? '');
    const goal = String(event.payload.goal ?? '').trim();
    if (agentVersionId && goal) delegatedGoals.set(agentVersionId, goal);
  }
  const leadAgentVersionId = String(orderedSteps[0]?.agentVersionId ?? '');
  const visibleSteps = delegationDecision
    ? orderedSteps.filter((step, index) => {
        const agentVersionId = String(step.agentVersionId);
        const isFinalLeadStep =
          agentVersionId === leadAgentVersionId && index === orderedSteps.length - 1;
        return isFinalLeadStep || delegatedGoals.has(agentVersionId);
      })
    : orderedSteps;
  const participants = new Map<string, TaskProgressParticipant>();
  for (const step of visibleSteps) {
    const id = String(step.agentVersionId);
    const identity = input.agents.get(id);
    const stepState = toTaskProgressState(step.state);
    const stage = stageByStepId.get(String(step.id));
    const staticModelId = String(step.modelOverrideId ?? identity?.defaultModelId ?? '');
    const next: TaskProgressParticipant = {
      id,
      name: identity?.name ?? id,
      role: identity?.role,
      responsibility: identity?.responsibility,
      modelLabel:
        stage?.modelLabel ||
        (staticModelId ? (input.modelLabelsById.get(staticModelId) ?? staticModelId) : undefined),
      state: stepState,
      color: identity?.color,
      avatarUrl: identity?.avatarUrl,
    };
    const current = participants.get(id);
    if (!current || STATE_PRIORITY[stepState] >= STATE_PRIORITY[current.state]) {
      participants.set(id, next);
    }
  }

  return {
    summary: {
      runId: String(graph.run.id),
      state,
      completedSteps: visibleSteps.filter((step) => toTaskProgressState(step.state) === 'completed')
        .length,
      totalSteps: visibleSteps.length,
      durationMs: runDuration({ graph, events: input.events, nowMs: input.nowMs, state }),
    },
    steps: visibleSteps.map((step) => ({
      id: String(step.id),
      title:
        delegatedGoals.get(String(step.agentVersionId)) ||
        step.title ||
        step.instructions ||
        '执行步骤',
      state: toTaskProgressState(step.state),
      agentName: input.agents.get(String(step.agentVersionId))?.name ?? String(step.agentVersionId),
    })),
    participants: [...participants.values()],
  };
}
