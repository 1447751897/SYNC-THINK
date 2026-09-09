/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { getExportSvg, renderSvgInShadowHost } from './mermaid-render.js';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
});

describe('Mermaid image export', () => {
  it('makes HTML labels and theme colors self-contained for image previews and PNG exports', () => {
    document.documentElement.style.setProperty('--color-text', '#202020');
    document.documentElement.style.setProperty('--color-chat', '#f8f8f8');
    document.documentElement.style.setProperty('--color-border-strong', '#606060');
    const container = document.createElement('div');
    document.body.append(container);
    renderSvgInShadowHost(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120">
      <g class="node"><rect width="200" height="80" />
      <g class="label"><foreignObject width="180" height="50">
        <div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">First line<br/>Second line</span></div>
      </foreignObject></g></g></svg>`,
      container,
    );

    const exported = getExportSvg(container);
    expect(exported).toBeTruthy();
    const svg = new DOMParser().parseFromString(exported!.svg, 'image/svg+xml');
    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.querySelector('foreignObject')).toBeNull();
    expect(svg.querySelector('text')?.textContent).toContain('First line');
    expect(svg.querySelector('text')?.textContent).toContain('Second line');
    expect(svg.documentElement.style.getPropertyValue('--color-text')).toBe('#202020');
    expect(svg.documentElement.getAttribute('width')).toBe(String(exported!.width));
    expect(svg.documentElement.getAttribute('height')).toBe(String(exported!.height));
  });
});
