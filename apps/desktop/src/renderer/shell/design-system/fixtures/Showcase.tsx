import {
  createElement,
  useState,
  useRef,
  useEffect,
  type ComponentType,
  type ReactNode,
} from 'react';
import * as d from './data.js';
import { LiveSpecimens } from '../LiveSpecimens.js';
import { DialogProvider } from '../../Dialog.js';
import { ToastProvider } from '../../Toast.js';
import { ContextMenuProvider } from '../../ContextMenu.js';
import { INITIAL_NAV, emptyConversationGroups } from '../../shell-state.js';
import { resolveKernelBrandLogo } from '../../brand-icons.js';
import * as C_ActivityCenterPage from '../../ActivityCenterPage.js';
import * as C_AgentActivity from '../../AgentActivity.js';

import * as C_AgentContactsSidebar from '../../AgentContactsSidebar.js';
import * as C_AgentLibrary from '../../AgentLibrary.js';
import * as C_AgentLimitsCard from '../../agent-limits-card.js';
import { WebSearch } from '../../WebSearch.js';
import * as C_AnswerSources from '../../AnswerSources.js';
import * as C_AskQuestionCard from '../../AskQuestionCard.js';
import * as C_BotAvatarCanvas from '../../BotAvatarCanvas.js';
import * as C_BotConversationPane from '../../BotConversationPane.js';
import * as C_BrandLogoMark from '../../BrandLogoMark.js';
import * as C_BrowserHandoffCard from '../../BrowserHandoffCard.js';
import * as C_BrowserPanel from '../../BrowserPanel.js';
import * as C_BrowserStage from '../../BrowserStage.js';
import * as C_BrowserTaskDashboard from '../../BrowserTaskDashboard.js';
import * as C_BrowserTaskInfo from '../../BrowserTaskInfo.js';
import * as C_BrowserWorkflowPanel from '../../BrowserWorkflowPanel.js';
import { GroupBrowserSettings } from '../../GroupBrowserAutomation.js';
import * as C_ChatView from '../../ChatView.js';
import * as C_ChromeExtensionBridgeCard from '../../ChromeExtensionBridgeCard.js';
import * as C_CitationContext from '../../CitationContext.js';
import * as C_CodeBlockSource from '../../CodeBlockSource.js';
import * as C_CollaborationChatView from '../../CollaborationChatView.js';
import * as C_compose_toolbar from '../../compose-toolbar.js';
import * as C_ComposerAddMenu from '../../ComposerAddMenu.js';
import * as C_ComposerApprovalStack from '../../ComposerApprovalStack.js';
import * as C_ComposerEditor from '../../ComposerEditor.js';
import * as C_ComposeRequestQueue from '../../ComposeRequestQueue.js';
import * as C_ComposerGitBar from '../../ComposerGitBar.js';
import * as C_ComposerGitMenu from '../../ComposerGitMenu.js';
import * as C_ComposerMcpMenu from '../../ComposerMcpMenu.js';
import * as C_ComposerMenuHighlight from '../../ComposerMenuHighlight.js';
import * as C_ComposerModeControls from '../../ComposerModeControls.js';
import * as C_ComposerSlashMenu from '../../ComposerSlashMenu.js';
import * as C_ContextMenu from '../../ContextMenu.js';
import * as C_ConversationMinimapRail from '../../ConversationMinimapRail.js';
import * as C_ConversationTabs from '../../ConversationTabs.js';
import * as C_DaemonCard from '../../DaemonCard.js';
import * as C_DeferredFileDiff from '../../DeferredFileDiff.js';
import * as C_DeferredToolContent from '../../DeferredToolContent.js';
import * as C_DesktopUpdatePanel from '../../DesktopUpdatePanel.js';
import * as C_DesktopWaitingCard from '../../DesktopWaitingCard.js';
import * as C_Dialog from '../../Dialog.js';
import * as C_DsTabBar from '../../DsTabBar.js';
import * as C_ExcalidrawDraftPreview from '../../ExcalidrawDraftPreview.js';
import * as C_ExcalidrawPreview from '../../ExcalidrawPreview.js';
import * as C_ExecutionProcessBlock from '../../ExecutionProcessBlock.js';
import * as C_ExecutionTimeline from '../../ExecutionTimeline.js';
import * as C_ExpiredToolApprovalNotice from '../../ExpiredToolApprovalNotice.js';
import * as C_ExternalSourceIcon from '../../ExternalSourceIcon.js';
import * as C_FileContentPreview from '../../FileContentPreview.js';
import * as C_FileDiffSurface from '../../FileDiffSurface.js';
import * as C_FilePane from '../../FilePane.js';
import * as C_FirstLaunchGuide from '../../FirstLaunchGuide.js';
import * as C_GitIdentityMenu from '../../GitIdentityMenu.js';
import * as C_GitPanel from '../../GitPanel.js';
import * as C_GoalSettingsDialog from '../../GoalSettingsDialog.js';
import * as C_GridReveal from '../../GridReveal.js';
import * as C_HomeScenarios from '../../HomeScenarios.js';
import * as C_HtmlFilePreview from '../../HtmlFilePreview.js';
import * as C_HtmlSandbox from '../../HtmlSandbox.js';
import * as C_ImageGenerationSettings from '../../ImageGenerationSettings.js';
import * as C_ImageLightbox from '../../ImageLightbox.js';
import * as C_InlineProcessFlow from '../../InlineProcessFlow.js';
import * as C_InlineVisualizationPreview from '../../InlineVisualizationPreview.js';
import * as C_KeepAliveLayer from '../../KeepAliveLayer.js';
import * as C_KernelUpdatePanel from '../../KernelUpdatePanel.js';
import * as C_MarkdownContent from '../../MarkdownContent.js';
import * as C_MarkdownDocumentEditor from '../../MarkdownDocumentEditor.js';
import * as C_MarkdownImageGallery from '../../MarkdownImageGallery.js';
import * as C_MeetingMinutesDialog from '../../MeetingMinutesDialog.js';
import * as C_MermaidChart from '../../MermaidChart.js';
import * as C_MessageTextContent from '../../MessageTextContent.js';
import * as C_model_settings_widgets from '../../model-settings-widgets.js';
import * as C_ModelListSelect from '../../ModelListSelect.js';
import * as C_ModelOverflowMenu from '../../ModelOverflowMenu.js';
import * as C_ModelSettings from '../../ModelSettings.js';
import * as C_NewConversationDialog from '../../NewConversationDialog.js';
import * as C_OverlayScrollArea from '../../OverlayScrollArea.js';
import * as C_PlanApprovalCard from '../../PlanApprovalCard.js';
import * as C_PreferencesSettings from '../../PreferencesSettings.js';
import * as C_ProjectlessDataSetting from '../../ProjectlessDataSetting.js';
import * as C_prompt_enhancement from '../../prompt-enhancement.js';
import * as C_RightDock from '../../RightDock.js';
import * as C_RunProcessLoadNotice from '../../RunProcessLoadNotice.js';
import * as C_ScrollToBottomButton from '../../ScrollToBottomButton.js';
import * as C_SecretInputControl from '../../SecretInputControl.js';
import * as C_SettingsPage from '../../SettingsPage.js';
import * as C_SettingsSectionTabs from '../../SettingsSectionTabs.js';
import * as C_Sidebar from '../../Sidebar.js';
import * as C_StreamingResponse from '../../StreamingResponse.js';
import * as C_TaskCalendar from '../../TaskCalendar.js';
import * as C_TaskPanel from '../../TaskPanel.js';
import {
  AutomationBindings,
  type AutomationBinding,
  type AutomationResources,
} from '../../AutomationBindings.js';
import * as C_TaskScopePicker from '../../TaskScopePicker.js';
import * as C_TaskSheet from '../../TaskSheet.js';
import * as C_TaskStatusPanel from '../../TaskStatusPanel.js';
import * as C_TaskTemporalPicker from '../../TaskTemporalPicker.js';
import * as C_TeamLibrary from '../../TeamLibrary.js';
import GroupChatFolders from '../../GroupChatFolders.js';
import * as C_TerminalPane from '../../TerminalPane.js';
import * as C_TipsCarousel from '../../TipsCarousel.js';
import * as C_Toast from '../../Toast.js';
import * as C_ToggleControl from '../../ToggleControl.js';
import * as C_ToolApprovalCard from '../../ToolApprovalCard.js';
import * as C_ToolResult from '../../ToolResult.js';
import * as C_TopBar from '../../TopBar.js';
import * as C_TurnSkillControl from '../../TurnSkillControl.js';
import * as C_WallpaperReadingLayers from '../../WallpaperReadingLayers.js';
import * as C_WebSearchSettings from '../../WebSearchSettings.js';
import * as C_WebTextLink from '../../WebTextLink.js';
import * as C_WeeklyRuleEditor from '../../WeeklyRuleEditor.js';
import * as C_word_diff from '../../word-diff.js';
import * as C_WorkspaceFileView from '../../WorkspaceFileView.js';
import * as C_WorkspacePaneHost from '../../WorkspacePaneHost.js';
import * as C_WorkspaceScopeRow from '../../WorkspaceScopeRow.js';
import * as C_WorkspaceWorkbench from '../../WorkspaceWorkbench.js';
import * as C_AbilityCenterPage from '../../abilities/AbilityCenterPage.js';
import * as C_McpIdentityMark from '../../abilities/McpIdentityMark.js';
// The fixture adapter deliberately accepts data-shaped props: it is built only
// into the isolated exhibition entry, never used by application business code.
// Coverage and browser rendering checks exercise every registry key.
const e = (
  Component: ComponentType<any>,
  props: Record<string, any> = {},
  ...children: ReactNode[]
) => createElement(Component, props, ...children);
const noop = () => {};
const imageList = [
  { src: d.image, url: d.image, alt: '设计研究', title: 'Design study', key: 'study-1' },
  { src: d.image, url: d.image, alt: '主题研究', title: 'Theme study', key: 'study-2' },
];
const processProps = {
  processView: d.process,
  view: d.process,
  streaming: false,
  commentaryText: '先阅读组件实现，再整理主题变量，最后验证交互与可访问性。',
  onOpenChange: noop,
};
export function Showcase({ name, variant = 'default' }: { name: string; variant?: string }) {
  const [text, setText] = useState('帮我梳理这个项目的设计系统。');
  const [checked, setChecked] = useState(true);
  const [selected, setSelected] = useState('overview');
  const [open, setOpen] = useState(true);
  const [notice, setNotice] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const action =
    (message = '已在演示中完成操作') =>
    () =>
      setNotice(message);
  const empty = variant === 'empty';
  const row = (...children: ReactNode[]) => <div className="sf-row">{children}</div>;
  const stack = (...children: ReactNode[]) => <div className="sf-stack">{children}</div>;
  const button = (label: string, onClick = action()) => (
    <button className="ds-button ds-button--secondary" onClick={onClick}>
      {label}
    </button>
  );
  const editor = () =>
    e(C_ComposerEditor.ComposerEditor, {
      value: text,
      onChange: setText,
      onSubmit: (v: string) => {
        setText('');
        setNotice('已发送演示消息：' + v);
      },
      ariaLabel: '预览消息输入',
      placeholder: '输入想法…',
      minHeight: 120,
    });
  const composer = () => (
    <div className="sf-composer">
      <div className="sf-composer-editor">{editor()}</div>
      <div className="sf-composer-toolbar">
        {e(C_ComposerAddMenu.ComposerAddControl, {
          variant: 'conversation',
          open: false,
          inputRef: input,
          composerRef: container,
          value: text,
          onValueChange: setText,
          onOpenChange: action('附件菜单：在独立组件中体验'),
          selectedFilePaths: [],
          networkEnabled: true,
          permissionMode: 'default',
          onAttach: action(),
          onPlan: action(),
          onGoal: action(),
          onNetworkChange: setChecked,
          onPermissionChange: noop,
          onFile: noop,
        })}
        <span className="sf-grow" />
        {e(C_compose_toolbar.ModelTrigger, {
          label: 'GPT · Design',
          open: false,
          onClick: action('已选择设计模型'),
        })}
        {e(C_compose_toolbar.ContextRing, { used: 18420, limit: 200000 })}
        {e(C_compose_toolbar.ComposerActionSlot, {
          hasContent: !!text,
          running: false,
          onVoice: action(),
          onSend: () => {
            setNotice('已发送：' + text);
            setText('');
          },
          onStop: noop,
        })}
      </div>
    </div>
  );
  const chat = () =>
    e(C_ChatView.ChatView, {
      conversation: d.conversations[0],
      modelName: 'GPT · Design',
      models: d.models,
      agents: d.agents,
      teams: d.teams,
      workspaces: d.workspaces,
      eventHistory: [],
      onTitleUpdated: noop,
    });
  const tabs = () =>
    e(C_SettingsSectionTabs.SettingsSectionTabs, {
      items: [
        { value: 'overview', id: 'overview', label: '概览' },
        { value: 'activity', id: 'activity', label: '活动' },
        { value: 'settings', id: 'settings', label: '设置' },
      ],
      value: selected,
      onChange: setSelected,
      'aria-label': '预览标签',
    });
  const source = () =>
    e(C_AnswerSources.AnswerSources, {
      sources: d.sources,
      onOpenFile: action('已选择来源文件'),
      onOpenUrl: noop,
    });
  const md = () =>
    e(C_MarkdownContent.MarkdownContent, { text: d.markdown, interactiveEmbeds: false });
  const diff = () =>
    stack(
      e(C_FileDiffSurface.FileDiffToolbar, { additions: 2, deletions: 1, copyText: d.diff }),
      e(
        C_FileDiffSurface.FileDiffViewport,
        { path: 'src/theme/tokens.css' },
        <pre className="sf-diff">
          {d.diff.split('\n').map((line, i) => (
            <div key={i} data-kind={line[0]}>
              {line}
            </div>
          ))}
        </pre>,
      ),
    );
  const modelSelect = () =>
    e(C_ModelListSelect.ModelListSelect, {
      label: '默认模型',
      placeholder: '选择一个模型',
      value: selected,
      options: d.models.map((m) => ({ value: m.modelId, label: m.displayName })),
      onChange: setSelected,
    });
  const commonPage = {
    agents: empty ? [] : d.agents,
    models: d.models,
    teams: empty ? [] : d.teams,
    workspaces: d.workspaces,
    conversations: d.conversations,
    skills: d.skills,
    onRefresh: action('已刷新演示数据'),
    onStartConversation: action('已创建演示会话'),
    onBack: action(),
    onGoToAbilities: action(),
    onGoToAgents: action(),
  };
  const taskPanel = () => e(C_TaskPanel.TaskPanel, commonPage);
  const sidebar = () =>
    e(C_Sidebar.Sidebar, {
      ...commonPage,
      nav: INITIAL_NAV,
      width: 250,
      modelNames: new Map(d.models.map((m) => [m.modelId, m.displayName])),
      groups: emptyConversationGroups(),
      bootState: 'ready',
      activeWorkspaceId: d.workspaces[0].workspaceId,
      multiSelect: false,
      selectedIds: new Set(),
      onSelectStage: action(),
      onToggleTrack: noop,
      onToggleSidebar: noop,
      onOpenConversation: action(),
      onNewConversation: action(),
      onTogglePin: noop,
      onRename: noop,
      onArchive: noop,
      onDelete: noop,
      onCreateGroup: noop,
      onRenameGroup: noop,
      onDeleteGroup: noop,
      onToggleGroupCollapsed: noop,
      onMoveToGroup: noop,
      onToggleMultiSelect: noop,
      onToggleSelected: noop,
      onBulkArchive: noop,
      onBulkDelete: noop,
      onResizeStart: noop,
    });
  const topbar = () =>
    e(C_TopBar.TopBar, {
      workspaces: d.workspaces,
      activeWorkspaceId: d.workspaces[0].workspaceId,
      sidebarCollapsed: false,
      onSelectWorkspace: action(),
      onOpenFolder: action(),
      onCreateWorkspace: async () => true,
      onUpdateWorkspace: async () => true,
      onDeleteWorkspace: async () => true,
      onToggleSidebar: noop,
      onPickFolder: async () => ({ canceled: true }),
    });
  const browser = () =>
    e(C_BrowserStage.BrowserStage, {
      workspaces: d.workspaces,
      activeWorkspaceId: d.workspaces[0].workspaceId,
      onStartAiTask: action(),
    });
  const registry: Record<string, () => ReactNode> = {
    CodeBlockButton: () => <LiveSpecimens only="CodeBlockButton" />,
    CopyTextButton: () => <LiveSpecimens only="CopyTextButton" />,
    AgentAvatarView: () => <LiveSpecimens only="AgentAvatarView" />,
    FileTypeIcon: () => <LiveSpecimens only="FileTypeIcon" />,
    SlidingTabs: () => <LiveSpecimens only="SlidingTabs" />,
    LoadingPixelGrid: () => <LiveSpecimens only="LoadingPixelGrid" />,
    CodeBlock: () => <LiveSpecimens only="CodeBlock" />,
    ToolApprovalCard: () => <LiveSpecimens only="ToolApprovalCard" />,
    ComposerEditor: composer,
    'compose-toolbar': composer,
    WebSearch: () => <div className={variant==='reference'?'shell-web-search-reference':undefined} style={variant==='reference'?{width:486,maxWidth:'100%'}:undefined}><WebSearch heading="Ran 3 searches" steps={[
      {id:'query',label:'Searching for what teams actually pay for in a component library',meta:'5 results',sources:[
        {title:'Tailwind UI vs building your own: a cost breakdown',domain:'www.reddit.com',href:'https://www.reddit.com'},
        {title:'We shipped our design system in 6 weeks. Here is what it cost',domain:'www.linkedin.com',href:'https://www.linkedin.com'},
        {title:'shadcn/ui — the registry model explained',domain:'github.com',href:'https://github.com'},
        {title:'Design tokens: a practical guide',domain:'www.figma.com',href:'https://www.figma.com'},
        {title:'How we priced our component library',domain:'www.notion.so',href:'https://www.notion.so'},
      ]},
      {id:'x',label:'Searched X for',query:'component library OR design system pricing',meta:'7 posts'},
      {id:'reddit',label:'Searched Reddit for',query:'r/reactjs worth paying for',meta:'12 threads'},
      {id:'read',label:'Reading the strongest three threads'},
    ]}/></div> ,
    'agent-limits-card': () =>
      e(C_AgentLimitsCard.AgentLimitsCard, {
        used: 184_200,
        limit: 400_000,
        usageRatio: 0.4605,
        compactThreshold: 0.85,
        measurement:{source:variant === 'calibrated' ? 'provider-calibrated' : 'estimate',estimatedTokens:variant === 'calibrated' ? 179200 : 184200,
          ...(variant === 'calibrated' ? {providerInputTokens:184200} : {})},
        budget:{contextWindow:400000,reservedOutputTokens:8192,safetyMarginTokens:8192,fixedInputTokens:80200,availableInputTokens:383616,availableHistoryTokens:303416,compactTriggerTokens:340000,retainedTailTokens:62689},
        compactedAt: '2026-09-28T09:30:00.000Z',
        modelContextWindow: 400_000,
        contextWindowSource: 'configured',
        sessionTokens: 2_480_000,
        sessionDurationMs: 5_400_000,
        sections: [
          { type: 'system', tokens: 12_000 },
          { type: 'agent', tokens: 8_200 },
          { type: 'project', tokens: 24_000 },
          { type: 'summary', tokens: 28_400 },
          { type: 'messages', tokens: 104_000 },
          { type: 'tools', tokens: 7_600 },
        ],
      }),
    ChatView: chat,
    CollaborationChatView: () =>
      e(C_CollaborationChatView.CollaborationChatView, {
        conversation: { ...d.conversations[0], track: 'agent', targetRef: d.agents[0].id },
        agents: d.agents,
        onOpenConversation: action(),
      }),
    BotConversationPane: () => e(C_BotConversationPane.BotConversationPane),
    ComposerAddMenu: () =>
      stack(
        composer(),
        e(C_ComposerAddMenu.ComposerAddControl, {
          variant: 'conversation',
          open,
          onOpenChange: setOpen,
          inputRef: input,
          composerRef: container,
          value: text,
          onValueChange: setText,
          selectedFilePaths: [],
          networkEnabled: checked,
          permissionMode: 'default',
          workspaceFolder: '/demo/sync-think',
          onAttach: action(),
          onPlan: action(),
          onGoal: action(),
          onNetworkChange: setChecked,
          onPermissionChange: noop,
          onFile: noop,
        }),
      ),
    ComposerMcpMenu: () =>
      e(C_ComposerMcpMenu.ComposerMcpMenu, {
        open: true,
        onDismiss: action(),
        onOpenSettings: action(),
        style: { position: 'relative', inset: 'auto', width: '100%' },
      }),
    ComposerSlashMenu: () =>
      e(C_ComposerSlashMenu.ComposerSlashMenu, {
        open: true,
        skills: d.skills,
        loading: false,
        query: '',
        selectedSkillVersionIds: [],
        activeIndex: 0,
        onActiveIndexChange: noop,
        onCommand: action(),
        onSkill: action(),
        onCreateSkill: action(),
        style: { position: 'relative', inset: 'auto' },
      }),
    ComposerMenuHighlight: () => (
      <div className="sf-menu" ref={container}>
        {e(C_ComposerMenuHighlight.ComposerMenuHighlight, {
          containerRef: container,
          activeIndex: Number(selected) || 0,
        })}
        {['搜索文件', '选择技能', '添加上下文'].map((label, i) => (
          <button key={label} onMouseEnter={() => setSelected(String(i))} onClick={action(label)}>
            {label}
          </button>
        ))}
      </div>
    ),
    ComposerModeControls: () =>
      stack(
        row(
          e(C_ComposerModeControls.ComposerActiveModePill, { mode: 'plan', onClick: action() }),
          e(C_ComposerModeControls.ComposerActiveModePill, { mode: 'goal', onClick: action() }),
        ),
        e(C_ComposerModeControls.ComposerModeKeywordHint, {
          kind: 'plan',
          onAccept: action(),
          onDismiss: action(),
        }),
      ),
    ComposeRequestQueue: () =>
      e(C_ComposeRequestQueue.ComposeRequestQueue, {
        items: [
          { id: 'q1', text: '接下来检查移动端布局', createdAt: d.timestamp, attachments: [] },
          { id: 'q2', text: '补充深色主题的对比度检查', createdAt: d.timestamp, attachments: [] },
        ],
        activeRun: true,
        onEdit: action(),
        onDelete: action(),
        onInterject: action(),
      }),
    NewConversationDialog: () =>
      e(C_NewConversationDialog.NewConversationDialog, {
        ...commonPage,
        track: 'model',
        onPick: action('已选择演示模型'),
        onGoToLibrary: action(),
        onClose: action(),
      }),
    ConversationTabs: () =>
      e(C_ConversationTabs.ConversationTabs, {
        conversations: d.conversations,
        openIds: d.conversations.map((c) => c.id),
        activeId: d.conversations[0].id,
        activeConversationId: d.conversations[0].id,
        onSelect: action(),
        onClose: action(),
        onNew: action(),
        onActivate: action(),
        onSelectConversation: action(),
        onCloseConversation: action(),
      }),
    ConversationMinimapRail: () => e(MinimapExample),
    ScrollToBottomButton: () => (
      <div style={{ position: 'relative', height: 160 }}>
        {e(C_ScrollToBottomButton.ScrollToBottomButton, {
          visible: true,
          unread: true,
          onScrollToBottom: action('已返回最新消息'),
        })}
      </div>
    ),
    TurnSkillControl: () =>
      e(C_TurnSkillControl.TurnSkillControl, {
        owner: d.agents[0],
        workspaceId: d.workspaces[0].workspaceId,
        open,
        onOpenChange: setOpen,
        selectedSkillVersionIds: [],
        onChange: action(),
      }),
    'prompt-enhancement': () =>
      stack(
        composer(),
        e(C_prompt_enhancement.PromptEnhancementAction, {
          enhancement: {
            visible: true,
            busy: false,
            enhance: () => {
              setText('请分析组件的视觉规范、交互状态与主题依赖，并给出改进建议。');
              setNotice('已在本地优化提示词');
            },
            cancel: noop,
          },
        }),
      ),
    MarkdownContent: md,
    MessageTextContent: () => e(C_MessageTextContent.MessageTextContent, { text: d.markdown }),
    StreamingResponse: () =>
      e(
        C_StreamingResponse.StreamingResponse,
        {
          status: variant === 'alternate' ? 'streaming' : 'complete',
          sources: d.sources,
          onCopy: action('已复制回答'),
          onRetry: action(),
          onFeedbackChange: action(),
        },
        md(),
      ),
    AnswerSources: () => stack(md(), source()),
    CitationContext: () =>
      e(C_CitationContext.CitationScope, { sources: d.sources }, md(), source()),
    CodeBlockSource: () =>
      e(C_CodeBlockSource.CodeBlockSource, { lines: d.code.split('\n'), language: 'typescript' }),
    ExternalSourceIcon: () =>
      row(
        ...['https://github.com', 'https://example.test', 'https://docs.example.test'].map((url) =>
          e(C_ExternalSourceIcon.ExternalSourceIcon, { key: url, url, size: 32 }),
        ),
      ),
    WebTextLink: () =>
      e(
        C_WebTextLink.WebTextLink,
        { href: 'https://example.test', url: 'https://example.test', onOpen: action() },
        'Sync-Think · 设计说明',
      ),
    HtmlSandbox: () => e(C_HtmlSandbox.HtmlSandbox, { code: d.html }),
    HtmlFilePreview: () =>
      e(C_HtmlFilePreview.HtmlFilePreview, { text: d.html, path: 'design.html' }),
    InlineVisualizationPreview: () =>
      e(C_InlineVisualizationPreview.InlineVisualizationPreview, {
        file: 'design.html',
        projectFolder: '/demo/sync-think',
      }),
    ImageLightbox: () =>
      e(C_ImageLightbox.ImageLightbox, {
        open: true,
        images: imageList,
        activeIndex: Number(selected) || 0,
        onChangeIndex: (i: number) => setSelected(String(i)),
        onClose: action('预览保持打开'),
      }),
    MarkdownImageGallery: () =>
      e(C_MarkdownImageGallery.MarkdownImageGallery, { images: imageList }),
    MermaidChart: () =>
      e(C_MermaidChart.MermaidChart, {
        code: 'flowchart LR\n  A[用户输入] --> B[智能体思考]\n  B --> C[工具执行]\n  C --> D[清晰结果]',
      }),
    AgentActivity: () =>
      e(
        C_AgentActivity.AgentActivityViewport,
        { state: variant === 'alternate' ? 'working' : 'complete', runId: 'demo-run' },
        e(C_AgentActivity.AgentActivityStatus, { state: 'complete' }),
        e(C_ExecutionTimeline.ExecutionTimeline, processProps),
      ),
    ExecutionTimeline: () => e(C_ExecutionTimeline.ExecutionTimeline, processProps),
    ExecutionProcessBlock: () => e(C_ExecutionProcessBlock.ExecutionProcessBlock, processProps),
    InlineProcessFlow: () =>
      e(C_InlineProcessFlow.InlineProcessFlow, {
        ...processProps,
        items: d.process.steps.map((s) => ({
          kind: 'tool',
          id: s.id,
          name: s.toolName,
          displayName: s.zh,
          argumentsJson: JSON.stringify({ path: s.path, command: s.command }),
          result: s.preview,
          status: 'completed',
        })),
      }),
    ToolResult: () =>
      stack(
        variant === 'hero'
          ? e(C_ExecutionTimeline.ExecutionTimeline, {
              ...processProps,
              commentaryText: '已完成组件检查，变更与结果都在这里。',
            })
          : null,
        e(C_ToolResult.ToolResult, {
          status: variant === 'alternate' ? 'error' : 'success',
          kind: 'terminal',
          output:
            variant === 'alternate'
              ? 'Error: 组件主题校验失败，请检查语义变量。'
              : '✓ theme.test.ts (8 tests)\n✓ components.test.tsx (16 tests)\n\n24 tests passed in 1.28s',
          onRetry: action(),
        }),
      ),
    PlanApprovalCard: () =>
      e(C_PlanApprovalCard.PlanApprovalCard, {
        conversationId: d.conversations[0].id,
        plan: d.plan,
        onPlanUpdated: noop,
        onExecute: async () => setNotice('演示计划已批准'),
        onSwitchMode: async () => {},
        onNotify: action(),
      }),
    ComposerApprovalStack: () =>
      e(C_ComposerApprovalStack.ComposerApprovalStack, {
        tool: {
          key: 'approval',
          id: 'approval',
          title: '运行组件测试',
          summary: 'pnpm test',
          label: '执行审批',
          node: e(C_ToolApprovalCard.ToolApprovalCard, {
            approval: {
              approvalId: 'demo-approval',
              toolName: 'exec_command',
              title: '运行组件测试',
              command: 'pnpm test',
              allowedScopes: ['once'],
            },
            onApprove: action('已同意演示请求'),
            onDeny: action('已拒绝演示请求'),
          }),
        },
      }),
    ExpiredToolApprovalNotice: () =>
      e(C_ExpiredToolApprovalNotice.ExpiredToolApprovalNotice, {
        approvals: [
          {
            approvalId: 'expired',
            title: '运行组件测试',
            expiredAt: d.timestamp,
            reason: 'run_ended',
          },
        ],
        onRecover: action('已恢复为演示草稿'),
      }),
    RunProcessLoadNotice: () =>
      e(C_RunProcessLoadNotice.RunProcessLoadNotice, {
        runId: 'demo',
        failure: { kind: 'connection', attempts: 1, retrying: false },
        onRetry: action('重新加载演示数据'),
      }),
    AskQuestionCard: () =>
      e(C_AskQuestionCard.AskQuestionCard, {
        ask: {
          id: 'demo-ask',
          askId: 'demo-ask',
          requestId: 'demo-ask',
          conversationId: d.conversations[0].id,
          questions: [
            {
              id: 'theme',
              question: '你希望优先完善哪一部分？',
              header: '设计方向',
              options: [
                { label: '组件展示', description: '先补齐可操作的真实 UI' },
                { label: '主题规范', description: '先完善 Token 与配色' },
              ],
            },
          ],
        },
        onSettled: action('回答已保存到演示状态'),
      }),
    DeferredToolContent: () =>
      e(C_DeferredToolContent.DeferredToolContent, {
        deferred: { reference: { kind: 'tool_result', id: 'demo-content' }, utf8Bytes: 2048 },
        preview: '24 tests passed in 1.28s. 组件与主题验证完成。',
        label: '完整测试输出',
      }),
    DesktopWaitingCard: () =>
      e(C_DesktopWaitingCard.DesktopWaitingCard, {
        command: {
          commandId: 'demo-wait',
          reason: 'attention-required',
          action: 'inspect-window',
          toolName: 'computer',
          updatedAt: d.timestamp,
          target: { title: 'Design Lab' },
        },
        busy: false,
        onContinue: action(),
        onCancel: action(),
      }),
    ToggleControl: () =>
      stack(
        ...[false, true].map((disabled, i) =>
          row(
            <span key={'label' + i}>{disabled ? '禁用状态' : '消息通知'}</span>,
            e(C_ToggleControl.ToggleControl, {
              key: i,
              checked,
              disabled,
              label: '消息通知' + i,
              onChange: setChecked,
              className: 'settings-toggle',
              thumbClassName: 'settings-toggle__thumb',
            }),
          ),
        ),
      ),
    SecretInputControl: () =>
      e(C_SecretInputControl.SecretInputControl, {
        value: text,
        onChange: setText,
        label: '演示 API Key',
        placeholder: 'sk-demo-only',
        hasStoredSecret: false,
      }),
    DsTabBar: () =>
      e(C_DsTabBar.DsTabBar, {
        items: [
          { value: 'overview', label: '概览' },
          { value: 'activity', label: '活动' },
          { value: 'settings', label: '设置' },
        ],
        value: selected,
        onChange: setSelected,
        'aria-label': '预览分段标签',
      }),
    SettingsSectionTabs: tabs,
    Dialog: () => e(DialogExample),
    Toast: () => e(ToastExample),
    ContextMenu: () => e(ContextExample),
    OverlayScrollArea: () =>
      e(
        C_OverlayScrollArea.OverlayScrollArea,
        { style: { height: 240 } },
        ...Array.from({ length: 12 }, (_, i) => (
          <div className="sf-list-row" key={i}>
            组件规范 {String(i + 1).padStart(2, '0')}
            <span>已同步</span>
          </div>
        )),
      ),
    GridReveal: () =>
      e(C_GridReveal.GridReveal, {
        src: d.image,
        alt: '设计研究',
        caption: '从像素到完整画面',
        progress: 1,
        aspect: 1.6,
        estimatedDuration: 600,
      }),
    BrandLogoMark: () =>
      row(
        ...['codex', 'claude-code', 'native'].map((kind) =>
          e(C_BrandLogoMark.BrandLogoMark, {
            key: kind,
            logo: resolveKernelBrandLogo(kind),
            size: 36,
          }),
        ),
      ),
    BotAvatarCanvas: () =>
      row(
        ...['thinking', 'working', 'idle'].map((state) =>
          stack(
            e(C_BotAvatarCanvas.default, {
              key: state,
              seed: state,
              name: state,
              face: { shape: 'droid', color: 'preset' },
              size: 72,
              state,
            }),
            <small>{state}</small>,
          ),
        ),
      ),
    AgentLibrary: () => e(C_AgentLibrary.AgentLibrary, commonPage),
    TeamLibrary: () => e(C_TeamLibrary.TeamLibrary, commonPage),
    GroupChatFolders: () =>
      e(GroupChatFolders, {
        scope: 'design-chat-folders-demo',
        contacts: [],
        searchTerm: '',
        onCreateChat: noop,
        renderContact: noop,
      }),
    AgentContactsSidebar: () =>
      e(C_AgentContactsSidebar.default, {
        ...commonPage,
        workspaceId: d.workspaces[0].workspaceId,
        onChat: action(),
        onOpenConversation: action(),
        onManage: action(),
      }),
    AbilityCenterPage: () =>
      e(C_AbilityCenterPage.AbilitiesPage, {
        ...commonPage,
        activeWorkspaceId: d.workspaces[0].workspaceId,
      }),
    McpIdentityMark: () =>
      row(
        ...['Project Files', 'Browser Tools', 'Design Kit'].map((name) =>
          stack(
            e(C_McpIdentityMark.McpIdentityMark, { key: name, name, size: 40 }),
            <small>{name}</small>,
          ),
        ),
      ),
    BrowserStage: browser,
    BrowserTaskDashboard: () =>
      e(C_BrowserTaskDashboard.BrowserTaskDashboard, {
        workspaces: d.workspaces,
        renderManager: browser,
      }),
    GroupBrowserAutomation: () =>
      e(GroupBrowserSettings, { snapshot: d.collaboration, busy: true, onCommand: noop }),
    BrowserWorkflowPanel: () =>
      e(C_BrowserWorkflowPanel.BrowserWorkflowPanel, {
        workspaceId: d.workspaces[0].workspaceId,
        profile: d.profile,
        refreshToken: 0,
        onRecordWorkflow: action(),
      }),
    BrowserTaskInfo: () =>
      e(C_BrowserTaskInfo.BrowserTaskInfo, {
        task: d.browserTasks[0],
        profileName: '工作浏览器',
        workspaceName: 'Sync-Think',
        onClose: action(),
      }),
    BrowserPanel: () => (
      <div className="sf-browser-frame">
        {e(C_BrowserPanel.BrowserPanel, {
          initialUrl: 'https://example.test/design',
          onClose: action(),
          registerForAutomation: false,
        })}
        <div className="sf-browser-page">
          <span className="sf-eyebrow">DESIGN LAB / 离线示例页面</span>
          <h1>一个想法，更多可能。</h1>
          <p>使用原版浏览器工具栏探索搜索、缩放与设备预览。</p>
          <div className="sf-browser-tiles">
            {['设计系统', '组件预览', '主题研究'].map((title) => (
              <article key={title}>
                <img src={d.image} alt="设计研究" />
                <h3>{title}</h3>
              </article>
            ))}
          </div>
          <small>网页内容为本地展示数据，不访问外部网站。</small>
        </div>
      </div>
    ),
    BrowserHandoffCard: () =>
      e(C_BrowserHandoffCard.BrowserHandoffCard, {
        handoff: {
          id: 'demo-handoff',
          handoffId: 'demo-handoff',
          runId: 'demo-run',
          reason: '请检查页面内容后继续',
          status: 'pending',
          url: 'https://example.test/design',
          title: '需要你确认下一步',
          createdAt: d.timestamp,
        },
        busy: false,
        onContinue: action('已继续演示任务'),
        onCancel: action('已结束演示任务'),
      }),
    ChromeExtensionBridgeCard: () => e(C_ChromeExtensionBridgeCard.ChromeExtensionBridgeCard),
    TaskPanel: taskPanel,
    // Automation dashboard is an opt-in specimen; scheduled tasks default to the original calendar.
    AutomationCenter: () => (
      <div className="sf-stack" style={{ height: 760, display: 'flex', flexDirection: 'column' }}>
        <small>离线组件示例 · 仅演示任务配置与本地状态，不运行模型或发送邮件。</small>
        <div style={{ flex: 1, minHeight: 0 }}>{e(C_TaskPanel.TaskPanel, { ...commonPage, initialView: 'center' })}</div>
      </div>
    ),
    AutomationBindings: () => <AutomationBindingsSpecimen empty={empty} />,

    TaskCalendar: () =>
      e(C_TaskCalendar.TaskCalendar, {
        tasks: d.tasks,
        allTasks: d.tasks,
        workspaces: d.workspaces,
        scopes: ['all'],
        onScopesChange: noop,
        targets: new Set(['agent', 'team', 'model']),
        onTargetToggle: noop,
        statusFilters: tabs(),
        listContent: taskPanel(),
        loading: false,
        now: new Date(d.timestamp).getTime(),
        onPick: action(),
        onCreate: action(),
        onRefresh: action(),
      }),
    TaskScopePicker: () =>
      e(C_TaskScopePicker.TaskScopePicker, {
        value: selected,
        onChange: setSelected,
        workspaces: d.workspaces,
        tasks: d.tasks,
        layout: 'sidebar',
      }),
    TaskTemporalPicker: () =>
      stack(
        row(
          <input
            type="text"
            value={text === '帮我梳理这个项目的设计系统。' ? '2026-09-28' : text}
            onChange={(event) => setText(event.target.value)}
          />,
          e(C_TaskTemporalPicker.TaskTemporalPicker, {
            type: 'date',
            value: '2026-09-28',
            onChange: setText,
          }),
        ),
        row(
          <span>09:30</span>,
          e(C_TaskTemporalPicker.TaskTemporalPicker, {
            type: 'time',
            value: '09:30',
            onChange: setText,
          }),
        ),
      ),
    WeeklyRuleEditor: () =>
      e(C_WeeklyRuleEditor.WeeklyRuleEditor, {
        rule: d.task.rule,
        timeZone: 'Asia/Shanghai',
        onChange: action('已更新演示周期'),
      }),
    WorkspaceScopeRow: () =>
      e(C_WorkspaceScopeRow.WorkspaceScopeRow, {
        options: [
          { id: 'all', value: 'all', name: '全部', label: '全部', count: 3 },
          ...d.workspaces.map((w) => ({
            id: w.workspaceId,
            value: w.workspaceId,
            name: w.name,
            label: w.name,
            count: 2,
          })),
        ],
        fixedCount: 1,
        value: selected,
        onChange: setSelected,
        label: '工作区范围',
      }),
    TaskSheet: () =>
      e(
        C_TaskSheet.TaskSheet,
        {
          title: '每日设计巡检',
          description: '以规则驱动重复任务，让工作持续推进。',
          onClose: action(),
          footer: button('保存演示任务'),
        },
        stack(
          <label>
            任务名称
            <input value={text} onChange={(event) => setText(event.target.value)} />
          </label>,
          e(C_WeeklyRuleEditor.WeeklyRuleEditor, {
            rule: d.task.rule,
            timeZone: 'Asia/Shanghai',
            onChange: noop,
          }),
        ),
      ),
    TaskStatusPanel: () =>
      e(C_TaskStatusPanel.TaskStatusPanel, {
        scopeKey: 'demo',
        goal: {
          status: 'active',
          condition: '完善 Sync-Think 组件展示',
          startedAt: d.timestamp,
          objective: '完善 Sync-Think 组件展示',
          elapsedMs: 240000,
          iterations: 3,
        },
        todo: {
          items: [
            { id: 'collect', title: '收集现有组件', status: 'completed' },
            { id: 'theme', title: '构建主题系统', status: 'completed' },
            { id: 'verify', title: '验证所有交互', status: 'in_progress' },
          ],
        },
        onGoalPause: action(),
        onGoalResume: action(),
        onGoalEdit: action(),
        onGoalClear: action(),
      }),
    ActivityCenterPage: () =>
      e(C_ActivityCenterPage.ActivityCenterPage, {
        ...commonPage,
        eventHistory: [],
        onNewConversation: action(),
        onOpenConversation: action(),
      }),
    DaemonCard: () => e(C_DaemonCard.DaemonCard),
    MeetingMinutesDialog: () =>
      e(C_MeetingMinutesDialog.MeetingMinutesDialog, {
        open: true,
        onOpenChange: noop,
        onUseTranscript: action(),
      }),
    GoalSettingsDialog: () =>
      e(C_GoalSettingsDialog.GoalSettingsDialog, {
        open: true,
        initialValues: { condition: '完成全部组件的设计与交互展示' },
        onOpenChange: noop,
        onSubmit: action('目标已保存到演示状态'),
      }),
    SettingsPage: () =>
      e(C_SettingsPage.SettingsPage, {
        workspaces: d.workspaces,
        onClose: action(),
        onBack: action(),
      }),
    PreferencesSettings: () => e(C_PreferencesSettings.PreferencesSettings),
    ModelSettings: () => e(C_ModelSettings.ModelSettings),
    ModelListSelect: () => stack(<h3>模型与推理</h3>, modelSelect()),
    ModelOverflowMenu: () =>
      row(
        <span>GPT · Design</span>,
        e(C_ModelOverflowMenu.ModelOverflowMenu, {
          ariaLabel: '模型更多操作',
          items: [
            { id: 'edit', label: '编辑模型', onSelect: action() },
            { id: 'copy', label: '复制配置', onSelect: action() },
          ],
        }),
      ),
    ImageGenerationSettings: () => e(C_ImageGenerationSettings.ImageGenerationSettings),
    WebSearchSettings: () => e(C_WebSearchSettings.WebSearchSettings),
    ProjectlessDataSetting: () => e(C_ProjectlessDataSetting.ProjectlessDataSetting),
    DesktopUpdatePanel: () => e(C_DesktopUpdatePanel.DesktopUpdatePanel),
    KernelUpdatePanel: () => e(C_KernelUpdatePanel.KernelUpdatePanel),
    'model-settings-widgets': () =>
      stack(
        e(C_model_settings_widgets.AddModelInlineRow, {
          value: text,
          onChange: setText,
          onConfirm: action(),
          onDismiss: action(),
          busy: false,
        }),
        modelSelect(),
        e(C_SecretInputControl.SecretInputControl, {
          value: 'sk-demo-only',
          onChange: noop,
          label: 'API Key',
        }),
      ),
    ShellApp: () => (
      <div className="sf-shell">
        {topbar()}
        <div className="sf-shell-body">
          {sidebar()}
          <div className="sf-shell-main">{chat()}</div>
        </div>
      </div>
    ),
    Sidebar: sidebar,
    TopBar: () =>
      stack(topbar(), <div className="sf-document">工作区标签 · 窗口控制 · 快捷入口</div>),
    KeepAliveLayer: () =>
      stack(tabs(), e(C_KeepAliveLayer.KeepAliveLayer, { active: true }, composer())),
    WallpaperReadingLayers: () => (
      <div className="sf-wallpaper">
        {e(C_WallpaperReadingLayers.WallpaperReadingLayers)}
        <div className="sf-reading-content">
          {md()}
          {composer()}
        </div>
      </div>
    ),
    FirstLaunchGuide: () =>
      e(C_FirstLaunchGuide.FirstLaunchGuide, {
        hasWorkspace: true,
        hasProvider: false,
        onOpenModelSettings: action(),
        onOpenWorkspaceMenu: action(),
      }),
    HomeScenarios: () =>
      e(C_HomeScenarios.HomeScenarios, { onSelectTemplate: setText, onManage: action() }),
    TipsCarousel: () =>
      stack(<h2>开始你的下一次思考</h2>, e(C_TipsCarousel.TipsCarousel), composer()),
    FileContentPreview: () =>
      e(C_FileContentPreview.FileContentPreview, { text: d.code, path: 'Composer.tsx' }),
    WorkspaceFileView: () =>
      e(C_WorkspaceFileView.WorkspaceFileView, {
        projectFolder: '/demo/sync-think',
        path: 'README.md',
      }),
    FilePane: () =>
      e(C_FilePane.FilePane, {
        projectFolder: '/demo/sync-think',
        path: 'README.md',
        onClose: action(),
      }),
    FileDiffSurface: diff,
    DeferredFileDiff: () =>
      e(C_DeferredFileDiff.DeferredFileDiff, {
        item: {
          path: 'src/theme/tokens.css',
          action: 'edited',
          content: '--color-accent: #0285f7;',
          previousContent: '--color-accent: #0066cc;',
          contentKind: 'text',
        },
      }),
    'word-diff': () =>
      stack(
        <p className="sf-diff-line">
          {e(C_word_diff.WordSegments, {
            segments: C_word_diff.diffWordSegments(
              'Build isolated source listings',
              'Build beautiful live components',
            )!.before,
          })}
        </p>,
        <p className="sf-diff-line">
          {e(C_word_diff.WordSegments, {
            segments: C_word_diff.diffWordSegments(
              'Build isolated source listings',
              'Build beautiful live components',
            )!.after,
          })}
        </p>,
      ),
    GitPanel: () =>
      e(C_GitPanel.GitPanel, {
        projectFolder: '/demo/sync-think',
        root: '/demo/sync-think',
        onOpenFile: action(),
      }),
    ComposerGitBar: () =>
      e(C_ComposerGitBar.ComposerGitBar, {
        projectFolder: '/demo/sync-think',
        workspaceName: 'Sync-Think',
        onOpenGit: action(),
      }),
    GitIdentityMenu: () =>
      e(C_GitIdentityMenu.GitIdentityMenu, {
        root: '/demo/sync-think',
        open: true,
        onClose: noop,
        onDismiss: noop,
      }),
    ComposerGitMenu: () => (
      <div>
        <button
          ref={anchor}
          className="ds-button ds-button--secondary"
          onClick={() => setOpen((v) => !v)}
        >
          main ▾
        </button>
        {anchor.current && open
          ? e(C_ComposerGitMenu.ComposerGitMenu, {
              kind: 'branch',
              root: '/demo/sync-think',
              label: 'main',
              currentBranch: 'main',
              anchor: anchor.current,
              onDismiss: () => setOpen(false),
              onReview: action(),
            })
          : null}
      </div>
    ),
    MarkdownDocumentEditor: () =>
      e(C_MarkdownDocumentEditor.MarkdownDocumentEditor, {
        text: d.markdown,
        onChange: action('文档已修改，仅保存在此预览'),
      }),
    TerminalPane: () =>
      e(C_TerminalPane.TerminalPane, {
        terminalId: 'demo-terminal',
        projectFolder: '/demo/sync-think',
        cwd: '/demo/sync-think',
        active: true,
        title: '组件测试',
      }),
    RightDock: () =>
      e(C_RightDock.WorkspaceFilesPanel, {
        projectFolder: '/demo/sync-think',
        onOpenFile: action(),
        activeFilePath: 'README.md',
      }),
    ExcalidrawPreview: () =>
      e(C_ExcalidrawPreview.ExcalidrawPreview, {
        content: d.drawing,
        filePath: 'design.excalidraw',
        isActive: true,
        onChange: noop,
      }),
    ExcalidrawDraftPreview: () =>
      e(C_ExcalidrawDraftPreview.ExcalidrawDraftPreview, {
        code: d.drawing,
        projectFolder: '/demo/sync-think',
      }),
    WorkspaceWorkbench: () =>
      e(C_WorkspaceWorkbench.WorkspaceWorkbench, {
        placement: 'right',
        scope: {
          open: true,
          size: 420,
          activeTabId: 'demo-file',
          tabs: [
            { id: 'demo-file', kind: 'file', type: 'file', path: 'README.md', title: 'README.md' },
          ],
        },
        open: true,
        focused: true,
        renderContent: md,
        onActivateTab: noop,
        onCloseTab: action(),
        onNewResource: action(),
        onClose: action(),
        onSizeChange: noop,
      }),
    WorkspacePaneHost: () =>
      e(C_WorkspacePaneHost.WorkspacePaneHost, {
        layout: {
          root: { id: 'pane-root', type: 'pane', paneId: 'demo-pane' },
          panes: { 'demo-pane': { id: 'demo-pane', tabs: [], activeTabId: null } },
          focusedPaneId: 'demo-pane',
        },
        renderPane: () => stack(tabs(), md()),
        onFocusPane: noop,
        onSplitRatioChange: noop,
      }),
  };
  // Ensure anchor-dependent menus receive the mounted button on their first frame.
  useEffect(() => {
    if (name === 'ComposerGitMenu') setSelected('mounted');
  }, [name]);
  const render = registry[name];
  if (!render) throw new Error('Missing visual fixture: ' + name);
  return (
    <DialogProvider>
      <ToastProvider>
        <ContextMenuProvider>
          <div className="sf-content" data-fixture={name} ref={container}>
            {render()}
            {notice && (
              <div className="sf-feedback" role="status">
                {notice}
              </div>
            )}
          </div>
        </ContextMenuProvider>
      </ToastProvider>
    </DialogProvider>
  );
}
function DialogExample() {
  const dialog = C_Dialog.useDialog();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void dialog.confirm({
      title: '归档此对话？',
      message: '对话会保留在历史记录中，你可以随时恢复。',
      confirmText: '归档对话',
    });
  }, [dialog]);
  return (
    <div className="sf-stack">
      <h3>让每次确认，都清楚明白。</h3>
      <div className="sf-row">
        <button
          className="ds-button ds-button--primary"
          onClick={() =>
            dialog.confirm({
              title: '归档此对话？',
              message: '对话会保留在历史记录中，你可以随时恢复。',
              confirmText: '归档对话',
            })
          }
        >
          确认弹窗
        </button>
        <button
          className="ds-button ds-button--secondary"
          onClick={() =>
            dialog.prompt({
              title: '重命名工作区',
              message: '为这个思考空间取一个名字。',
              defaultValue: 'Design Lab',
            })
          }
        >
          输入弹窗
        </button>
      </div>
    </div>
  );
}
function ToastExample() {
  const toast = C_Toast.useToast();
  useEffect(() => {
    const id = toast.toast({
      id: 'showcase-toast',
      type: 'success',
      title: '主题已保存',
      description: '所有组件已同步新的主题配色。',
      duration: 0,
    });
    return () => toast.dismiss(id);
  }, [toast]);
  return (
    <div className="sf-row">
      {['success', 'error', 'info'].map((type) => (
        <button
          key={type}
          className="ds-button ds-button--secondary"
          onClick={() =>
            toast.toast({
              type: type as 'success' | 'error' | 'info',
              title:
                type === 'success'
                  ? '主题已保存'
                  : type === 'error'
                    ? '示例错误：请检查输入'
                    : '所有更改仅影响演示环境',
            })
          }
        >
          {type === 'success' ? '成功反馈' : type === 'error' ? '错误反馈' : '信息提示'}
        </button>
      ))}
    </div>
  );
}
function ContextExample() {
  const menu = C_ContextMenu.useContextMenu();
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    target.current?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 110 }),
    );
  }, []);
  return (
    <div
      className="sf-context-target"
      ref={target}
      onContextMenu={(event) => {
        menu(event, [
          { id: 'copy', label: '复制', run: noop },
          { id: 'rename', label: '重命名', run: noop },
          { id: 'archive', label: '归档', run: noop },
        ]);
      }}
    >
      在这个区域点击右键<small>体验 Sync-Think 的上下文菜单</small>
    </div>
  );
}

