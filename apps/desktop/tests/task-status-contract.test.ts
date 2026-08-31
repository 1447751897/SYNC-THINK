import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('NewMax task status contract', () => {
  const chat = source('../src/renderer/shell/ChatView.tsx');
  const flow = source('../src/renderer/shell/InlineProcessFlow.tsx');
  const panel = source('../src/renderer/shell/TaskStatusPanel.tsx');
  const css = source('../src/renderer/shell/shell.css');

  it('mounts one status surface and removes the repeated Progress and Goal entrances', () => {
    expect(chat.match(/<ComposerTaskPanel\b/g)).toHaveLength(1);
    expect(chat).not.toContain('<TaskStatusPanel');
    expect(chat).not.toContain('<TodoPanel');
    expect(chat).not.toContain('<GoalCapsule');
    expect(chat).not.toContain('function RunTaskCapsule');
    expect(chat).not.toContain('function GoalCapsule');
    expect(chat).not.toContain('turnPlan={processView?.taskPlan}');
    expect(flow).not.toContain('process-turn-plan');
    expect(flow).not.toContain('turnPlan?:');
    expect(css).not.toContain('.shell-todo-panel');
    expect(css).not.toContain('.shell-task-status__changes-list');
  });

  it('keeps the ZCode section order and measured floating geometry', () => {
    expect(panel.indexOf('title="Git 工具"')).toBeLessThan(panel.indexOf('title="目标"'));
    expect(panel.indexOf('title="目标"')).toBeLessThan(panel.indexOf('title="任务清单"'));
    expect(panel).not.toContain('title="Git tools"');
    expect(panel).not.toContain('<ChangesDialog');
    expect(panel).toContain('onOpenReview');
    expect(css).toMatch(/\.shell-task-status-panel\s*\{[\s\S]*?width:\s*320px/);
    expect(css).toMatch(/max-height:\s*min\(64dvh,\s*32rem\)/);
    expect(css).toMatch(/\.shell-task-status-host\s*\{[\s\S]*?top:\s*16px;[\s\S]*?right:\s*16px/);
    expect(css).toContain('@container shell-chat (max-width: 1279px)');
  });

  it('binds the card and its overlays to semantic and image-theme surfaces', () => {
    expect(css).toContain(":root[data-image-theme='active'] .shell-task-status-panel");
    expect(css).toContain('var(--shell-chat-composer-surface)');
    expect(css).toContain('var(--color-overlay)');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    const statusCss = css.slice(
      css.indexOf('/* Local ZCode 3.9.2 task status'),
      css.indexOf('.shell-browser-handoff {', css.indexOf('/* Local ZCode 3.9.2 task status')),
    );
    expect(statusCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
