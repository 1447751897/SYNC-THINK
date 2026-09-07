export const scenarios = {
  website: {
    title: '制作产品介绍页',
    prompt:
      '根据任务资料，为 SYNC-THINK 整理一页产品介绍，突出本地工作区、模型选择和可查看的执行过程。',
    context: '产品实验室的需求说明和品牌资料已经就绪。我可以把介绍页内容整理为可继续编辑的文档。',
    files: ['需求说明.md', '品牌资料.md'],
    steps: [
      {
        title: '读取需求与品牌资料',
        tool: '读取文件',
        file: '需求说明.md',
        result:
          '产品：SYNC-THINK\n受众：开发者与创作者\n重点：本地工作区、模型选择、执行过程\n资料：需求说明.md、品牌资料.md',
        response: '资料已核对。介绍页将围绕三个已有能力展开，下载入口指向 Windows 版本。',
      },
      {
        title: '组织页面内容与结构',
        tool: '整理内容',
        file: '介绍页结构.md',
        result: '01 产品名称与简介\n02 本地工作区\n03 模型选择与执行过程\n04 Windows 下载入口',
        response: '页面内容已组织完成：先说明产品，再展示工作方式，最后提供下载入口。',
      },
      {
        title: '生成介绍文档',
        tool: '生成文档',
        file: '产品介绍页.md',
        result: '示例产物：产品介绍页.md\n结构：4 个部分\n结果：内容已整理，可继续编辑',
        response: '演示已完成。产品介绍文档已放在右侧产物区。',
      },
    ],
    artifact: {
      name: '产品介绍页.md',
      text: '# SYNC-THINK\n\n连接模型、上下文与行动的本地工作台。\n\n## 在同一工作区继续\n对话、文件与任务保留在本机。\n\n## 选择适合任务的模型\n连接自己的模型服务，按任务切换。\n\n## 查看每一步\n检查计划、工具结果与文件变更。\n\n下一步：下载 Windows 版。',
    },
  },
  release: {
    title: '整理发布计划',
    prompt: '根据版本记录和测试清单，整理下一版 Windows 内测包的发布计划，列出交付项和发布前检查。',
    context: '版本记录和测试清单已经加入当前任务。我可以先核对这些资料，再整理一份发布计划。',
    files: ['版本记录.md', '测试清单.md'],
    steps: [
      {
        title: '核对版本与测试记录',
        tool: '读取文件',
        file: '版本记录.md',
        result:
          '平台：Windows 11 x64\n发布类型：内测包\n已记录：安装、模型配置、任务恢复\n待确认：安装包哈希与发布说明',
        response: '版本资料已核对。发布计划会保留安装包、测试结果与回退说明三个交付项。',
      },
      {
        title: '整理交付与检查项',
        tool: '整理清单',
        file: '测试清单.md',
        result:
          '交付：安装包、SHA-256、发布说明\n检查：全新安装、首次配置、任务恢复\n留存：上一版安装包与备份说明',
        response: '交付项和检查项已整理。安装包上传前需要核对哈希，并保留上一版与备份说明。',
      },
      {
        title: '生成发布计划',
        tool: '生成文档',
        file: '发布计划.md',
        result: '示例产物：发布计划.md\n内容：交付清单、验收步骤、回退说明\n状态：待负责人确认',
        response: '演示已完成。发布计划已整理，实际发布仍需要负责人确认。',
      },
    ],
    artifact: {
      name: '发布计划.md',
      text: '# Windows 内测发布计划\n\n## 交付清单\n- Windows 11 x64 安装包\n- SHA-256 与发布说明\n- 测试结果\n\n## 发布前检查\n- 完成全新安装\n- 验证首次模型配置\n- 验证任务恢复\n\n## 回退准备\n保留上一版安装包与备份说明。\n\n状态：待负责人确认。',
    },
  },
};

const models = new Set(['Sync-Think', 'GPT', 'ClaudeCode']);
const modes = new Set(['plan', 'execute']);
const isRunning = (state) => state.phase === 'approval' || state.phase === 'active';

