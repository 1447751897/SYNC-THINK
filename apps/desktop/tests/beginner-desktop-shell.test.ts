import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/index.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/renderer/renderer.css', import.meta.url), 'utf8');

describe('beginner desktop shell contract', () => {
  it('uses NewMax-style primary navigation and keeps the task tree visible', () => {
    expect(source).toContain('data-testid="product-navigation"');
    expect(source).toContain('product-shell-nav');
    expect(source).toContain('projectProductPrimaryNav');
    expect(source).not.toContain('projectTalkTrackNav');
    expect(source).toContain('data-testid={item.testId}');
    expect(source).not.toContain('data-testid="talk-track-navigation"');
    expect(source).toContain('data-testid="recent-conversations"');
    expect(source).toContain('recent-section-${section.track}');
    expect(source).toContain('data-testid={`recent-conversation-new-${section.track}`}');
    expect(source).toContain('togglePinnedConversation');
    expect(source).toContain('resolvePrimaryNav');
    expect(source).toContain('项目与任务');
    expect(source).toContain('hideBrand');
    expect(source).toContain('<WorkspaceNav');
    expect(css).toContain('.st-product-nav__item');
    expect(css).toContain('.st-talk-track-nav');
    expect(css).toContain('.st-recent-talk');
  });

  it('keeps the task header quiet and leaves Agent/model controls in Compose', () => {
    expect(source).not.toContain('data-testid="task-agent-summary"');
    expect(source).not.toContain('data-testid="task-model-summary"');
    expect(source).toContain('data-testid="beginner-next-step"');
    expect(source).toContain('beginnerWorkspace.showNextStepStrip');
    expect(source).not.toContain('当前队友');
  });

  it('defaults to task progress and keeps technical execution details on demand', () => {
    expect(source).toContain("'overview'");
    expect(source).toContain('data-testid="right-rail-overview"');
    expect(source).toContain('data-testid="right-rail-open-details"');
    expect(source).toContain('执行详情');
    expect(source).toContain('任务进度');
    expect(source).toContain('data-testid="right-rail-trace"');
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
    expect(source).toContain('talkTargetKind');
    // Object kind is fixed by left talk track / recent list, not a Compose pill switcher.
    expect(source).toContain('recent-conversations');
    expect(source).toContain('buildRecentConversationsModel');
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

  it('keeps R4 light/dark parity and reduced-motion hooks', () => {
    expect(css).toContain('R4 light/dark parity');
    expect(css).toContain("--st-shadow-compose: 0 8px 24px rgba(28, 40, 31, 0.08)");
    expect(css).toContain(":root[data-st-theme='dark']");
    expect(css).toContain('prefers-reduced-motion');
  });

  it('surfaces child tasks on the right rail with jump-to-child and parent breadcrumb', () => {
    expect(source).toContain('right-rail-child-tasks');
    expect(source).toContain('right-rail-add-child');
    expect(source).toContain('right-rail-open-parent');
    expect(source).toContain('task-parent-breadcrumb');
    expect(source).toContain('openTaskById');
    expect(source).toContain('projectChildTasks');
    expect(css).toContain('.st-task-overview__children');
  });
});
