/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock.js';
import { ToolPayload } from './ToolPayload.js';

const oldDesign = document.documentElement.getAttribute('data-shell-design');
const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  cleanup();
  if (oldDesign === null) document.documentElement.removeAttribute('data-shell-design');
  else document.documentElement.setAttribute('data-shell-design', oldDesign);
  if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('tool details in the real normal-workspace context', () => {
  it.each(['board-chat.css', 'workbench-design.css'])('%s decorates Markdown but never reintroduces cards inside tool details', file => {
    document.documentElement.setAttribute('data-shell-design', 'agent');
    const css = readFileSync(new NodeURL(`./${file}`, import.meta.url), 'utf8');
    const selectors = [...css.matchAll(/(:root\[data-shell-design='agent'\][^{\n]*\.shell-md-code[^{\n]*)\s*\{/g)].map(match => match[1]!.trim());
    expect(selectors).toHaveLength(1);
    const { container } = render(<div className="shell-normal-workspace">
      <div data-testid="ordinary-markdown"><CodeBlock code="const value = 42;" /></div>
      <div className="shell-harness-trace"><div className="shell-inline-process__tool-body">
        <div className="shell-tool-result"><CodeBlock code="{}" /></div>
        <div className="shell-tool-result shell-beui-result"><CodeBlock code={'{"sessions":[]}'} /></div>
      </div></div>
      <div className="agent-chat-workspace"><CodeBlock code="const other = 1;" /></div>
    </div>);
    const selector = selectors[0]!;
    expect(screen.getByTestId('ordinary-markdown').querySelector('.shell-md-code')!.matches(selector)).toBe(true);
    const inner = container.querySelectorAll('.shell-inline-process__tool-body .shell-md-code');
    expect(inner).toHaveLength(2);
    for (const code of inner) expect(code.matches(selector)).toBe(false);
    expect(container.querySelector('.agent-chat-workspace .shell-md-code')!.matches(selector)).toBe(false);
  });

  it.each([false, true])('shows empty-object parameters without another code card (MCP=%s)', async mcp => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<ToolPayload toolName={mcp ? 'mcp__sync-think-platform__list_commands' : 'list_commands'} text="{}" label="参数" />);
    expect(screen.getByText('无参数（空 JSON 对象）')).toBeTruthy();
    expect(container.querySelector('.shell-beui-code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制参数' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{}'));
  });

  it('retains the code view for a plain-text non-JSON parameter payload', () => {
    const { container } = render(<ToolPayload text="legacy command" label="参数" />);
    expect(container.querySelector('.shell-beui-code')).toBeTruthy();
    expect(screen.queryByText('无参数（空 JSON 对象）')).toBeNull();
  });
});
