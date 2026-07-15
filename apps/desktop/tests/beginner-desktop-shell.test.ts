import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/index.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/renderer/renderer.css', import.meta.url), 'utf8');

describe('beginner desktop shell contract', () => {
  it('uses labelled product navigation and keeps the task tree visible', () => {
    expect(source).toContain('data-testid="product-navigation"');
    expect(source).toContain('data-testid="product-nav-tasks"');
    expect(source).toContain('>任务<');
    expect(source).toContain('hideBrand');
    expect(source).toContain('<WorkspaceNav');
    expect(css).toContain('.st-product-nav__item');
  });

  it('shows the responsible Agent, model, and one next action in the task header', () => {
    expect(source).toContain('data-testid="task-agent-summary"');
    expect(source).toContain('data-testid="task-model-summary"');
    expect(source).toContain('data-testid="beginner-next-step"');
    expect(source).toContain('负责智能体');
    expect(source).toContain('运行模型');
  });

  it('defaults to task progress and keeps technical execution details on demand', () => {
    expect(source).toContain("'overview'");
    expect(source).toContain('data-testid="right-rail-overview"');
    expect(source).toContain('data-testid="right-rail-open-details"');
    expect(source).toContain('执行详情');
    expect(source).toContain('任务进度');
    expect(source).toContain('data-testid="right-rail-trace"');
  });

  it('hides the technical readiness dashboard during a healthy conversation', () => {
    expect(source).toContain('const showConversationAlert =');
    expect(source).toContain('{showConversationAlert ? (');
    expect(source).not.toContain('data-testid="conversation-stream-checks"');
    expect(css).toContain('.st-conversation-alert');
  });

  it('uses a three-step onboarding empty state instead of runtime diagnostics', () => {
    expect(source).toContain('className="st-beginner-empty"');
    expect(source).toContain('beginnerWorkspace.steps.map');
    expect(source).not.toContain('conversationStreamReadiness.checks.map');
    expect(source).not.toContain('data-testid="desktop-shortcut-strip"');
    expect(css).toContain('.st-beginner-empty__steps');
  });
});
