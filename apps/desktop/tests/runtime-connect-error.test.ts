import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@sync-think/shared';
import {
  RuntimeAuthenticationError,
  RuntimeProtocolError,
  RuntimeResponseError,
  RuntimeTransientError,
  classifyRuntimeConnectError,
} from '../src/main/runtime-client.js';

describe('desktop Runtime connect error classification', () => {
  it('marks only structured transport failures retryable without exposing raw errors', () => {
    expect(classifyRuntimeConnectError(new RuntimeTransientError())).toEqual({
      code: 'runtime.unavailable',
      retryable: true,
    });
    expect(
      classifyRuntimeConnectError(
        Object.assign(new Error('named pipe raw detail'), { code: 'ECONNREFUSED' }),
      ),
    ).toEqual({ code: 'runtime.unavailable', retryable: true });
    expect(classifyRuntimeConnectError(new TypeError('programming error raw detail'))).toEqual({
      code: 'runtime.request-rejected',
      retryable: false,
    });
  });

  it('never retries authentication, protocol, or permission failures', () => {
    expect(classifyRuntimeConnectError(new RuntimeAuthenticationError())).toEqual({
      code: 'runtime.authentication-failed',
      retryable: false,
    });
    expect(classifyRuntimeConnectError(new RuntimeProtocolError())).toEqual({
      code: 'runtime.protocol-error',
      retryable: false,
    });
    expect(
      classifyRuntimeConnectError(
        new RuntimeResponseError(ErrorCode.UNAUTHORIZED_TOOL, 'raw permission detail'),
      ),
    ).toEqual({
      code: 'runtime.permission-denied',
      retryable: false,
    });
  });
});
