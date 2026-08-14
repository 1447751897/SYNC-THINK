import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  CommentaryTimelineSegment,
  ContextStatusSection,
  RunProcessView,
} from '@sync-think/protocol';
import {
  Bot,
  CheckCircle2,
  FileCode2,
  MessageSquare,
  Puzzle,
  RefreshCw,
  SendHorizonal,
  User,
  Zap,
} from 'lucide-react';
import { AssistantProcessGroup } from './ChatView.js';
import { ContextRing } from './compose-toolbar.js';
import { ExecutionTimeline } from './ExecutionTimeline.js';
import { FirstLaunchGuide, FIRST_LAUNCH_GUIDE_KEY } from './FirstLaunchGuide.js';
import { FileTypeIcon } from './FileTypeIcon.js';
import { MarkdownContent } from './MarkdownContent.js';
import { DataDiagnosticsSection } from './SettingsPage.js';
import { WorkspaceFileView } from './WorkspaceFileView.js';

export const PHASE3_VISUAL_CASES = [
  'welcome',
  'long-trace-open',
  'long-trace-closed',
  'connection-and-code',
  'streaming-follow',
  'diagnostics',
  'composer-context',
  'workspace-file',
  'execution-auto-disclosure',
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
      sequence: 11,
      startedAt: '2026-08-08T10:01:03.000Z',
      completedAt: '2026-08-08T10:01:04.000Z',
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
      sequence: 12,
      startedAt: '2026-08-08T10:01:05.000Z',
      completedAt: '2026-08-08T10:01:06.000Z',
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
      sequence: 13,
      startedAt: '2026-08-08T10:01:09.000Z',
      completedAt: '2026-08-08T10:01:10.000Z',
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

const TRACE_COMMENTARY = [
  '**先核对任务的持久化终态**，再读取界面入口并完成最小范围修改。',
  '根据前两个工具的结果继续验证，确认历史暂停任务不会继续计时。',
].join('\n\n');

const TRACE_COMMENTARY_SEGMENTS: CommentaryTimelineSegment[] = TRACE_COMMENTARY.split('\n\n').map(
  (text, index) => ({
    id: `phase3-trace-commentary-${index + 1}`,
    text,
    afterSequence: [10, 12][index],
    startedAt: ['2026-08-08T10:01:01.000Z', '2026-08-08T10:01:07.000Z'][index]!,
    completedAt: ['2026-08-08T10:01:02.000Z', '2026-08-08T10:01:08.000Z'][index]!,
  }),
);

const HISTORY = Array.from({ length: 18 }, (_, index) => ({
  id: 'fixture-message-' + (index + 1),
  role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
  text:
    index % 2 === 0
      ? '第 ' + (Math.floor(index / 2) + 1) + ' 轮：继续完成当前切片，并保留可复验的构建证据。'
      : '已完成第 ' +
        (Math.floor(index / 2) + 1) +
        ' 轮检查。上下文仍由同一任务承接，历史消息按 50 条分页读取。',
}));

function FixtureFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <main className="phase3-visual" data-phase3-ready="true" aria-label={label}>
      <aside className="phase3-visual__rail" aria-label="工作台导航示意">
        <div className="phase3-visual__brand" aria-label="SYNC-THINK">
          S
        </div>
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
          <article
            className="shell-message-window-item phase3-visual__message phase3-visual__trace"
            data-role="assistant"
            aria-label="最近一轮执行轨迹"
          >
            <div className="phase3-visual__avatar" aria-hidden="true">
              <Bot size={13} />
            </div>
            <div className="phase3-visual__trace-content">
              <strong>SYNC-THINK</strong>
              <AssistantProcessGroup
                processView={COMPLETED_TRACE}
                commentaryText={TRACE_COMMENTARY}
                commentarySegments={TRACE_COMMENTARY_SEGMENTS}
                defaultOpen={open}
              >
                <ExecutionTimeline
                  commentarySegments={TRACE_COMMENTARY_SEGMENTS}
                  commentaryText={TRACE_COMMENTARY}
                  processView={COMPLETED_TRACE}
                />
              </AssistantProcessGroup>
              <p>运行态已经与 Runtime 对账，暂停任务不会再显示为持续运行。</p>
            </div>
          </article>
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

const SHORT_TEXT_BLOCK = [
  '连接恢复后，当前回复会继续生成。',
  '备用模型切换期间，已有思考内容保持可见。',
  '这个短文本块不足 12 行，因此应按自然高度完整展示。',
  'SHORT_TEXT_BLOCK_END',
].join('\n');

function ConnectionAndCodeFixture() {
  return (
    <FixtureFrame label="连接状态与文本块">
      <div className="phase3-visual__conversation">
        <div className="phase3-visual__conversation-column">
          <article
            className="shell-message-window-item phase3-visual__message phase3-visual__trace"
            data-role="assistant"
            aria-label="重连与备用模型状态"
          >
            <div className="phase3-visual__avatar" aria-hidden="true">
              <Bot size={13} />
            </div>
            <div className="phase3-visual__trace-content">
              <strong>SYNC-THINK</strong>
              <div className="shell-run-connection-status" aria-live="polite">
                <RefreshCw size={12} aria-hidden="true" />
                <span>正在重新连接 4/5</span>
              </div>
              <div className="shell-run-connection-status" aria-live="polite">
                <RefreshCw size={12} aria-hidden="true" />
                <span>正在切换备用模型：luna → gpt-5.6-sol</span>
              </div>
              <MarkdownContent text={`\`\`\`text\n${SHORT_TEXT_BLOCK}\n\`\`\``} />
            </div>
          </article>
        </div>
      </div>
    </FixtureFrame>
  );
}

const STREAMING_TRACE: RunProcessView = {
  runId: 'phase3-streaming-follow-run' as RunProcessView['runId'],
  running: true,
  doneCount: 0,
  errorCount: 0,
  startedAt: new Date().toISOString(),
  steps: [],
  fileChanges: [],
};

const INITIAL_STREAMING_COMMENTARY = Array.from(
  { length: 20 },
  (_, index) => `正在分析第 ${index + 1} 项上下文与工具状态。`,
).join('\n\n');

function StreamingFollowFixture() {
  const [commentary, setCommentary] = useState(INITIAL_STREAMING_COMMENTARY);
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCommentary(
        `${INITIAL_STREAMING_COMMENTARY}\n\n已接收 luna 的最新执行说明。\n\nSTREAMING_FOLLOW_LATEST`,
      );
      setUpdated(true);
    }, 120);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <FixtureFrame label="流式思考自动跟随">
      <div
        className="phase3-visual__conversation"
        data-phase3-streaming-follow={updated ? 'ready' : 'pending'}
      >
        <div className="phase3-visual__conversation-column">
          <article
            className="shell-message-window-item phase3-visual__message phase3-visual__trace"
            data-role="assistant"
            aria-label="流式思考跟随"
          >
            <div className="phase3-visual__avatar" aria-hidden="true">
              <Bot size={13} />
            </div>
            <div className="phase3-visual__trace-content">
              <strong>SYNC-THINK</strong>
              <AssistantProcessGroup
                processView={STREAMING_TRACE}
                commentaryText={commentary}
                commentarySegments={[
                  {
                    id: 'phase3-streaming-commentary',
                    text: commentary,
                    startedAt: STREAMING_TRACE.startedAt!,
                    afterSequence: 0,
                  },
                ]}
                streaming
                defaultOpen
              >
                <ExecutionTimeline
                  commentarySegments={[
                    {
                      id: 'phase3-streaming-commentary',
                      text: commentary,
                      startedAt: STREAMING_TRACE.startedAt!,
                      afterSequence: 0,
                    },
                  ]}
                  processView={STREAMING_TRACE}
                  streaming
                />
              </AssistantProcessGroup>
            </div>
          </article>
        </div>
      </div>
    </FixtureFrame>
  );
}

