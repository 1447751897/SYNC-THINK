import { createElement, useState, type ComponentType, type ReactNode } from 'react';
import * as d from './data.js';
import { AgentBindingPanel } from '../../../../../../../packages/ui-kit/src/components/AgentBindingPanel.js';
import { AgentWorkspace } from '../../../../../../../packages/ui-kit/src/components/AgentWorkspace.js';
import { ApprovalCenterPanel } from '../../../../../../../packages/ui-kit/src/components/ApprovalCenterPanel.js';
import { AppShell } from '../../../../../../../packages/ui-kit/src/components/AppShell.js';
import { ArtifactVersionsPanel } from '../../../../../../../packages/ui-kit/src/components/ArtifactVersionsPanel.js';
import { Compose } from '../../../../../../../packages/ui-kit/src/components/Compose.js';
import { ComposerModeBanner } from '../../../../../../../packages/ui-kit/src/components/ComposerModeBanner.js';
import { ComposerTaskPanel } from '../../../../../../../packages/ui-kit/src/components/ComposerTaskPanel.js';
import { ContinuumRail } from '../../../../../../../packages/ui-kit/src/components/ContinuumRail.js';
import { ExecutionGraphPanel } from '../../../../../../../packages/ui-kit/src/components/ExecutionGraphPanel.js';
import { ManifestPanel } from '../../../../../../../packages/ui-kit/src/components/ManifestPanel.js';
import { MemoryDiagnosticsPanel } from '../../../../../../../packages/ui-kit/src/components/MemoryDiagnosticsPanel.js';
import { MessageBubble } from '../../../../../../../packages/ui-kit/src/components/MessageBubble.js';
import { ModelPathBoard } from '../../../../../../../packages/ui-kit/src/components/ModelPathBoard.js';
import { ModelPathPicker } from '../../../../../../../packages/ui-kit/src/components/ModelPathPicker.js';
import { ModeSwitch } from '../../../../../../../packages/ui-kit/src/components/ModeSwitch.js';
import { NewMaxComposerFrame } from '../../../../../../../packages/ui-kit/src/components/NewMaxComposerFrame.js';
import { PlanRevisionPanel } from '../../../../../../../packages/ui-kit/src/components/PlanRevisionPanel.js';
import { ProjectCreateDialog } from '../../../../../../../packages/ui-kit/src/components/ProjectCreateDialog.js';
import { ProvidersPanel } from '../../../../../../../packages/ui-kit/src/components/ProvidersPanel.js';
import { TaskCreateDialog } from '../../../../../../../packages/ui-kit/src/components/TaskCreateDialog.js';
import { TraceList } from '../../../../../../../packages/ui-kit/src/components/TraceList.js';
import { WorkspaceNav } from '../../../../../../../packages/ui-kit/src/components/WorkspaceNav.js';

// These are the repository's archived components. The removed legacy stylesheet
// is not recoverable here: a deliberately labelled, scoped archival skin is used.
const e = (c: ComponentType<any>, p: Record<string, any> = {}, ...children: ReactNode[]) =>
  createElement(c, p, ...children);
