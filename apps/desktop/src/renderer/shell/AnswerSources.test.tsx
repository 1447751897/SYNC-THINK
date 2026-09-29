/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnswerSources } from './AnswerSources.js';
import type { AnswerSource } from './answer-sources.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('AnswerSources', () => {
  it('shows a connector stack and opens external or workspace sources', () => {
    const openExternalUrl = vi.fn().mockResolvedValue({ opened: true, error: null });
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { openExternalUrl } },
    });
    const onOpenFile = vi.fn();
    const sources: AnswerSource[] = [
      {
        key: 'external:youtube',
        kind: 'external',
        url: 'https://youtube.com/watch?v=demo',
        host: 'youtube.com',
        label: '视频来源',
      },
      {
        key: 'file:src/app.ts',
        kind: 'file',
        path: 'src/app.ts',
        label: 'app.ts',
        action: 'read',
      },
    ];

    const { container } = render(<AnswerSources sources={sources} onOpenFile={onOpenFile} />);

    expect(screen.getByText('2 个来源')).toBeTruthy();
    expect(container.querySelector('.shell-msg-sources__stack img')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: '查看 2 个来源' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '打开来源 视频来源' }));
    fireEvent.click(screen.getByRole('button', { name: '打开来源 app.ts' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://youtube.com/watch?v=demo');
    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts');
  });

  it('keeps a closed source list out of keyboard navigation', () => {
    render(
      <AnswerSources
        sources={[
          {
            key: 'web',
            kind: 'external',
            url: 'https://example.test/docs',
            host: 'example.test',
            label: '文档',
            origin: 'citation',
          },
        ]}
      />,
    );
    const toggle = screen.getByRole('button', { name: '查看 1 个来源' });
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.querySelector('button')?.tabIndex).toBe(-1);
    fireEvent.click(toggle);
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('list', { name: '引用来源' })).toBeTruthy();
    expect(panel.querySelector('button')?.tabIndex).toBe(0);
  });
});
