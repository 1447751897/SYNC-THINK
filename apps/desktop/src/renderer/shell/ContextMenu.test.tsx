/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContextMenuProvider, MessageContextActions, useContextMenu, selectedContextText } from './ContextMenu.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import { LineDiffView } from './ExecutionProcessBlock.js';
import { CodeBlock } from './CodeBlock.js';
import { appendContextQuote } from './context-quote.js';
import { markdownPlainText } from './markdown-plain-text.js';
let write: ReturnType<typeof vi.fn>, execute: ReturnType<typeof vi.fn>;
beforeEach(() => {
  write = vi.fn(async () => {}); execute = vi.fn(async () => {});
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { editing: { writeText: write, execute, readText: async () => '' } } });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.getSelection()?.removeAllRanges(); });
const open = (element: Element) => fireEvent.contextMenu(element, { clientX: 100, clientY: 120 });
async function choose(label: string) { fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp('^' + label) })); }

it('restores the original input and selection before native editing', async () => {
  render(<ContextMenuProvider><input aria-label="输入" defaultValue="alpha beta" /></ContextMenuProvider>);
  const input = screen.getByRole('textbox') as HTMLInputElement; input.focus(); input.setSelectionRange(0, 5);
  execute.mockImplementation(async () => { expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(5); });
  open(input); await choose('复制'); await waitFor(() => expect(execute).toHaveBeenCalledWith('copy'));
});
it('offers read-only copy without paste/cut and hides selected password text', async () => {
  render(<ContextMenuProvider><input aria-label="只读" readOnly defaultValue="value" /><input aria-label="密码" type="password" defaultValue="secret" /></ContextMenuProvider>);
  open(screen.getByLabelText('只读')); expect(await screen.findByRole('menuitem', { name: /^复制/ })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: /^粘贴/ })).toBeNull(); fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  const input = screen.getByLabelText('密码') as HTMLInputElement; input.focus(); input.select(); open(input);
  expect((await screen.findByRole('menuitem', { name: /^复制/ })).hasAttribute('data-disabled')).toBe(true);
});
it('keeps an existing specialized right-click menu in control', () => {
  const original = vi.fn(); render(<ContextMenuProvider><div onContextMenu={event => { event.preventDefault(); original(); }}>图片</div></ContextMenuProvider>);
  open(screen.getByText('图片')); expect(original).toHaveBeenCalledOnce(); expect(screen.queryByRole('menu')).toBeNull();
});
it('does not use a selection from another message', () => {
  render(<><p data-testid="first">first</p><p data-testid="second">second</p></>);
  const range = document.createRange(); range.selectNodeContents(screen.getByTestId('first')); window.getSelection()?.addRange(range);
  expect(selectedContextText(screen.getByTestId('second'))).toBe(''); expect(selectedContextText(screen.getByTestId('first'))).toBe('first');
});
it('opens the same menu using Shift+F10 and respects disabled actions', async () => {
  function Region() { const menu = useContextMenu(); return <button onContextMenu={e => menu(e, [{ id: 'disabled', label: '不可操作', disabled: true }, { id: 'copy', label: '复制测试', run: () => write('value') }])}>目标</button>; }
  render(<ContextMenuProvider><Region /></ContextMenuProvider>); screen.getByRole('button', { name: '目标' }).focus(); fireEvent.keyDown(document.activeElement!, { key: 'F10', shiftKey: true });
  expect((await screen.findByRole('menuitem', { name: '不可操作' })).hasAttribute('data-disabled')).toBe(true);
  await choose('复制测试'); await waitFor(() => expect(write).toHaveBeenCalledWith('value'));
});
it('copies only the actual command and quotes errors without executing anything', async () => {
  const quote = vi.fn();
  render(<ContextMenuProvider><MessageContextActions.Provider value={{ quote }}><InlineProcessFlow defaultOpen items={[{ kind: 'tool', toolCallId: 'test', name: 'command_execution', argumentsJson: JSON.stringify({ command: 'pwsh.exe -Command "pnpm test"', cwd: 'D:/project', processId: 55 }), result: 'Error: missing fixture', status: 'failed' }]} /></MessageContextActions.Provider></ContextMenuProvider>);
  const tool = screen.getByTestId('inline-process-tool'); open(tool); await choose('复制命令'); await waitFor(() => expect(write).toHaveBeenCalledWith('pnpm test'));
  open(tool); await choose('复制输出'); await waitFor(() => expect(write).toHaveBeenCalledWith('Error: missing fixture'));
  open(tool); await choose('引用错误并提问'); await waitFor(() => expect(quote).toHaveBeenCalledWith(expect.stringContaining('Error: missing fixture'), expect.stringContaining('分析')));
  expect(execute).not.toHaveBeenCalled();
});
it('copies complete code rather than its capped preview and inserts only a quote', async () => {
  const code = Array.from({ length: 1400 }, (_, i) => 'line ' + i).join('\n'), quote = vi.fn();
  render(<ContextMenuProvider><MessageContextActions.Provider value={{ quote }}><CodeBlock code={code} language="text" /></MessageContextActions.Provider></ContextMenuProvider>);
  const block = document.querySelector('.shell-beui-code')!; open(block); await choose('复制代码'); await waitFor(() => expect(write).toHaveBeenCalledWith(code));
  open(block); await choose('引用代码到输入框'); await waitFor(() => expect(quote).toHaveBeenCalledWith(code, '引用代码'));
});
it('copies an actual diff and opens the same file through the existing callback', async () => {
  const openFile = vi.fn();
  render(<ContextMenuProvider><MessageContextActions.Provider value={{ openFile }}><LineDiffView oldText="const count = 1;" newText="const count = 5;" path="src/count.ts" /></MessageContextActions.Provider></ContextMenuProvider>);
  const diff = document.querySelector('.shell-beui-diff')!; open(diff); await choose('复制 Diff'); await waitFor(() => expect(write).toHaveBeenCalledWith(expect.stringContaining('-const count = 1;')));
  expect(write.mock.calls.at(-1)?.[0]).toContain('+const count = 5;'); open(diff); await choose('复制修改后内容'); await waitFor(() => expect(write).toHaveBeenCalledWith('const count = 5;'));
  open(diff); await choose('打开对应文件'); await waitFor(() => expect(openFile).toHaveBeenCalledWith('src/count.ts'));
});
describe('quote and plain-text content', () => {
  it('preserves drafts and multiline quotes, without adding a send instruction', () => {
    expect(appendContextQuote('已有草稿', 'first\r\nsecond', '引用消息')).toBe('已有草稿\n\n引用消息：\n> first\n> second\n\n');
    expect(appendContextQuote('keep', '  ', '引用消息')).toBe('keep');
  });
  it('keeps prose, code and tables while removing Markdown syntax', () => {
    const value = markdownPlainText('# 标题\n\n**粗体** 和 [链接](https://example.test)\n\n- one\n- two\n\n~~~ts\nconst count = 5;\n~~~\n\n|a|b|\n|-|-|\n|1|2|');
    expect(value).toContain('标题'); expect(value).toContain('粗体 和 链接'); expect(value).not.toContain('**'); expect(value).toContain('const count = 5;'); expect(value).toContain('a\tb\n1\t2');
  });
});
