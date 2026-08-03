import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { RunProcessView } from '@sync-think/protocol';
import { Bot, CheckCircle2, FileCode2, User } from 'lucide-react';
import { ExecutionProcessBlock } from './ExecutionProcessBlock.js';
import { FirstLaunchGuide, FIRST_LAUNCH_GUIDE_KEY } from './FirstLaunchGuide.js';
import { DataDiagnosticsSection } from './SettingsPage.js';

export const PHASE3_VISUAL_CASES = [
  'welcome',
  'long-trace-open',
  'long-trace-closed',
  'diagnostics',
] as const;

export type Phase3VisualCase = (typeof PHASE3_VISUAL_CASES)[number];

export function resolvePhase3VisualCase(search: string): Phase3VisualCase | undefined {
  const requested = new URLSearchParams(search).get('phase3-visual');
  return PHASE3_VISUAL_CASES.find((candidate) => candidate === requested);
}

const COMPLETED_TRACE: RunProcessView = {
  runId: 'phase3-visual-run' as RunProcessView['runId'],
  running: false,
  doneCount: 3,
  errorCount: 0,
  tokensIn: 18420,
  tokensOut: 3260,
  durationMs: 18400,
  providerModelId: 'openai',
  modelId: 'gpt-5.6',
  steps: [
    {
      id: 'read-shell',
      label: 'Read shell',
      verb: 'Read',
      zh: '读取界面入口',
      toolName: 'read_file',
      kind: 'read',
      status: 'done',
      path: 'apps/desktop/src/renderer/shell/ShellApp.tsx',
      preview: '已读取 214 行，定位欢迎页与对话区入口。',
    },
    {
      id: 'edit-guide',
      label: 'Edit onboarding',
      verb: 'Edit',
      zh: '更新首次启动引导',
      toolName: 'apply_patch',
      kind: 'write',
      status: 'done',
      path: 'apps/desktop/src/renderer/shell/FirstLaunchGuide.tsx',
      preview: '已写入三步引导、跳过入口与键盘焦点状态。',
    },
    {
      id: 'test-shell',
      label: 'Run tests',
      verb: 'Run',
      zh: '运行桌面专项测试',
      toolName: 'exec_command',
      kind: 'bash',
      status: 'done',
      command: 'pnpm --filter @sync-think/desktop exec vitest run',
      preview: '42 tests passed in 6.8s',
      exitCode: 0,
    },
  ],
  fileChanges: [
    {
      path: 'apps/desktop/src/renderer/shell/FirstLaunchGuide.tsx',
      action: 'edited',
    },
  ],
};

const RUNNING_TRACE: RunProcessView = {
  ...COMPLETED_TRACE,
  runId: 'phase3-visual-running' as RunProcessView['runId'],
  running: true,
  doneCount: 2,
  steps: [
    ...COMPLETED_TRACE.steps.slice(0, 2),
    {
      id: 'build-shell',
      label: 'Build desktop',
      verb: 'Build',
      zh: '构建桌面应用',
      toolName: 'exec_command',
      kind: 'bash',
      status: 'running',
      command: 'pnpm --filter @sync-think/desktop build',
      preview: '正在生成 renderer-shell 与 preload bundle…',
    },
  ],
};

const HISTORY = Array.from({ length: 18 }, (_, index) => ({
  id: 'fixture-message-' + (index + 1),
  role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
  text:
    index % 2 === 0
      ? '第 ' + (Math.floor(index / 2) + 1) + ' 轮：继续完成当前切片，并保留可复验的构建证据。'
      : '已完成第 ' + (Math.floor(index / 2) + 1) + ' 轮检查。上下文仍由同一任务承接，历史消息按 50 条分页读取。',
}));

function FixtureFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <main className="phase3-visual" data-phase3-ready="true" aria-label={label}>
      <aside className="phase3-visual__rail" aria-label="工作台导航示意">
        <div className="phase3-visual__brand" aria-label="SYNC-THINK">S</div>
        <button type="button" className="is-active" aria-label="对话">
          <Bot size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label="文件">
          <FileCode2 size={16} aria-hidden="true" />
        </button>
        <div className="phase3-visual__rail-spacer" />
        <div className="phase3-visual__rail-status" title="Runtime 已连接" />
      </aside>
      <section className="phase3-visual__surface">
        <header className="phase3-visual__topbar">
          <div>
            <span>PHASE 3 · VISUAL ACCEPTANCE</span>
            <strong>{label}</strong>
          </div>
          <div className="phase3-visual__ready">
            <CheckCircle2 size={13} aria-hidden="true" />
            LOCAL READY
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}

function WelcomeFixture() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(FIRST_LAUNCH_GUIDE_KEY);
    } catch {
      // The guide itself remains usable when storage is unavailable.
    }
  }, []);

  return (
    <FixtureFrame label="首次启动引导">
      <div className="phase3-visual__welcome">
        <div className="phase3-visual__welcome-copy">
          <span>LOCAL-FIRST AGENT WORKSPACE</span>
          <h1>今天想完成什么？</h1>
          <p>从一个本地工作区开始，选择模型、智能体或小队，然后在同一任务中持续推进。</p>
        </div>
        <FirstLaunchGuide
          hasWorkspace={false}
          onOpenWorkspaceMenu={() => undefined}
          onPickTrack={() => undefined}
        />
      </div>
    </FixtureFrame>
  );
}

function TraceFixture({ open }: { open: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, []);

  return (
    <FixtureFrame label={open ? '长对话与展开执行轨迹' : '长对话与收起执行轨迹'}>
      <div className="phase3-visual__conversation" ref={scrollRef}>
        <div className="phase3-visual__conversation-column">
          <div className="phase3-visual__history-marker">已加载较早消息 · 每页 50 条</div>
          {HISTORY.map((message) => (
            <article
              key={message.id}
              className="shell-message-window-item phase3-visual__message"
              data-role={message.role}
            >
              <div className="phase3-visual__avatar" aria-hidden="true">
                {message.role === 'user' ? <User size={13} /> : <Bot size={13} />}
              </div>
              <div>
                <strong>{message.role === 'user' ? '你' : 'SYNC-THINK'}</strong>
                <p>{message.text}</p>
              </div>
            </article>
          ))}
          <section className="phase3-visual__trace" aria-label="最近一轮执行轨迹">
            <div className="phase3-visual__trace-heading">
              <span>EXECUTION TRACE</span>
              <strong>{open ? '正在构建桌面应用' : '本轮已完成'}</strong>
            </div>
            <ExecutionProcessBlock
              view={open ? RUNNING_TRACE : COMPLETED_TRACE}
              forceExpanded={open}
            />
          </section>
        </div>
      </div>
    </FixtureFrame>
  );
}

function DiagnosticsFixture() {
  return (
    <FixtureFrame label="诊断导出">
      <div className="phase3-visual__diagnostics">
        <DataDiagnosticsSection />
      </div>
    </FixtureFrame>
  );
}

export function Phase3VisualFixture({ visualCase }: { visualCase: Phase3VisualCase }) {
  if (visualCase === 'welcome') return <WelcomeFixture />;
  if (visualCase === 'diagnostics') return <DiagnosticsFixture />;
  return <TraceFixture open={visualCase === 'long-trace-open'} />;
}
