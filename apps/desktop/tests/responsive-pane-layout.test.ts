import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatSource = readFileSync(
  new URL('../src/renderer/shell/ChatView.tsx', import.meta.url),
  'utf8',
);
const tabsSource = readFileSync(
  new URL('../src/renderer/shell/ConversationTabs.tsx', import.meta.url),
  'utf8',
);
const topBarSource = readFileSync(
  new URL('../src/renderer/shell/TopBar.tsx', import.meta.url),
  'utf8',
);
const shellStyles = readFileSync(
  new URL('../src/renderer/shell/shell.css', import.meta.url),
  'utf8',
);
const workspaceFileViewSource = readFileSync(
  new URL('../src/renderer/shell/WorkspaceFileView.tsx', import.meta.url),
  'utf8',
);

describe('responsive pane layout wiring', () => {
  it('sizes the composer from its pane instead of the whole window', () => {
    expect(chatSource).toContain('shell-chat-column');
    expect(chatSource).not.toContain('min-w-[260px]');
    expect(shellStyles).toContain('container-name: shell-chat');
    expect(shellStyles).toContain('@container shell-chat (max-width: 620px)');
  });

  it('uses morphing pointer slots for workspace tabs and native dragging for conversation tabs', () => {
    expect(tabsSource).not.toContain('PointerSensor');
    expect(tabsSource).toContain('draggable');
    expect(tabsSource).toContain('application/x-sync-think-pane-resource');
    expect(topBarSource).not.toContain('PointerSensor');
    expect(topBarSource).not.toContain('application/x-sync-think-workspace');
    expect(topBarSource).toContain('useMorphingWorkspaceTabs');
    expect(topBarSource).toContain('workspace-tab-surface');
  });

  it('contains all application-level horizontal overflow inside owned scroll regions', () => {
    expect(shellStyles).toMatch(/html,\s*body,\s*#root\s*\{[^}]*overflow:\s*hidden;/s);
  });

  it('combines the conversation row and active resource inside one rounded pane frame', () => {
    const shellSource = readFileSync(
      new URL('../src/renderer/shell/ShellApp.tsx', import.meta.url),
      'utf8',
    );

    expect(shellSource).toContain('shell-stage--talk');
    expect(shellSource).toContain('shell-pane-frame');
    expect(shellSource).toContain('shell-pane-canvas');
    expect(shellSource).toContain(
      'shell-pane-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden',
    );
    expect(shellStyles).toMatch(
      /\.shell-pane-frame\s*\{[\s\S]*margin:[\s\S]*var\(--shell-pane-frame-gutter\)[\s\S]*border-radius:\s*var\(--shell-pane-frame-radius\)[\s\S]*background:\s*var\(--color-chat\)/,
    );
    expect(shellStyles).toMatch(
      /\.shell-conversation-tabs\s*\{[\s\S]*background:\s*var\(--color-chat\)[\s\S]*border-bottom:\s*1px solid/,
    );
    expect(shellStyles).toMatch(
      /\.shell-pane-frame > \.shell-conversation-tabs\s*\{[\s\S]*border-radius:\s*var\(--shell-pane-frame-radius\) var\(--shell-pane-frame-radius\) 0 0/,
    );
  });

  it('keeps file content full-width and owns workspace files in a separate workbench', () => {
    expect(shellStyles).toContain('.shell-file-workbench__layout');
    expect(workspaceFileViewSource).not.toContain('WorkspaceFilesPanel');
    expect(workspaceFileViewSource).not.toContain('workspace-file-explorer');
    expect(shellStyles).not.toContain(".shell-file-workbench[data-explorer-open='true']");
    expect(shellStyles).toMatch(
      /\.shell-dock-panel\.is-active\s*\{[\s\S]*opacity:\s*1;[\s\S]*animation:\s*shell-dock-panel-in/,
    );
    expect(shellStyles).toMatch(
      /\.shell-review-panel\s*\{[\s\S]*width:\s*100%;[\s\S]*flex:\s*1 1 auto;/,
    );
    expect(shellStyles).toMatch(
      /\.shell-workbench--right\s*\{[\s\S]*box-shadow:\s*inset 1px 0 var\(--color-border\);/,
    );
    expect(shellStyles).toMatch(
      /\.shell-workbench__tabbar\s*\{[\s\S]*background:\s*var\(--color-chat\);/,
    );
    expect(shellStyles).toMatch(
      /:root\[data-image-theme='active'\] \.shell-workbench__tabbar\s*\{[\s\S]*background:\s*var\(--color-chat\);/,
    );
  });

  it('keeps the bottom workbench chrome fixed and its content shrinkable', () => {
    expect(shellStyles).toMatch(
      /\.shell-workbench--bottom > \.shell-workbench__tabbar\s*\{\s*min-height:\s*40px;\s*\}/,
    );
    expect(shellStyles).toMatch(
      /\.shell-workbench--bottom > \.shell-workbench__divider,[\s\S]*\.shell-workbench--bottom > \.shell-workbench__content\s*\{\s*min-height:\s*0;\s*\}/,
    );
    expect(shellStyles).not.toContain('min-height: var(--workbench-size, 220px);');
  });

  it('lets the image-theme wallpaper show on the empty welcome pane without reading blur', () => {
    expect(shellStyles).toMatch(
      /:root\[data-image-theme='active'\][\s\S]*\.shell-pane-canvas--empty[\s\S]*background:\s*transparent;/,
    );
    expect(shellStyles).toMatch(
      /:root\[data-image-theme='active'\][\s\S]*\.shell-pane-canvas:has\(\.shell-chat-column--empty-newmax\)[\s\S]*background:\s*transparent;/,
    );
    expect(shellStyles).toMatch(
      /\.shell-workspace-primary-content:has\(\.shell-chat-column--empty-newmax\)::before/,
    );
    expect(shellStyles).toMatch(
      /\.shell-workspace-primary-content:has\(\.shell-chat-column--empty-newmax\)\s+\[data-wallpaper-reading-blur-stack\]/,
    );
  });
});
