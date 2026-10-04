import { describe, expect, it } from 'vitest';
import {
  canonicalizeLocalWebPageUrl,
  isLocalWebPageUrl,
  LEGACY_LOCAL_WEB_PAGE_SCHEME,
  LOCAL_WEB_PAGE_SCHEME,
  LOCAL_WEB_PAGE_SCHEMES,
} from './local-web-page-contract.js';

describe('local HTML page protocol contract', () => {
  it('uses the SYNC-THINK brand for all new page URLs', () => {
    expect(LOCAL_WEB_PAGE_SCHEME).toBe('sync-think-local-web');
    expect(LOCAL_WEB_PAGE_SCHEMES).toEqual([LOCAL_WEB_PAGE_SCHEME, LEGACY_LOCAL_WEB_PAGE_SCHEME]);
  });

  it.each(LOCAL_WEB_PAGE_SCHEMES)(
    'recognizes %s in any casing and without mutating the matcher',
    (scheme) => {
      const url = `${scheme.toUpperCase()}://page-token/index.html`;
      expect(isLocalWebPageUrl(url)).toBe(true);
      expect(isLocalWebPageUrl(url)).toBe(true);
      expect(canonicalizeLocalWebPageUrl(url)).toBe('sync-think-local-web://page-token/index.html');
    },
  );

  it('preserves the token, encoded filename, query and fragment of a legacy URL', () => {
    const suffix =
      '://12345678-1234-1234-1234-123456789012/%E6%B5%B7%E5%B2%B8%20ride.html?mode=1#preview';
    expect(canonicalizeLocalWebPageUrl(LEGACY_LOCAL_WEB_PAGE_SCHEME + suffix)).toBe(
      LOCAL_WEB_PAGE_SCHEME + suffix,
    );
  });

  it.each([
    'https://example.test/newmax-local-web://token/index.html',
    'file:///C:/index.html',
    'data:text/html,<p>newmax-local-web://token/index.html</p>',
    'javascript:alert(1)',
    'about:blank',
    'newmax-local-web-evil://token/index.html',
    'sync-think-local-web-evil://token/index.html',
    'sync-think-local-web:///index.html',
    'newmax-local-web://',
  ])('does not classify or rewrite unrelated URLs: %s', (url) => {
    expect(isLocalWebPageUrl(url)).toBe(false);
    expect(canonicalizeLocalWebPageUrl(url)).toBe(url);
  });
});
