export type BeginnerWorkspaceState =
  | 'empty'
  | 'offline'
  | 'setup'
  | 'ready'
  | 'working'
  | 'approval'
  | 'result'
  | 'continue';

export type BeginnerWorkspaceAction =
  | 'tasks'
  | 'create-project'
  | 'create-task'
  | 'reconnect'
  | 'agent'
  | 'compose'
  | 'approvals'
  | 'artifacts'
  | 'none';

export type BeginnerTaskStepState = 'complete' | 'active' | 'pending';

export interface BeginnerTaskStep {
  id: 'prepare' | 'work' | 'result';
  label: string;
  detail: string;
  state: BeginnerTaskStepState;
}

export interface BeginnerWorkspaceView {
  state: BeginnerWorkspaceState;
  statusLabel: string;
  statusDetail: string;
  nextAction: string;
  actionLabel: string | null;
  action: BeginnerWorkspaceAction;
  steps: readonly BeginnerTaskStep[];
  /** Center empty state primary heading (product copy). */
  emptyTitle: string;
  /** Center empty state supporting line. */
  emptyHint: string;
  /** Whether the top "下一步" strip should show (urgent guidance only). */
  showNextStepStrip: boolean;
  /** Whether the right-rail overview should stay dense with steps. */
  showProgressSteps: boolean;
}

export interface BeginnerWorkspaceInput {
  hasActiveTask: boolean;
  /** When known, empty CTA becomes create-project vs create-task. */
  hasWorkspace?: boolean;
  connectionState: 'preview' | 'connecting' | 'online' | 'offline';
  agentReady: boolean;
  streaming: boolean;
  messageCount: number;
  artifactCount: number;
  approvalCount: number;
}

function steps(
  prepare: BeginnerTaskStepState,
  work: BeginnerTaskStepState,
  result: BeginnerTaskStepState,
  workDetail: string,
  resultDetail: string,
): readonly BeginnerTaskStep[] {
  return [
    {
      id: 'prepare',
      label: '准备任务',
      detail: prepare === 'complete' ? '任务和运行方式已就绪' : '选择任务并确认运行方式',
      state: prepare,
    },
    { id: 'work', label: '完成工作', detail: workDetail, state: work },
    { id: 'result', label: '检查结果', detail: resultDetail, state: result },
  ];
}