export function LegacyShowcase({ name }: { name: string }) {
  const [value, setValue] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const done = () => setNotice('演示状态已更新');
  const models = d.models.map((m) => ({
    ...m,
    providerName: m.providerId === 'openai' ? 'OpenAI' : 'Anthropic',
    providerId: m.providerId ?? 'openai',
    groupName: '设计模型',
    credentialGroupId: 'demo-group',
    protocol: 'openai-responses',
    capabilities: ['text'],
  }));
  const revision = {
    ...d.planRevision,
    ...d.planRevision.plan,
    diffFromPrevious: { added: [], removed: [], changed: [] },
    steps: d.planRevision.plan.steps.map((step, i) => ({
      ...step,
      agentVersionId: 'demo-agent-v1',
      instructions: step.description,
      dependsOn: i ? ['step-1'] : [],
      maxRetries: 0,
    })),
  };
  const binding = {
    agentId: 'demo-agent',
    agentVersionId: 'demo-agent-v1',
    version: 1,
    name: '设计搭档',
    role: '产品设计',
    defaultModelId: models[0].modelId,
    fallbackModelIds: [],
    pauseOnFailure: true,
    skillVersionIds: [],
    mcpServerIds: [],
  };
  const messages = () => (
    <div className="sf-stack">
      {e(MessageBubble, { role: 'user' }, '帮我整理这个项目的设计系统。')}
      {e(
        MessageBubble,
        { role: 'assistant', agentLabel: '设计搭档', meta: '刚刚' },
        '## 设计建议\n以语义 Token 为基础，将组件按用途分类。\n\n- 清晰的层级\n- 一致的交互\n- 可调整的主题',
      )}
    </div>
  );
  const compose = () =>
    e(Compose, {
      onSend: done,
      models,
      connectionState: 'online',
      hasActiveTask: true,
      agentDefaultSet: true,
    });
  const trace = () =>
    e(TraceList, {
      items: [
        { id: 'read', category: 'tool-action', summary: '读取组件与设计变量', time: '09:30' },
        { id: 'review', category: 'review', summary: '完成视觉与交互检查', time: '09:32' },
      ],
      hasActiveTask: true,
    });
  const nav = () =>
    e(WorkspaceNav, {
      workspaces: [{ id: 'demo-workspace', workspaceId: 'demo-workspace', name: 'Sync-Think' }],
      tasksByWorkspace: new Map([
        [
          'demo-workspace',
          [
            {
              id: 'task-demo',
              workspaceId: 'demo-workspace',
              title: '构建组件展示库',
              state: 'active',
            },
          ],
        ],
      ]),
      activeTaskId: 'task-demo',
      connectionState: 'online',
      onSelectTask: done,
    });
  const registry: Record<string, () => ReactNode> = {
    MessageBubble: messages,
    Compose: compose,
    TraceList: trace,
    WorkspaceNav: nav,
    AppShell: () =>
      e(AppShell, {
        leftNav: nav(),
        conversation: messages(),
        compose: compose(),
        trace: trace(),
        hideReadiness: true,
      }),
    NewMaxComposerFrame: () =>
      e(NewMaxComposerFrame, {
        variant: 'conversation',
        input: <textarea defaultValue="让想法清晰可见。" />,
        toolbar: <button onClick={done}>发送消息 ↑</button>,
      }),
    AgentBindingPanel: () => e(AgentBindingPanel, { binding, models, onSave: done }),
    AgentWorkspace: () =>
      e(AgentWorkspace, {
        binding,
        models,
        agents: [{ agentId: 'demo-agent', id: 'demo-agent', name: '设计搭档', role: '产品设计' }],
        selectedAgentId: 'demo-agent',
        workSummary: '整理组件语言与交互规范',
        onSave: done,
      }),
    ApprovalCenterPanel: () =>
      e(ApprovalCenterPanel, {
        items: [
          {
            id: 'approve',
            kind: 'tool',
            action: 'write-file',
            summary: '更新组件主题变量',
            humanOnly: true,
            mode: 'request',
            gate: 'require-human',
            state: 'pending',
            createdAt: d.timestamp,
          },
        ],
        onDecide: done,
      }),
    ArtifactVersionsPanel: () =>
      e(ArtifactVersionsPanel, {
        artifact: {
          id: 'design',
          name: '组件设计方案',
          selectedVersionId: 'v2',
          versions: [1, 2].map((v) => ({
            id: 'v' + v,
            artifactId: 'design',
            version: v,
            sourceStepId: 'design',
            status: v === 2 ? 'selected' : 'candidate',
            contentHash: 'demo-' + v,
            mimeType: 'text/markdown',
            parentVersionIds: [],
            createdAt: d.timestamp,
          })),
        },
        onSelect: done,
      }),
    ComposerModeBanner: () =>
      e(ComposerModeBanner, {
        mode: 'plan',
        planModelLabel: 'GPT · Design',
        actModelLabel: 'Claude · Review',
        onOpenPlanSettings: done,
        onExitPlan: done,
      }),
    ComposerTaskPanel: () =>
      e(ComposerTaskPanel, {
        todo: {
          items: [
            { id: 't1', title: '梳理组件', status: 'completed' },
            { id: 't2', title: '验证主题', status: 'in_progress' },
          ],
          completedCount: 1,
          totalCount: 2,
        },
      }),
    ContinuumRail: () =>
      e(ContinuumRail, {
        entries: [
          { id: 'decision', kind: 'decision', label: '确定设计方向' },
          { id: 'artifact', kind: 'artifact', label: '生成组件文档' },
          { id: 'review', kind: 'review', label: '通过视觉检查' },
        ],
        hasActiveTask: true,
        onSelect: setValue,
        activeId: value,
      }),
    ExecutionGraphPanel: () =>
      e(ExecutionGraphPanel, {
        graph: {
          run: { id: 'demo-run', state: 'running' },
          steps: ['收集组件', '整理主题', '交互验证'].map((title, i) => ({
            id: 'step' + i,
            title,
            agentVersionId: 'demo-agent-v1',
            state: i === 0 ? 'completed' : i === 1 ? 'running' : 'pending',
            dependsOn: i ? ['step' + (i - 1)] : [],
            retries: 0,
          })),
        },
        onPause: done,
      }),
    ManifestPanel: () =>
      e(ManifestPanel, {
        manifests: [
          {
            id: 'manifest',
            packetId: 'packet-demo',
            modelId: models[0].modelId,
            tokenEstimate: 18420,
            included: [{ id: 'design-doc', kind: 'document', tokenEstimate: 800 }],
            includedSourceIds: ['design-doc'],
            occurredAt: d.timestamp,
          },
        ],
        selectedId: 'manifest',
      }),
    MemoryDiagnosticsPanel: () =>
      e(MemoryDiagnosticsPanel, {
        entries: [
          {
            id: 'memory',
            key: '界面设计偏好',
            value: '使用清晰的分组与语义化颜色',
            scope: 'project',
            active: true,
            updatedAt: d.timestamp,
          },
        ],
        changes: [],
        diagnostics: [],
      }),
    ModelPathBoard: () =>
      e(ModelPathBoard, { models, value, onChange: setValue, variant: 'embedded' }),
    ModelPathPicker: () => e(ModelPathPicker, { models, value, onChange: setValue }),
    ModeSwitch: () =>
      e(ModeSwitch, {
        value: value ?? 'request',
        onChange: setValue,
        approvedPlan: true,
        applicablePolicy: true,
      }),
    PlanRevisionPanel: () =>
      e(PlanRevisionPanel, { revision, revisions: [revision], onApprove: done, onRevise: done }),
    ProjectCreateDialog: () =>
      e(ProjectCreateDialog, {
        open: true,
        busy: false,
        error: null,
        onClose: done,
        onSubmit: done,
      }),
    TaskCreateDialog: () =>
      e(TaskCreateDialog, {
        open: true,
        busy: false,
        error: null,
        workspaceName: 'Design Lab',
        onClose: done,
        onSubmit: done,
      }),
    ProvidersPanel: () =>
      e(ProvidersPanel, {
        providers: [
          {
            providerId: 'demo-provider',
            name: '设计模型服务',
            baseUrl: 'https://example.test/v1',
            protocol: 'openai-responses',
            supportsDiscovery: true,
            credentials: [],
            models: models.map((m) => ({
              ...m,
              capabilities: ['text'],
              capabilitiesConfirmed: true,
            })),
            createdAt: d.timestamp,
          },
        ],
        onDiscover: done,
      }),
  };
  return (
    <div className="sf-legacy">
      <p className="sf-archive-note">
        历史组件 · 原始 React 结构 + 归档展示样式，不代表现役桌面设计
      </p>
      {registry[name]?.()}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
