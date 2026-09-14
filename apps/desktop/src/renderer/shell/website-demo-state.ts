import type {
  ChatPlanSubmission,
  ConversationId,
  ConversationPlanSummary,
  TaskPlanProjection,
} from '@sync-think/shared';
import type { AskQuestionAnswer, ToolApprovalScope } from '@sync-think/protocol';
import { projectFileDiffPage } from '@sync-think/shared';
import type { ConversationReadFileDiffPayload } from '@sync-think/protocol';
import type { PendingAsk } from './AskQuestionCard.js';

export const demoScenes = [
  { id: 'flow', label: '完整对话流程', hint: '发送 → 提问 → 方案 → 审批 → 执行' },
  { id: 'tasks', label: '任务进度', hint: '展开、收起、清除和逐项完成' },
  { id: 'question', label: '提问卡', hint: '单选、多选、自定义、跳过、取消' },
  { id: 'plan', label: '方案审批', hint: '查看、编辑、修订、批准和取消' },
  { id: 'tool', label: '工具审批', hint: '单次批准、会话批准、拒绝' },
  { id: 'process', label: '思考与工具', hint: '过程折叠、工具参数和结果' },
  { id: 'result', label: '代码与文件', hint: 'Markdown、代码、变更和产物' },
  { id: 'streaming', label: '流式输出', hint: '逐字生成、停止和继续' },
  { id: 'error', label: '失败与重试', hint: '失败工具、错误提示和重试' },
  { id: 'browser', label: '浏览器接管', hint: '人工继续或取消' },
  { id: 'desktop', label: '桌面操作等待', hint: '人工输入暂停与恢复' },
  { id: 'queue', label: '待处理需求', hint: '运行中追加、编辑、删除和插话' },
  { id: 'goal', label: '目标模式', hint: '目标横幅、暂停和恢复' },
] as const;
export type DemoScene = (typeof demoScenes)[number]['id'];
export type DemoPhase =
  'ready' | 'question' | 'plan' | 'tool' | 'running' | 'complete' | 'cancelled' | 'error';
export const demoConversationId = 'website-demo-conversation' as ConversationId;
export const demoTaskItems = [
  {
    title: '搭建完整工作台交互演示',
    description: '复用当前系统的对话、任务清单和输入框组件，保持同一套字体、间距与动效。',
  },
  {
    title: '补齐提问与审批交互',
    description: '覆盖单选、多选、自定义回答、方案修订及工具批准或拒绝。',
  },
  {
    title: '接入嵌入式演示路由',
    description: '通过独立浏览器入口展示真实组件，所有操作只使用内存中的示例数据。',
  },
  {
    title: '整理本次改动并跑通校验',
    description: '验证桌面与移动端、组件交互和构建，确认没有引入真实模型调用。',
  },
];
export const demoPlan: ChatPlanSubmission = {
  title: '搭建完整工作台交互演示',
  goal: '让用户在官网直接体验 SYNC-THINK 的真实交互组件。',
  scope: ['apps/website', 'apps/desktop/src/renderer/shell'],
  assumptions: ['演示使用本地示例数据，不调用真实模型。'],
  decisions: ['复用桌面端组件，不再维护第二套卡片样式。'],
  steps: demoTaskItems.map((item, index) => ({
    id: `step-${index + 1}`,
    ...item,
    expectedFiles: ['Workbench.tsx'],
    acceptanceChecks: ['交互测试通过'],
  })),
  risks: [{ description: '官网演示与产品样式漂移', mitigation: '共用组件源文件与 shell.css' }],
  finalAcceptanceChecks: [
    '提问、方案与工具审批可以操作',
    '任务进度与生成文件同步',
    '演示不发起模型或文件系统请求',
  ],
};

export function makeDemoPlan(): ConversationPlanSummary {
  const latest = {
    id: 'demo-revision-1',
    conversationId: demoConversationId,
    revision: 1,
    plan: structuredClone(demoPlan),
    state: 'draft' as const,
    createdAt: '2026-09-08T09:00:00.000Z',
  };
  return {
    planId: 'demo-plan',
    conversationId: demoConversationId,
    currentRevision: 1,
    state: 'draft',
    latest,
    revisions: [latest],
  };
}

