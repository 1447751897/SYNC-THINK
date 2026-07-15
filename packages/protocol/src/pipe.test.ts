import { describe, it, expect } from 'vitest';
import { pipePath, PIPE_PREFIX, DEFAULT_DEV_INSTALL_ID } from './pipe.js';

describe('pipe path', () => {
  it('joins prefix and safe installId', () => {
    expect(pipePath('dev-0001')).toBe(`${PIPE_PREFIX}dev-0001`);
  });
  it('rejects unsafe installId', () => {
    expect(() => pipePath('..\\win')).toThrow();
  });
  it('non-empty default', () => {
    expect(DEFAULT_DEV_INSTALL_ID.length).toBeGreaterThan(0);
  });
});
