/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolResult } from './ToolResult.js';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
const css = readFileSync(new NodeURL('./tool-result.css', import.meta.url), 'utf8');

describe('tool result detail surface', () => {
  it.each(['terminal', 'request', 'custom'] as const)('formats valid JSON uniformly for %s results', async kind => {
    const output = { ok: true, stdout: 'first line\nsecond line\n', stderr: '', args: ['node', 'build.mjs'] };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<ToolResult status="success" kind={kind} output={JSON.stringify(output)} />);
    expect(container.querySelector('[data-language="json"]')).toBeTruthy();
    expect(container.querySelector('.shell-beui-result__meta')?.textContent).toContain('JSON');
    expect([...container.querySelectorAll('.shell-agent-code__text')].map(line => line.textContent).join('\n')).toBe(JSON.stringify(output, null, 2));
    fireEvent.click(screen.getByRole('button', { name: '复制输出' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(output, null, 2)));
  });

  it.each(['partial', 'plain'])('preserves %s terminal logs without guessing JSON or decoding literal escapes', mode => {
    const output = mode === 'partial' ? '{"stdout":"partial' : 'path C:\\temp\\new.log\nnext line';
    const { container } = render(<ToolResult status="running" kind="terminal" output={output} />);
    expect(container.querySelector('[data-language="text"]')).toBeTruthy();
    expect(container.querySelector('.shell-beui-result__meta')?.textContent).toContain('终端输出');
    expect([...container.querySelectorAll('.shell-agent-code__text')].map(line => line.textContent).join('\n')).toBe(output);
  });

  it('copies the full formatted error JSON, not only its summary', async () => {
    const output = { ok: false, error: 'spreadsheet 仅使用 columns/rows' };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ToolResult status="error" output={JSON.stringify(output)} />);
    fireEvent.click(screen.getByRole('button', { name: '复制错误' }));
    await waitFor(() => expect(screen.getByText('已复制')).toBeTruthy());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(output, null, 2));
  });
  it('keeps error JSON readable with status and one set of result controls', () => {
    const { container } = render(
      <ToolResult
        status="error"
        kind="request"
        output={JSON.stringify({ ok: false, error: 'spreadsheet 仅使用 columns/rows' })}
      />,
    );
    expect(screen.getByText('执行失败').getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: '复制错误' })).toBeTruthy();
    expect(container.querySelectorAll('.shell-beui-code')).toHaveLength(1);
    expect(container.querySelector('.shell-beui-result__meta')!.textContent).toContain('4');
    expect(screen.getByRole('region', { name: '代码内容' }).textContent).toContain('columns/rows');
    expect(screen.queryByRole('button', { name: '展开代码' })).toBeNull();
  });
  it('keeps successful and empty outputs available without a nested disclosure', () => {
    const { rerender } = render(<ToolResult status="success" output="real output" />);
    expect(screen.getByText('已完成').getAttribute('role')).toBe('status');
    expect(screen.getByRole('region', { name: '代码内容' }).textContent).toContain('real output');
    rerender(<ToolResult status="error" />);
    expect(screen.getByText('工具未返回错误详情')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制错误' })).toBeNull();
  });
  it('flattens both result shells only inside an expanded tool, with a shared content inset', () => {
    const flat = css.slice(
      css.indexOf('.shell-inline-process__tool-body .shell-tool-result.shell-beui-result'),
      css.indexOf('.shell-inline-process__tool-body .shell-beui-result .shell-md-code__bar'),
    );
    expect(flat).toContain('.shell-beui-result .shell-agent-code.shell-beui-code');
    expect(flat).toContain('.shell-tool-result .shell-agent-code.shell-beui-code');
    for (const declaration of [
      'border: 0;',
      'border-radius: 0;',
      'background: transparent;',
      'box-shadow: none;',
    ])
      expect(flat).toContain(declaration);
    expect(css).toContain('.shell-inline-process__detail-block:has(> .shell-beui-result)');
    expect(css).toContain('padding: 14px 16px 16px;');
  });
});