export function createDemoState(scenarioId = 'website', model = 'Sync-Think', mode = 'plan') {
  const scenario = scenarios[scenarioId] || scenarios.website;
  return {
    scenarioId: scenarios[scenarioId] ? scenarioId : 'website',
    model,
    mode,
    runModel: null,
    phase: 'ready',
    completed: 0,
    artifact: null,
    messages: [{ role: 'assistant', text: scenario.context }],
  };
}

export function transitionDemo(state, action) {
  if (action.type === 'scenario' && Object.hasOwn(scenarios, action.value))
    return createDemoState(action.value, state.model, state.mode);
  if (action.type === 'reset') return createDemoState(state.scenarioId, state.model, state.mode);
  if (action.type === 'model' && !isRunning(state) && models.has(action.value))
    return { ...state, model: action.value };
  if (action.type === 'mode' && !isRunning(state) && modes.has(action.value))
    return { ...state, mode: action.value };
  const scenario = scenarios[state.scenarioId];
  if (action.type === 'submit' && !isRunning(state)) {
    const prompt = (String(action.prompt ?? '').trim() || scenario.prompt).slice(0, 1000);
    return {
      ...state,
      runModel: state.model,
      phase: state.mode === 'plan' ? 'approval' : 'active',
      completed: 0,
      artifact: null,
      messages: [
        { role: 'assistant', text: scenario.context },
        { role: 'user', text: prompt },
        {
          role: 'assistant',
          model: state.model,
          text:
            state.mode === 'plan'
              ? '这项示例任务已整理为右侧的三步计划。确认计划后开始逐步执行。'
              : '按当前示例推进这项任务。三步执行过程和产物会保留在本次对话中。',
        },
      ],
    };
  }
  if (action.type === 'approve' && state.phase === 'approval')
    return {
      ...state,
      phase: 'active',
      messages: [
        ...state.messages,
        { role: 'assistant', model: state.runModel, text: '计划已确认，可以推进第一步。' },
      ],
    };
  if (action.type === 'next' && state.phase === 'active') {
    const step = scenario.steps[state.completed];
    const completed = state.completed + 1;
    const finished = completed === scenario.steps.length;
    return {
      ...state,
      completed,
      phase: finished ? 'complete' : 'active',
      artifact: finished ? { ...scenario.artifact } : null,
      messages: [
        ...state.messages,
        { role: 'assistant', kind: 'tool', title: step.tool, file: step.file, text: step.result },
        { role: 'assistant', model: state.runModel, text: step.response },
      ],
    };
  }
  return state;
}