function MinimapExample() {
  const scroller = useRef<HTMLDivElement>(null);
  const items = Array.from({ length: 8 }, (_, i) => ({
    id: 'message-' + i,
    role: i % 2 ? 'assistant' : 'user',
    text: i % 2 ? '使用一致的主题 Token，连接设计与实现。' : '如何让组件更清晰？',
    timestamp: d.timestamp,
  }));
  return (
    <div className="sf-minimap">
      <div ref={scroller} className="sf-minimap-scroll">
        {items.map((item) => (
          <article key={item.id} data-message-id={item.id}>
            <small>{item.role === 'user' ? '你' : '设计搭档'}</small>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
      {e(C_ConversationMinimapRail.ConversationMinimapRail, { items, scrollerRef: scroller })}
    </div>
  );
}

/** Real binding component with explicitly offline registry metadata, not a recreated form. */
function AutomationBindingsSpecimen({ empty }: { empty: boolean }) {
  const [binding, setBinding] = useState<AutomationBinding>(() =>
    empty
      ? { executionMode: 'workspace' }
      : {
          executionMode: 'workspace',
          browser: { profileId: d.profile.id, workflowTaskId: 'offline-published-flow' },
          outputs: ['spreadsheet'],
          delivery: {
            kind: 'gmail',
            mcpServerId: 'offline-gmail',
            toolName: 'gmail_send_message',
            recipient: 'offline-recipient@example.test',
          },
          acceptance: '离线组件示例：采集→整理→产物→交付；这里仅展示绑定，未生成文件或发送邮件。',
        },
  );
  const [refreshed, setRefreshed] = useState(false);
  const resources: AutomationResources = {
    profiles: empty ? [] : [d.profile],
    workflows: empty
      ? []
      : [
          {
            id: 'offline-published-flow',
            profileId: d.profile.id,
            name: '离线示例 · 已发布采集流程',
            instruction: '离线组件示例，不采集外部网站。',
            startUrl: 'https://example.test/offline',
            source: 'manual',
            status: 'enabled',
            revision: 1,
            publishedVersionId: 'offline-flow-v1',
            successCount: 0,
            failureCount: 0,
            createdAt: d.timestamp,
            updatedAt: d.timestamp,
          },
        ],
    servers: empty
      ? []
      : [
          {
            mcpServerId: 'offline-gmail',
            name: '离线示例 Gmail connector',
            transport: 'remote-http',
            endpoint: 'https://example.test/offline-mcp',
            enabled: true,
            trusted: true,
            maxOutputBytes: 10000,
            timeoutMs: 1000,
            notes: '仅离线登记数据，不连接邮箱。',
            tools: [
              {
                name: 'gmail_send_message',
                description: '离线工具 schema，用来演示明确选择发件工具。',
                inputSchemaJson: JSON.stringify({
                  type: 'object',
                  properties: { to: { type: 'string' }, subject: { type: 'string' } },
                  required: ['to'],
                }),
              },
              {
                name: 'gmail_send_draft',
                description: '离线工具 schema，只接受 draftId；用于演示 connector 格式提示。',
                inputSchemaJson: JSON.stringify({
                  type: 'object',
                  properties: { draftId: { type: 'string' } },
                  required: ['draftId'],
                }),
              },
            ],
            createdAt: d.timestamp,
            updatedAt: d.timestamp,
          },
        ],
    errors: {},
    loading: false,
  };
  return (
    <div className="sf-stack">
      <small>离线组件示例 · 仅登记数据；不验证连接、不发送邮件。</small>
      <AutomationBindings
        value={binding}
        onChange={setBinding}
        resources={resources}
        onReload={() => setRefreshed(true)}
      />
      {refreshed ? <small role="status">已刷新离线示例配置；没有连接外部服务。</small> : null}
    </div>
  );
}
