/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { URL as FileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent.js';
import { StreamingResponse } from './StreamingResponse.js';

const workbenchCss = readFileSync(new FileURL('./workbench-design.css', import.meta.url), 'utf8');
const responseCss = readFileSync(new FileURL('./streaming-response.css', import.meta.url), 'utf8');
const rules = (css: string) => Array.from(
  css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
  match => ({ selector: match[1]!.trim(), body: match[2]! }),
);

function backgroundRules(element: Element, css: string) {
  return rules(css).filter(rule => /\bbackground(?:-color)?\s*:/.test(rule.body) && element.matches(rule.selector));
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.shellDesign;
  delete document.documentElement.dataset.imageTheme;
  document.documentElement.classList.remove('dark');
});

describe('plain response wallpaper surfaces', () => {
  it.each(['light', 'dark'] as const)('does not paint a rectangle behind plain model text in the %s wallpaper theme', theme => {
    document.documentElement.dataset.shellDesign = 'agent';
    document.documentElement.dataset.imageTheme = 'active';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    render(<div className="shell-normal-workspace">
      <StreamingResponse status="complete" variant="plain">
        <MarkdownContent text={'本次回顾属于 **部分完成**。\n\n- **已完成**：工作区检查。\n- **未完成**：部分历史读取。\n\n最终结果保留在这里。'} />
      </StreamingResponse>
      <StreamingResponse status="complete" variant="bubble">智能体气泡</StreamingResponse>
    </div>);
    const responses = screen.getAllByTestId('streaming-response');
    const plain = responses[0]!.querySelector('.shell-response__content')!;
    const bubble = responses[1]!.querySelector('.shell-response__content')!;
    const wallpaperAnswerRules = rules(workbenchCss).filter(rule =>
      rule.selector.includes("[data-image-theme='active']") &&
      rule.selector.includes('.shell-response__content') && /\bbackground\s*:/.test(rule.body));
    expect(wallpaperAnswerRules).toHaveLength(1);
    expect(wallpaperAnswerRules[0]!.selector).toContain("[data-variant='bubble']");
    expect(responses[0]!.getAttribute('data-variant')).toBe('plain');
    expect(bubble.parentElement!.getAttribute('data-variant')).toBe('bubble');
    expect(plain.querySelector('strong')?.textContent).toBe('部分完成');
    expect(plain.querySelectorAll('ul > li')).toHaveLength(2);
    expect(plain.querySelectorAll('p')).toHaveLength(2);
    expect(backgroundRules(plain, responseCss).every(rule => /background:\s*transparent\s*;/.test(rule.body))).toBe(true);
  });

  it('explicitly keeps the plain answer surface transparent without changing rich child surfaces', () => {
    render(<StreamingResponse status="complete" variant="plain">
      <div className="shell-md"><p>正文</p><pre className="shell-md-code">代码</pre></div>
    </StreamingResponse>);
    const answer = screen.getByTestId('streaming-response').querySelector('.shell-response__content')!;
    const reset = backgroundRules(answer, responseCss);
    expect(reset).toHaveLength(1);
    expect(reset[0]!.body).toContain('background: transparent;');
    expect(reset[0]!.body).toContain('box-shadow: none;');
    expect(reset[0]!.body).toContain('backdrop-filter: none;');
    expect(backgroundRules(answer.querySelector('pre')!, responseCss)).toEqual([]);
  });
});
