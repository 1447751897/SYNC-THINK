/** Isolated QA surface. No bridge or user data is read or changed. */
import { useEffect, useState } from 'react';
import { applyWorkbenchAppearance, clearWorkbenchAppearance } from './theme/apply-workbench-appearance.js';
import { AgentThinking, type AgentThinkingVariant } from './AgentThinking.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import { HostSystemAvatar, HOST_SYSTEM_NAME } from './HostSystemAvatar.js';
import { avatarStateFrom } from './agentAvatarState.js';
import type { InlineProcessItem } from './conversation-types.js';
const variants: AgentThinkingVariant[] = ['wave', 'spin', 'stars', 'infinity'];
const states = ['waiting', 'thinking', 'tool', 'approval', 'done', 'failed', 'paused', 'cancelled'] as const;
export default function AgentThinkingFixture() {
  useEffect(() => {
    const root = document.documentElement;
    const previousDesign = root.dataset.shellDesign;
    applyWorkbenchAppearance(root, { colorTheme: 'default' });
    return () => {
      clearWorkbenchAppearance(root);
      if (previousDesign === undefined) delete root.dataset.shellDesign;
      else root.dataset.shellDesign = previousDesign;
    };
  }, []);
  const [state, setState] = useState<(typeof states)[number]>('waiting');
  const [showThinking, setShowThinking] = useState(true);
  const [startedAt, setStartedAt] = useState(() => new Date(Date.now() - 4000).toISOString());
  const items: InlineProcessItem[] = state === 'thinking'
    ? [{ kind: 'reasoning', text: '核对当前任务的执行模型和工作区。', status: 'streaming' }]
    : state === 'tool' ? [{ kind: 'tool', toolCallId: 'thinking-preview-command', name: 'run_command', argumentsJson: '{"command":"pnpm","args":["test"]}', status: 'running', startedAt }]
    : [];
  const terminalState = state === 'failed' || state === 'paused' || state === 'cancelled' ? state : undefined;
  return <main data-phase3-ready="true" aria-label="Agent Thinking 移植验收"
    style={{ width: 'min(760px, 100%)', margin: '0 auto', padding: 24, boxSizing: 'border-box', color: 'var(--color-text)' }}>
    <h1 style={{ fontSize: 18 }}>执行过程底部 · Agent Thinking</h1>
    <div role="group" aria-label="验收运行状态" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0 30px' }}>
      {states.map(value => <button key={value} type="button" aria-pressed={state === value} className="agent-btn"
        onClick={() => { setState(value); setStartedAt(new Date(Date.now() - 4000).toISOString()); }}>{value}</button>)}
    </div>
    <section aria-label="执行过程组件预览" style={{ minHeight: 220 }}>
      <div className="shell-host-identity" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
        <HostSystemAvatar size={32} interactive state={avatarStateFrom({
          reasoning: state === 'waiting' || state === 'thinking', streaming: state === 'tool',
          awaitingApproval: state === 'approval', failed: state === 'failed', justCompleted: state === 'done',
        })} /><span className="shell-host-name">{HOST_SYSTEM_NAME}</span>
      </div>
      <div style={{ marginLeft: 42 }}>
        <InlineProcessFlow runId={'thinking-preview-' + state} items={items} defaultOpen
          startedAt={startedAt} streaming={state !== 'done'} answerStarted={state === 'done'}
          waitingForApproval={state === 'approval'} terminalState={terminalState}
          showThinking={showThinking} onShowThinkingChange={setShowThinking}
          completedAt={state === 'done' ? new Date().toISOString() : undefined} />
      </div>
    </section>
    <section aria-label="可复用组件的四种变体" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 22 }}>
      <h2 style={{ fontSize: 14, marginBottom: 20 }}>可复用组件 · 四种变体</h2>
      {variants.map(variant => <div key={variant} style={{ display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr)', gap: 14, marginBottom: 20 }}>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>{variant}</span>
        <AgentThinking variant={variant} label="正在整理执行结果" elapsedLabel="4.0s" testId={'variant-' + variant} />
      </div>)}
    </section>
  </main>;
}
