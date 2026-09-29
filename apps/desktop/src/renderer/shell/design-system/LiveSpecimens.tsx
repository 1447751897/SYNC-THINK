import { useState, type ComponentType } from 'react';
import { SlidingTabs } from '../SlidingTabs.js';
import { AgentAvatarView } from '../AgentAvatarView.js';
import { LoadingPixelGrid } from '../LoadingPixelGrid.js';
import { CodeBlockButton } from '../CodeBlockButton.js';
import { CopyTextButton } from '../CopyTextButton.js';
import { CodeBlock } from '../CodeBlock.js';
import { ComposerEditor } from '../ComposerEditor.js';
import { FileTypeIcon } from '../FileTypeIcon.js';
import { ToolApprovalCard } from '../ToolApprovalCard.js';
import { Plus, Send, Check, Archive } from 'lucide-react';

function ButtonExample() {
  const [notice, setNotice] = useState('点击按钮可测试真实的按压反馈。');
  return (
    <>
      <div className="ds-button-row">
        <CodeBlockButton
          className="ds-button ds-button--primary"
          onClick={() => setNotice('已在预览中创建新任务；未调用 Runtime。')}
        >
          <Plus size={14} />
          新建任务
        </CodeBlockButton>
        <CodeBlockButton
          className="ds-button ds-button--secondary"
          onClick={() => setNotice('已在预览中归档。')}
        >
          <Archive size={14} />
          归档
        </CodeBlockButton>
        <CodeBlockButton className="ds-button ds-button--secondary" disabled>
          禁用
        </CodeBlockButton>
      </div>
      <p className="ds-hint" role="status">
        {notice}
      </p>
    </>
  );
}
function CopyExample() {
  return (
    <div className="ds-button-row">
      <CopyTextButton text="var(--color-accent)" label="复制主题变量" />
      <code>var(--color-accent)</code>
    </div>
  );
}
function TabsExample() {
  const [tab, setTab] = useState('全部');
  return (
    <>
      <SlidingTabs rootRole="group" className="ds-real-tabs" aria-label="示例任务筛选">
        {['全部', '进行中', '已完成'].map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </SlidingTabs>
      <p className="ds-hint">当前筛选：{tab}</p>
    </>
  );
}
function AvatarExample() {
  return (
    <div className="ds-real-avatars">
      {['思考', '设计', '工程', '审查'].map((name) => (
        <div key={name}>
          <AgentAvatarView name={name} size={40} />
          <span>{name}</span>
        </div>
      ))}
    </div>
  );
}
function FileExample() {
  const [file, setFile] = useState('theme.ts');
  return (
    <div className="ds-file-list">
      {['theme.ts', 'Composer.tsx', 'tokens.json', 'README.md'].map((path) => (
        <button type="button" key={path} aria-pressed={file === path} onClick={() => setFile(path)}>
          <FileTypeIcon path={path} size={16} />
          {path}
          {file === path && <Check size={13} />}
        </button>
      ))}
    </div>
  );
}
function LoadingExample() {
  return (
    <>
      <div className="ds-loading-row">
        <LoadingPixelGrid />
        <span>正在同步智能体上下文…</span>
      </div>
      <div className="ds-semantic-states">
        {[
          ['success', '已完成'],
          ['warning', '等待确认'],
          ['error', '执行失败'],
          ['info', '有新消息'],
        ].map(([tone, label]) => (
          <span key={tone} style={{ color: `var(--color-${tone})` }}>
            <i />
            {label}
          </span>
        ))}
      </div>
    </>
  );
}
function ComposerExample() {
  const [draft, setDraft] = useState('帮我梳理 Sync-Think 的组件和主题。');
  const [sent, setSent] = useState('');
  const send = (text: string) => {
    if (text.trim()) {
      setSent(text);
      setDraft('');
    }
  };
  return (
    <>
      {sent && (
        <div className="ds-sent-message">
          <Check size={14} />
          已在本地预览发送：{sent}
        </div>
      )}
      <div className="ds-composer">
        <ComposerEditor
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          ariaLabel="组件库消息输入"
          minHeight={100}
          placeholder="输入消息，按 Enter 测试发送…"
        />
        <div className="ds-composer__footer">
          <span>真实编辑器 · 仅本地状态</span>
          <CodeBlockButton
            className="ds-button ds-button--primary"
            disabled={!draft.trim()}
            onClick={() => send(draft)}
          >
            <Send size={14} />
            发送
          </CodeBlockButton>
        </div>
      </div>
    </>
  );
}
function CodeExample() {
  return (
    <CodeBlock
      code={
        '// 所有颜色来自语义 token\nexport const shell = {\n  background: "var(--color-panel)",\n  foreground: "var(--color-text)",\n  accent: "var(--color-accent)",\n};'
      }
      language="typescript"
      filename="theme.ts"
      wrapControl
      showStatus={false}
    />
  );
}
function ApprovalExample() {
  const [decision, setDecision] = useState<'approve' | 'deny'>();
  return decision ? (
    <div className="ds-sent-message">
      <Check size={15} />
      {decision === 'approve' ? '已同意' : '已拒绝'}预览请求，未执行命令。
      <button type="button" className="ds-inline-link" onClick={() => setDecision(undefined)}>
        重试样例
      </button>
    </div>
  ) : (
    <ToolApprovalCard
      approval={{
        approvalId: 'design-system-preview',
        toolName: 'exec_command',
        title: '运行组件检查',
        detail: '仅展示审批交互；不会启动命令。',
        command: 'pnpm design:catalog --check',
        allowedScopes: ['once'],
      }}
      onApprove={() => setDecision('approve')}
      onDeny={() => setDecision('deny')}
    />
  );
}
const EXAMPLES: Record<string, ComponentType> = {
  CodeBlockButton: ButtonExample,
  CopyTextButton: CopyExample,
  SlidingTabs: TabsExample,
  AgentAvatarView: AvatarExample,
  FileTypeIcon: FileExample,
  LoadingPixelGrid: LoadingExample,
  ComposerEditor: ComposerExample,
  CodeBlock: CodeExample,
  ToolApprovalCard: ApprovalExample,
};
export const LIVE_COMPONENT_NAMES = Object.keys(EXAMPLES);
export function LiveSpecimens({ only }: { only?: string }) {
  const names = only ? [only] : LIVE_COMPONENT_NAMES;
  return (
    <div className="ds-example-list">
      {names.map((name) => {
        const Example = EXAMPLES[name];
        return Example ? (
          <div className="ds-example" data-example={name} key={name}>
            <Example />
          </div>
        ) : null;
      })}
    </div>
  );
}
