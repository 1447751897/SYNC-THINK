import { describe, expect, it } from 'vitest';
import { normalizeExternalUrl } from './external-link-contract.js';

describe('normalizeExternalUrl', () => {
  it('normalizes ordinary HTTP and HTTPS links', () => {
    expect(normalizeExternalUrl(' https://example.test/docs?q=1#intro ')).toBe(
      'https://example.test/docs?q=1#intro',
    );
    expect(normalizeExternalUrl('http://127.0.0.1:3000/health')).toBe(
      'http://127.0.0.1:3000/health',
    );
  });

  it('rejects executable, local-file, credentialed, and oversized URLs', () => {
    expect(normalizeExternalUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeExternalUrl('file:///C:/secret.txt')).toBeUndefined();
    expect(normalizeExternalUrl('https://user:pass@example.test/')).toBeUndefined();
    expect(normalizeExternalUrl(`https://example.test/${'a'.repeat(8_192)}`)).toBeUndefined();
  });
});
