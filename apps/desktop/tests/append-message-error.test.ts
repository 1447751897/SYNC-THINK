import { describe, expect, it } from 'vitest';
import { classifyAppendMessageFailure } from '../src/renderer/append-message-error.js';

describe('classifyAppendMessageFailure', () => {
  it('keeps a task version mismatch separate from Runtime connectivity', () => {
    const result = classifyAppendMessageFailure(
      new Error(
        "Error invoking remote method 'runtime:append-message': RuntimeResponseError: Expected task version 2, received 0",
      ),
    );
    expect(result).toMatchObject({ versionMismatch: true, connectionLost: false });
    expect(result.message).toContain('任务消息版本');
  });

  it('marks transport failures as disconnected', () => {
    expect(
      classifyAppendMessageFailure(new Error('Runtime connection closed EPIPE')),
    ).toMatchObject({ connectionLost: true, versionMismatch: false });
  });

  it('does not turn a Runtime business rejection into an offline state', () => {
    const result = classifyAppendMessageFailure(
      new Error('RuntimeResponseError: permission denied'),
    );
    expect(result).toMatchObject({ connectionLost: false, versionMismatch: false });
    expect(result.message).toContain('permission denied');
  });
});
