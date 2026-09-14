import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUp,
  ArrowLeft,
  Check,
  FileCode2,
  FolderOpen,
  MessageSquare,
  PanelLeft,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import type {
  GoalStatus,
  BrowserHandoffSummary,
  DesktopWaitingCommandSummary,
} from '@sync-think/protocol';
import { ComposerTaskPanel } from './ComposerTaskPanel.js';
import { AskQuestionCard } from './AskQuestionCard.js';
import { PlanApprovalCard } from './PlanApprovalCard.js';
import { ToolApprovalCard } from './ToolApprovalCard.js';
import { ComposerApprovalStack } from './ComposerApprovalStack.js';
import { NewMaxComposerFrame } from './NewMaxComposerFrame.js';
import { ComposerEditor, type ComposerEditorHandle } from './ComposerEditor.js';
import { ComposerModeBanner } from './ComposerModeBanner.js';
import {
  WebsiteDemoToolbar,
  demoSkills,
  initialDemoSettings,
  type DemoComposeSettings,
} from './WebsiteDemoToolbar.js';
import { parseCapabilityView, type DemoRoster } from './website-capability-state.js';
import type { ComposeAttachment } from './compose-mention.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import { MarkdownContent } from './MarkdownContent.js';
import { CodeBlock } from './CodeBlock.js';
import { BrowserHandoffCard } from './BrowserHandoffCard.js';
import { DesktopWaitingCard } from './DesktopWaitingCard.js';
import { WebsiteDemoWorkbench } from './WebsiteDemoWorkbench.js';
import { DeferredFileDiff } from './DeferredFileDiff.js';
import { ComposeRequestQueue } from './ComposeRequestQueue.js';
import { createQueuedComposeRequest, type QueuedComposeRequest } from './compose-request-queue.js';
import { CopyTextButton } from './CopyTextButton.js';
import type { InlineProcessItem } from './ChatView.js';
import {
  createWebsiteDemoSession,
  demoAsk,
  demoConversationId,
  demoScenes,
  demoTodo,
  type DemoScene,
} from './website-demo-state.js';

const session = createWebsiteDemoSession();
Object.defineProperty(window, 'syncThink', {
  value: {
    runtime: {
      ...session.runtime,
      listProjectFiles: async ({ query = '' }: { query?: string }) => ({
        files: [
          { path: '需求说明.md', name: '需求说明.md', kind: 'file' },
          { path: 'task.ts', name: 'task.ts', kind: 'file' },
        ].filter((file) => file.name.includes(query)),
      }),
    },
  },
  configurable: true,
});
document.documentElement.classList.remove('dark');
document.body.dataset.demoView = 'chat';
if (new URLSearchParams(location.search).get('embed') === 'hero') {
  document.body.dataset.demoEmbed = 'hero';
}

const sampleCode = `export function describeTask(completed: number, total: number) {\n  if (completed === total) return '已完成';\n  return \`进行中：\${completed}/\${total}\`;\n}\n`;
const sampleBefore =
  "export function describeTask(completed: number, total: number) {\n  return '进行中';\n}\n";
const sampleDocument =
  '# 交互演示验收记录\n\n任务面板、提问卡、方案审批与工具审批均来自桌面端源文件。\n\n| 检查项 | 示例状态 |\n| --- | --- |\n| 单选与多选 | 已体验 |\n| 方案修订 | 已体验 |\n| 工具审批 | 已体验 |\n\n> 这是一份示例产物，不代表已经执行真实工程检查。';
const streamText =
  '我已把任务区、提问卡和审批卡放进同一个对话工作流。任务面板保持在输入框上方；提问时由问询卡接管输入区；方案与工具审批依照系统顺序叠放。接下来，你可以查看生成文件，或者继续提出新的需求。';
