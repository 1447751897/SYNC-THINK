/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  PHASE3_VISUAL_CASES,
  Phase3VisualFixture,
  resolvePhase3VisualCase,
} from './Phase3VisualFixture.js';

const SHELL_CSS = readFileSync(resolve(process.cwd(), 'src/renderer/shell/shell.css'), 'utf8');
const TOKENS_CSS = readFileSync(resolve(process.cwd(), 'src/renderer/shell/tokens.css'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = SHELL_CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

vi.mock('./ModelSettings.js', () => ({ ModelSettings: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: {
        getDataStorageStats: vi.fn().mockResolvedValue({
          success: true,
          dataDirectory: 'C:\\Users\\fixture\\SYNC-THINK',
          dbSizeBytes: 12 * 1024 * 1024,
          conversationFilesSizeBytes: 3 * 1024 * 1024,
          conversationCount: 12,
          messageCount: 48,
        }),
        listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [] }),
        getSettings: vi.fn().mockResolvedValue({ settings: {} }),
        setSetting: vi.fn(),
        exportData: vi.fn(),
        importData: vi.fn(),
        backupData: vi.fn(),
        compactDataStorage: vi.fn(),
        cleanConversations: vi.fn(),
        cleanEmptyAttachmentDirectories: vi.fn(),
        openDataDirectory: vi.fn(),
        pickFolder: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Phase3VisualFixture routing', () => {
  it('accepts only the deterministic visual cases', () => {
    expect(resolvePhase3VisualCase('?phase3-visual=welcome')).toBe('welcome');
    expect(resolvePhase3VisualCase('?phase3-visual=long-trace-open&theme=dark')).toBe(
      'long-trace-open',
    );
    expect(resolvePhase3VisualCase('?phase3-visual=unknown')).toBeUndefined();
    expect(resolvePhase3VisualCase('')).toBeUndefined();
    expect(resolvePhase3VisualCase('?phase3-visual=connection-and-code')).toBe(
      'connection-and-code',
    );
    expect(resolvePhase3VisualCase('?phase3-visual=streaming-follow')).toBe('streaming-follow');
    expect(resolvePhase3VisualCase('?phase3-visual=streaming-text')).toBe('streaming-text');
    expect(resolvePhase3VisualCase('?phase3-visual=composer-context')).toBe('composer-context');
    expect(resolvePhase3VisualCase('?phase3-visual=composer-slash-open')).toBe(
      'composer-slash-open',
    );
    expect(resolvePhase3VisualCase('?phase3-visual=workspace-file')).toBe('workspace-file');
    expect(resolvePhase3VisualCase('?phase3-visual=execution-auto-disclosure')).toBe(
      'execution-auto-disclosure',
    );
    expect(resolvePhase3VisualCase('?phase3-visual=inline-process-hierarchy')).toBe(
      'inline-process-hierarchy',
    );
    expect(resolvePhase3VisualCase('?phase3-visual=task-status-panel')).toBe('task-status-panel');
    expect(resolvePhase3VisualCase('?phase3-visual=sliding-tabs')).toBe('sliding-tabs');
    expect(resolvePhase3VisualCase('?phase3-visual=kernel-update-panel')).toBe(
      'kernel-update-panel',
    );
    expect(resolvePhase3VisualCase('?phase3-visual=connection-settings')).toBe(
      'connection-settings',
    );
    expect(PHASE3_VISUAL_CASES).toHaveLength(16);
  });

  it('renders the deterministic 656px Composer slash-menu state', () => {
    render(<Phase3VisualFixture visualCase="composer-slash-open" />);

    const composer = screen.getByTestId('composer-slash-open');
    const input = screen.getByRole('textbox', { name: '斜杠命令输入' }) as HTMLTextAreaElement;
    const menu = screen.getByRole('listbox', { name: '斜杠命令视觉验收' });
    const options = within(menu).getAllByRole('option');

    expect(composer.style.width).toBe('656px');
    expect(composer.style.maxWidth).toBe('100%');
    expect(composer.parentElement?.style.maxWidth).toBe('calc(100% - 48px)');
    expect(composer.getAttribute('data-layout')).toBe('tall');
    expect(input.value).toBe('/');
    expect(input.rows).toBe(2);
    expect(menu.parentElement).toBe(composer);
    expect(menu.classList.contains('shell-empty-slash-pop')).toBe(true);
    expect(options).toHaveLength(5);
    expect(within(menu).getByRole('option', { name: /\/goal.*目标模式/ })).toBeTruthy();
    expect(options.every((option) => option.classList.contains('shell-slash-pop__item'))).toBe(
      true,
    );
    expect(options.every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(within(menu).getByTestId('composer-menu-highlight').style.opacity).toBe('0');
    expect(within(menu).getByText('↑↓ 选择 · Enter 确认 · Esc 关闭')).toBeTruthy();

    const anchoredMenu = cssRule('.shell-mention-pop.shell-slash-pop.shell-empty-slash-pop');
    const menuSurface = cssRule('.shell-mention-pop.shell-slash-pop');
    const menuItem = cssRule('.shell-slash-pop__item');
    const voiceControl = cssRule('.shell-compose__voice');
    const sendControl = cssRule('.shell-compose__send');
    expect(anchoredMenu).toContain('right: -1px;');
    expect(anchoredMenu).toContain('left: -1px;');
    expect(anchoredMenu).toContain('overflow-x: hidden;');
    expect(menuSurface).toContain('border-radius: var(--composer-menu-radius);');
    expect(menuSurface).toContain('padding: var(--composer-menu-padding);');
    expect(menuItem).toContain('height: var(--composer-menu-row-height);');
    expect(menuItem).toContain('min-height: var(--composer-menu-row-height);');
    expect(voiceControl).toContain('margin-left: auto;');
    expect(sendControl).toContain('margin-left: 0;');
    expect(TOKENS_CSS).toContain('--composer-max-width: 744px;');
    expect(TOKENS_CSS).toContain('--composer-text-min-height-empty: 72px;');
    expect(TOKENS_CSS).toContain('--composer-menu-radius: 18px;');
    expect(TOKENS_CSS).toContain('--composer-menu-padding: 4px;');
    expect(TOKENS_CSS).toContain('--composer-menu-row-height: 32px;');
  });

  it('renders the production connection settings for interactive visual QA', async () => {
    render(<Phase3VisualFixture visualCase="connection-settings" />);
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开 抖音' }));

    expect(await screen.findByRole('heading', { name: '抖音' })).toBeTruthy();
    expect(screen.getByText('fetch_hot_search_list')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    fireEvent.click(screen.getByRole('tab', { name: '机器人对话' }));
    const botPane = await screen.findByRole('region', { name: '机器人对话设置' });
    expect(within(botPane).getByRole('heading', { name: 'Telegram' })).toBeTruthy();
    expect(within(botPane).getByText('已连接')).toBeTruthy();
  });

  it('switches the measured sliding tab fixture', () => {
    render(<Phase3VisualFixture visualCase="sliding-tabs" />);

    const debugTab = screen.getByRole('tab', { name: '调试与排查' });
    expect(screen.getByTestId('sliding-tabs-panel').textContent).toContain('规划任务');
    fireEvent.click(debugTab);
    expect(debugTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('sliding-tabs-panel').textContent).toContain('调试与排查');
  });

  it('renders the current unnumbered process hierarchy with the final answer outside', () => {
    render(<Phase3VisualFixture visualCase="inline-process-hierarchy" />);

    const panel = screen.getByTestId('process-panel');
    expect(within(panel).getByText(/我先核对/)).toBeTruthy();
    expect(within(panel).getAllByTestId('inline-process-tool')).toHaveLength(2);
    expect(within(panel).queryByTestId('process-entry-index')).toBeNull();
    expect(within(panel).queryByTestId('inline-process-fixture-final')).toBeNull();
    expect(screen.getByTestId('inline-process-fixture-final')).toBeTruthy();
    expect(panel.lastElementChild).toBe(screen.getByTestId('process-panel-activity'));
    expect(screen.getByTestId('loading-pixel-grid').children).toHaveLength(9);
    expect(document.querySelector('[data-source-connector="youtube"] img')).toBeTruthy();
    expect(screen.getByText('3 个来源')).toBeTruthy();
  });
});

describe('Phase3VisualFixture accessibility', () => {
  it('renders the real first-launch guide with named actions', () => {
    render(<Phase3VisualFixture visualCase="welcome" />);

    expect(screen.getByRole('main', { name: '首次启动引导' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '三步开始第一项任务' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开工作区' })).toBeTruthy();
    expect(screen.getByText('当前步骤')).toBeTruthy();
  });

  it('keeps trace disclosure state explicit for open and closed evidence', () => {
    const view = render(<Phase3VisualFixture visualCase="long-trace-open" />);
    const outerToggle = screen.getByRole('button', {
      name: /^过程 · 18秒$/,
    });
    expect(outerToggle.getAttribute('aria-expanded')).toBe('true');
    const timeline = screen.getByTestId('execution-timeline');
    const timelineItems = Array.from(
      timeline.querySelectorAll(
        '[data-testid="execution-commentary-item"], [data-testid="execution-tools-item"]',
      ),
    );
    expect(timelineItems.map((item) => item.getAttribute('data-testid'))).toEqual([
      'execution-commentary-item',
      'execution-tools-item',
      'execution-commentary-item',
      'execution-tools-item',
    ]);
    expect(timeline.querySelectorAll('time')).toHaveLength(0);

    const firstToolsToggle = screen.getByRole('button', { name: /调用了 2 个工具/ });
    const secondToolsToggle = screen.getByRole('button', { name: /调用了 1 个工具/ });
    expect(firstToolsToggle.getAttribute('aria-expanded')).toBe('false');
    expect(secondToolsToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /读取界面入口/ })).toBeNull();

    fireEvent.click(firstToolsToggle);

    expect(firstToolsToggle.getAttribute('aria-expanded')).toBe('true');
    expect(timeline.querySelectorAll('time')).toHaveLength(0);
    const firstTool = screen.getByRole('button', { name: /读取界面入口/ });
    const secondTool = screen.getByRole('button', { name: /更新首次启动引导/ });
    expect(firstTool.getAttribute('aria-expanded')).toBe('false');
    expect(secondTool.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(firstTool);

    expect(firstTool.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('已读取 214 行，定位欢迎页与对话区入口。')).toBeTruthy();
    expect(secondTool.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('先核对任务的持久化终态').tagName).toBe('STRONG');
    const expandedBody = document.querySelector('.shell-process-group__body');
    expect(expandedBody?.firstElementChild).toBe(timeline);
    expect(expandedBody?.lastElementChild).toBe(timeline);
    expect(screen.getByText('已加载较早消息 · 每页 50 条')).toBeTruthy();

    view.unmount();
    render(<Phase3VisualFixture visualCase="long-trace-closed" />);
    const closedToggle = screen.getByRole('button', {
      name: /^过程 · 18秒$/,
    });
    expect(closedToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('execution-timeline')).toBeNull();
    expect(screen.queryByTestId('execution-commentary-item')).toBeNull();
  });

  it('follows thinking, active tools, continued thinking and final-answer disclosure states', () => {
    render(<Phase3VisualFixture visualCase="execution-auto-disclosure" />);

    const outerToggle = screen.getByRole('button', { name: /^过程/ });
    expect(outerToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('先检查项目配置，再运行相关测试。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '工具运行' }));
    expect(outerToggle.getAttribute('aria-expanded')).toBe('true');
    const batchToggle = screen.getByRole('button', { name: /调用了 2 个工具/ });
    expect(batchToggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen
        .getByRole('button', { name: /读取配置 · package\.json/ })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: /运行测试 · pnpm test/ }).getAttribute('aria-expanded'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '工具完成' }));
    expect(outerToggle.getAttribute('aria-expanded')).toBe('true');
    expect(batchToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('工具批次已经完成，继续整理最终结论。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /读取配置 · package\.json/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '最终回答' }));
    expect(outerToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('execution-timeline')).toBeNull();
    expect(screen.getByText('验证完成，最终回答已经开始输出。')).toBeTruthy();
  });

  it('renders the NewMax data layout with live storage status and enabled migration actions', async () => {
    render(<Phase3VisualFixture visualCase="diagnostics" />);

    expect(screen.getByRole('main', { name: '诊断导出' })).toBeTruthy();
    const exportButton = screen.getByRole('button', { name: '导出数据' });
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('region', { name: '数据迁移' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '存储管理' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '清空本机数据' })).toBeTruthy();
    expect(screen.getByText('数据库大小')).toBeTruthy();
    expect(await screen.findByText('12.0 MB')).toBeTruthy();
  });

  it('renders reconnect/fallback notices and an unclipped short text block', () => {
    render(<Phase3VisualFixture visualCase="connection-and-code" />);

    expect(screen.getByText('正在重新连接 4/5')).toBeTruthy();
    expect(screen.getByText('正在切换备用模型：luna → gpt-5.6-sol')).toBeTruthy();
    expect(screen.getByText(/SHORT_TEXT_BLOCK_END/)).toBeTruthy();
    const code = document.querySelector('.shell-md-code');
    expect(code?.classList.contains('is-expandable')).toBe(false);
    expect(code?.querySelector('.shell-md-code__collapse')).toBeNull();
  });

  it('renders a complete context window and exposes compression details', () => {
    render(<Phase3VisualFixture visualCase="composer-context" />);

    expect(screen.getByRole('main', { name: '输入区与对话总上下文' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '任务输入' })).toBeTruthy();
    expect(screen.getByText('172,340 / 400,000')).toBeTruthy();
    expect(screen.getByText('246,780 Token')).toBeTruthy();

    const contextRing = screen.getByTestId('context-ring');
    expect(contextRing.getAttribute('aria-label')).toBe('上下文 172.3k / 400k（约 43%）');
    fireEvent.click(contextRing);

    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.getByText('当前上下文窗口')).toBeTruthy();
    expect(screen.getByText('当前模型实际可见的完整上下文窗口')).toBeTruthy();
    expect(screen.getByText('达到 70% 时，在发送下一条消息前自动压缩')).toBeTruthy();
    expect(screen.getByTestId('context-used-value').textContent).toContain('172.3k');
    expect(screen.getByTestId('context-compact-distance').textContent).toBe('107.7k');
    expect(screen.getByTestId('context-section-summary').textContent).toContain('28.4k');
    expect(screen.getByText('累计 Token 消耗')).toBeTruthy();
    expect(screen.getByText('246.8k')).toBeTruthy();
    expect(screen.getByTestId('context-compacted-at').textContent).not.toBe('尚未发生');
  });
});