export function projectBeginnerWorkspace(input: BeginnerWorkspaceInput): BeginnerWorkspaceView {
  if (!input.hasActiveTask) {
    // Prefer create-project when we know there is no workspace; otherwise create-task
    // (falls back to project create in the shell if the catalog is empty).
    const noWorkspace = input.hasWorkspace === false;
    return {
      state: 'empty',
      statusLabel: '可以开始',
      statusDetail: noWorkspace ? '还没有项目' : '还没有打开任务',
      nextAction: noWorkspace
        ? '先建一个项目，再创建任务开始对话。'
        : '创建或选择一个任务，就能开始对话。',
      actionLabel: noWorkspace ? '新建项目' : '新建任务',
      action: noWorkspace ? 'create-project' : 'create-task',
      steps: steps('active', 'pending', 'pending', '等待任务', '完成后在这里检查'),
      emptyTitle: '今天想推进什么？',
      emptyHint: noWorkspace
        ? '先建一个项目；本地文件夹可稍后绑定。'
        : '创建一个任务，或从左侧选择已有任务。',
      showNextStepStrip: false,
      showProgressSteps: false,
    };
  }

  if (input.connectionState !== 'online' && input.connectionState !== 'preview') {
    const connecting = input.connectionState === 'connecting';
    return {
      state: 'offline',
      statusLabel: connecting ? '正在连接' : '连接已断开',
      statusDetail: connecting ? '正在连接本地服务' : '暂时无法向智能体发送消息',
      nextAction: connecting ? '稍等片刻，连接成功后即可继续。' : '重新连接本地服务后继续任务。',
      actionLabel: connecting ? null : '重新连接',
      action: connecting ? 'none' : 'reconnect',
      steps: steps('active', 'pending', 'pending', '等待连接', '完成后在这里检查'),
      emptyTitle: connecting ? '正在连接本地服务' : '连接恢复后即可继续',
      emptyHint: connecting
        ? '连接成功后，对话会自动恢复。'
        : '重新连接本地服务，无需重述任务。',
      showNextStepStrip: !connecting,
      showProgressSteps: false,
    };
  }

  if (!input.agentReady) {
    return {
      state: 'setup',
      statusLabel: '还差一步',
      statusDetail: '智能体还没有可用模型',
      nextAction: '为智能体选好模型后，回到这里开始对话。',
      actionLabel: '配置智能体',
      action: 'agent',
      steps: steps('active', 'pending', 'pending', '等待运行模型', '完成后在这里检查'),
      emptyTitle: '为任务选好智能体',
      emptyHint: '绑定模型后即可发送消息。',
      showNextStepStrip: true,
      showProgressSteps: false,
    };
  }

  if (input.streaming) {
    return {
      state: 'working',
      statusLabel: '智能体处理中',
      statusDetail: '回复会自动出现在当前任务',
      nextAction: '智能体正在工作，无需重复发送。',
      actionLabel: null,
      action: 'none',
      steps: steps('complete', 'active', 'pending', '正在处理你的要求', '等待工作完成'),
      emptyTitle: '智能体处理中',
      emptyHint: '回复和执行结果会自动出现。',
      showNextStepStrip: false,
      showProgressSteps: true,
    };
  }

  if (input.approvalCount > 0) {
    return {
      state: 'approval',
      statusLabel: '等待你的确认',
      statusDetail: `${input.approvalCount} 项操作需要审批`,
      nextAction: '查看待审批内容，确认后智能体会继续。',
      actionLabel: '查看审批',
      action: 'approvals',
      steps: steps('complete', 'active', 'pending', '等待你的确认', '审批后继续'),
      emptyTitle: '有操作等待确认',
      emptyHint: '批准或拒绝后，任务才会继续。',
      showNextStepStrip: true,
      showProgressSteps: true,
    };
  }

  if (input.artifactCount > 0) {
    return {
      state: 'result',
      statusLabel: '已有结果',
      statusDetail: `${input.artifactCount} 项产物可检查`,
      nextAction: '检查产物，或继续告诉智能体需要调整的地方。',
      actionLabel: '查看产物',
      action: 'artifacts',
      steps: steps('complete', 'complete', 'complete', '本轮工作已返回', '产物可以检查'),
      emptyTitle: '本轮已有结果',
      emptyHint: '可以检查产物，或继续补充要求。',
      showNextStepStrip: false,
      showProgressSteps: true,
    };
  }

  if (input.messageCount === 0) {
    return {
      state: 'ready',
      statusLabel: '可以开始',
      statusDetail: '任务已就绪',
      nextAction: '在下方描述你希望完成的工作。',
      actionLabel: '开始输入',
      action: 'compose',
      steps: steps('complete', 'active', 'pending', '等待你的第一条消息', '完成后在这里检查'),
      emptyTitle: '告诉智能体要做什么',
      emptyHint: '直接在下方输入即可，上下文会留在当前任务里。',
      showNextStepStrip: false,
      showProgressSteps: false,
    };
  }

  return {
    state: 'continue',
    statusLabel: '等待你的消息',
    statusDetail: '可以继续当前对话',
    nextAction: '补充要求或询问进展，智能体会沿用当前任务上下文。',
    actionLabel: '继续输入',
    action: 'compose',
    steps: steps('complete', 'active', 'pending', '继续推进当前任务', '结果出现后可检查'),
    emptyTitle: '继续当前任务',
    emptyHint: '补充要求即可，无需重述背景。',
    showNextStepStrip: false,
    showProgressSteps: true,
  };
}
