import { describe, expect, it } from 'vitest';
import { highlightCode, highlightCodeLines, languageFromPath } from './code-highlight.js';
import { escapeHtml, highlightSource } from './highlight.js';

describe('shared bounded syntax highlighting', () => {
  it.each(['typescript', 'tsx', 'TSX', 'javascript', 'jsx', 'html', 'json', 'powershell'])(
    'uses the same registered %s grammar in source and line views',
    (language) => {
      const source = '<div title="hello">const value = 42;</div>';
      expect(highlightCode(source, language)).toBeDefined();
      expect(highlightSource(source, language)).toBe(highlightCode(source, language));
      expect(highlightCodeLines(source, language)).toEqual([highlightSource(source, language)]);
    },
  );

  it.each([undefined, 'mermaid', 'not-a-language', 'plaintext'])(
    'escapes unknown language %s without guessing a grammar',
    (language) => {
      const source = '<script>alert("value & test")</script>';
      expect(highlightCode(source, language)).toBeUndefined();
      expect(highlightSource(source, language)).toBe(escapeHtml(source));
      expect(highlightSource(source, language)).not.toContain('<script>');
    },
  );

  it('keeps large source readable without running the highlighter', () => {
    const source = '<tag>\n'.repeat(20_000);
    expect(highlightCode(source, 'html')).toBeUndefined();
    expect(highlightCodeLines(source, 'html')).toBeUndefined();
    expect(highlightSource(source, 'html')).toBe(escapeHtml(source));
  });

  it('balances multi-line tokens for independently rendered lines', () => {
    const lines = highlightCodeLines('/* first\nsecond */\nconst value = 1;', 'typescript')!;
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.match(/<span\b/g)?.length ?? 0).toBe(line.match(/<\/span>/g)?.length ?? 0);
    }
    expect(lines[1]).toContain('hljs-comment');
    expect(languageFromPath('C:\\project\\file.tsx')).toBe('typescript');
  });
});
