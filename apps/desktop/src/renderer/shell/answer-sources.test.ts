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

describe('citation mapping', () => {
  it('resolves explicit reference links and deduplicates repeated sources', () => {
    const sources = collectAnswerSources(
      '[9][doc] 然后 [2](https://example.test/docs#api)\n\n[doc]: https://example.test/docs#api "接口说明"',
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      origin: 'citation',
      label: '接口说明',
      url: 'https://example.test/docs#api',
    });
  });
  it('preserves different web anchors and ordinary recommendation links', () => {
    const sources = collectAnswerSources(
      '[帮助](https://example.test/help) [1](https://example.test/docs#one) [2](https://example.test/docs#two)',
    );
    expect(sources.map((s) => s.origin)).toEqual(['citation', 'citation', 'link']);
    expect(sources.map((s) => s.key)).toEqual([
      'external:https://example.test/docs#one',
      'external:https://example.test/docs#two',
      'external:https://example.test/help',
    ]);
  });
  it('does not treat modifications, failed reads, code examples or bare numbers as evidence', () => {
    const sources = collectAnswerSources(
      '编号 [1]。 \n\n```md\n[2](https://example.test/code)\n```',
      [
        {
          kind: 'tool',
          name: 'write_file',
          argumentsJson: '{"path":"output.ts"}',
          status: 'completed',
        },
        {
          kind: 'tool',
          name: 'read_file',
          argumentsJson: '{"path":"failed.ts"}',
          status: 'failed',
        },
        {
          kind: 'tool',
          name: 'read_file',
          argumentsJson: '{"path":"README.md"}',
          status: 'completed',
        },
      ],
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: 'file', path: 'README.md', origin: 'read' });
  });
  it('keeps every source beyond the former twelve-source limit', () => {
    const text = Array.from(
      { length: 18 },
      (_, i) => '[' + (i + 1) + '](https://example.test/' + i + ')',
    ).join(' ');
    expect(collectAnswerSources(text)).toHaveLength(18);
  });
  it('uses file locations, rejects outside paths and omits duplicate read traces', () => {
    const sources = collectAnswerSources(
      '[1](src/app.ts#L8) [2](D:/work/src/app.ts:12:4) [3](../private.txt)',
      [
        {
          kind: 'tool',
          name: 'read_file',
          argumentsJson: '{"path":"src/app.ts"}',
          status: 'completed',
        },
      ],
      'D:/work',
    );
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      origin: 'citation',
      path: 'src/app.ts',
      location: { line: 8, column: 1 },
    });
    expect(sources[1]).toMatchObject({
      origin: 'citation',
      path: 'src/app.ts',
      location: { line: 12, column: 4 },
    });
  });
});

it('preserves distinct case-sensitive read references on POSIX', () => {
  const sources = collectAnswerSources(
    '[1](src/App.ts)',
    [
      {
        kind: 'tool',
        name: 'read_file',
        argumentsJson: '{"path":"src/app.ts"}',
        status: 'completed',
      },
    ],
    '/work',
  );
  expect(sources).toHaveLength(2);
});
