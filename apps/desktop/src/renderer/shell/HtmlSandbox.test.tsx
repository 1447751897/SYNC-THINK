/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HtmlSandbox } from './HtmlSandbox.js';

const executeJavaScript = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('HtmlSandbox', () => {
  it('uses NewMax fixed iframe srcDoc instead of guest measurement', () => {
    render(<HtmlSandbox code={'<main style="height:412px">content</main>'} />);

    const content = screen.getByTestId('html-sandbox-content');
    const iframe = content.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('title')).toBe('HTML 预览');
    expect(executeJavaScript).not.toHaveBeenCalled();
    expect(screen.queryByTestId('html-sandbox')).toBeNull();
    expect(screen.queryByText('UI 设计资源格式无效，请让模型重新生成')).toBeNull();
  });

  it('previews unfinished HTML instead of showing a format-invalid card', () => {
    render(<HtmlSandbox code={'<main><section>unfinished'} />);

    const iframe = screen.getByTestId('html-sandbox-content').querySelector('iframe');
    expect(iframe?.getAttribute('srcdoc')).toContain('unfinished');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the source and preview shell available for fenced HTML', () => {
    render(<HtmlSandbox code={'<main>content</main>'} />);

    expect(screen.getByTestId('html-sandbox-content')).toBeTruthy();
    expect(screen.getByRole('button', { name: '源码' })).toBeTruthy();
    expect(screen.getByText('HTML')).toBeTruthy();
  });
});
