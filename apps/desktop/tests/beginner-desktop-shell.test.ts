import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/index.tsx', import.meta.url), 'utf8');
const talkSource = readFileSync(
  new URL('../src/renderer/talk-workspace.tsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../src/renderer/renderer.css', import.meta.url), 'utf8');

describe('beginner desktop shell contract', () => {
  it('uses labelled project navigation and keeps the task tree visible', () => {
    expect(source).toContain('data-testid="product-navigation"');
    expect(source).toContain('data-testid="product-nav-tasks"');
    expect(source).toContain('>项目<');
    expect(source).toContain('hideBrand');
    expect(source).toContain('<WorkspaceNav');
    expect(css).toContain('.st-product-nav__item');
  });

  it('keeps the task header quiet and leaves Agent/model controls in Compose', () => {
    expect(source).not.toContain('data-testid="task-agent-summary"');
    expect(source).not.toContain('data-testid="task-model-summary"');
    expect(source).toContain('data-testid="beginner-next-step"');
    expect(source).toContain('beginnerWorkspace.showNextStepStrip');
    expect(source).not.toContain('当前队友');
  });

  it('uses Figma progress, artifact directory, and per-turn execution logs in the task rail', () => {
    expect(source).toContain("'overview'");
    expect(source).toContain('<ConversationTaskProgress');
    expect(source).toContain('<TaskArtifactDirectory');
    expect(source).toContain('<ConversationExecutionLogs');
    expect(source).toContain('projectConversationLogs');
    expect(source).toContain('执行详情');
    expect(source).toContain('任务进度');
    expect(source).not.toContain('data-testid="right-rail-tab-approvals"');
    expect(source).not.toContain('data-testid="right-rail-tab-graph"');
    expect(source.match(/<ApprovalCenterPanel/g)).toHaveLength(1);
    expect(source).not.toContain('data-testid="right-rail-approvals"');
    expect(source).toContain('shellTraceCollapsed');
    expect(source).toContain('emptyRailExpanded');
  });

  it('hides the technical readiness dashboard during a healthy conversation', () => {
    expect(source).toContain('const showConversationAlert =');
    expect(source).toContain('{showConversationAlert ? (');
    expect(source).not.toContain('data-testid="conversation-stream-checks"');
    expect(css).toContain('.st-conversation-alert');
  });

  it('uses a calm single-CTA empty state instead of a three-step checklist', () => {
    expect(source).toContain('className="st-beginner-empty"');
    expect(source).toContain('beginnerWorkspace.emptyTitle');
    expect(source).toContain('data-testid="conversation-empty-cta"');
    expect(source).toContain('create-project');
    expect(source).toContain('create-task');
    expect(source).not.toContain('conversation-empty-steps');
    expect(source).not.toContain('conversationStreamReadiness.checks.map');
    expect(source).not.toContain('data-testid="desktop-shortcut-strip"');
    expect(css).toContain('.st-beginner-empty__aside');
  });

  it('keeps R2 calm chrome tokens for chat-first density', () => {
    expect(css).toContain('--st-layout-chat-max-width: 760px');
    expect(css).toContain('.st-demo-header-tools');
    expect(css).toContain('R2 visual calm');
  });

  it('wires Compose workspace/teammate switching and on-demand continuum', () => {
    expect(source).toContain('composeAgents');
    expect(source).toContain('composeWorkspaces');
    expect(source).toContain('onWorkspaceChange');
    expect(source).toContain('onAgentChange');
    expect(source).toContain('product-continuum-strip');
    expect(source).toContain('projectContinuumEvidence');
    expect(source).not.toContain('<ModeSwitch');
  });

  it('creates tasks instantly under a project without a modal or prompt', () => {
    expect(source).toContain("const title = parentTaskId ? '子任务' : '新任务'");
    expect(source).toContain('Instant create under a project');
    expect(source).not.toContain('TaskCreateDialog');
    expect(source).not.toContain('openTaskCreateDialog');
    expect(source).not.toContain("window.prompt('任务目标'");
    expect(source).toContain('onCreateTask={(workspaceId) => void createTask(workspaceId)}');
  });

  it('auto-names the first message and upgrades collaboration intent inside the conversation', () => {
    expect(source).toContain('deriveTaskTitleFromPrompt');
    expect(source).toContain('inferConversationCollaborationIntent');
    expect(source).toContain('prepareConversationCollaboration');
    expect(source).toContain('buildConversationCollaborationPlan');
    expect(source).toContain('data-testid="conversation-collaboration-status"');
  });

  it('creates Agents through the typed inline form instead of browser prompts', () => {
    expect(source).toContain('const createAgent = async (input: AgentCreateInput)');
    expect(source).toContain('onCreateAgent={(input) => createAgent(input)}');
    expect(source).not.toContain("window.prompt('智能体名称'");
    expect(source).not.toContain("window.prompt('智能体角色'");
  });

  it('keeps R4 light/dark parity and reduced-motion hooks', () => {
    expect(css).toContain('R4 light/dark parity');
    expect(css).toContain('--st-shadow-compose: 0 8px 24px rgba(28, 40, 31, 0.08)');
    expect(css).toContain(":root[data-st-theme='dark']");
    expect(css).toContain('prefers-reduced-motion');
  });

  it('uses the dedicated Figma conversation workspace instead of AppShell for task presentation', () => {
    expect(source.match(/<TalkGlobalNav/g)).toHaveLength(1);
    expect(source).toContain('<section className="st-talk-stage">');
    expect(source).toContain('<TalkTopBar');
    expect(source).toContain('<TalkProjectsWorkspace');
    expect(source).toContain('<TalkConversationTaskWorkspace');
    expect(source).toContain("productSection === 'tasks' || productSection === 'projects'");
    expect(source).not.toContain('taskMode=');
    expect(source).not.toContain('<AppShell');
    expect(talkSource).not.toContain('return <AppShell');
    expect(css).toContain('.st-talk-conversation-workspace');
    expect(css).toContain('grid-template-columns: 240px minmax(0, 1fr) 260px');
    expect(css).toContain(
      'grid-template-rows: 52px minmax(0, 1fr) var(--st-talk-composer-height, 126px)',
    );
  });

  it('offers configured teams in Compose and uses compact global scrollbars', () => {
    expect(source).toContain('groups={composeGroups}');
    expect(source).toContain('onGroupChange={(groupId) => void selectComposeGroup(groupId)}');
    expect(source).toContain('await createGroupTask(');
    expect(css).toContain('*::-webkit-scrollbar');
    expect(css).toContain('scrollbar-width: thin');
    expect(css).toMatch(/\*::-webkit-scrollbar\s*\{[^}]*width: 6px[^}]*height: 6px/s);
    expect(css).toMatch(/\.st-talk-task-composer\s*\{[^}]*border-top: 0/s);
  });

  it('resets optimistic task version when the active conversation changes', () => {
    expect(source).toContain("type: 'task-selected'");
    expect(source).toContain('taskVersion: selection?.taskVersion ?? 0');
  });

  it('renders non-task product pages inside a direct full-height Talk surface', () => {
    expect(source).toContain('className="st-talk-section-surface"');
    expect(source).toContain('{talkResourceWorkspace}');
    expect(css).toMatch(
      /\.st-talk-section-surface\s*\{[^}]*width: 100%[^}]*height: 100%[^}]*min-width: 0[^}]*min-height: 0[^}]*overflow: hidden/s,
    );
    expect(css).toMatch(
      /\.st-talk-section-surface > \*\s*\{[^}]*width: 100%[^}]*height: 100%[^}]*min-width: 0[^}]*min-height: 0/s,
    );
  });

  it('gives every resource page the same owned full-height overflow contract', () => {
    expect(css).toMatch(
      /\.st-talk-section-surface\[data-section='groups'\] > \.st-talk-resource-page,[\s\S]*?\.st-talk-section-surface\[data-section='automation'\] > \.st-talk-resource-page,[\s\S]*?\.st-talk-section-surface\[data-section='skills'\] > \.st-talk-resource-page,[\s\S]*?\.st-talk-section-surface\[data-section='providers'\] > \.st-providers\s*\{[^}]*width: 100%[^}]*height: 100%[^}]*min-width: 0[^}]*min-height: 0[^}]*overflow: hidden/s,
    );
  });

  it('keeps Projects selected while composing its project directory and live task workspace', () => {
    expect(source).toContain("productSection === 'tasks' || productSection === 'projects'");
    expect(source).toMatch(
      /tasks=\{\s*productSection === 'projects' \? projectConversationTasks : talkConversationTasks\s*\}/s,
    );
    expect(source).toContain('onSelectProject={setProjectWorkspaceId}');
    expect(source).toContain('onClearTask={() => applySelection(null)}');
    expect(source).toMatch(
      /productSection === 'projects'\s*\? \(projectWorkspaceId \?\? active\?\.workspaceId\)/s,
    );
    expect(css).toMatch(
      /\.st-talk-root\[data-section='projects'\] \.st-talk-stage__body\s*\{[^}]*display: grid[^}]*grid-template-columns: 270px minmax\(0, 1fr\)/s,
    );
    expect(css).toMatch(
      /\.st-talk-root\[data-section='projects'\] \.st-talk-conversation-workspace\s*\{[^}]*grid-column: 2[^}]*grid-template-columns: minmax\(0, 1fr\) 260px/s,
    );
    expect(css).toMatch(
      /\.st-talk-root\[data-section='projects'\] \.st-talk-conversation-directory\s*\{[^}]*display: none/s,
    );
    expect(css).toMatch(
      /\.st-talk-root\[data-section='projects'\][\s\S]*?\.st-talk-projects\[data-view='conversations'\][\s\S]*?\.st-talk-projects__main\s*\{[^}]*display: none/s,
    );
    expect(css).toMatch(
      /\.st-talk-root\[data-section='projects'\][\s\S]*?\.st-talk-projects\[data-view='settings'\][\s\S]*?\.st-talk-projects__main\s*\{[^}]*display: block/s,
    );
  });

  it('binds settings typography to Talk theme tokens in both themes', () => {
    expect(css).toMatch(/\.st-talk-settings\s*\{[^}]*color: var\(--st-color-text-primary\)/s);
    expect(css).toMatch(/\.st-talk-settings h2\s*\{[^}]*color: var\(--st-color-text-secondary\)/s);
    expect(css).toMatch(
      /\.st-talk-setting-row strong\s*\{[^}]*color: var\(--st-color-text-primary\)/s,
    );
  });

  it('styles the conversation detail rail as dense flat lists and accessible dialogs', () => {
    expect(css).toMatch(
      /\.st-conversation-progress__summary\s*\{[^}]*border: 1px solid var\(--st-color-border\)/s,
    );
    expect(css).toMatch(
      /\.st-conversation-progress__steps li\s*\{[^}]*border-bottom: 1px solid var\(--st-color-border\)/s,
    );
    expect(css).toContain('.st-conversation-progress__participants');
    expect(css).toContain('.st-task-artifact-directory');
    expect(css).toContain('.st-conversation-execution-logs');
    expect(css).toMatch(
      /\.st-conversation-log-row\s*\{[^}]*border-bottom: 1px solid var\(--st-color-border\)/s,
    );
    expect(css).toMatch(
      /\.st-conversation-dialog\s*\{[^}]*width: min\(880px, 92vw\)[^}]*max-height: 86vh/s,
    );
    expect(css).toContain('.st-conversation-log-stage');
    expect(css).toMatch(
      /\.st-conversation-log-stage__events[^}]*\{[^}]*white-space: pre-wrap[^}]*overflow-wrap: anywhere/s,
    );
    expect(css).toMatch(/\[data-state='running'\][^{]*\{[^}]*color: var\(--st-color-primary\)/s);
    expect(css).toMatch(/\[data-state='completed'\][^{]*\{[^}]*color: var\(--st-color-success\)/s);
    expect(css).toMatch(/\[data-state='failed'\][^{]*\{[^}]*color: var\(--st-color-error\)/s);
    expect(css).toMatch(
      /\[data-state='waiting'\][^{]*\{[^}]*color: var\(--st-color-text-secondary\)/s,
    );
    expect(css).toContain('grid-template-columns: 240px minmax(0, 1fr) 260px');
    expect(css).toContain('grid-template-columns: 240px minmax(0, 1fr) 0');
    expect(css).toMatch(
      /\[data-detail-collapsed='1'\] \.st-talk-task-detail\s*\{[^}]*display: none/s,
    );
    expect(css).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.st-talk-conversation-workspace\s*\{[^}]*grid-template-columns: 220px minmax\(0, 1fr\) 260px/s,
    );
    expect(css).toContain('@media (max-width: 999px)');
    expect(css).toMatch(/:root\[data-st-theme='dark'\] \.st-conversation-dialog-backdrop/s);
    expect(css).toContain('.st-conversation-log-row:focus-visible');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.st-rail-spin[^}]*\{[^}]*animation: none/s,
    );
  });

  it('keeps child-task creation and navigation in the task tree instead of progress', () => {
    expect(source).not.toContain('right-rail-child-tasks');
    expect(source).not.toContain('right-rail-add-child');
    expect(source).not.toContain('right-rail-open-parent');
    expect(talkSource).toContain('task-parent-breadcrumb');
    expect(source).toContain('onCreateChildTask');
  });

  it('applies the persistent font-size preference without resizing layout tracks', () => {
    expect(source).toContain('readFontSizePreference');
    expect(source).toContain('applyFontSizePreference(document.documentElement, fontSize)');
    expect(source).toContain('fontSize={fontSize}');
    expect(source).toContain('onFontSizeChange=');
    expect(css).toContain('--st-user-font-scale');
    expect(css).toContain('--st-user-font-size');
    expect(css).toMatch(/:root\s*\{[^}]*--st-user-font-size:[^}]*--st-user-font-scale:/s);
    expect(css).not.toMatch(/\.st-talk-root\s*\{[^}]*--st-user-font-size:/s);
    expect(css).toContain('--st-typo-body-size: var(--st-user-font-size, 14px)');
    expect(css).toContain('--st-typo-small-size: calc(11px * var(--st-user-font-scale, 1))');
    expect(css).toContain('--st-typo-label-size: calc(10px * var(--st-user-font-scale, 1))');
    expect(css).toContain('--st-typo-micro-size: calc(9px * var(--st-user-font-scale, 1))');
    expect(css).toMatch(
      /\.st-talk-task-header__identity > strong\s*\{[^}]*font-size: calc\(12\.5px \* var\(--st-user-font-scale, 1\)\)/s,
    );
    expect(css).toMatch(
      /\.st-talk-conversation-directory__filters button,[\s\S]*?\{[^}]*font-size: calc\(10\.5px \* var\(--st-user-font-scale, 1\)\)/s,
    );
    expect(css).toMatch(
      /\.st-talk-settings__nav > header strong\s*\{[^}]*font-size: calc\(13px \* var\(--st-user-font-scale, 1\)\)/s,
    );
    expect(css).toMatch(
      /\.st-talk-font-size-control\s*\{[^}]*font-size: calc\(10px \* var\(--st-user-font-scale, 1\)\)/s,
    );
    expect(css).toMatch(
      /\.st-talk-task-composer \.st-compose__input\s*\{[^}]*font-size: calc\(12\.5px \* var\(--st-user-font-scale, 1\)\)/s,
    );
  });

  it('keeps conversation summaries readable without changing the directory geometry', () => {
    expect(css).toMatch(
      /\.st-talk-conversation-row__content > small\s*\{[^}]*display: -webkit-box[^}]*-webkit-line-clamp: 2[^}]*-webkit-box-orient: vertical[^}]*white-space: normal/s,
    );
  });

  it('uses the Figma reading width while keeping user turns compact and right aligned', () => {
    expect(css).toMatch(
      /\.st-talk-task-conversation \.st-demo-thread\s*\{[^}]*width: 100%[^}]*max-width: none/s,
    );
    expect(css).toMatch(
      /\.st-talk-task-conversation \.st-message-bubble\[data-role='assistant'\]\s*\{[^}]*width: 100%[^}]*max-width: min\(100%, 1040px\)/s,
    );
    expect(css).toMatch(
      /\.st-talk-task-conversation \.st-message-bubble\[data-role='assistant'\] \.st-message-bubble__body\s*\{[^}]*max-width: 100%/s,
    );
    expect(css).toMatch(
      /\.st-talk-task-conversation \.st-message-bubble\[data-role='user'\]\s*\{[^}]*max-width: min\(72%, 620px\)[^}]*margin-left: auto/s,
    );
  });

  it('keeps the empty conversation command readable inside the Talk button color scope', () => {
    expect(css).toMatch(
      /\.st-talk-conversation-workspace \.st-beginner-empty > button\s*\{[^}]*background: var\(--st-color-primary\)[^}]*color: var\(--st-color-on-primary, #fff\)/s,
    );
  });
});
