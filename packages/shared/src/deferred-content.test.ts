import { describe, expect, it } from 'vitest';
import { parseContentReference, parseDeferredContent } from './deferred-content.js';

describe('deferred conversation content references', () => {
  it('validates preview metadata before displaying a full-content control', () => {
    const descriptor = {
      reference: { source: 'event', id: 'event-a', path: ['result'] },
      utf16Length: 100,
      utf8Bytes: 200,
      format: 'text',
    };
    expect(parseDeferredContent(descriptor)).toEqual(descriptor);
    for (const value of [
      'not a descriptor',
      { ...descriptor, utf8Bytes: 0 },
      { ...descriptor, utf16Length: -1 },
      { ...descriptor, format: 'html' },
    ])
      expect(parseDeferredContent(value)).toBeUndefined();
  });
  it('accepts only known content sources and displayable field paths', () => {
    expect(
      parseContentReference({ source: 'event', id: 'event-a', path: ['result', 'stdout'] }),
    ).toEqual({ source: 'event', id: 'event-a', path: ['result', 'stdout'] });
    expect(
      parseContentReference({
        source: 'timeline',
        id: 'segment-a',
        runId: 'run-a',
        path: ['output'],
      }),
    ).toBeDefined();
    expect(
      parseContentReference({
        source: 'message',
        id: 'message-a',
        path: ['blocks', 2, 'payload', 'assistantTimeline', 1, 'output'],
      }),
    ).toBeDefined();
    expect(
      parseContentReference({ source: 'event', id: 'event-a', path: ['run', 'contextSnapshot'] }),
    ).toBeUndefined();
    expect(
      parseContentReference({ source: 'message', id: 'message-a', path: ['credentialRefId'] }),
    ).toBeUndefined();
    expect(
      parseContentReference({ source: 'timeline', id: 'segment-a', path: ['output'] }),
    ).toBeUndefined();
  });

  it('rejects inherited fields, dangerous paths, oversized identifiers and unexpected fields', () => {
    for (const value of [
      Object.create({ source: 'event', id: 'event-a', path: ['result'] }),
      { source: 'event', id: 'event-a', path: ['result', '__proto__'] },
      { source: 'message', id: 'message-a', path: ['blocks', -1, 'text'] },
      { source: 'event', id: 'x'.repeat(513), path: ['result'] },
      { source: 'file', id: 'C:/private', path: ['text'] },
      { source: 'event', id: 'event-a', path: ['result'], filename: 'private' },
    ])
      expect(parseContentReference(value)).toBeUndefined();
  });
});

it('limits legacy terminal prose references to exact assistant text fields', () => {
  expect(
    parseContentReference({ source: 'event-prose', id: 'terminal', path: ['assistantText'] }),
  ).toEqual({ source: 'event-prose', id: 'terminal', path: ['assistantText'] });
  expect(
    parseContentReference({
      source: 'event-prose',
      id: 'terminal',
      path: ['run', 'assistantText'],
    }),
  ).toEqual({ source: 'event-prose', id: 'terminal', path: ['run', 'assistantText'] });
  for (const path of [
    ['run'],
    ['run', 'userText'],
    ['run', 'credentialRefId'],
    ['assistantText', 'length'],
    ['error'],
  ])
    expect(parseContentReference({ source: 'event-prose', id: 'terminal', path })).toBeUndefined();
});