export function mountDemo(document) {
  const get = (id) => document.getElementById(id);
  let state = createDemoState();
  let view = 'chat';
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const setView = (next, focus = false) => {
    view = next;
    get('demo-workspace').dataset.view = view;
    for (const tab of document.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
  };
  const render = (scroll = false) => {
    const scenario = scenarios[state.scenarioId];
    const running = isRunning(state);
    get('task-title').textContent = scenario.title;
    get('scenario-select').value = state.scenarioId;
    get('model-select').value = state.model;
    get('model-select').disabled = running;
    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.checked = input.value === state.mode;
      input.disabled = running;
    });
    document
      .querySelectorAll('[data-scenario]')
      .forEach((button) =>
        button.setAttribute('aria-current', String(button.dataset.scenario === state.scenarioId)),
      );
    get('context-files').replaceChildren(...scenario.files.map((file) => node('li', '', file)));
    get('model-caption').textContent =
      `${state.runModel || state.model} · ${state.mode === 'plan' ? '规划' : '执行'}模式`;
    get('prompt').disabled = running;
    get('send-prompt').disabled = running;
    get('sample-prompt').disabled = running;
    const status = {
      ready: '需求与资料已就绪',
      approval: '等待确认计划',
      active: `下一步：${scenario.steps[state.completed]?.title}`,
      complete: '演示已完成',
    }[state.phase];
    get('run-status').textContent = status;
    get('plan-state').textContent = {
      ready: '待提交',
      approval: '等待确认',
      active: '逐步执行',
      complete: '已完成',
    }[state.phase];
    for (const id of ['advance-run', 'results-advance']) {
      get(id).hidden = !running;
      get(id).textContent = state.phase === 'approval' ? '批准计划' : '执行下一步';
    }
    get('step-count').textContent = `${state.completed} / ${scenario.steps.length}`;
    get('plan-steps').replaceChildren(
      ...scenario.steps.map((step, index) => {
        const item = node(
          'li',
          index < state.completed
            ? 'done'
            : state.phase === 'active' && index === state.completed
              ? 'current'
              : '',
        );
        item.append(
          node('span', 'step-marker', index < state.completed ? '✓' : String(index + 1)),
          node('span', 'step-title', step.title),
          node(
            'span',
            'step-state',
            index < state.completed
              ? '已完成'
              : state.phase === 'active' && index === state.completed
                ? '下一步'
                : '待执行',
          ),
        );
        return item;
      }),
    );
    const opened = new Set(
      [...get('messages').querySelectorAll('details[open]')].map(
        (detail) => detail.dataset.message,
      ),
    );
    get('messages').replaceChildren(
      ...state.messages.map((message, index) => {
        if (message.kind === 'tool') {
          const detail = node('details', 'tool-result');
          detail.dataset.message = String(index);
          detail.open = opened.has(String(index));
          detail.append(
            node('summary', '', `${message.title} · ${message.file}`),
            node('pre', '', message.text),
          );
          return detail;
        }
        const item = node('article', `message ${message.role}`);
        item.append(
          node(
            'span',
            'message-author',
            message.role === 'user' ? '你' : message.model || state.model,
          ),
          node('p', '', message.text),
        );
        return item;
      }),
    );
    get('artifact-count').textContent = state.artifact ? '1' : '0';
    get('artifact-empty').hidden = Boolean(state.artifact);
    get('artifact-result').hidden = !state.artifact;
    get('artifact-name').textContent = state.artifact?.name || '';
    get('artifact-content').textContent = state.artifact?.text || '';
    if (scroll) get('conversation').scrollTop = get('conversation').scrollHeight;
  };
  const dispatch = (action) => {
    const previous = state;
    state = transitionDemo(state, action);
    if (state === previous) return;
    if (action.type === 'reset' || action.type === 'scenario') {
      get('prompt').value = scenarios[state.scenarioId].prompt;
      setView('chat');
    }
    if (action.type === 'submit') get('prompt').value = '';
    render(['submit', 'approve', 'next'].includes(action.type));
    if (state.phase === 'complete') {
      if (view === 'results') get('artifact-content').focus();
      else get('prompt').focus();
    }
  };
  const advance = () => dispatch({ type: state.phase === 'approval' ? 'approve' : 'next' });
  // The embedded demo intentionally runs without iframe form permission.
  const sendPrompt = () => dispatch({ type: 'submit', prompt: get('prompt').value });
  get('send-prompt').addEventListener('click', sendPrompt);
  get('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    sendPrompt();
  });
  get('reset-demo').addEventListener('click', () => dispatch({ type: 'reset' }));
  get('model-select').addEventListener('change', (event) =>
    dispatch({ type: 'model', value: event.target.value }),
  );
  get('scenario-select').addEventListener('change', (event) =>
    dispatch({ type: 'scenario', value: event.target.value }),
  );
  document
    .querySelectorAll('[data-scenario]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        dispatch({ type: 'scenario', value: button.dataset.scenario }),
      ),
    );
  document
    .querySelectorAll('input[name="mode"]')
    .forEach((input) =>
      input.addEventListener('change', () => dispatch({ type: 'mode', value: input.value })),
    );
  get('advance-run').addEventListener('click', advance);
  get('results-advance').addEventListener('click', advance);
  get('sample-prompt').addEventListener('click', () => {
    get('prompt').value = scenarios[state.scenarioId].prompt;
    get('prompt').focus();
  });
  get('back-to-chat').addEventListener('click', () => setView('chat', true));
  document.querySelectorAll('[role="tab"]').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      setView(
        event.key === 'Home'
          ? 'chat'
          : event.key === 'End'
            ? 'results'
            : view === 'chat'
              ? 'results'
              : 'chat',
        true,
      );
    });
  });
  get('prompt').value = scenarios[state.scenarioId].prompt;
  render();
}

if (typeof document !== 'undefined' && document.getElementById('demo-workspace'))
  mountDemo(document);
