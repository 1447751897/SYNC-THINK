/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerMcpMenu } from './ComposerMcpMenu.js';
import { NEWMAX_POPOVER_TRANSITION_MS } from './NewMaxComposerFrame.js';

const runtime = {
  listMcpServers: vi.fn(),
};

beforeEach(() => {
  runtime.listMcpServers.mockReset().mockResolvedValue({
    servers: [
      {
        mcpServerId: 'mcp-linear',
        name: 'Linear',
        transport: 'remote-http',
        endpoint: 'https://example.invalid/mcp',
        tools: [
          { name: 'list_issues', description: 'List issues' },
          { name: 'create_issue', description: 'Create issue' },
        ],
        trusted: true,
        enabled: true,
        maxOutputBytes: 100000,
        timeoutMs: 30000,
        notes: 'Project tracker',
        createdAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T10:00:00.000Z',
      },
      {
        mcpServerId: 'mcp-docs',
        name: 'Docs',
        transport: 'local-stdio',
        endpoint: 'node docs.mjs',
        tools: [],
        trusted: true,
        enabled: false,
        maxOutputBytes: 100000,
        timeoutMs: 30000,
        notes: '',
        createdAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T10:00:00.000Z',
      },
      {
        mcpServerId: 'builtin-codex',
        name: 'Codex 内置服务',
        transport: 'local-stdio',
        endpoint: 'node builtin.mjs',
        tools: [{ name: 'internal_tool', description: 'Internal tool' }],
        trusted: true,
        enabled: true,
        maxOutputBytes: 100000,
        timeoutMs: 30000,
        notes: '不应出现在菜单中',
        isBuiltin: true,
        createdAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T10:00:00.000Z',
      },
    ],
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ComposerMcpMenu', () => {
  it('matches the NewMax server list and routes status management to settings', async () => {
    const onDismiss = vi.fn();
    const onOpenSettings = vi.fn();
    render(<ComposerMcpMenu onDismiss={onDismiss} onOpenSettings={onOpenSettings} />);

    await waitFor(() => expect(runtime.listMcpServers).toHaveBeenCalledWith({ limit: 100 }));
    expect(await screen.findByText('Linear')).toBeTruthy();
    expect(screen.getByText('Project tracker')).toBeTruthy();
    expect(screen.getByText('LOCAL-STDIO MCP 服务器')).toBeTruthy();
    expect(screen.getByText('已启用')).toBeTruthy();
    expect(screen.getByText('已禁用')).toBeTruthy();
    expect(screen.getByText('启用状态在设置中管理')).toBeTruthy();
    expect(screen.queryByText('Codex 内置服务')).toBeNull();
    expect(screen.queryByText('https://example.invalid/mcp')).toBeNull();
    expect(screen.queryByText(/个工具/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '去 MCP 设置' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('retains an explicitly closed MCP popover until its exit motion completes', async () => {
    vi.useFakeTimers();
    const props = { onDismiss: vi.fn(), onOpenSettings: vi.fn() };
    const view = render(<ComposerMcpMenu {...props} open />);
    await act(async () => Promise.resolve());
    const menu = screen.getByTestId('composer-mcp-menu');
    expect(menu.getAttribute('data-motion-state')).toBe('entering');

    act(() => vi.advanceTimersByTime(NEWMAX_POPOVER_TRANSITION_MS));
    expect(menu.getAttribute('data-motion-state')).toBe('stable');

    view.rerender(<ComposerMcpMenu {...props} open={false} />);
    expect(menu.getAttribute('data-motion-state')).toBe('exiting');
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(NEWMAX_POPOVER_TRANSITION_MS - 1));
    expect(screen.getByTestId('composer-mcp-menu')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('composer-mcp-menu')).toBeNull();
  });
});
