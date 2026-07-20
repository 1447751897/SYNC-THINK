import { describe, expect, it } from 'vitest';
import { parseResolveApplicationToolConfirmationPayload } from '../src/application-tool-payloads.js';

describe('application tool confirmation payloads', () => {
  it('accepts only one bounded confirmation id and thread id', () => {
    expect(
      parseResolveApplicationToolConfirmationPayload({
        confirmationId: ' confirmation-1 ',
        threadId: ' thread-1 ',
      }),
    ).toEqual({ confirmationId: 'confirmation-1', threadId: 'thread-1' });
    expect(() =>
      parseResolveApplicationToolConfirmationPayload({
        confirmationId: 'confirmation-1',
        threadId: 'thread-1',
        confirmationToken: 'must-never-cross-the-renderer',
      }),
    ).toThrow('Invalid application-tool confirmation payload');
  });
});