export const demoAsk: PendingAsk = {
  askId: 'demo-ask',
  threadId: 'demo-thread',
  runId: 'demo-run',
  createdAt: '2026-09-08T09:00:00.000Z',
  questions: [
    {
      id: 'audience',
      header: '使用场景',
      question: '这份交互演示主要面向谁？',
      options: [
        { label: '首次使用者（推荐）', description: '串联一次完整工作流程' },
        { label: '产品团队', description: '逐项检查组件交互' },
      ],
    },
    {
      id: 'coverage',
      header: '交互范围',
      question: '你希望优先体验哪些功能？',
      multiSelect: true,
      options: [
        { label: '任务进度', description: '查看每一步状态' },
        { label: '提问与审批', description: '掌握人工介入的时机' },
        { label: '文件与代码', description: '查看工作产物' },
      ],
    },
  ],
};

export interface DemoSnapshot {
  scene: DemoScene;
  phase: DemoPhase;
  revision: number;
  completed: number;
  plan: ConversationPlanSummary;
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  notice: string;
}

function initial(scene: DemoScene, revision: number): DemoSnapshot {
  const phase: DemoPhase =
    scene === 'flow'
      ? 'ready'
      : scene === 'question'
        ? 'question'
        : scene === 'plan'
          ? 'plan'
          : scene === 'tool'
            ? 'tool'
            : scene === 'result'
              ? 'complete'
              : scene === 'error'
                ? 'error'
                : 'running';
  return {
    scene,
    phase,
    revision,
    completed: scene === 'result' ? 4 : 0,
    plan: makeDemoPlan(),
    messages: [
      {
        role: 'assistant',
        text:
          scene === 'flow'
            ? '你好，我是 SYNC-THINK。描述你想完成的工作，我们一起把想法变成可检查的结果。\n\n这是交互演示，所有回答、执行与文件均为示例。'
            : '我会按下面的任务清单推进。你可以查看过程，也可以在需要时回答问题、修改方案或决定是否批准工具操作。\n\n**当前展示使用桌面端真实组件，数据为演示数据。**',
      },
    ],
    notice: '',
  };
}

export function demoTodo(state: DemoSnapshot): TaskPlanProjection {
  const items = state.plan.latest.plan.steps;
  return {
    total: items.length,
    completed: state.completed,
    running: state.phase === 'running',
    items: items.map((item, index) => ({
      ...item,
      status:
        index < state.completed
          ? 'completed'
          : index === state.completed
            ? 'in_progress'
            : 'pending',
    })),
  };
}

