/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { HtmlSandbox } from './HtmlSandbox.js';

const executeJavaScript = vi.fn();
const setZoomFactor = vi.fn();

beforeEach(() => {
  executeJavaScript.mockResolvedValue(412);
  Object.defineProperty(HTMLElement.prototype, 'executeJavaScript', {
    configurable: true,
    value: executeJavaScript,
  });
  Object.defineProperty(HTMLElement.prototype, 'setZoomFactor', {
    configurable: true,
    value: setZoomFactor,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (HTMLElement.prototype as HTMLElement & { executeJavaScript?: unknown }).executeJavaScript;
  delete (HTMLElement.prototype as HTMLElement & { setZoomFactor?: unknown }).setZoomFactor;
});

describe('HtmlSandbox', () => {
  it('measures natural guest content without applying a second zoom correction', async () => {
    render(<HtmlSandbox code={'<main style="height:412px">content</main>'} />);

    const webview = screen.getByTestId('html-sandbox') as HTMLElement;
    await waitFor(() => expect(webview.style.height).toBe('412px'));

    expect(executeJavaScript).toHaveBeenCalled();
    expect(String(executeJavaScript.mock.calls[0]?.[0])).toContain('body.getBoundingClientRect');
    expect(String(executeJavaScript.mock.calls[0]?.[0])).not.toContain('devicePixelRatio');
    expect(setZoomFactor).not.toHaveBeenCalled();
  });

  it('keeps the shell mounted when Electron rejects an early measurement synchronously', async () => {
    executeJavaScript
      .mockImplementationOnce(() => {
        throw new Error('The WebView must be attached to the DOM and dom-ready first');
      })
      .mockResolvedValue(412);

    render(<HtmlSandbox code={'<main style="height:412px">content</main>'} />);

    const webview = screen.getByTestId('html-sandbox') as HTMLElement;
    expect(webview.style.height).toBe('320px');

    webview.dispatchEvent(new Event('dom-ready'));
    await waitFor(() => expect(webview.style.height).toBe('412px'));
    expect(executeJavaScript.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
