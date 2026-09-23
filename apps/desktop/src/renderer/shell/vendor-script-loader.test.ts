/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVendorScriptLoader, ensureVendorStylesheet } from './vendor-script-loader.js';

const SCRIPT_SELECTOR = 'script[data-test-vendor]';

afterEach(() => {
  document.head.replaceChildren();
});

function fixture(readVendor: () => { name: string } | undefined) {
  return createVendorScriptLoader({
    scriptSelector: SCRIPT_SELECTOR,
    scriptSource: './test-vendor.js',
    markerAttribute: 'data-test-vendor',
    readVendor,
    missingExportMessage: 'vendor missing export',
    loadErrorMessage: 'vendor failed to load',
  });
}

describe('vendor script loader', () => {
  it('returns an existing vendor without creating a script', async () => {
    const vendor = { name: 'ready' };
    await expect(fixture(() => vendor)()).resolves.toBe(vendor);
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  it('shares one script and promise across concurrent callers', async () => {
    const state: { vendor?: { name: string } } = {};
    const beforeStart = vi.fn();
    const load = createVendorScriptLoader({
      scriptSelector: SCRIPT_SELECTOR,
      scriptSource: './test-vendor.js',
      markerAttribute: 'data-test-vendor',
      readVendor: () => state.vendor,
      missingExportMessage: 'vendor missing export',
      loadErrorMessage: 'vendor failed to load',
      beforeStart,
    });

    const first = load();
    const second = load();
    expect(second).toBe(first);
    expect(beforeStart).toHaveBeenCalledTimes(1);
    const script = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
    expect(script?.src).toContain('/test-vendor.js');
    expect(script?.async).toBe(true);

    state.vendor = { name: 'loaded' };
    script?.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(state.vendor);
  });

  it('removes a failed script and permits a retry', async () => {
    const load = fixture(() => undefined);
    const first = load();
    document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR)?.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('vendor failed to load');
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();

    const retry = load();
    expect(document.querySelector(SCRIPT_SELECTOR)).not.toBeNull();
    document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR)?.dispatchEvent(new Event('error'));
    await expect(retry).rejects.toThrow('vendor failed to load');
  });

  it('rejects and removes a script that loads without its global export', async () => {
    const loading = fixture(() => undefined)();
    document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR)?.dispatchEvent(new Event('load'));
    await expect(loading).rejects.toThrow('vendor missing export');
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  it('adds a vendor stylesheet once', () => {
    const options = {
      selector: 'link[data-test-vendor-style]',
      source: './test-vendor.css',
      markerAttribute: 'data-test-vendor-style',
    };
    ensureVendorStylesheet(options);
    ensureVendorStylesheet(options);
    const links = document.querySelectorAll<HTMLLinkElement>(options.selector);
    expect(links).toHaveLength(1);
    expect(links[0]?.rel).toBe('stylesheet');
    expect(links[0]?.href).toContain('/test-vendor.css');
  });
});
