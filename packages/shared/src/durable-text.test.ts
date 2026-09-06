import { expect, it } from 'vitest';
import { DURABLE_EMBEDDED_IMAGE_MARKER, sanitizeDurableText } from './durable-text.js';
it('retains ordinary text and Unicode exactly', () => {
  const text = '完整回答🙂\ncode and whitespace  ';
  expect(sanitizeDurableText(text)).toBe(text);
});
it('uses the same image redaction for durable and recovered prose sources', () => {
  expect(sanitizeDurableText('start data:image/png;base64,AAAA end')).toBe(
    'start ' + DURABLE_EMBEDDED_IMAGE_MARKER + ' end',
  );
  expect(sanitizeDurableText('data:image/unsupported')).toBe('data-image/unsupported');
});
