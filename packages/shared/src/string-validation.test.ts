import { describe, expect, it } from 'vitest';
import { hasAsciiControlCharacter } from './string-validation.js';

describe('hasAsciiControlCharacter', () => {
  it('accepts printable ASCII and Unicode text', () => {
    expect(hasAsciiControlCharacter('Browser workflow - 中文')).toBe(false);
  });

  it('rejects C0 controls and DEL', () => {
    expect(hasAsciiControlCharacter('line\nbreak')).toBe(true);
    expect(hasAsciiControlCharacter(`value${String.fromCharCode(0x7f)}`)).toBe(true);
  });
});
