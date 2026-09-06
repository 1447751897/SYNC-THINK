import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deferred conversation content bridge', () => {
  it('validates the renderer source and bounded payload before sending a runtime request', () => {
    const source = readFileSync(new URL('./main/index.ts', import.meta.url), 'utf8');
    const start = source.indexOf("ipcMain.handle('runtime:conversation-read-content'");
    expect(start).toBeGreaterThan(0);
    const handler = source.slice(start, source.indexOf('\n  });', start));
    expect(handler.indexOf('assertRuntimeIpcSource(event)')).toBeLessThan(
      handler.indexOf('parseConversationReadContentPayload(value)'),
    );
    expect(handler.indexOf('if (!payload) throw')).toBeLessThan(
      handler.indexOf('ensureRuntimeConnection()'),
    );
    expect(handler).toContain("request('conversation.readContent', payload)");
  });

  it('exposes only the scoped content request through preload', () => {
    const source = readFileSync(new URL('./preload/index.ts', import.meta.url), 'utf8');
    expect(source).toContain('readConversationContent:');
    expect(source).toMatch(
      /ipcRenderer\.invoke\(\s*'runtime:conversation-read-content',\s*payload,?\s*\)/,
    );
    const declarations = readFileSync(new URL('./renderer/global.d.ts', import.meta.url), 'utf8');
    expect(declarations).toContain('readConversationContent(');
    expect(declarations).toContain('ConversationReadContentPayload');
  });
});
