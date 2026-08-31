import { describe, expect, it } from 'vitest';
import type { InlineProcessItem } from './ChatView.js';
import { collectAnswerSources } from './answer-sources.js';

describe('collectAnswerSources', () => {
  it('collects and deduplicates Markdown links before completed workspace files', () => {
    const processItems: InlineProcessItem[] = [
      {
        kind: 'tool',
        toolCallId: 'read-a',
        name: 'read_file',
        argumentsJson: '{"path":"src/app.ts"}',
        status: 'completed',
      },
    ];

    const sources = collectAnswerSources(
      '[文档](https://example.test/docs) 和 [重复](https://example.test/docs)',
      processItems,
    );

    expect(sources).toEqual([
      expect.objectContaining({ kind: 'external', host: 'example.test' }),
      expect.objectContaining({ kind: 'file', path: 'src/app.ts', action: 'read' }),
    ]);
  });

  it('normalizes workspace-absolute tool paths before opening source files', () => {
    const sources = collectAnswerSources(
      '',
      [
        {
          kind: 'tool',
          name: 'read_file',
          argumentsJson: JSON.stringify({ path: 'D:\\projects\\SYNC-THINK\\package.json' }),
          status: 'completed',
        },
      ],
      'D:\\projects\\SYNC-THINK',
    );

    expect(sources).toEqual([
      expect.objectContaining({ kind: 'file', path: 'package.json', label: 'package.json' }),
    ]);
  });
});