type ExecutionDisclosurePhase = 'thinking' | 'tools' | 'continued' | 'final';

const EXECUTION_DISCLOSURE_STARTED_AT = '2026-08-14T01:00:00.000Z';
const EXECUTION_DISCLOSURE_STEPS: RunProcessView['steps'] = [
  {
    id: 'disclosure-read',
    label: 'Read package',
    verb: 'Read',
    zh: '读取配置',
    toolName: 'read_file',
    kind: 'read',
    status: 'done',
    path: 'package.json',
    preview: '已读取工作区脚本与依赖。',
    sequence: 11,
    startedAt: '2026-08-14T01:00:02.000Z',
    completedAt: '2026-08-14T01:00:03.000Z',
  },
  {
    id: 'disclosure-test',
    label: 'Run tests',
    verb: 'Run',
    zh: '运行测试',
    toolName: 'run_command',
    kind: 'bash',
    status: 'running',
    command: 'pnpm test',
    preview: '正在执行组件回归。',
    sequence: 12,
    startedAt: '2026-08-14T01:00:03.000Z',
  },
];

function executionDisclosureView(phase: ExecutionDisclosurePhase): RunProcessView {
  const final = phase === 'final';
  const toolsRunning = phase === 'tools';
  const steps = phase === 'thinking' ? [] : EXECUTION_DISCLOSURE_STEPS;
  return {
    runId: 'phase3-execution-auto-disclosure' as RunProcessView['runId'],
    running: !final,
    startedAt: EXECUTION_DISCLOSURE_STARTED_AT,
    ...(final ? { completedAt: '2026-08-14T01:00:08.000Z', durationMs: 8_000 } : {}),
    doneCount: steps.length === 0 ? 0 : toolsRunning ? 1 : 2,
    errorCount: 0,
    steps: steps.map((step) =>
      step.id === 'disclosure-test' && !toolsRunning
        ? {
            ...step,
            status: 'done' as const,
            completedAt: '2026-08-14T01:00:06.000Z',
            preview: '组件回归全部通过。',
          }
        : step,
    ),
    fileChanges: [],
  };
}

