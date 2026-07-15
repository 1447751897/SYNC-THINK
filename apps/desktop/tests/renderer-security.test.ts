import { describe, expect, it } from 'vitest';
import {
  assertTrustedRendererIpcSource,
  installNavigationGuards,
  isTrustedRendererUrl,
  parseLoopbackDevServerUrl,
  trustedFileLocation,
} from '../src/main/renderer-security.js';

describe('Electron renderer security boundary', () => {
  it('accepts only explicit HTTP(S) loopback development origins', () => {
    expect(parseLoopbackDevServerUrl('http://localhost:5173/app').origin).toBe(
      'http://localhost:5173',
    );
    expect(parseLoopbackDevServerUrl('https://127.0.0.1:4173').origin).toBe(
      'https://127.0.0.1:4173',
    );
    expect(parseLoopbackDevServerUrl('http://[::1]:5173').origin).toBe(
      'http://[::1]:5173',
    );

    for (const value of [
      'https://example.com',
      'http://localhost.example.com:5173',
      'http://0.0.0.0:5173',
      'file:///D:/renderer/index.html',
      'data:text/html,unsafe',
      'http://user:password@localhost:5173',
      'not a url',
    ]) {
      expect(() => parseLoopbackDevServerUrl(value)).toThrow(
        'VITE_DEV_SERVER_URL must use an explicit loopback origin',
      );
    }
  });

  it('matches development origins and the exact packaged renderer file only', () => {
    const development = {
      kind: 'origin' as const,
      value: 'http://localhost:5173',
    };
    expect(isTrustedRendererUrl('http://localhost:5173/', development)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5173/task/1', development)).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', development)).toBe(false);
    expect(isTrustedRendererUrl('https://localhost:5173/', development)).toBe(false);

    const packaged = trustedFileLocation('D:\app\renderer\index.html');
    expect(isTrustedRendererUrl(packaged.value, packaged)).toBe(true);
    expect(isTrustedRendererUrl(`${packaged.value}?remote=1`, packaged)).toBe(false);
    expect(isTrustedRendererUrl('https://example.com/', packaged)).toBe(false);
  });

  it('treats Chromium file URLs and pathToFileURL encodings as the same trusted file', () => {
    // pathToFileURL percent-encodes "~"; Chromium webContents.getURL() often does not.
    const trusted = {
      kind: 'file' as const,
      value:
        'file:///C:/Users/ZHUZHE%7E1/AppData/Local/Temp/sync-think/index.html',
    };
    expect(
      isTrustedRendererUrl(
        'file:///C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think/index.html',
        trusted,
      ),
    ).toBe(true);
    expect(
      isTrustedRendererUrl(
        'file:///C:/Users/ZHUZHE%7E1/AppData/Local/Temp/sync-think/index.html?x=1',
        trusted,
      ),
    ).toBe(false);
  });

  it('requires both the expected webContents and a trusted sender URL for IPC', () => {
    const expectedSender = {};
    const trust = { kind: 'origin' as const, value: 'http://localhost:5173' };

    expect(() =>
      assertTrustedRendererIpcSource(
        expectedSender,
        expectedSender,
        'http://localhost:5173/',
        trust,
      ),
    ).not.toThrow();
    expect(() =>
      assertTrustedRendererIpcSource({}, expectedSender, 'http://localhost:5173/', trust),
    ).toThrow('Untrusted renderer IPC source');
    expect(() =>
      assertTrustedRendererIpcSource(
        expectedSender,
        expectedSender,
        'https://example.com/',
        trust,
      ),
    ).toThrow('Untrusted renderer IPC source');
  });

  it('allows trusted same-document reloads but denies foreign navigation and new windows', () => {
    const packaged = trustedFileLocation('D:\app\renderer\index.html');
    const navigationHandlers: Partial<
      Record<
        'will-navigate' | 'will-redirect',
        (event: { preventDefault(): void }, url: string) => void
      >
    > = {};
    let windowOpenHandler: (() => { action: 'deny' }) | undefined;
    installNavigationGuards(
      {
        on(event, handler) {
          navigationHandlers[event] = handler as (
            event: { preventDefault(): void },
            url: string,
          ) => void;
        },
        setWindowOpenHandler(handler) {
          windowOpenHandler = handler;
        },
      },
      packaged,
    );

    const prevented: string[] = [];
    // location.reload() / Playwright page.reload() fire will-navigate with the current URL.
    navigationHandlers['will-navigate']?.(
      { preventDefault: () => prevented.push('trusted-reload') },
      packaged.value,
    );
    navigationHandlers['will-navigate']?.(
      { preventDefault: () => prevented.push('foreign-navigate') },
      'https://evil.example/',
    );
    navigationHandlers['will-redirect']?.(
      { preventDefault: () => prevented.push('foreign-redirect') },
      'https://evil.example/redirect',
    );
    navigationHandlers['will-redirect']?.(
      { preventDefault: () => prevented.push('trusted-redirect') },
      packaged.value,
    );

    expect(prevented).toEqual(['foreign-navigate', 'foreign-redirect']);
    expect(windowOpenHandler?.()).toEqual({ action: 'deny' });
  });

  it('allows trusted loopback origin reloads during development', () => {
    const development = {
      kind: 'origin' as const,
      value: 'http://localhost:5173',
    };
    const navigationHandlers: Partial<
      Record<'will-navigate', (event: { preventDefault(): void }, url: string) => void>
    > = {};
    installNavigationGuards(
      {
        on(event, handler) {
          if (event === 'will-navigate') {
            navigationHandlers[event] = handler as (
              event: { preventDefault(): void },
              url: string,
            ) => void;
          }
        },
        setWindowOpenHandler() {},
      },
      development,
    );

    const prevented: string[] = [];
    navigationHandlers['will-navigate']?.(
      { preventDefault: () => prevented.push('dev-reload') },
      'http://localhost:5173/',
    );
    navigationHandlers['will-navigate']?.(
      { preventDefault: () => prevented.push('foreign') },
      'http://127.0.0.1:5173/',
    );
    expect(prevented).toEqual(['foreign']);
  });
});
