import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SYNC_THINK_INTEGRATION_CATALOG } from './connector-catalog.js';
const assetsDirectory = new URL('./assets/providers/', import.meta.url);
const sources = JSON.parse(readFileSync(new URL('sources.json', assetsDirectory), 'utf8')) as {
  assets: Array<{ id: string; file: string; source: string; license: string; commit: string }>;
};
describe('packaged Provider brand marks', () => {
  it('covers every integration exactly once with a traceable SVG source', () => {
    expect(sources.assets.map((asset) => asset.id).sort()).toEqual(
      SYNC_THINK_INTEGRATION_CATALOG.map((entry) => entry.id).sort(),
    );
    expect(new Set(sources.assets.map((asset) => asset.file)).size).toBe(sources.assets.length);
    for (const asset of sources.assets) {
      expect(asset.file).toBe(asset.id + '.brand.svg');
      expect(asset.commit).toMatch(/^[a-f0-9]{40}$/);
      expect(asset.source).toContain('/' + asset.commit + '/');
    }
  });
  it('contains scalable, self-contained image data without executable markup or network dependencies', () => {
    for (const asset of sources.assets) {
      const svg = readFileSync(new URL(asset.file, assetsDirectory), 'utf8');
      expect(svg).toMatch(/<svg[\s>]/);
      expect(svg).toContain('viewBox=');
      expect(svg).toContain('</svg>');
      expect(svg).not.toMatch(/<script|<foreignObject|\bon\w+\s*=/i);
      expect(svg).not.toMatch(
        /(?:href|src)\s*=\s*["'](?:https?:|\/\/)|url\(\s*["']?(?:https?:|\/\/)/i,
      );
    }
  });
  it('retains upstream attribution for both icon collections', () => {
    expect(readFileSync(new URL('LICENSE.svgl.txt', assetsDirectory), 'utf8')).toContain(
      'MIT License',
    );
    expect(readFileSync(new URL('LICENSE.simple-icons.md', assetsDirectory), 'utf8')).toContain(
      'CC0 1.0 Universal',
    );
    expect(new Set(sources.assets.map((asset) => asset.license))).toEqual(
      new Set(['MIT', 'CC0-1.0']),
    );
  });
});
