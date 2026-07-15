export type BeginnerWorkspaceState =
  'empty' | 'offline' | 'setup' | 'ready' | 'working' | 'approval' | 'result' | 'continue';

export type BeginnerWorkspaceAction =
  'tasks' | 'reconnect' | 'agent' | 'compose' | 'approvals' | 'artifacts' | 'none';

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
}

export interface BeginnerWorkspaceInput {
  hasActiveTask: boolean;
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
    return {
      state: 'empty',
      statusLabel: '等待开始',
      statusDetail: '还没有打开任务',
      nextAction: '从左侧选择一个任务，或新建任务。',
      actionLabel: '查看任务',
      action: 'tasks',
      steps: steps('active', 'pending', 'pending', '等待任务', '完成后在这里检查'),
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
    };
  }

  if (!input.agentReady) {
    return {
      state: 'setup',
      statusLabel: '还差一步',
      statusDetail: '智能体没有可用的运行模型',
      nextAction: '为智能体选择分组、供应商和模型，然后回到任务。',
      actionLabel: '配置智能体',
      action: 'agent',
      steps: steps('active', 'pending', 'pending', '等待运行模型', '完成后在这里检查'),
    };
  }

  if (input.streaming) {
    return {
      state: 'working',
      statusLabel: '智能体处理中',
      statusDetail: '回复和执行结果会自动出现在当前任务',
      nextAction: '智能体正在工作，无需重复发送。',
      actionLabel: null,
      action: 'none',
      steps: steps('complete', 'active', 'pending', '正在处理你的要求', '等待工作完成'),
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
    };
  }

  if (input.messageCount === 0) {
    return {
      state: 'ready',
      statusLabel: '可以开始',
      statusDetail: '任务、智能体和模型已就绪',
      nextAction: '在下方描述你希望完成的工作。',
      actionLabel: '开始输入',
      action: 'compose',
      steps: steps('complete', 'active', 'pending', '等待你的第一条消息', '完成后在这里检查'),
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
  };
}
