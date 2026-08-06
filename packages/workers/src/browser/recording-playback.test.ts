import { describe, expect, it } from 'vitest';
import {
  browserLocatorToSelector,
  collectStepOrigins,
  collectStepVariables,
  locatorToDescription,
  recordingStepToBrowserAction,
} from './recording-playback.js';

describe('recordingStepToBrowserAction', () => {
  it('translates a navigate step with its origin', () => {
    const result = recordingStepToBrowserAction({ kind: 'navigate', url: 'https://example.test/a' });
    expect(result).toEqual({
      ok: true,
      action: { kind: 'navigate', url: 'https://example.test/a' },
      origin: 'https://example.test',
    });
  });

  it('translates a click with a css locator', () => {
    const result = recordingStepToBrowserAction({
      kind: 'click',
      locator: { strategy: 'css', value: 'button.submit' },
    });
    expect(result).toEqual({ ok: true, action: { kind: 'click', selector: 'button.submit' } });
  });

  it('translates a fill with a literal value', () => {
    const result = recordingStepToBrowserAction({
      kind: 'fill',
      locator: { strategy: 'placeholder', value: 'Search…' },
      value: { kind: 'literal', value: 'hello' },
    });
    expect(result).toEqual({
      ok: true,
      action: { kind: 'fill', selector: '[placeholder="Search…"]', text: 'hello' },
    });
  });

  it('resolves a variable-marked fill to the provided value', () => {
    const result = recordingStepToBrowserAction(
      {
        kind: 'fill',
        locator: { strategy: 'placeholder', value: 'Search…' },
        value: { kind: 'variable', name: 'keyword' },
      },
      { keyword: 'cat names' },
    );
    expect(result).toEqual({
      ok: true,
      action: { kind: 'fill', selector: '[placeholder="Search…"]', text: 'cat names' },
    });
  });

  it('returns a variable-required result when the variable value is missing', () => {
    const result = recordingStepToBrowserAction(
      {
        kind: 'fill',
        locator: { strategy: 'placeholder', value: 'Search…' },
        value: { kind: 'variable', name: 'keyword' },
      },
      {},
    );
    expect(result).toEqual({
      ok: false,
      kind: 'variable',
      name: 'keyword',
      selector: '[placeholder="Search…"]',
    });
  });

  it('rejects secret fill values without leaking them', () => {
    const result = recordingStepToBrowserAction({
      kind: 'fill',
      locator: { strategy: 'name', value: 'password' },
      value: { kind: 'secret' },
    });
    expect(result).toEqual({
      ok: false,
      kind: 'failure',
      code: 'browser.replay-secret-value',
      error: expect.stringContaining('secret input value'),
    });
    expect(JSON.stringify(result)).not.toContain('secret-value-text');
  });

  it('rejects unsupported select/check/press steps with a clear message', () => {
    for (const step of [
      { kind: 'select' as const, locator: { strategy: 'css' as const, value: 'select.x' }, value: { kind: 'literal' as const, value: 'a' } },
      { kind: 'check' as const, locator: { strategy: 'css' as const, value: 'input.x' }, checked: true },
      { kind: 'press' as const, locator: { strategy: 'css' as const, value: 'input.x' }, key: 'Enter' as const },
    ]) {
      const result = recordingStepToBrowserAction(step);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('browser.replay-unsupported-step');
      }
    }
  });
});

describe('browserLocatorToSelector', () => {
  it('maps each locator strategy to a CSS selector', () => {
    expect(browserLocatorToSelector({ strategy: 'test-id', value: 'submit-btn' })).toBe(
      '[data-testid="submit-btn"]',
    );
    expect(browserLocatorToSelector({ strategy: 'id', value: 'main' })).toBe('#main');
    expect(browserLocatorToSelector({ strategy: 'name', value: 'q' })).toBe('[name="q"]');
    expect(browserLocatorToSelector({ strategy: 'placeholder', value: 'Type…' })).toBe(
      '[placeholder="Type…"]',
    );
    expect(browserLocatorToSelector({ strategy: 'css', value: 'a.btn' })).toBe('a.btn');
    expect(browserLocatorToSelector({ strategy: 'role', role: 'button' })).toBe('[role="button"]');
    expect(
      browserLocatorToSelector({ strategy: 'role', role: 'button', name: 'Export' }),
    ).toBe('[role="button"][aria-label="Export"]');
  });

  it('escapes quotes and backslashes in attribute values', () => {
    expect(browserLocatorToSelector({ strategy: 'name', value: 'a"b' })).toBe(
      '[name="a\\"b"]',
    );
  });

  it('returns undefined for malformed css selectors', () => {
    expect(browserLocatorToSelector({ strategy: 'css', value: '' })).toBeUndefined();
    expect(browserLocatorToSelector({ strategy: 'css', value: 'a\nb' })).toBeUndefined();
  });
});

describe('collectStepOrigins', () => {
  it('collects unique navigation origins', () => {
    const origins = collectStepOrigins([
      { kind: 'navigate', url: 'https://example.test/a' },
      { kind: 'click', locator: { strategy: 'css', value: 'a' } },
      { kind: 'navigate', url: 'https://example.test/b' },
      { kind: 'navigate', url: 'https://other.test/' },
    ]);
    expect(origins).toEqual(['https://example.test', 'https://other.test']);
  });

  it('ignores non-http schemes', () => {
    expect(collectStepOrigins([{ kind: 'navigate', url: 'file:///etc/passwd' }])).toEqual([]);
  });
});

describe('collectStepVariables', () => {
  it('collects unique variable names in first-appearance order', () => {
    const names = collectStepVariables([
      { kind: 'navigate', url: 'https://example.test/' },
      {
        kind: 'fill',
        locator: { strategy: 'placeholder', value: 'Search' },
        value: { kind: 'variable', name: 'keyword' },
      },
      {
        kind: 'fill',
        locator: { strategy: 'name', value: 'limit' },
        value: { kind: 'literal', value: '10' },
      },
      {
        kind: 'fill',
        locator: { strategy: 'name', value: 'region' },
        value: { kind: 'variable', name: 'region' },
      },
      {
        kind: 'fill',
        locator: { strategy: 'name', value: 'keyword2' },
        value: { kind: 'variable', name: 'keyword' },
      },
    ]);
    expect(names).toEqual(['keyword', 'region']);
  });

  it('returns an empty list when no variables are referenced', () => {
    expect(
      collectStepVariables([
        { kind: 'navigate', url: 'https://example.test/' },
        {
          kind: 'fill',
          locator: { strategy: 'placeholder', value: 'Search' },
          value: { kind: 'literal', value: 'hello' },
        },
      ]),
    ).toEqual([]);
  });
});

describe('locatorToDescription', () => {
  it('renders a human-readable label', () => {
    expect(locatorToDescription({ strategy: 'role', role: 'button', name: 'Go' })).toBe(
      'button "Go"',
    );
    expect(locatorToDescription({ strategy: 'css', value: 'a.btn' })).toBe('css:a.btn');
  });
});