export function createWebsiteDemoSession() {
  let snapshot = initial('tasks', 0);
  const listeners = new Set<() => void>();
  const update = (patch: Partial<DemoSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const say = (text: string) =>
    update({ messages: [...snapshot.messages, { role: 'assistant', text }], notice: text });
  const requirePhase = (phase: DemoPhase) => {
    if (snapshot.phase !== phase) throw new Error('演示状态已变化，请重新选择场景。');
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(scene: DemoScene) {
      if (!demoScenes.some((item) => item.id === scene)) return;
      snapshot = initial(scene, snapshot.revision + 1);
      listeners.forEach((listener) => listener());
    },
    send(text: string) {
      if (['question', 'plan', 'tool', 'running'].includes(snapshot.phase)) return;
      const prompt = text.trim().slice(0, 2000);
      if (!prompt) return;
      update({
        phase: 'question',
        completed: 0,
        messages: [...snapshot.messages, { role: 'user', text: prompt }],
        notice: '请先回答两个问题。',
      });
    },
    notify(text: string) {
      update({ notice: text });
    },
    interject(text: string) {
      update({ messages: [...snapshot.messages, { role: 'user', text }] });
      say('已收到插话；这里只记录演示消息，不打断或启动真实进程。');
    },
    finishStream() {
      if (snapshot.scene === 'streaming') update({ phase: 'ready' });
    },
    approveTool(scope: ToolApprovalScope) {
      requirePhase('tool');
      update({ phase: 'running' });
      say(`已${scope === 'session' ? '在本会话中' : '单次'}批准演示操作。不会执行真实命令。`);
    },
    denyTool() {
      requirePhase('tool');
      update({ phase: 'cancelled' });
      say('你已拒绝此工具操作。任务已停止，没有执行命令或生成文件。');
    },
    next() {
      if (snapshot.phase !== 'running') return;
      const steps = snapshot.plan.latest.plan.steps;
      const completed = Math.min(steps.length, snapshot.completed + 1);
      update({ completed, phase: completed === steps.length ? 'complete' : 'running' });
      say(
        completed === steps.length
          ? '演示任务已完成。你可以打开生成的代码、Markdown 与文件变更。'
          : `已完成：${steps[completed - 1].title}。`,
      );
    },
    retry() {
      if (snapshot.phase !== 'error') return;
      update({ phase: 'running', notice: '正在重试示例检查。' });
    },
    cancel() {
      update({ phase: 'cancelled' });
      say('演示已停止。可以重新发送需求或重新开始场景。');
    },
    continueHandoff() {
      update({ phase: 'running', scene: 'tasks' });
      say('已确认人工操作完成，继续演示任务。');
    },
    runtime: {
      async readConversationFileDiff(payload: ConversationReadFileDiffPayload) {
        if (!('text' in payload.before) || !('text' in payload.after))
          throw new Error('演示仅接受内存文本。');
        const hash = async (value: string) =>
          [
            ...new Uint8Array(
              await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
            ),
          ]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
        const beforeVersion = await hash(payload.before.text);
        const afterVersion = await hash(payload.after.text);
        const version = await hash(beforeVersion + afterVersion);
        return {
          diff: {
            ...projectFileDiffPage(payload.before.text, payload.after.text, payload, version),
            beforeVersion,
            afterVersion,
          },
        };
      },
      async conversationAskAnswer(payload: { askId: string; answers: AskQuestionAnswer[] }) {
        requirePhase('question');
        if (payload.askId !== demoAsk.askId || payload.answers.length !== demoAsk.questions.length)
          throw new Error('演示问题已变化。');
        const text = payload.answers
          .map((answer) => answer.custom || answer.selected.join('、') || '已跳过')
          .join('；');
        update({ phase: 'plan', plan: makeDemoPlan() });
        say(`已记录你的回答：${text}。请检查执行方案。`);
        return { askId: payload.askId };
      },
      async conversationAskCancel() {
        requirePhase('question');
        update({ phase: 'cancelled' });
        say('已取消问询，没有继续执行。');
        return { askId: demoAsk.askId };
      },
      async conversationPlanRevise(payload: {
        expectedRevision: number;
        plan: ChatPlanSubmission;
      }) {
        requirePhase('plan');
        if (payload.expectedRevision !== snapshot.plan.currentRevision)
          throw new Error('方案版本已变化。');
        const revision = payload.expectedRevision + 1;
        const latest = {
          ...snapshot.plan.latest,
          id: `demo-revision-${revision}`,
          revision,
          plan: structuredClone(payload.plan),
        };
        const plan = {
          ...snapshot.plan,
          latest,
          currentRevision: revision,
          revisions: [...snapshot.plan.revisions, latest],
        };
        update({ plan, notice: `方案已保存为 v${revision}。` });
        return { plan };
      },
      async conversationPlanApprove(payload: { revision: number }) {
        requirePhase('plan');
        if (payload.revision !== snapshot.plan.currentRevision) throw new Error('请批准最新版本。');
        const plan = { ...snapshot.plan, state: 'approved' as const };
        update({ plan, phase: 'tool', notice: '方案已批准。写入前仍需单独批准工具。' });
        return { plan };
      },
      async conversationPlanCancel() {
        requirePhase('plan');
        const plan = { ...snapshot.plan, state: 'cancelled' as const };
        update({ plan, phase: 'cancelled' });
        say('执行方案已取消。');
        return { plan };
      },
    },
  };
}
