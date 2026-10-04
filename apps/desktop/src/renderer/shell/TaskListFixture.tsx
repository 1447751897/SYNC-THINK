import { useState } from 'react';
import { TaskList, TaskListIcon, type TaskListTask } from './TaskList.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import type { InlineProcessItem } from './conversation-types.js';

const tasks: readonly TaskListTask[] = [
  {
    id: 'search',
    title: 'Found project files',
    runningTitle: 'Searching project files',
    icon: <TaskListIcon kind="search" />,
    steps: [
      { label: 'Searching "app/page.tsx, components structure"' },
      { label: 'Read', chips: [{ label: 'page.tsx' }] },
      { label: 'Scanning 52 files' },
      { label: 'Reading files', chips: [{ label: 'layout.tsx' }] },
    ],
  },
  {
    id: 'theme',
    title: 'Registered the theme toggle',
    runningTitle: 'Registering the theme toggle',
    icon: <TaskListIcon kind="file" />,
    steps: [
      { label: 'Created', chips: [{ label: 'theme-toggle.tsx' }] },
      { label: 'Wired it into', chips: [{ label: 'layout.tsx' }] },
      { label: 'Ran lint and type-check, 0 errors' },
    ],
  },
];
const items: InlineProcessItem[] = [
  {
    kind: 'tool',
    id: 'search',
    toolCallId: 'search',
    name: 'search',
    status: 'completed',
    argumentsJson: JSON.stringify({ query: 'app/page.tsx, components structure' }),
    result: 'Found 52 files.',
  },
  {
    kind: 'tool',
    id: 'read',
    toolCallId: 'read',
    name: 'read_file',
    status: 'completed',
    argumentsJson: JSON.stringify({ path: 'app/page.tsx' }),
    result: 'export default function Page() { return <main />; }',
  },
  {
    kind: 'tool',
    id: 'layout',
    toolCallId: 'layout',
    name: 'read_file',
    status: 'completed',
    argumentsJson: JSON.stringify({ path: 'app/layout.tsx' }),
    result: 'export default function Layout() { return <html />; }',
  },
  { kind: 'commentary', id: 'comment', text: '已找到主题入口，开始接入切换功能。' },
  {
    kind: 'tool',
    id: 'write',
    toolCallId: 'write',
    name: 'write_file',
    status: 'completed',
    argumentsJson: JSON.stringify({
      path: 'components/theme-toggle.tsx',
      content: 'export const ThemeToggle = () => <button />;',
    }),
    result: 'File saved.',
  },
  {
    kind: 'tool',
    id: 'lint',
    toolCallId: 'lint',
    name: 'exec_command',
    status: 'completed',
    argumentsJson: JSON.stringify({ cmd: 'pnpm lint && pnpm typecheck' }),
    result: '0 errors.',
  },
];

// Mirrors the isolated browser workflow call followed by Think in the reported UI.
const singleCallItems: InlineProcessItem[] = [
  { kind: 'commentary', id: 'workflow-intro', text: '我查一下现有的浏览器流程和定时任务。' },
  {
    kind: 'tool', id: 'workflow-list', toolCallId: 'workflow-list',
    name: 'mcp__browser__browser_workflow_list', status: 'completed',
    argumentsJson: '{"query":"摸鱼岛"}', result: '找到 1 条已启用的流程。',
  },
  {
    kind: 'reasoning', id: 'workflow-think', status: 'completed',
    text: 'Exploring list schema requirements',
  },
  {
    kind: 'commentary', id: 'workflow-check',
    text: '已有一条启用的「摸鱼岛签到」流程。我再查看是否有定时调度。',
  },
  {
    kind: 'tool', id: 'schedule-list', toolCallId: 'schedule-list',
    name: 'mcp__browser__schedule_list', status: 'completed',
    argumentsJson: '{}', result: '没有匹配的定时任务。',
  },
  {
    kind: 'tool', id: 'workflow-get', toolCallId: 'workflow-get',
    name: 'mcp__browser__browser_workflow_get', status: 'completed',
    argumentsJson: '{"name":"摸鱼岛签到"}', result: '流程详情已读取。',
  },
];

export default function TaskListFixture() {
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<'reference' | 'execution' | 'single'>(() =>
    new URLSearchParams(location.search).get('scenario') === 'single-tool' ? 'single' : 'reference',
  );
  const [collapse, setCollapse] = useState<boolean | 'all'>(false);
  const [openedPath, setOpenedPath] = useState('');
  const [live, setLive] = useState(false);
  const parameters = new URLSearchParams(location.search);
  if (parameters.get('viewport') === 'mobile') {
    parameters.delete('viewport');
    return (
      <main className="task-list-mobile-fixture">
        <iframe
          title="任务列表窄屏验收"
          src={'/?' + parameters.toString()}
          width="390"
          height="844"
        />
      </main>
    );
  }

  const executionItems = mode === 'single'
    ? live
      ? [singleCallItems[0], {
          ...singleCallItems[1], status: 'running', result: undefined,
        } as InlineProcessItem]
      : singleCallItems
    : live
      ? [...items.slice(0, 4), {
          ...items[4], status: 'running', result: undefined,
        } as InlineProcessItem]
      : items;

  return (
    <main className="task-list-fixture">
      <header>
        <h1>Task List</h1>
        <p>Streaming execution log</p>
      </header>
      <nav aria-label="任务日志验收">
        <button aria-pressed={mode === 'reference'} onClick={() => setMode('reference')}>
          参考样例
        </button>
        <button aria-pressed={mode === 'execution'} onClick={() => setMode('execution')}>
          真实执行组件
        </button>
        <button
          aria-pressed={mode === 'single'}
          onClick={() => { setMode('single'); setLive(false); }}
        >
          单次调用验收
        </button>
        <label>
          完成后折叠{' '}
          <select
            aria-label="完成后折叠"
            value={String(collapse)}
            onChange={(e) => {
              setCollapse(e.target.value === 'all' ? 'all' : e.target.value === 'true');
              setRun((n) => n + 1);
            }}
          >
            <option value="false">保持展开</option>
            <option value="true">逐项折叠</option>
            <option value="all">全部折叠</option>
          </select>
        </label>
      </nav>
      <section className="task-list-fixture__preview" aria-label="任务列表预览">
        <div className="task-list-fixture__content">
          {mode === 'reference' ? (
            <TaskList
              key={run}
              tasks={tasks}
              revealed={playing ? undefined : 9}
              collapseOnComplete={collapse}
              onComplete={() => setPlaying(false)}
            />
          ) : (
            <>
              <InlineProcessFlow
                items={executionItems}
                runId={mode + '-fixture-' + run}
                streaming={live}
                defaultOpen={mode === 'execution'}
                showThinking={mode === 'single'}
                collapseExecutionProcess={false}
                onOpenChange={setOpenedPath}
              />
              {openedPath && <output>打开文件：{openedPath}</output>}
            </>
          )}
          <button
            type="button"
            className="task-list-fixture__replay"
            disabled={playing}
            onClick={() => {
              setPlaying(true);
              setRun((n) => n + 1);
            }}
          >
            ↻ Run again
          </button>
          {mode !== 'reference' && (
            <button onClick={() => {
              if (!live) setRun((n) => n + 1);
              setLive((v) => !v);
            }}>{live ? '完成执行' : '开始执行'}</button>
          )}
        </div>
      </section>
    </main>
  );
}
