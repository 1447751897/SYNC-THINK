import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppShell, projectAppShellReadiness } from '../src/components/AppShell.js';

describe('AppShell — Locked IA', () => {
  it('renders left navigation, center conversation, and a closable right trace', () => {
    render(
      <AppShell
        leftNav={<div data-testid="nav">nav</div>}
        conversation={<div data-testid="conv">conv</div>}
        compose={<div data-testid="compose">compose</div>}
        trace={<div data-testid="trace">trace</div>}
        contextRail={<div data-testid="rail">rail</div>}
      />,
    );
    expect(screen.getByTestId('nav')).toBeTruthy();
    expect(screen.getByTestId('conv')).toBeTruthy();
    expect(screen.getByTestId('compose')).toBeTruthy();
    expect(screen.getByTestId('trace')).toBeTruthy();
    expect(screen.getByTestId('rail')).toBeTruthy();
    expect(screen.getByRole('log')).toBeTruthy();
  });

  it('collapses trace on toggle but never drops the trace marker', () => {
    render(<AppShell trace={<div>body</div>} />);
    const toggle = screen.getByTestId('trace-toggle');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('title') || '').toMatch(/展开运行轨迹|Restore trace/);
    expect(toggle.textContent).toBe('');
    // After collapsing, the trace-body is gone but the trace rail persists.
    expect(document.querySelector('.st-app-shell__trace-body')).toBeNull();
    expect(
      document.querySelector(':root [aria-label="运行轨迹"]') ||
        document.querySelector(':root [aria-label="Run trace"]'),
    ).toBeTruthy();
  });

  it('removes an explicit theme attribute when following the system theme', () => {
    document.documentElement.setAttribute('data-st-theme', 'dark');
    render(<AppShell theme="system" />);
    expect(document.documentElement.hasAttribute('data-st-theme')).toBe(false);
  });

  it('toggles trace on Ctrl+Backslash keyboard shortcut', () => {
    render(<AppShell trace={<div data-testid="trace-body">body</div>} />);
    const toggle = screen.getByTestId('trace-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('shell-shortcut-hint')).toBeTruthy();
  });
  it('notifies onTraceCollapsedChange when controlled (workspace preference)', () => {
    const seen: boolean[] = [];
    render(
      <AppShell
        trace={<div>body</div>}
        traceCollapsed={false}
        onTraceCollapsedChange={(c) => {
          seen.push(c);
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('trace-toggle'));
    expect(seen).toEqual([true]);
  });

  it('shows Chinese trace title and collapsed hint when folded', () => {
    render(<AppShell trace={<div data-testid="trace-body">body</div>} />);
    expect(screen.getByTestId('shell-trace-title').textContent).toMatch(/运行轨迹/);
    expect(screen.getByTestId('trace-toggle').getAttribute('aria-label')).toMatch(/折叠运行轨迹/);
    fireEvent.click(screen.getByTestId('trace-toggle'));
    expect(screen.getByTestId('shell-trace-collapsed-hint').textContent).toMatch(/已折叠|不暂停/);
    expect(screen.queryByTestId('trace-body')).toBeNull();
  });

  it('allows a product composition to give the right rail a beginner-facing title', () => {
    render(<AppShell trace={<div>body</div>} traceTitle="任务进度" traceAriaLabel="任务进度" />);
    expect(screen.getByTestId('shell-trace-title').textContent).toBe('任务进度');
    expect(document.querySelector('aside[aria-label="任务进度"]')).toBeTruthy();
  });

  it('exposes main conversation landmark for skip navigation', () => {
    render(
      <AppShell
        conversation={<div>conv</div>}
        compose={<div>compose</div>}
        trace={<div>trace</div>}
      />,
    );
    const main = document.getElementById('st-main-conversation');
    expect(main).toBeTruthy();
    expect(main?.getAttribute('role')).toBe('log');
  });
});

describe('AppShell layout readiness', () => {
  it('shows ready strip when full IA slots present', () => {
    render(
      <AppShell
        leftNav={<div>nav</div>}
        conversation={<div>conv</div>}
        compose={<div>compose</div>}
        trace={<div>trace</div>}
        contextRail={<div>rail</div>}
        theme="dark"
      />,
    );
    expect(screen.getByTestId('app-shell-readiness').getAttribute('data-level')).toBe('ready');
    expect(screen.getByTestId('app-shell-readiness-badge').textContent).toBe('布局就绪');
    expect(screen.getByTestId('shell-check-nav').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('shell-check-conversation').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('shell-check-compose').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('shell-check-continuum').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('shell-check-trace').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('shell-check-theme').textContent).toMatch(/深色/);
    expect(screen.getByTestId('app-shell').getAttribute('data-level')).toBe('ready');
  });

  it('marks compact when trace collapsed', () => {
    render(
      <AppShell
        leftNav={<div>nav</div>}
        conversation={<div>conv</div>}
        compose={<div>compose</div>}
        trace={<div>trace</div>}
        contextRail={<div>rail</div>}
        theme="system"
        traceCollapsedDefault
      />,
    );
    expect(screen.getByTestId('app-shell-readiness').getAttribute('data-level')).toBe('compact');
    expect(screen.getByTestId('app-shell-readiness-badge').textContent).toBe('轨迹已折');
    expect(screen.getByTestId('shell-check-trace').textContent).toMatch(/已折/);
  });

  it('marks partial when slots missing', () => {
    render(<AppShell conversation={<div>only chat</div>} theme="light" />);
    expect(screen.getByTestId('app-shell-readiness').getAttribute('data-level')).toBe('partial');
    expect(screen.getByTestId('app-shell-readiness-badge').textContent).toBe('布局不全');
    expect(screen.getByTestId('shell-check-nav').getAttribute('data-ok')).toBe('0');
  });

  it('can hide readiness strip', () => {
    render(
      <AppShell
        leftNav={<div>nav</div>}
        conversation={<div>conv</div>}
        compose={<div>c</div>}
        trace={<div>t</div>}
        hideReadiness
      />,
    );
    expect(screen.queryByTestId('app-shell-readiness')).toBeNull();
  });
});

describe('projectAppShellReadiness', () => {
  it('projects empty shell', () => {
    const r = projectAppShellReadiness({});
    expect(r.level).toBe('empty');
    expect(r.badge).toBe('空壳');
  });

  it('projects ready full layout', () => {
    const r = projectAppShellReadiness({
      hasLeftNav: true,
      hasConversation: true,
      hasCompose: true,
      hasTrace: true,
      hasContextRail: true,
      theme: 'dark',
    });
    expect(r.level).toBe('ready');
    expect(r.themeLabel).toBe('深色');
  });

  it('projects compact when collapsed', () => {
    const r = projectAppShellReadiness({
      hasLeftNav: true,
      hasConversation: true,
      hasCompose: true,
      hasTrace: true,
      traceCollapsed: true,
      theme: 'system',
    });
    expect(r.level).toBe('compact');
  });
});
