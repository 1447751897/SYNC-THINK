/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildVisualizationDocumentHtml, VISUALIZATION_CSP } from './ui-kit.js';

function policyFor(source: string): string {
  const document = new DOMParser().parseFromString(buildVisualizationDocumentHtml(source), 'text/html');
  return document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!;
}

function directive(policy: string, name: string): string {
  return policy.split(';').map(value => value.trim()).find(value => value.startsWith(name + ' '))!;
}

afterEach(() => vi.unstubAllGlobals());

describe('visualization media policy', () => {
  it('supplies responsive native video sizing before the authored page styles', () => {
    const html = buildVisualizationDocumentHtml('<html><head><style id="authored">video{border-radius:12px}</style></head><body><video controls src="https://cdn.example/film.mp4"></video></body></html>');
    expect(html).toContain(':where(video[controls]) { display: block; width: 100%; max-width: 100%; height: auto; aspect-ratio: auto 16 / 9; object-fit: contain; }');
    expect(html.indexOf(':where(video[controls])')).toBeLessThan(html.indexOf('id="authored"'));
    expect(html).toContain('video{border-radius:12px}');
  });

  it('allows exactly the declared local MP4 and its poster in the chat guest', () => {
    const policy = policyFor('<video controls poster="http://127.0.0.1:4174/stills/scene-09.jpg"><source src="http://127.0.0.1:4174/film.mp4" type="video/mp4"></video>');
    expect(directive(policy, 'media-src')).toBe('media-src data: blob: http://127.0.0.1:4174/film.mp4');
    expect(directive(policy, 'img-src')).toBe('img-src data: blob: http://127.0.0.1:4174/stills/scene-09.jpg');
    expect(directive(policy, 'connect-src')).toBe("connect-src 'none'");
    expect(directive(policy, 'script-src')).toBe("script-src 'unsafe-inline' blob:");
    expect(directive(policy, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'");
    expect(policy).not.toContain('http://127.0.0.1:4174;');
  });

  it('supports audio, video source alternatives and tracks without opening unrelated images', () => {
    const policy = policyFor('<audio src="https://cdn.example/audio.mp3"></audio><video src="https://cdn.example/video.mp4"><source src="https://cdn.example/alt.webm"><track src="https://cdn.example/captions.vtt"></video><img src="https://other.example/tracker.png"><source src="https://other.example/orphan.mp4">');
    expect(directive(policy, 'media-src')).toContain('https://cdn.example/audio.mp3');
    expect(directive(policy, 'media-src')).toContain('https://cdn.example/video.mp4');
    expect(directive(policy, 'media-src')).toContain('https://cdn.example/alt.webm');
    expect(directive(policy, 'media-src')).toContain('https://cdn.example/captions.vtt');
    expect(policy).not.toContain('other.example');
    expect(directive(policy, 'img-src')).toBe('img-src data: blob:');
  });

  it('normalizes URL sources, deduplicates them and leaves signed query strings out of the policy', () => {
    const policy = policyFor('<video src="https://CDN.example:443/a%20b.mp4?token=SECRET&amp;v=2#fragment"><source src="https://cdn.example/a%20b.mp4"></video>');
    expect(directive(policy, 'media-src')).toBe('media-src data: blob: https://cdn.example/a%20b.mp4');
    expect(policy).not.toContain('SECRET');
  });

  it.each([
    'file:///C:/private/film.mp4', 'javascript:alert(1)', 'ftp://host/film.mp4',
    'https://name:password@cdn.example/film.mp4', 'https://cdn.example/clip;object-src*',
    'https://bad;host/clip.mp4', 'https://*.example/clip.mp4', 'http://127.0.0.1:4174/',
    'film.mp4', '/film.mp4', '//cdn.example/film.mp4',
  ])('does not grant a policy exception for %s', source => {
    expect(policyFor(`<video src="${source}"></video>`)).toBe(VISUALIZATION_CSP);
  });

  it('ignores media-looking strings in scripts, comments and inert templates', () => {
    expect(policyFor(`<script>const text='<video src="https://cdn.example/hidden.mp4">';</script><!-- <video src="https://cdn.example/comment.mp4"> --><template><video src="https://cdn.example/inert.mp4"></video></template>`)).toBe(VISUALIZATION_CSP);
  });

  it('keeps the existing policy for documents without network media', () => {
    expect(policyFor('<main>Chart</main><video src="data:video/mp4;base64,AAAA"></video>')).toBe(VISUALIZATION_CSP);
  });

  it('keeps the offline policy when an HTML parser is not available', () => {
    vi.stubGlobal('DOMParser', undefined);
    expect(buildVisualizationDocumentHtml('<video src="https://cdn.example/film.mp4"></video>')).toContain(`content="${VISUALIZATION_CSP}"`);
  });
});
