/**
 * @vitest-environment jsdom
 */
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerAddControl } from './ComposerAddMenu.js';
import { NEWMAX_POPOVER_TRANSITION_MS } from './NewMaxComposerFrame.js';

const runtime = {
  listProjectFiles: vi.fn(),
};

const actionLog = {
  attach: vi.fn(),
  plan: vi.fn(),
  goal: vi.fn(),
  network: vi.fn(),
  permission: vi.fn(),
  file: vi.fn(),
};

function Harness({
  variant = 'conversation',
  workspaceFolder = 'D:\\workspace',
  showPermissionItems = false,
  rewriteValueOnPlan = false,
}: {
  variant?: 'empty' | 'conversation';
  workspaceFolder?: string;
  showPermissionItems?: boolean;
  rewriteValueOnPlan?: boolean;
}) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [networkEnabled, setNetworkEnabled] = useState(true);
  const [permissionMode, setPermissionMode] = useState<'ask' | 'workspace' | 'full-access'>(
    'workspace',
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={composerRef}>
      <textarea
        ref={inputRef}
        aria-label="消息"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <ComposerAddControl
        variant={variant}
        open={open}
        inputRef={inputRef}
        composerRef={composerRef}
        value={value}
        onValueChange={setValue}
        onOpenChange={setOpen}
        workspaceFolder={workspaceFolder}
        selectedFilePaths={[]}
        networkEnabled={networkEnabled}
        permissionMode={permissionMode}
        showPermissionItems={showPermissionItems}
        onAttach={actionLog.attach}
        onPlan={() => {
          actionLog.plan();
          if (rewriteValueOnPlan) setValue('/plan ');
        }}
        onGoal={actionLog.goal}
        onNetworkChange={(enabled) => {
          actionLog.network(enabled);
          setNetworkEnabled(enabled);
        }}
        onPermissionChange={(mode) => {
          actionLog.permission(mode);
          setPermissionMode(mode);
        }}
        onFile={actionLog.file}
        triggerTestId={`${variant}-add-trigger`}
        menuTestId={`${variant}-add-menu`}
      />
    </div>
  );
}

