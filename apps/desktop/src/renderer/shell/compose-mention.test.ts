import { describe, expect, it } from 'vitest';
import {
  addAttachment,
  buildMessageWithAttachments,
  detectMentionQuery,
  fileNameFromPath,
  removeAttachment,
  splitMessageFileReferences,
  stripMentionToken,
} from './compose-mention.js';

describe('detectMentionQuery', () => {
  it('detects @ at start and mid-token query', () => {
    expect(detectMentionQuery('@src', 4)).toEqual({
      atIndex: 0,
      query: 'src',
      caret: 4,
    });
    // '请看 @App' → indices 0请 1看 2空 3@ 4A 5p 6p ; caret at end
    expect(detectMentionQuery('请看 @App', 7)).toEqual({
      atIndex: 3,
      query: 'App',
      caret: 7,
    });
  });

  it('ignores email-like tokens and completed mentions with space', () => {
    expect(detectMentionQuery('a@b.com', 7)).toBeNull();
    expect(detectMentionQuery('see @file ', 10)).toBeNull();
  });
});

describe('stripMentionToken', () => {
  it('removes the active @query so a chip can replace it', () => {
    const mention = detectMentionQuery('看 @Ap', 5)!;
    const result = stripMentionToken('看 @Ap', mention);
    expect(result.text).toBe('看 ');
    expect(result.caret).toBe(2);
  });
});

describe('attachments helpers', () => {
  it('adds unique attachments and removes by path', () => {
    const a = { path: 'a.ts', name: 'a.ts', kind: 'file' as const };
    const b = { path: 'b.ts', name: 'b.ts', kind: 'file' as const };
    expect(addAttachment([], a)).toEqual([a]);
    expect(addAttachment([a], a)).toEqual([a]);
    expect(addAttachment([a], b)).toEqual([a, b]);
    expect(removeAttachment([a, b], 'a.ts')).toEqual([b]);
  });

  it('builds message footer with referenced files', () => {
    expect(
      buildMessageWithAttachments('帮我看看', [
        { path: 'package.json', name: 'package.json', kind: 'file' },
      ]),
    ).toBe('帮我看看\n\n引用文件：\n- package.json');
    expect(fileNameFromPath('src/components/Button.tsx')).toBe('Button.tsx');
  });

  it('splits the generated file footer for attachment rendering', () => {
    expect(
      splitMessageFileReferences('请读取它\n\n引用文件：\n- .codex-logs/next-dev.err.log'),
    ).toEqual({
      body: '请读取它',
      files: [
        {
          path: '.codex-logs/next-dev.err.log',
          name: 'next-dev.err.log',
          kind: 'file',
        },
      ],
    });
  });

  it('does not invent a fake image path footer (images go via multimodal payload)', () => {
    const images = [
      {
        path: 'image:1-shot.png',
        name: 'shot.png',
        kind: 'image' as const,
        previewUrl: 'data:image/png;base64,abc',
      },
    ];
    // Text body only — image binary is sent separately as appendMessage.images.
    expect(buildMessageWithAttachments('看图', images)).toBe('看图');
  });
});