const processItems: InlineProcessItem[] = [
  {
    kind: 'reasoning',
    id: 'thinking',
    text: '演示思考摘要：先核对现有组件入口，再确认任务清单、提问和审批的先后顺序。这里没有展示真实模型的内部推理。',
    status: 'completed',
  },
  {
    kind: 'commentary',
    id: 'commentary',
    text: '已定位当前系统中的任务面板，接下来检查输入区的交互。',
    status: 'completed',
  },
  {
    kind: 'tool',
    toolCallId: 'read',
    name: 'read_file',
    argumentsJson: '{"path":"ComposerTaskPanel.tsx"}',
    inputSummary: 'ComposerTaskPanel.tsx',
    result: '读取到任务清单组件：支持进度、展开与收起、当前任务和清除操作。',
    status: 'completed',
  },
  {
    kind: 'tool',
    toolCallId: 'write',
    name: 'write_file',
    argumentsJson: '{"path":"task.ts"}',
    inputSummary: 'task.ts',
    result: sampleCode,
    status: 'completed',
  },
];
const browserHandoff: BrowserHandoffSummary = {
  handoffId: 'demo-browser',
  revision: 1,
  workspaceId: 'demo-workspace' as BrowserHandoffSummary['workspaceId'],
  runId: 'demo-run' as BrowserHandoffSummary['runId'],
  siteOrigin: 'https://example.com',
  reason: 'manual',
  requestedOutcome: '示例：确认页面内容，然后回到这里继续。此演示不会打开外部浏览器。',
  onCancel: 'keep-open',
  status: 'waiting_user',
  createdAt: '2026-09-08T09:00:00.000Z',
  updatedAt: '2026-09-08T09:00:00.000Z',
  canContinue: true,
  canCancel: true,
};