beforeEach(() => {
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
  runtime.listProjectFiles.mockReset().mockResolvedValue({ files: [] });
  Object.values(actionLog).forEach((mock) => mock.mockReset());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-reduced-motion');
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ComposerAddControl', () => {
  it('opens the NewMax action sheet, rotates the trigger, and exposes only real actions', async () => {
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: '消息' });
    const trigger = screen.getByTestId('conversation-add-trigger');

    fireEvent.click(trigger);

    const menu = await screen.findByTestId('conversation-add-menu');
    expect(menu.getAttribute('data-placement')).toBe('above');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('data-open')).toBe('1');
    expect(document.activeElement).toBe(input);
    expect(within(menu).getByText('附加文件')).toBeTruthy();
    expect(within(menu).getByText('规划模式')).toBeTruthy();
    expect(within(menu).getByText('目标模式')).toBeTruthy();
    expect(within(menu).getByText('联网搜索')).toBeTruthy();
    expect(within(menu).queryByText('询问批准')).toBeNull();
    expect(within(menu).queryByText('为我批准')).toBeNull();
    expect(within(menu).queryByText('完全访问')).toBeNull();
    expect(within(menu).getByText('会议纪要')).toBeTruthy();
    expect(within(menu).getAllByRole('option').slice(0, 5)).toEqual(
      ['附加文件', '规划模式', '目标模式', '会议纪要', '联网搜索'].map((label) =>
        within(menu).getByText(label).closest('[role="option"]'),
      ),
    );

    fireEvent.click(within(menu).getByRole('option', { name: /规划模式/ }));
    expect(actionLog.plan).toHaveBeenCalledTimes(1);
    const exitingMenu = screen.getByTestId('conversation-add-menu');
    expect(exitingMenu.getAttribute('data-motion-state')).toBe('exiting');
    expect(exitingMenu.getAttribute('aria-hidden')).toBe('true');
    fireEvent.animationEnd(exitingMenu);
    expect(screen.queryByTestId('conversation-add-menu')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(trigger.getAttribute('data-open')).toBe('0');
  });

  it('opens real meeting transcription and inserts the generated prompt into this composer', async () => {
    render(<Harness workspaceFolder="" />);
    const input = screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement;

    fireEvent.click(screen.getByTestId('conversation-add-trigger'));
    const menu = await screen.findByTestId('conversation-add-menu');
    fireEvent.click(within(menu).getByRole('option', { name: /会议纪要/ }));

    expect(await screen.findByRole('dialog', { name: '会议纪要' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('会议转写'), {
      target: { value: '确认发布窗口为周五，负责人是小林。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成会议纪要' }));

    expect(input.value).toBe(
      '请根据以下会议转写生成结构化会议纪要，包含议题、关键结论、待办事项、负责人和时间节点：\n\n确认发布窗口为周五，负责人是小林。',
    );
    expect(screen.queryByRole('dialog', { name: '会议纪要' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('uses Arrow keys, Enter, Tab and Escape while focus remains in the composer', async () => {
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: '消息' });
    const trigger = screen.getByTestId('conversation-add-trigger');

    fireEvent.click(trigger);
    let menu = await screen.findByTestId('conversation-add-menu');
    expect(within(menu).getByRole('option', { selected: true }).textContent).toContain('附加文件');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(menu).getByRole('option', { selected: true }).textContent).toContain('规划模式');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actionLog.plan).toHaveBeenCalledTimes(1);
    fireEvent.animationEnd(screen.getByTestId('conversation-add-menu'));
    expect(screen.queryByTestId('conversation-add-menu')).toBeNull();

    fireEvent.click(trigger);
    menu = await screen.findByTestId('conversation-add-menu');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(actionLog.plan).toHaveBeenCalledTimes(2);
    fireEvent.animationEnd(screen.getByTestId('conversation-add-menu'));

    fireEvent.click(trigger);
    await screen.findByTestId('conversation-add-menu');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(actionLog.attach).not.toHaveBeenCalled();
    expect(screen.getByTestId('conversation-add-menu')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.animationEnd(screen.getByTestId('conversation-add-menu'));
    expect(screen.queryByTestId('conversation-add-menu')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('turns composer typing into workspace search and keeps multi-file selection open', async () => {
    runtime.listProjectFiles.mockImplementation(
      async ({ query = '' }: { query?: string }) => ({
        files: query
          ? [
              { path: 'src/App.tsx', name: 'App.tsx', kind: 'file' as const },
              { path: 'src/components', name: 'components', kind: 'dir' as const },
            ]
          : [{ path: 'README.md', name: 'README.md', kind: 'file' as const }],
      }),
    );
    render(<Harness variant="empty" />);
    const input = screen.getByRole('textbox', { name: '消息' });

    fireEvent.click(screen.getByTestId('empty-add-trigger'));
    const initialMenu = await screen.findByTestId('empty-add-menu');
    expect(initialMenu.getAttribute('data-placement')).toBe('below');
    await waitFor(() =>
      expect(runtime.listProjectFiles).toHaveBeenCalledWith({
        root: 'D:\\workspace',
        query: '',
        maxEntries: 80,
      }),
    );
    expect(await within(initialMenu).findByText('README.md')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'src', selectionStart: 3 } });
    await waitFor(() =>
      expect(runtime.listProjectFiles).toHaveBeenCalledWith({
        root: 'D:\\workspace',
        query: 'src',
        maxEntries: 80,
      }),
    );

    const searchMenu = screen.getByTestId('empty-add-menu');
    expect(within(searchMenu).queryByText('规划模式')).toBeNull();
    expect(within(searchMenu).getByText('App.tsx')).toBeTruthy();
    expect(within(searchMenu).getAllByText('src')).toHaveLength(2);
    expect(within(searchMenu).getByText('components')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(actionLog.file).toHaveBeenCalledWith({
      path: 'src/App.tsx',
      name: 'App.tsx',
      kind: 'file',
    });
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByTestId('empty-add-menu')).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it('treats a typed @ token as the same action sheet as the plus trigger', async () => {
    runtime.listProjectFiles.mockImplementation(async ({ query }: { query?: string }) => ({
      files: query
        ? [{ path: 'src/App.tsx', name: 'App.tsx', kind: 'file' as const }]
        : [{ path: 'README.md', name: 'README.md', kind: 'file' as const }],
    }));
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '@', selectionStart: 1, selectionEnd: 1 } });
    fireEvent.click(screen.getByTestId('conversation-add-trigger'));

    const menu = await screen.findByTestId('conversation-add-menu');
    expect(within(menu).getByText('附加文件')).toBeTruthy();
    expect(within(menu).getByText('规划模式')).toBeTruthy();
    expect(within(menu).getByText('目标模式')).toBeTruthy();
    expect(within(menu).getByText('会议纪要')).toBeTruthy();
    expect(within(menu).getByText('联网搜索')).toBeTruthy();
    expect(within(menu).getByText('工作区文件')).toBeTruthy();
    expect(within(menu).queryByText('来源与上下文')).toBeNull();
    expect(within(menu).queryByText('上传图片')).toBeNull();
    await waitFor(() =>
      expect(runtime.listProjectFiles).toHaveBeenCalledWith({
        root: 'D:\\workspace',
        query: '',
        maxEntries: 80,
      }),
    );

    fireEvent.change(input, { target: { value: '@App', selectionStart: 4, selectionEnd: 4 } });
    await waitFor(() =>
      expect(runtime.listProjectFiles).toHaveBeenCalledWith({
        root: 'D:\\workspace',
        query: 'App',
        maxEntries: 80,
      }),
    );
    expect(within(screen.getByTestId('conversation-add-menu')).queryByText('规划模式')).toBeNull();
    expect(within(screen.getByTestId('conversation-add-menu')).getByText('App.tsx')).toBeTruthy();
  });

  it('keeps network changes open, closes after permission selection, and reports missing folders', async () => {
    const view = render(<Harness showPermissionItems />);
    const trigger = screen.getByTestId('conversation-add-trigger');
    fireEvent.click(trigger);
    let menu = await screen.findByTestId('conversation-add-menu');

    fireEvent.click(within(menu).getByRole('option', { name: /联网搜索/ }));
    expect(actionLog.network).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('conversation-add-menu')).toBeTruthy();
    expect(within(menu).getByRole('option', { name: /联网搜索/ }).getAttribute('aria-checked')).toBe(
      'false',
    );

    fireEvent.click(within(menu).getByRole('option', { name: /完全访问/ }));
    expect(actionLog.permission).toHaveBeenCalledWith('full-access');
    fireEvent.animationEnd(screen.getByTestId('conversation-add-menu'));
    expect(screen.queryByTestId('conversation-add-menu')).toBeNull();

    view.rerender(<Harness workspaceFolder="" />);
    fireEvent.click(screen.getByTestId('conversation-add-trigger'));
    menu = await screen.findByTestId('conversation-add-menu');
    expect(within(menu).getByText('未绑定项目文件夹')).toBeTruthy();
  });

  it('retains the action sheet for the exact 150ms NewMax exit animation', () => {
    vi.useFakeTimers();
    render(<Harness workspaceFolder="" />);

    fireEvent.click(screen.getByTestId('conversation-add-trigger'));
    const menu = screen.getByTestId('conversation-add-menu');
    expect(menu.getAttribute('data-motion-state')).toBe('entering');

    act(() => vi.advanceTimersByTime(NEWMAX_POPOVER_TRANSITION_MS));
    expect(menu.getAttribute('data-motion-state')).toBe('stable');

    fireEvent.click(within(menu).getByRole('option', { name: /规划模式/ }));
    expect(screen.getByTestId('conversation-add-menu').getAttribute('data-motion-state')).toBe(
      'exiting',
    );

    act(() => vi.advanceTimersByTime(NEWMAX_POPOVER_TRANSITION_MS - 1));
    expect(screen.getByTestId('conversation-add-menu')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('conversation-add-menu')).toBeNull();
  });

  it('keeps the selected action sheet content stable while the command replacement exits', () => {
    render(<Harness workspaceFolder="" rewriteValueOnPlan />);

    fireEvent.click(screen.getByTestId('conversation-add-trigger'));
    const menu = screen.getByTestId('conversation-add-menu');
    fireEvent.click(within(menu).getByRole('option', { name: /规划模式/ }));

    const exitingMenu = screen.getByTestId('conversation-add-menu');
    expect(exitingMenu.getAttribute('data-motion-state')).toBe('exiting');
    expect(within(exitingMenu).getByText('规划模式')).toBeTruthy();
    expect(within(exitingMenu).queryByText(/在工作区搜索/)).toBeNull();
  });

  it('opens and closes without transitional frames when reduced motion is enabled', () => {
    document.documentElement.setAttribute('data-reduced-motion', '');
    render(<Harness workspaceFolder="" />);

    const trigger = screen.getByTestId('conversation-add-trigger');
    fireEvent.click(trigger);
    const menu = screen.getByTestId('conversation-add-menu');
    expect(menu.getAttribute('data-motion-state')).toBe('stable');

    fireEvent.click(within(menu).getByRole('option', { name: /规划模式/ }));
    expect(screen.queryByTestId('conversation-add-menu')).toBeNull();
  });
});
