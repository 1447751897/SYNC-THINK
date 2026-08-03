/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
    expect(PHASE3_VISUAL_CASES).toHaveLength(4);
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
    const openButtons = screen.getAllByRole('button').filter((button) =>
      button.hasAttribute('aria-expanded'),
    );
    expect(openButtons.some((button) => button.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(screen.getByText('已加载较早消息 · 每页 50 条')).toBeTruthy();

    view.unmount();
    render(<Phase3VisualFixture visualCase="long-trace-closed" />);
    const closedButtons = screen.getAllByRole('button').filter((button) =>
      button.hasAttribute('aria-expanded'),
    );
    expect(closedButtons.length).toBeGreaterThan(0);
    expect(closedButtons.every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(
      true,
    );
  });

  it('renders the real diagnostics privacy ledger and live status region', () => {
    render(<Phase3VisualFixture visualCase="diagnostics" />);

    expect(screen.getByRole('main', { name: '诊断导出' })).toBeTruthy();
    const exportButton = screen.getByRole('button', { name: '导出诊断 JSON' });
    expect(exportButton.getAttribute('aria-describedby')).toContain('diagnostics-privacy');
    expect(screen.getByText('EXCLUDED')).toBeTruthy();
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
