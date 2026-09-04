/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PERSONALIZATION_SETTING_KEY } from '@sync-think/protocol/preferences';
import { compressThemeImage, PreferencesSettings } from './PreferencesSettings.js';
import { APPEARANCE_PREFERENCE_KEY, SHORTCUT_PREFERENCE_KEY } from './preferences-store.js';

const runtime = {
  setTheme: vi.fn().mockResolvedValue({ dark: false }),
  getSettings: vi.fn().mockResolvedValue({ settings: {} }),
  setSetting: vi.fn().mockResolvedValue({}),
  setGlobalShortcut: vi.fn().mockResolvedValue({ registered: true, error: null }),
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubThemeImageDom() {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
    this: HTMLCanvasElement,
  ) {
    return {
      canvas: this,
      drawImage,
      getImageData: () => ({
        data: new Uint8ClampedArray([38, 92, 67, 255, 92, 144, 118, 255]),
      }),
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/webp;base64,dGhlbWU=',
  );

  class CspAwareImage {
    naturalWidth = 1200;
    naturalHeight = 800;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(value: string) {
      window.setTimeout(() => {
        if (value.startsWith('data:image/')) this.onload?.();
        else this.onerror?.();
      }, 0);
    }
  }
  vi.stubGlobal('Image', CspAwareImage);
  return { drawImage };
}

describe('PreferencesSettings', () => {
  it('imports a theme image through the CSP-safe data URL path', async () => {
    const { drawImage } = stubThemeImageDom();
    const createObjectUrl = vi.fn(() => 'blob:blocked-by-shell-csp');
    const revokeObjectUrl = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectUrl },
      revokeObjectURL: { configurable: true, value: revokeObjectUrl },
    });

    const result = await compressThemeImage(
      new File(['image-bytes'], 'wallpaper.png', { type: 'image/png' }),
    );

    expect(result.dataUrl).toBe('data:image/webp;base64,dGhlbWU=');
    expect(drawImage).toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it('matches the NewMax three-tab information architecture', () => {
    render(<PreferencesSettings />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '主题',
      '快捷键',
      '个性化',
    ]);
    expect(screen.getByText('外观模式')).toBeTruthy();
    expect(screen.getByText('图片主题')).toBeTruthy();
    expect(screen.getByText('颜色主题')).toBeTruthy();
    expect(screen.getByText('对话字体')).toBeTruthy();
  });

  it('persists and applies appearance choices immediately', () => {
    render(<PreferencesSettings />);
    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_PREFERENCE_KEY) ?? '{}');
    expect(saved.mode).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(runtime.setTheme).toHaveBeenCalledWith('dark');
  });

  it('persists application shortcut switches', () => {
    render(<PreferencesSettings />);
    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }));
    fireEvent.click(screen.getByRole('switch', { name: '新建对话' }));
    const voiceInput = screen.getByRole('switch', { name: '语音输入' });
    expect(voiceInput.hasAttribute('disabled')).toBe(false);
    fireEvent.click(voiceInput);

    const saved = JSON.parse(localStorage.getItem(SHORTCUT_PREFERENCE_KEY) ?? '{}');
    expect(saved.newChat.enabled).toBe(false);
    expect(saved.voiceInput.enabled).toBe(true);
    expect(screen.getByText('系统快捷键')).toBeTruthy();
    expect(screen.getByText('应用快捷键')).toBeTruthy();
  });

  it('lets the user turn the prompt-enhancement shortcut on and off', () => {
    render(<PreferencesSettings />);
    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }));

    const toggle = screen.getByRole('switch', { name: '优化提示词' });
    expect(toggle.hasAttribute('disabled')).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: '修改优化提示词快捷键' }).textContent).toMatch(/Tab/i);

    const saved = JSON.parse(localStorage.getItem(SHORTCUT_PREFERENCE_KEY) ?? '{}');
    expect(saved.promptEnhancement.enabled).toBe(true);
    expect(saved.promptEnhancement.accelerator).toBe('Tab');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(localStorage.getItem(SHORTCUT_PREFERENCE_KEY) ?? '{}').promptEnhancement.enabled).toBe(
      false,
    );
  });

  it('resets the shared viewport when switching tabs', async () => {
    const { container } = render(<PreferencesSettings />);
    const scroller = container.querySelector('.settings-preferences__scroll') as HTMLDivElement;
    scroller.scrollTop = 240;

    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }));

    await waitFor(() => expect(scroller.scrollTop).toBe(0));
    expect(screen.getByText('系统快捷键')).toBeTruthy();
  });

  it('supports image accent variants and reversible preset removal', () => {
    render(<PreferencesSettings />);
    fireEvent.click(screen.getByRole('button', { name: '雾林深境图片主题' }));
    fireEvent.click(screen.getAllByRole('button', { name: '浓郁' })[0]!);

    let saved = JSON.parse(localStorage.getItem(APPEARANCE_PREFERENCE_KEY) ?? '{}');
    expect(saved.imageThemeId).toBe('preset-lakewood');
    expect(saved.imageThemeVariants['preset-lakewood']).toBe('rich');

    fireEvent.click(screen.getAllByRole('button', { name: '删除图片主题' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '确认删除图片主题' }));
    expect(screen.queryByRole('button', { name: '雾林深境图片主题' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '恢复主题' }));
    expect(screen.getByRole('button', { name: '雾林深境图片主题' })).toBeTruthy();
    saved = JSON.parse(localStorage.getItem(APPEARANCE_PREFERENCE_KEY) ?? '{}');
    expect(saved.dismissedImageThemeIds).toEqual([]);
  });

  it('loads and saves personalization through the Runtime setting bridge', async () => {
    runtime.getSettings.mockResolvedValueOnce({
      settings: {
        [PERSONALIZATION_SETTING_KEY]: {
          name: '小林',
          workDescription: '桌面应用工程师',
          globalPrompt: '请用中文回答',
        },
      },
    });
    render(<PreferencesSettings />);
    fireEvent.click(screen.getByRole('tab', { name: '个性化' }));

    const name = await screen.findByDisplayValue('小林');
    fireEvent.change(name, { target: { value: '林一' } });

    await waitFor(
      () =>
        expect(runtime.setSetting).toHaveBeenCalledWith({
          key: PERSONALIZATION_SETTING_KEY,
          value: {
            name: '林一',
            workDescription: '桌面应用工程师',
            globalPrompt: '请用中文回答',
          },
        }),
      { timeout: 2_000 },
    );
  });
});
