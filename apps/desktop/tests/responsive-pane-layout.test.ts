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

describe('responsive pane layout wiring', () => {
  it('sizes the composer from its pane instead of the whole window', () => {
    expect(chatSource).toContain('shell-chat-column');
    expect(chatSource).not.toContain('min-w-[260px]');
    expect(shellStyles).toContain('container-name: shell-chat');
    expect(shellStyles).toContain('@container shell-chat (max-width: 620px)');
  });

  it('uses native resource dragging for conversation tabs without a pointer transform track', () => {
    expect(tabsSource).not.toContain('PointerSensor');
    expect(tabsSource).toContain('draggable');
    expect(tabsSource).toContain('application/x-sync-think-pane-resource');
    expect(topBarSource).not.toContain('PointerSensor');
    expect(topBarSource).toContain('application/x-sync-think-workspace');
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

  it('keeps the file editor and embedded workspace tree usable in a narrow pane', () => {
    expect(shellStyles).toContain('.shell-file-workbench__layout');
    expect(shellStyles).toContain(
      ".shell-file-workbench[data-explorer-open='true'] .shell-file-workbench__layout",
    );
    expect(shellStyles).toMatch(
      /@container shell-file-workbench \(max-width: 520px\)[\s\S]*\.shell-file-workbench\[data-explorer-open='true'\] \.shell-file-workbench__layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*grid-template-rows:\s*minmax\(180px, 3fr\) minmax\(150px, 2fr\)/,
    );
    expect(shellStyles).toMatch(
      /\.shell-file-workbench__explorer\s*\{[\s\S]*grid-row:\s*2;[\s\S]*border-top:\s*1px solid var\(--color-border\)/,
    );
  });
});