function ExecutionAutoDisclosureFixture() {
  const [phase, setPhase] = useState<ExecutionDisclosurePhase>('thinking');
  const processView = executionDisclosureView(phase);
  const commentarySegments: CommentaryTimelineSegment[] = [
    {
      id: 'disclosure-thinking-before',
      text: '先检查项目配置，再运行相关测试。',
      startedAt: '2026-08-14T01:00:01.000Z',
      ...(phase === 'thinking' ? {} : { completedAt: '2026-08-14T01:00:02.000Z' }),
      afterSequence: 10,
    },
    ...(phase === 'continued' || phase === 'final'
      ? [
          {
            id: 'disclosure-thinking-after',
            text: '工具批次已经完成，继续整理最终结论。',
            startedAt: '2026-08-14T01:00:07.000Z',
            ...(phase === 'final' ? { completedAt: '2026-08-14T01:00:08.000Z' } : {}),
            afterSequence: 12,
          },
        ]
      : []),
  ];

  return (
    <FixtureFrame label="执行过程自动展开与折叠">
      <div className="phase3-visual__conversation" data-execution-disclosure-phase={phase}>
        <div className="phase3-visual__conversation-column">
          <div className="flex flex-wrap gap-2 px-4 pt-4" aria-label="执行阶段切换">
            {(
              [
                ['thinking', '思考'],
                ['tools', '工具运行'],
                ['continued', '工具完成'],
                ['final', '最终回答'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="rounded border border-border bg-surface px-3 py-1.5 text-xs text-text"
                aria-pressed={phase === value}
                onClick={() => setPhase(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <article
            className="shell-message-window-item phase3-visual__message phase3-visual__trace"
            data-role="assistant"
            aria-label="执行过程自动折叠示例"
          >
            <div className="phase3-visual__avatar" aria-hidden="true">
              <Bot size={13} />
            </div>
            <div className="phase3-visual__trace-content">
              <strong>SYNC-THINK</strong>
              <AssistantProcessGroup
                processView={processView}
                commentarySegments={commentarySegments}
                commentaryText={commentarySegments.map((segment) => segment.text).join('\n\n')}
                streaming={phase !== 'final'}
                answerStarted={phase === 'final'}
              >
                <ExecutionTimeline
                  commentarySegments={commentarySegments}
                  processView={processView}
                  streaming={phase === 'thinking' || phase === 'continued'}
                />
              </AssistantProcessGroup>
              {phase === 'final' ? <p>验证完成，最终回答已经开始输出。</p> : null}
            </div>
          </article>
        </div>
      </div>
    </FixtureFrame>
  );
}

const COMPOSER_CONTEXT_SECTIONS = [
  { type: 'system', tokens: 2_160 },
  { type: 'agent', tokens: 4_880 },
  { type: 'project', tokens: 18_640 },
  { type: 'summary', tokens: 28_420 },
  { type: 'messages', tokens: 102_180 },
  { type: 'tools', tokens: 16_060 },
] satisfies ContextStatusSection[];

function ComposerContextFixture() {
  const [input, setInput] = useState('');

  return (
    <FixtureFrame label="输入区与对话总上下文">
      <div className="phase3-visual__composer-stage">
        <div className="phase3-visual__composer-preview">
          <span>CONTEXT WINDOW · COMPOSER STATES</span>
          <h1>完整对话上下文与输入控件</h1>
          <p>
            圆环展示当前模型实际可见的完整上下文窗口；会话累计消耗单独统计。将鼠标移到控件上，
            或点击上下文圆环检查详细状态。
          </p>
          <div className="phase3-visual__composer-facts" aria-label="上下文摘要">
            <div>
              <span>当前窗口</span>
              <strong>172,340 / 400,000</strong>
            </div>
            <div>
              <span>压缩阈值</span>
              <strong>70% · 280,000</strong>
            </div>
            <div>
              <span>会话累计</span>
              <strong>246,780 Token</strong>
            </div>
          </div>
        </div>

        <div className="phase3-visual__composer-wrap">
          <div className="shell-compose phase3-visual__composer">
            <textarea
              className="shell-compose__input"
              aria-label="任务输入"
              placeholder="有什么我能帮你的吗？输入 @ 引用文件，/ 打开命令"
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              rows={1}
            />
            <div className="shell-compose__bar">
              <div className="shell-compose__bar-left">
                <button
                  type="button"
                  className="shell-compose__tool"
                  data-active="1"
                  title="权限：完全访问"
                >
                  <Zap size={15} />
                  <span className="shell-compose__tool-label">完全访问</span>
                </button>
                <button type="button" className="shell-compose__tool" title="本轮技能：0/8">
                  <Puzzle size={15} />
                  <span className="shell-compose__tool-label">0/8</span>
                </button>
              </div>

              <div className="shell-compose__bar-right">
                <button type="button" className="shell-compose__tool" title="对话对象：模型">
                  <MessageSquare size={15} />
                  <span className="shell-compose__tool-label">模型</span>
                </button>
                <ContextRing
                  used={172_340}
                  limit={400_000}
                  usageRatio={172_340 / 400_000}
                  compactThreshold={0.7}
                  compactedAt="2026-08-08T19:42:00+08:00"
                  sections={COMPOSER_CONTEXT_SECTIONS}
                  sessionDurationMs={5_880_000}
                  sessionTokens={246_780}
                  title="查看对话总上下文"
                />
                <button
                  type="button"
                  className="shell-compose__model-btn"
                  title="切换模型，思考强度：自动"
                >
                  <span className="shell-compose__model-label">GPT-5.6 Luna</span>
                  <span className="shell-compose__model-reasoning">自动</span>
                </button>
                <button
                  type="button"
                  className="shell-compose__send"
                  title="发送 (Enter)"
                  aria-label="发送"
                  disabled={!input.trim()}
                >
                  <SendHorizonal size={15} />
                </button>
              </div>
            </div>
          </div>
          <div className="phase3-visual__composer-caption">
            输入框聚焦时使用低饱和强调边框；所有控件保留透明边框，hover 不会引发布局跳动。
          </div>
        </div>
      </div>
    </FixtureFrame>
  );
}

const WORKSPACE_LONG_VALUE = 'workspace-segment/'.repeat(90);

const WORKSPACE_FILE_CONTENTS: Record<string, string> = {
  'install-all.sh': `#!/usr/bin/env bash
set -euo pipefail

TOOL="auto"
SOURCE="local"
REPOSITORY="1447751897/ai-project-command-skills"
BRANCH="master"
CODEX_TARGET_ROOT="\${HOME}/.agents/skills"
CLAUDE_TARGET_ROOT="\${HOME}/.claude/skills"
DRY_RUN=0
CACHE_KEY="${WORKSPACE_LONG_VALUE}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tool)
      TOOL="\${2:?Missing value for --tool}"
      shift 2
      ;;
    --source)
      SOURCE="\${2:?Missing value for --source}"
      shift 2
      ;;
    --repository)
      REPOSITORY="\${2:?Missing value for --repository}"
      shift 2
      ;;
    --branch)
      BRANCH="\${2:?Missing value for --branch}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

printf 'Installing %s from %s@%s\n' "$TOOL" "$REPOSITORY" "$BRANCH"
`,
  'package.json': `{
  "name": "workspace-file-fixture",
  "private": true,
  "scripts": {
    "check": "pnpm lint && pnpm test",
    "build": "pnpm --filter @sync-think/desktop build:shell"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.1.8"
  }
}
`,
  'settings.json': `{
  "editor": {
    "fontSize": 12,
    "lineNumbers": true,
    "wordWrap": false
  },
  "files": {
    "exclude": ["dist", "node_modules"]
  }
}
`,
  'README.md': `# Workspace files

Open a file from the explorer, then switch between preview and source.

- Preview keeps syntax highlighting and line numbers.
- Source keeps editing, saving, and conflict handling.
- File icons follow each file format.
`,
  '.gitignore': `node_modules
dist
.turbo
*.log
`,
  'src/FilePreview.tsx': `import { useMemo } from 'react';

type FilePreviewProps = {
  path: string;
  source: string;
};

export function FilePreview({ path, source }: FilePreviewProps) {
  const lineCount = useMemo(() => source.split('\\n').length, [source]);

  return (
    <section aria-label={\`Preview \${path}\`}>
      <strong>{path}</strong>
      <span>{lineCount} lines</span>
      <pre>{source}</pre>
    </section>
  );
}
`,
  'scripts/check_workspace.py': `from pathlib import Path


def project_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.is_file())


if __name__ == "__main__":
    files = project_files(Path.cwd())
    print(f"workspace files: {len(files)}")
`,
  'styles/workspace.css': `.workspace-file-view {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-page);
}

.workspace-file-view:focus-within {
  outline: 1px solid var(--color-accent);
}
`,
  'data/report.csv': `file,type,status
install-all.sh,shell,ready
src/FilePreview.tsx,typescript,ready
scripts/check_workspace.py,python,ready
`,
  'docker-compose.yml': `services:
  desktop:
    build: .
    command: pnpm --filter @sync-think/desktop dev
`,
};

const WORKSPACE_FILE_DIRS: Record<
  string,
  Array<{ path: string; name: string; kind: 'file' | 'dir' }>
> = {
  '': [
    { path: 'src', name: 'src', kind: 'dir' },
    { path: 'scripts', name: 'scripts', kind: 'dir' },
    { path: 'styles', name: 'styles', kind: 'dir' },
    { path: 'data', name: 'data', kind: 'dir' },
    { path: '.gitignore', name: '.gitignore', kind: 'file' },
    { path: 'docker-compose.yml', name: 'docker-compose.yml', kind: 'file' },
    { path: 'install-all.sh', name: 'install-all.sh', kind: 'file' },
    { path: 'package.json', name: 'package.json', kind: 'file' },
    { path: 'README.md', name: 'README.md', kind: 'file' },
    { path: 'settings.json', name: 'settings.json', kind: 'file' },
  ],
  src: [{ path: 'src/FilePreview.tsx', name: 'FilePreview.tsx', kind: 'file' }],
  scripts: [{ path: 'scripts/check_workspace.py', name: 'check_workspace.py', kind: 'file' }],
  styles: [{ path: 'styles/workspace.css', name: 'workspace.css', kind: 'file' }],
  data: [{ path: 'data/report.csv', name: 'report.csv', kind: 'file' }],
};

const workspaceFileMtimes = new Map(
  Object.keys(WORKSPACE_FILE_CONTENTS).map((path, index) => [path, 1000 + index]),
);

function installWorkspaceFileFixtureRuntime() {
  const fixtureWindow = window as Window & { __phase3CopiedText?: string };
  fixtureWindow.__phase3CopiedText = '';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        fixtureWindow.__phase3CopiedText = text;
      },
    },
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: {
        readProjectFile: async ({ path }: { path: string }) => {
          const content = WORKSPACE_FILE_CONTENTS[path];
          return {
            path,
            content: content ?? null,
            error: content === undefined ? 'File not found' : null,
            errorCode: content === undefined ? 'not-found' : null,
            mtimeMs: workspaceFileMtimes.get(path) ?? null,
            size: content?.length ?? null,
          };
        },
        writeProjectFile: async ({ path, content }: { path: string; content: string }) => {
          WORKSPACE_FILE_CONTENTS[path] = content;
          const mtimeMs = (workspaceFileMtimes.get(path) ?? 1000) + 1;
          workspaceFileMtimes.set(path, mtimeMs);
          return {
            ok: true,
            conflict: false,
            error: null,
            errorCode: null,
            mtimeMs,
            size: content.length,
          };
        },
        watchProjectFile: () => ({
          ready: Promise.resolve(),
          unsubscribe: async () => undefined,
        }),
        listProjectDir: async ({ dir = '' }: { dir?: string }) => ({
          dir,
          entries: WORKSPACE_FILE_DIRS[dir] ?? [],
        }),
        listProjectFiles: async ({ query = '' }: { query?: string }) => {
          const normalizedQuery = query.trim().toLowerCase();
          const files = Object.keys(WORKSPACE_FILE_CONTENTS)
            .filter((path) => path.toLowerCase().includes(normalizedQuery))
            .map((path) => ({
              path,
              name: path.split('/').pop() ?? path,
              kind: 'file' as const,
            }));
          return { root: 'C:/workspace', files };
        },
        searchProjectContent: async ({ query = '' }: { query?: string }) => {
          const normalizedQuery = query.trim().toLowerCase();
          const results = Object.entries(WORKSPACE_FILE_CONTENTS).flatMap(([path, content]) => {
            const lines = content.split('\n');
            const lineIndex = lines.findIndex((line) =>
              line.toLowerCase().includes(normalizedQuery),
            );
            if (lineIndex < 0) return [];
            return [{ path, line: lineIndex + 1, column: 1, preview: lines[lineIndex] ?? '' }];
          });
          return { root: 'C:/workspace', query, results, truncated: false, timedOut: false };
        },
        getGitInfo: async () => ({
          branch: 'feature/workspace-file-preview',
          branches: ['feature/workspace-file-preview', 'main'],
          changes: [
            { status: 'M', path: 'apps/desktop/src/renderer/shell/FilePane.tsx' },
            { status: 'A', path: 'apps/desktop/src/renderer/shell/FileTypeIcon.tsx' },
          ],
          recentCommits: [
            { hash: '9f38a7c', subject: 'feat: add workspace file preview' },
            { hash: 'd162bb4', subject: 'style: align workspace file explorer' },
          ],
          isRepo: true,
        }),
      },
    },
  });
}

function WorkspaceFileFixture() {
  const [path, setPath] = useState(() => {
    installWorkspaceFileFixtureRuntime();
    return 'install-all.sh';
  });

  return (
    <main
      className="phase3-workspace-file"
      data-phase3-ready="true"
      aria-label="Workspace file preview"
    >
      <header className="phase3-workspace-file__tabs">
        <div className="phase3-workspace-file__tab is-active">
          <FileTypeIcon path={path} size={13} />
          <span>{path}</span>
        </div>
        <div className="phase3-workspace-file__tab">
          <span>工作区文件</span>
        </div>
      </header>
      <section className="phase3-workspace-file__content">
        <WorkspaceFileView
          projectFolder="C:/workspace"
          path={path}
          onOpenFileInCurrentTab={(nextPath) => setPath(nextPath)}
          onOpenFileInNewTab={(nextPath) => setPath(nextPath)}
        />
      </section>
    </main>
  );
}

export function Phase3VisualFixture({ visualCase }: { visualCase: Phase3VisualCase }) {
  if (visualCase === 'welcome') return <WelcomeFixture />;
  if (visualCase === 'diagnostics') return <DiagnosticsFixture />;
  if (visualCase === 'connection-and-code') return <ConnectionAndCodeFixture />;
  if (visualCase === 'streaming-follow') return <StreamingFollowFixture />;
  if (visualCase === 'composer-context') return <ComposerContextFixture />;
  if (visualCase === 'workspace-file') return <WorkspaceFileFixture />;
  if (visualCase === 'execution-auto-disclosure') return <ExecutionAutoDisclosureFixture />;
  return <TraceFixture open={visualCase === 'long-trace-open'} />;
}