const desktopWaiting: DesktopWaitingCommandSummary = {
  commandId: 'demo-desktop',
  workspaceId: browserHandoff.workspaceId,
  runId: browserHandoff.runId,
  toolName: 'computer',
  action: 'invoke-element',
  target: { title: '演示窗口', appId: 'demo' },
  reason: 'user-input-detected',
  errorCode: 'demo.user-input',
  status: 'waiting_user',
  canContinue: true,
  canCancel: true,
  createdAt: browserHandoff.createdAt,
  updatedAt: browserHandoff.updatedAt,
};
function ChatApp({
  initialSettings = initialDemoSettings,
  initialModel = 'SYNC-THINK',
  onBack,
  roster,
}: {
  initialSettings?: DemoComposeSettings;
  initialModel?: string;
  onBack?: () => void;
  roster?: DemoRoster;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [input, setInput] = useState('');
  const [queue, setQueue] = useState<QueuedComposeRequest[]>([]);
  const [model, setModel] = useState(initialModel);
  const [mode, setMode] = useState<'plan' | 'execute'>('execute');
  const [settings, setSettings] = useState(initialSettings);
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);

  const [editorPlan, setEditorPlan] = useState(false);
  const [menu, setMenu] = useState<'mode' | null>(null);
  const [thinking, setThinking] = useState(true);
  const [streamCount, setStreamCount] = useState(0);
  const [streaming, setStreaming] = useState(true);
  const [goalState, setGoalState] = useState<GoalStatus['status']>('active');
  const overlay = useRef<HTMLDivElement>(null);
  const editor = useRef<ComposerEditorHandle>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const scene = demoScenes.find((item) => item.id === state.scene)!;
  const busy = ['question', 'plan', 'tool', 'running'].includes(state.phase);
  const showTask =
    state.phase === 'running' &&
    mode !== 'plan' &&
    !['streaming', 'browser', 'desktop', 'process'].includes(state.scene);
  const generating = state.scene === 'streaming' && streamCount < streamText.length && streaming;
  const streamComplete = streamCount >= streamText.length;
  const showProcess = ['process', 'result', 'error'].includes(state.scene) || state.completed > 0;

  useEffect(() => {
    setInput('');
    setQueue([]);
    setFileOpen(false);
    setEditorPlan(false);
    setMenu(null);
    setAttachments([]);
    setSettings(initialSettings);
    setStreamCount(0);
    setStreaming(true);
    setGoalState('active');
    setMode(session.getSnapshot().scene === 'plan' ? 'plan' : 'execute');
    follow.current = true;
  }, [state.revision, initialSettings]);
  useEffect(() => {
    if (state.scene !== 'streaming' || !streaming || streamComplete) return;
    const timer = window.setInterval(
      () => setStreamCount((count) => Math.min(streamText.length, count + 2)),
      55,
    );
    return () => window.clearInterval(timer);
  }, [state.scene, streaming, streamComplete]);
  useEffect(() => {
    if (streamCount === streamText.length) session.finishStream();
  }, [streamCount]);
  useEffect(() => {
    if (state.phase !== 'complete' || queue.length === 0) return;
    const [next, ...remaining] = queue;
    setQueue(remaining);
    session.send(next.text);
  }, [state.phase, queue]);
  useEffect(() => {
    if (!editorPlan) return;
    const previous = document.activeElement;
    const element = overlay.current;
    const controls = () => [
      ...(element?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, textarea, select, [tabindex="0"]',
      ) ?? []),
    ];
    controls()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const targets = controls().filter((target) => target.getClientRects().length > 0);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    element?.addEventListener('keydown', trap);
    return () => {
      element?.removeEventListener('keydown', trap);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [editorPlan]);
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [state.messages, streamCount]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setFileOpen(false);
        setEditorPlan(false);
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  const selectScene = (value: DemoScene) => {
    session.select(value);
    setSidebarOpen(false);
  };
  const send = (value = input) => {
    if (!value.trim()) return;
    if (busy) {
      setQueue((items) => [
        ...items,
        createQueuedComposeRequest({
          conversationId: demoConversationId,
          text: value.slice(0, 2000),
          attachments,
          modelOverride: model,
          reasoningEffort: settings.reasoning,
          networkEnabled: settings.network,
          skillVersionIds: settings.skills,
          kernelOverride: settings.kernel,
        }),
      ]);
      session.notify('需求已排队；当前任务完成后进入下一轮演示。');
    } else session.send(value);
    setInput('');
  };
  const planCard = (variant: 'composer' | 'editor') => (
    <PlanApprovalCard
      key={`${state.revision}:${variant}`}
      variant={variant}
      conversationId={demoConversationId}
      plan={state.plan}
      onPlanUpdated={(plan) => {
        if (!plan || plan.state !== 'draft') setEditorPlan(false);
      }}
      onExecute={() => session.notify('方案已批准，等待工具审批。')}
      onSwitchMode={(value) => {
        setMode(value);
        if (value === 'plan') setEditorPlan(true);
      }}
      onNotify={(_tone, text) => session.notify(text)}
    />
  );
  const goal: GoalStatus = {
    conversationId: demoConversationId,
    condition: '完成工作台演示并检查提问、审批和文件输出',
    status: goalState,
    startedAt: '2026-09-08T09:00:00.000Z',
    roundsStarted: state.completed,
    turnCount: state.completed,
    tokensIn: 3200,
    tokensOut: 860,
    maxGoalRounds: 10,
  };
  const activeMenu = input.endsWith('/') ? 'mode' : menu;

  return (
    <main className="website-chat-app" data-testid="website-chat-app">
      <aside className={`demo-scene-rail ${sidebarOpen ? 'is-open' : ''}`} aria-label="演示场景">
        <div className="demo-brand">
          <img className="sync-think-logo" src="/assets/sync-think-logo.png" alt="" />
          SYNC-THINK
          <button
            className="demo-mobile-close"
            aria-label="关闭场景导航"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
        <button className="demo-new-chat" onClick={() => selectScene('flow')}>
          <Plus size={16} />
          新建演示对话
        </button>
        <p className="demo-rail-label">工作台 · 真实组件</p>
        <nav>
          {demoScenes.map((item, index) => (
            <button
              key={item.id}
              data-testid={`scene-${item.id}`}
              aria-current={state.scene === item.id ? 'page' : undefined}
              title={item.hint}
              onClick={() => selectScene(item.id)}
            >
              <span className="demo-scene-number">{String(index + 1).padStart(2, '0')}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="demo-rail-footer">
          仅示例数据
          <br />
          不调用模型 · 不读写本机文件
        </div>
      </aside>
      <div className="demo-workspace-body">
        <section className="demo-chat-stage" aria-label="对话工作台">
          <header className="demo-chat-header">
            {onBack ? (
              <button onClick={onBack} title="返回能力展示" aria-label="返回能力展示">
                <ArrowLeft size={17} />
              </button>
            ) : null}
            <button
              aria-label="切换场景导航"
              className="demo-mobile-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <PanelLeft size={17} />
            </button>
            <div>
              <h1>{scene.label}</h1>
              <p>{scene.hint}</p>
            </div>
            {state.phase === 'running' &&
            !['streaming', 'browser', 'desktop', 'process'].includes(state.scene) ? (
              <button
                className="demo-next-control"
                data-testid="demo-next"
                disabled={state.scene === 'goal' && goalState === 'paused'}
                onClick={() => session.next()}
              >
                模拟下一步
              </button>
            ) : null}
            <button
              title="重新开始当前场景"
              aria-label="重新开始当前场景"
              onClick={() => session.select(state.scene)}
            >
              <RotateCcw size={15} />
            </button>
            <button
              aria-label="打开文件产物"
              disabled={state.phase !== 'complete'}
              onClick={() => setFileOpen(true)}
            >
              <FolderOpen size={17} />
            </button>
          </header>
          <div
            className="demo-chat-scroll"
            ref={scroll}
            onScroll={() => {
              const element = scroll.current;
              if (element)
                follow.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 70;
            }}
          >
            <div className="demo-message-column">
              {state.messages.map((message, index) => (
                <article
                  className={`demo-message is-${message.role}`}
                  key={`${state.revision}:${index}`}
                >
                  <div className="demo-message-author">
                    {message.role === 'assistant' ? (
                      <img className="sync-think-logo" src="/assets/sync-think-logo.png" alt="" />
                    ) : null}
                    {message.role === 'assistant'
                      ? settings.identity.track === 'model'
                        ? 'SYNC-THINK'
                        : settings.identity.name
                      : '你'}
                    <span>示例</span>
                  </div>
                  <MarkdownContent text={message.text} interactiveEmbeds={false} />
                  <div className="demo-message-actions">
                    <CopyTextButton text={message.text} />
                    <span>
                      {settings.identity.track === 'model' ? model : settings.identity.name} ·
                      演示消息
                    </span>
                  </div>
                </article>
              ))}
              {showProcess ? (
                <InlineProcessFlow
                  key={`${state.revision}:${state.phase}`}
                  items={
                    state.phase === 'error'
                      ? [
                          ...processItems.slice(0, 2),
                          {
                            kind: 'tool',
                            toolCallId: 'failed-check',
                            name: 'shell_command',
                            inputSummary: 'pnpm test',
                            argumentsJson: '{"command":"pnpm test"}',
                            result: '示例错误：检查超时。没有运行真实测试。',
                            failed: true,
                            status: 'failed',
                          },
                        ]
                      : processItems
                  }
                  defaultOpen={state.scene === 'process' || state.phase === 'error'}
                  showThinking={thinking}
                  onShowThinkingChange={setThinking}
                  streaming={false}
                />
              ) : null}
              {state.scene === 'streaming' ? (
                <article className="demo-stream" aria-label="流式演示">
                  <MarkdownContent
                    text={streamText.slice(0, streamCount)}
                    streaming={streaming && streamCount < streamText.length}
                    interactiveEmbeds={false}
                  />
                  <div className="demo-stream-controls">
                    <span role="status">
                      {streamCount === streamText.length
                        ? '生成完成'
                        : streaming
                          ? '示例输出中…'
                          : '已停止生成'}
                    </span>
                    <button
                      onClick={() => setStreaming((value) => !value)}
                      disabled={streamCount === streamText.length}
                    >
                      {streaming ? '停止生成' : '继续生成'}
                    </button>
                  </div>
                </article>
              ) : null}
              {state.phase === 'error' ? (
                <div className="demo-error" role="alert">
                  <strong>示例检查未完成</strong>
                  <p>这里演示工具失败后的恢复入口，不会发出真实命令。</p>
                  <button onClick={() => session.retry()}>重试检查</button>
                </div>
              ) : null}
              {state.phase === 'complete' ? (
                <div className="demo-result" data-testid="demo-result">
                  <MarkdownContent
                    text={
                      '### 交付内容\n\n- [x] 完成任务清单\n- [x] 记录提问与审批\n- [x] 生成示例代码与说明\n\n以下是示例产物，可打开文件查看。'
                    }
                    interactiveEmbeds={false}
                  />
                  <CodeBlock code={sampleCode} language="typescript" filename="task.ts" />
                  <button className="demo-artifact-link" onClick={() => setFileOpen(true)}>
                    <FileCode2 size={16} />
                    打开 3 个示例文件
                  </button>
                </div>
              ) : null}
              {state.scene === 'flow' && state.phase === 'ready' ? (
                <button
                  className="demo-example-prompt"
                  onClick={() => {
                    setInput('帮我搭建一个覆盖任务、提问、审批与文件的完整交互演示。');
                    editor.current?.focus();
                  }}
                >
                  试一试：搭建完整交互演示 <ArrowUp size={14} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="demo-composer-region">
            <div className="demo-composer-column">
              <div className="demo-playback">
                <span role="status" data-testid="demo-status">
                  {state.notice || '可操作的组件演示 · 所有执行均为模拟'}
                </span>
                {state.scene === 'process' ? (
                  <button onClick={() => selectScene('result')}>查看输出文件</button>
                ) : null}
              </div>
              <div className="demo-composer-surfaces">
                {showTask ? (
                  <ComposerTaskPanel scopeKey={demoConversationId} todo={demoTodo(state)} />
                ) : null}
                {state.scene === 'desktop' && state.phase === 'running' ? (
                  <DesktopWaitingCard
                    command={desktopWaiting}
                    busy={false}
                    onContinue={() => session.continueHandoff()}
                    onCancel={() => session.cancel()}
                  />
                ) : null}
                {state.scene === 'browser' && state.phase === 'running' ? (
                  <BrowserHandoffCard
                    handoff={browserHandoff}
                    busy={false}
                    onContinue={() => session.continueHandoff()}
                    onCancel={() => session.cancel()}
                  />
                ) : null}
                <ComposerApprovalStack
                  hasSurfaceBelow={mode === 'plan' || state.scene === 'goal'}
                  tool={
                    state.phase === 'tool'
                      ? {
                          key: `tool-${state.revision}`,
                          node: (
                            <ToolApprovalCard
                              approval={{
                                approvalId: 'demo-write',
                                toolName: 'write_file',
                                title: '允许生成演示文件？',
                                detail: '写入 task.ts · 仅内存示例，不操作磁盘',
                                path: 'task.ts',
                                allowedScopes: ['once', 'session'],
                              }}
                              onApprove={(scope) => session.approveTool(scope)}
                              onDeny={() => session.denyTool()}
                            />
                          ),
                        }
                      : undefined
                  }
                  plan={
                    state.phase === 'plan'
                      ? {
                          key: `plan-${state.revision}-${state.plan.currentRevision}`,
                          node: planCard('composer'),
                        }
                      : undefined
                  }
                />
                <NewMaxComposerFrame
                  variant="conversation"
                  data-layout="tall"
                  modeBanner={
                    state.scene === 'goal' && goalState !== 'cleared' ? (
                      <ComposerModeBanner
                        mode="goal"
                        goal={goal}
                        onPauseGoal={() => setGoalState('paused')}
                        onResumeGoal={() => setGoalState('active')}
                        onClearGoal={() => {
                          setGoalState('cleared');
                          session.cancel();
                        }}
                        onConfigureGoal={() =>
                          session.notify('示例目标：完成工作台演示并检查提问、审批和文件输出。')
                        }
                      />
                    ) : mode === 'plan' ? (
                      <ComposerModeBanner
                        mode="plan"
                        planModelLabel={model}
                        actModelLabel={model}
                        onOpenPlanSettings={() => {
                          setMenu('mode');
                          session.notify('可以在输入区切换规划/执行模式与示例模型。');
                        }}
                      />
                    ) : undefined
                  }
                >
                  <ComposeRequestQueue
                    items={queue}
                    activeRun={busy}
                    dispatchingId={state.phase === 'running' ? queue[0]?.id : undefined}
                    onEdit={(id, text) =>
                      setQueue((items) =>
                        items.map((item) => (item.id === id ? { ...item, text } : item)),
                      )
                    }
                    onDelete={(id) => setQueue((items) => items.filter((item) => item.id !== id))}
                    onInterject={(id) => {
                      const item = queue.find((queued) => queued.id === id);
                      if (item) session.interject(item.text);
                      setQueue((items) => items.filter((item) => item.id !== id));
                    }}
                  />
                  {state.phase === 'question' ? (
                    <AskQuestionCard key={state.revision} ask={demoAsk} onSettled={() => {}} />
                  ) : (
                    <>
                      {activeMenu ? (
                        <div className="demo-composer-menu" role="group" aria-label="输入快捷选项">
                          <>
                            {(['plan', 'execute'] as const).map((value) => (
                              <button
                                key={value}
                                onClick={() => {
                                  setMode(value);
                                  setInput((text) => text.replace(/\/$/, ''));
                                  setMenu(null);
                                }}
                              >
                                <MessageSquare size={15} />
                                {value === 'plan' ? '规划模式' : '执行模式'}
                                {mode === value ? <Check size={13} /> : null}
                              </button>
                            ))}
                          </>
                        </div>
                      ) : null}
                      <div className="shell-newmax-composer__editor is-conversation">
                        <ComposerEditor
                          ref={editor}
                          selectedSkills={demoSkills.filter((item) =>
                            settings.skills.includes(item.skillVersionId),
                          )}
                          onRemoveSkill={(id) =>
                            setSettings((current) => ({
                              ...current,
                              skills: current.skills.filter((item) => item !== id),
                            }))
                          }
                          attachments={attachments}
                          onRemoveAttachment={(path) =>
                            setAttachments((items) => items.filter((item) => item.path !== path))
                          }
                          onOpenAttachment={() => setFileOpen(true)}
                          value={input}
                          onChange={(value) => setInput(value)}
                          onSubmit={(value) => send(value)}
                          placeholder={
                            busy
                              ? '输入追加需求，发送后加入待处理队列…'
                              : '输入消息…（输入 @ 引用文件，/ 打开快捷面板）'
                          }
                          ariaLabel="任务输入"
                          inputTestId="demo-prompt"
                          minHeight={70}
                          maxHeight={150}
                        />
                      </div>
                      <WebsiteDemoToolbar
                        key={state.revision}
                        editor={editor}
                        input={input}
                        onInput={setInput}
                        model={model}
                        onModel={setModel}
                        mode={mode}
                        onMode={setMode}
                        onGoal={() => selectScene('goal')}
                        settings={settings}
                        roster={roster}
                        onSettings={setSettings}
                        attachments={attachments}
                        onAttachments={setAttachments}
                        onNotice={(value) => session.notify(value)}
                        busy={busy}
                        generating={generating}
                        onSend={() => send()}
                        onStop={() => setStreaming(false)}
                      />
                    </>
                  )}
                </NewMaxComposerFrame>
              </div>
              <p className="demo-disclosure">
                桌面端组件 · 本地交互模拟 · 不代表真实模型能力或实际执行结果
              </p>
            </div>
          </div>
        </section>
        {fileOpen ? (
          <WebsiteDemoWorkbench
            onClose={() => setFileOpen(false)}
            renderDocument={() => (
              <MarkdownContent text={sampleDocument} interactiveEmbeds={false} />
            )}
            renderCode={() => (
              <CodeBlock
                code={sampleCode}
                filename="task.ts"
                language="typescript"
                maxHeight={600}
              />
            )}
            renderDiff={() => (
              <DeferredFileDiff
                conversationId={demoConversationId}
                item={{
                  path: 'task.ts',
                  action: 'edited',
                  previousContent: sampleBefore,
                  content: sampleCode,
                }}
              />
            )}
          />
        ) : null}
      </div>
      {editorPlan && state.phase === 'plan' ? (
        <div
          ref={overlay}
          className="demo-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="编辑执行方案"
        >
          <div className="demo-overlay-header">
            <h2>编辑执行方案</h2>
            <button aria-label="关闭方案编辑" onClick={() => setEditorPlan(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="demo-overlay-content">{planCard('editor')}</div>
        </div>
      ) : null}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing demo root');
const CapabilityDemo = lazy(() => import('./WebsiteCapabilityDemo.js'));
const initialView = parseCapabilityView(new URLSearchParams(location.search).get('view'));
function DemoEntry() {
  const [conversation, setConversation] = useState<{
    settings: DemoComposeSettings;
    model: string;
    roster?: DemoRoster;
  } | null>(null);
  if (!initialView) return <ChatApp />;
  if (conversation)
    return (
      <ChatApp
        initialSettings={conversation.settings}
        initialModel={conversation.model}
        roster={conversation.roster}
        onBack={() => setConversation(null)}
      />
    );
  return (
    <Suspense fallback={<p role="status">正在载入工作区…</p>}>
      <CapabilityDemo
        initialView={initialView}
        onStart={(identity, model, roster) => {
          session.select('flow');
          setConversation({ settings: { ...initialDemoSettings, identity }, model, roster });
        }}
      />
    </Suspense>
  );
}
createRoot(root).render(<DemoEntry />);
