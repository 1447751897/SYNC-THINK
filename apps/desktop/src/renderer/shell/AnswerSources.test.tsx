/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnswerSources } from './AnswerSources.js';
import type { AnswerSource } from './answer-sources.js';

const shellCss = readFileSync(resolve(process.cwd(), 'src/renderer/shell/shell.css'), 'utf8');

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

  it('expands sources inside the message flow with title and host on one row', () => {
    expect(shellCss).toMatch(
      /\.shell-msg-sources__reveal\s*\{[\s\S]*?grid-template-rows:\s*0fr;[\s\S]*?duration:\s*300ms/,
    );
    expect(shellCss).toMatch(
      /\.shell-msg-sources__reveal\.is-open\s*\{[\s\S]*?grid-template-rows:\s*1fr;[\s\S]*?opacity:\s*1/,
    );
    expect(shellCss).toMatch(/\.shell-msg-sources__panel\s*\{[\s\S]*?width:\s*min\(380px,/);
    expect(shellCss).toMatch(
      /\.shell-msg-sources__item-copy\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/,
    );
  });
});
