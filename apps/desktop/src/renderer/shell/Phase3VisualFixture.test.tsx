/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  PHASE3_VISUAL_CASES,
  Phase3VisualFixture,
  resolvePhase3VisualCase,
} from './Phase3VisualFixture.js';

vi.mock('./ModelSettings.js', () => ({ ModelSettings: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: {
        exportDiagnostics: vi.fn(),
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
    expect(resolvePhase3VisualCase('?phase3-visual=composer-context')).toBe('composer-context');
    expect(resolvePhase3VisualCase('?phase3-visual=workspace-file')).toBe('workspace-file');
    expect(resolvePhase3VisualCase('?phase3-visual=execution-auto-disclosure')).toBe(
      'execution-auto-disclosure',
    );
    expect(PHASE3_VISUAL_CASES).toHaveLength(9);
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
      name: /^执行过程 · 18秒$/,
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
      name: /^执行过程 · 18秒$/,
    });
    expect(closedToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('execution-timeline')).toBeNull();
    expect(screen.queryByTestId('execution-commentary-item')).toBeNull();
  });

  it('follows thinking, active tools, continued thinking and final-answer disclosure states', () => {
    render(<Phase3VisualFixture visualCase="execution-auto-disclosure" />);

    const outerToggle = screen.getByRole('button', { name: /^执行过程/ });
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

  it('renders the real diagnostics privacy ledger and live status region', () => {
    render(<Phase3VisualFixture visualCase="diagnostics" />);

    expect(screen.getByRole('main', { name: '诊断导出' })).toBeTruthy();
    const exportButton = screen.getByRole('button', { name: '导出诊断 JSON' });
    expect(exportButton.getAttribute('aria-describedby')).toContain('diagnostics-privacy');
    expect(screen.getByText('EXCLUDED')).toBeTruthy();
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
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