describe('file tool result contents', () => {

  it.each(['content', 'text'])('decodes the %s envelope once, preserving file bytes on copy and retaining the raw metadata', async field => {
    const file = JSON.stringify({ target: 'nsis', path: String.raw`C:\temp\new.json` }, null, 2) + '\n';
    const envelope = { ok: true, [field]: file, bytes: file.length, message: 'File read completed' };
    const output = JSON.stringify(envelope);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<ToolResult status="success" kind="file" filename="apps/desktop/electron-builder.json" output={output} />);
    const code = () => [...container.querySelectorAll('.shell-agent-code__text')].map(line => line.textContent).join('\n');
    expect(code()).toBe(file.replace(/\n$/, ''));
    expect(container.querySelector('[data-language="json"]')).toBeTruthy();
    expect(container.querySelector('.shell-beui-result')?.getAttribute('data-view')).toBe('file');
    expect(screen.getByText(/文件内容 · JSON/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制文件内容' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(file));
    fireEvent.click(screen.getByRole('button', { name: '查看原始结果' }));
    expect(code()).toBe(JSON.stringify(envelope, null, 2));
    expect(screen.getByText(/原始 JSON/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制输出' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(envelope, null, 2)));
    fireEvent.click(screen.getByRole('button', { name: '查看文件内容' }));
    expect(code()).toBe(file.replace(/\n$/, ''));
  });

  it('preserves CRLF and literal Windows backslashes in plain file content when copying', async () => {
    const file = String.raw`C:\temp\new.log` + '\r\n' + String.raw`\n is literal` + '\r\n';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<ToolResult status="success" kind="file" filename="paths.txt" output={JSON.stringify({ ok: true, content: file, bytes: file.length })} />);
    expect([...container.querySelectorAll('.shell-agent-code__text')].map(line => line.textContent).join('\n')).toBe(file.replaceAll('\r\n', '\n').replace(/\n$/, ''));
    fireEvent.click(screen.getByRole('button', { name: '复制文件内容' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(file));
  });

  it.each([
    ['error status', 'error', { ok: true, content: 'body', bytes: 4 }],
    ['worker failure', 'success', { ok: false, content: 'body', bytes: 4, error: 'read failed' }],
    ['reported error', 'success', { ok: true, content: 'body', bytes: 4, error: 'read failed' }],
    ['unrecognized envelope', 'success', { ok: true, text: 'body' }],
    ['non-text content', 'success', { ok: true, content: {}, bytes: 4 }],
    ['negative bytes', 'success', { ok: true, content: 'body', bytes: -1 }],
  ] as const)('keeps the full raw details for %s', (_, status, envelope) => {
    const { container } = render(<ToolResult status={status} kind="file" output={JSON.stringify(envelope)} />);
    expect(screen.queryByRole('button', { name: '查看原始结果' })).toBeNull();
    expect([...container.querySelectorAll('.shell-agent-code__text')].map(line => line.textContent).join('\n')).toBe(JSON.stringify(envelope, null, 2));
  });

  it('does not unwrap non-file JSON or incomplete file payloads', () => {
    const { rerender, container } = render(<ToolResult status="success" kind="request" output={JSON.stringify({ ok: true, text: 'body', bytes: 4 })} />);
    expect(screen.queryByRole('button', { name: '查看原始结果' })).toBeNull();
    rerender(<ToolResult status="running" kind="file" output={'{"ok":true,"text":"body'} />);
    expect(screen.queryByRole('button', { name: '查看原始结果' })).toBeNull();
    expect(container.querySelector('[data-language="text"]')).toBeTruthy();
  });

  it('shows empty files distinctly while keeping the raw envelope accessible', () => {
    render(<ToolResult status="success" kind="file" output={JSON.stringify({ ok: true, content: '', bytes: 0 })} />);
    expect(screen.getByText('文件为空。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看原始结果' }));
    expect(screen.getByRole('region', { name: '代码内容' }).textContent).toContain('bytes');
  });

  it('resets the raw view for a new payload and uses its file extension for highlighting', () => {
    const { rerender, container } = render(<ToolResult status="success" kind="file" output={JSON.stringify({ ok: true, content: 'old', bytes: 3 })} />);
    fireEvent.click(screen.getByRole('button', { name: '查看原始结果' }));
    rerender(<ToolResult status="success" kind="file" output={JSON.stringify({ ok: true, content: 'export const value = 42;\n', bytes: 25, path: 'example.ts' })} />);
    expect(screen.getByRole('button', { name: '查看原始结果' })).toBeTruthy();
    expect(container.querySelector('[data-language="typescript"]')).toBeTruthy();
  });
});
