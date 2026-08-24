import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attachmentImageRelativePath,
  readImageDataUrl,
  resolveDescribeImagePath,
} from './describe-image-tool.js';

const dirs: string[] = [];
afterEachCleanup();
function afterEachCleanup() {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'describe-image-tool-'));
  dirs.push(dir);
  return dir;
}

describe('resolveDescribeImagePath', () => {
  it('resolves a relative path inside the workspace', () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, 'shot.png'), 'fake');
    const result = resolveDescribeImagePath(ws, 'shot.png');
    expect(result).toMatchObject({ ok: true, mimeType: 'image/png' });
  });

  it('accepts an absolute path inside the workspace', () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, 'a.jpg'), 'fake');
    const result = resolveDescribeImagePath(ws, join(ws, 'a.jpg'));
    expect(result).toMatchObject({ ok: true, mimeType: 'image/jpeg' });
  });

  it('rejects paths outside the workspace (traversal)', () => {
    const ws = makeWorkspace();
    const result = resolveDescribeImagePath(ws, '..\\outside.png');
    expect(result.ok).toBe(false);
  });

  it('rejects a missing file and a non-image extension', () => {
    const ws = makeWorkspace();
    expect(resolveDescribeImagePath(ws, 'nope.png').ok).toBe(false);
    expect(resolveDescribeImagePath(ws, 'data.txt').ok).toBe(false);
  });

  it('rejects an empty workspace and an empty path', () => {
    expect(resolveDescribeImagePath('', 'x.png').ok).toBe(false);
    expect(resolveDescribeImagePath('/tmp', '').ok).toBe(false);
  });
});

describe('readImageDataUrl', () => {
  it('builds a data URL from a small png', () => {
    const ws = makeWorkspace();
    const png = join(ws, 'tiny.png');
    writeFileSync(png, Buffer.from([137, 80, 78, 71]));
    const url = readImageDataUrl(png, 'image/png');
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it('returns undefined for a missing file', () => {
    expect(readImageDataUrl('\\\\nonexistent\\x.png', 'image/png')).toBeUndefined();
  });
});

describe('attachment path helpers', () => {
  it('keeps attachments under .newmax-attachments/', () => {
    const ws = makeWorkspace();
    expect(attachmentImageRelativePath(ws, 'a.png')).toBe(join('.newmax-attachments', 'a.png'));
  });
});
