/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { URL as FileURL } from 'node:url';
import { HostSystemAvatar } from './HostSystemAvatar.js';
import { KeepAliveLayer } from './KeepAliveLayer.js';
import { ComposerIdentity } from './compose-toolbar.js';

vi.mock('./HostSystemTurn3D.js', async () => {
  const { useEffect } = await import('react');
  return { default: function MockHostSystemTurn3D({ sequence, onReady, onComplete }: { sequence: number; onReady(): void; onComplete(): void }) {
    useEffect(onReady, [onReady]);
    return <canvas data-renderer="solid-webgl" data-sequence={sequence} onAnimationEnd={onComplete} />;
  } };
});

afterEach(() => { cleanup(); vi.useRealTimers(); document.documentElement.removeAttribute('data-reduced-motion'); });

describe('fixed host system presentation', () => {
  it('uses the supplied white portrait with no idle motion in historical rows', () => {
    const { container } = render(<HostSystemAvatar />);
    const image = screen.getByRole('img', { name: '宿主系统' });
    expect(image.getAttribute('src')).toContain('host-system.png');
    expect(container.firstElementChild?.getAttribute('data-animated')).toBe('false');
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('.shell-host-eyes')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(['thinking', 'working', 'waiting', 'happy'] as const)('maps the real %s state to CSS motion', state => {
    const { container } = render(<HostSystemAvatar state={state} />);
    expect(container.firstElementChild?.getAttribute('data-state')).toBe(state);
    expect(container.firstElementChild?.getAttribute('data-animated')).toBe('true');
    expect(container.querySelector('.shell-host-eyes[aria-hidden="true"]')).toBeTruthy();
    expect(container.querySelectorAll('.shell-host-blink')).toHaveLength(2);
  });

  it.each(['error', 'inactive', 'sleeping'] as const)('stays still in the %s state even when motion is requested', state => {
    const { container } = render(<HostSystemAvatar state={state} animate />);
    expect(container.firstElementChild?.getAttribute('data-animated')).toBe('false');
    expect(container.querySelector('.shell-host-eyes')).toBeNull();
  });

  it('keeps the name and portrait unchanged when a model label changes', () => {
    const view = render(<ComposerIdentity track="model" label="Model A" testId="identity" />);
    const source = screen.getByRole('img', { name: '宿主系统' }).getAttribute('src');
    view.rerender(<ComposerIdentity track="model" label="Model B" testId="identity" />);
    expect(screen.getByTestId('identity').textContent).toBe('宿主系统');
    expect(screen.getByRole('img', { name: '宿主系统' }).getAttribute('src')).toBe(source);
  });

  it.each(['agent', 'team'] as const)('preserves the %s identity', track => {
    render(<ComposerIdentity track={track} label="世界观设定" avatar={{ name: '世界观设定', avatar: 'data:image/png;base64,custom' }} />);
    expect(screen.getByText('世界观设定')).toBeTruthy();
    expect(screen.getByRole('img', { name: '世界观设定' }).getAttribute('src')).toBe('data:image/png;base64,custom');
    expect(screen.queryByText('宿主系统')).toBeNull();
  });

  it('respects both reduced-motion settings and keeps its styles in the canonical shell', () => {
    const css = readFileSync(new FileURL('./host-system-avatar.css', import.meta.url), 'utf8');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain(':root[data-reduced-motion]');
    expect(readFileSync(new FileURL('./shell.css', import.meta.url), 'utf8')).toContain("@import './host-system-avatar.css';");
  });
});


describe('host portrait interaction', () => {
  it('uses an on-demand solid renderer, not a CSS-rotated portrait', () => {
    const css = readFileSync(new FileURL('./host-system-avatar.css', import.meta.url), 'utf8');
    expect(css).not.toContain('@keyframes shell-host-spin');
    expect(css).not.toContain('rotateY');
    expect(css).toContain('.shell-host-3d');
    expect(css).toContain("data-renderer-ready='true'");
  });

  it('spins without changing the task state and restarts on another click', async () => {
    render(<HostSystemAvatar interactive state="working" />);
    const button = screen.getByRole('button', { name: '宿主系统，点击转一圈' });
    expect(button.getAttribute('type')).toBe('button');
    const initial = button.querySelector('.shell-host-turn');
    fireEvent.click(button);
    expect(button.getAttribute('data-spinning')).toBe('true');
    expect(button.getAttribute('data-state')).toBe('working');
    expect(button.getAttribute('data-animated')).toBe('true');
    await waitFor(() => expect(button.querySelector('canvas')?.getAttribute('data-sequence')).toBe('1'));
    const firstTurn = button.querySelector('.shell-host-turn');
    expect(firstTurn).toBe(initial);
    fireEvent.click(button);
    expect(button.querySelector('.shell-host-turn')).toBe(firstTurn);
    expect(button.querySelector('canvas')?.getAttribute('data-sequence')).toBe('2');
    expect(button.querySelectorAll('.shell-host-eyes')).toHaveLength(1);
  });

  it('finishes only the 3D turn, not a bubbling eye animation', async () => {
    render(<HostSystemAvatar interactive state="thinking" />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    const finish = (element: Element, animationName: string) => {
      const event = new Event('animationend', { bubbles: true });
      Object.defineProperty(event, 'animationName', { value: animationName });
      fireEvent(element, event);
    };
    finish(button.querySelector('.shell-host-blink')!, 'shell-host-blink');
    expect(button.getAttribute('data-spinning')).toBe('true');
    await waitFor(() => expect(button.querySelector('canvas')).toBeTruthy());
    finish(button.querySelector('canvas')!, 'solid-turn-complete');
    expect(button.getAttribute('data-spinning')).toBe('false');
    expect(button.querySelector('.shell-host-eyes')).toBeTruthy();
    expect(button.getAttribute('data-animated')).toBe('true');
  });

  it('bounds a stalled 3D turn and cleans up its timer', () => {
    vi.useFakeTimers();
    const view = render(<HostSystemAvatar interactive />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    act(() => { vi.advanceTimersByTime(1700); });
    expect(button.getAttribute('data-spinning')).toBe('false');
    fireEvent.click(button);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops motion in a hidden KeepAlive layer and resumes only the live eyes', () => {
    const face = <HostSystemAvatar interactive state="working" />;
    const view = render(<KeepAliveLayer active>{face}</KeepAliveLayer>);
    fireEvent.click(screen.getByRole('button'));
    view.rerender(<KeepAliveLayer active={false}>{face}</KeepAliveLayer>);
    const button = screen.getByRole('button', { hidden: true });
    expect(button.getAttribute('data-animated')).toBe('false');
    expect(button.getAttribute('data-spinning')).toBe('false');
    expect(button.querySelector('.shell-host-eyes')).toBeNull();
    view.rerender(<KeepAliveLayer active>{face}</KeepAliveLayer>);
    expect(button.getAttribute('data-animated')).toBe('true');
    expect(button.getAttribute('data-spinning')).toBe('false');
    expect(button.querySelector('.shell-host-eyes')).toBeTruthy();
  });

  it('cancels the GPU turn when reduced motion is enabled', async () => {
    render(<HostSystemAvatar interactive state="working" />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => expect(button.querySelector('canvas')).toBeTruthy());
    act(() => document.documentElement.setAttribute('data-reduced-motion', 'true'));
    await waitFor(() => expect(button.getAttribute('data-spinning')).toBe('false'));
    expect(button.querySelector('canvas')).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('data-spinning')).toBe('false');
  });

  it('keeps mask ids independent across multiple live host portraits', () => {
    const { container } = render(<><HostSystemAvatar state="thinking" /><HostSystemAvatar state="working" /></>);
    const ids = [...container.querySelectorAll('mask, filter')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const image of container.querySelectorAll('svg image')) {
      const maskId = image.getAttribute('mask')!.slice(5, -1);
      expect(container.querySelector('[id="' + maskId + '"]')).toBeTruthy();
    }
  });
});
