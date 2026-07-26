import { describe, expect, it } from 'vitest';
import { findDeepLinkInArgv, parseDeepLinkUrl, SYNCTHINK_PROTOCOL } from '../src/main/deep-link.js';

describe('parseDeepLinkUrl', () => {
  it('parses a canonical syncthink://conversation/{id} URL', () => {
    expect(parseDeepLinkUrl('syncthink://conversation/conv-123')).toEqual({
      conversationId: 'conv-123',
    });
  });

  it('parses the bare syncthink: scheme form', () => {
    expect(parseDeepLinkUrl('syncthink:conversation/conv-x')).toEqual({
      conversationId: 'conv-x',
    });
  });

  it('tolerates a trailing query string without leaking it into the id', () => {
    expect(parseDeepLinkUrl('syncthink://conversation/conv-1?ws=ws-a')).toEqual({
      conversationId: 'conv-1',
    });
  });

  it.each([
    ['empty string', ''],
    ['other scheme', 'https://conversation/conv-1'],
    ['wrong path root', 'syncthink://agent/agent-1'],
    ['missing id', 'syncthink://conversation/'],
    ['only whitespace id', 'syncthink://conversation/%20'],
    ['id containing a slash', 'syncthink://conversation/conv/extra'],
    ['garbage', 'not a url at all'],
    ['null', null as unknown as string],
  ])('rejects %s', (_label, value) => {
    expect(parseDeepLinkUrl(value as string)).toBeNull();
  });

  it('exposes the canonical protocol for registration', () => {
    expect(SYNCTHINK_PROTOCOL).toBe('syncthink:');
  });
});

describe('findDeepLinkInArgv', () => {
  it('finds the first syncthink: argument', () => {
    expect(
      findDeepLinkInArgv(['--foo', 'syncthink://conversation/conv-1', '--bar']),
    ).toBe('syncthink://conversation/conv-1');
  });

  it('is case-insensitive on the scheme', () => {
    expect(findDeepLinkInArgv(['Syncthink:conversation/conv-2'])).toBe(
      'Syncthink:conversation/conv-2',
    );
  });

  it('returns null when no link is present', () => {
    expect(findDeepLinkInArgv(['--foo', 'D:/file.txt'])).toBeNull();
  });
});
