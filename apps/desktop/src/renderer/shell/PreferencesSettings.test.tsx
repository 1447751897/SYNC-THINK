/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PERSONALIZATION_SETTING_KEY } from '@sync-think/protocol/preferences';
import { compressThemeImage, PreferencesSettings } from './PreferencesSettings.js';
import { APPEARANCE_PREFERENCE_KEY, SHORTCUT_PREFERENCE_KEY, readAppearancePreferences } from './preferences-store.js';

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

  it('uses shortcut row dividers without stacking extra group dividers', () => {
    render(<PreferencesSettings />);
    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }));
    expect(document.querySelectorAll('.settings-shortcuts__group-divider')).toHaveLength(0);
    expect(document.querySelectorAll('.settings-shortcuts__rows')).toHaveLength(2);
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
    expect(screen.getByRole('button', { name: '修改优化提示词快捷键' }).textContent).toMatch(
      /Tab/i,
    );

    const saved = JSON.parse(localStorage.getItem(SHORTCUT_PREFERENCE_KEY) ?? '{}');
    expect(saved.promptEnhancement.enabled).toBe(true);
    expect(saved.promptEnhancement.accelerator).toBe('Tab');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(
      JSON.parse(localStorage.getItem(SHORTCUT_PREFERENCE_KEY) ?? '{}').promptEnhancement.enabled,
    ).toBe(false);
  });

  it('resets the shared viewport when switching tabs', async () => {
    const { container } = render(<PreferencesSettings />);
    const scroller = container.querySelector('.settings-preferences__scroll') as HTMLDivElement;
    scroller.scrollTop = 240;

    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }));

    await waitFor(() => expect(scroller.scrollTop).toBe(0));
    expect(screen.getByText('系统快捷键')).toBeTruthy();
  });

  it('switches wallpaper effects without clearing the selected image', () => {
    render(<PreferencesSettings />);
    fireEvent.click(screen.getByRole('button', { name: '雾林深境图片主题' }));
    const root = document.documentElement;
    const image = root.style.getPropertyValue('--shell-wallpaper-image');
    const overlay = screen.getByRole('radio', { name: '覆盖色' });
    const blur = screen.getByRole('radio', { name: '模糊' });

    fireEvent.click(overlay);
    expect(overlay.getAttribute('aria-checked')).toBe('true');
    expect(blur.getAttribute('aria-checked')).toBe('false');
    expect(root.dataset.imageThemeEffect).toBe('overlay');
    expect(root.style.getPropertyValue('--shell-message-reading-blur')).toBe('0px');
    expect(root.style.getPropertyValue('--shell-wallpaper-image')).toBe(image);
    expect(JSON.parse(localStorage.getItem(APPEARANCE_PREFERENCE_KEY) ?? '{}')).toMatchObject({
      imageEffect: 'overlay', imageThemeId: 'preset-lakewood',
    });

    fireEvent.click(blur);
    expect(blur.getAttribute('aria-checked')).toBe('true');
    expect(overlay.getAttribute('aria-checked')).toBe('false');
    expect(root.dataset.imageThemeEffect).toBe('blur');
    expect(root.style.getPropertyValue('--shell-message-reading-blur')).toBe('18px');
    expect(root.style.getPropertyValue('--shell-wallpaper-image')).toBe(image);
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


describe('wallpaper controls and uploaded library', () => {
  it('previews and persists mask strength and can restore the old default', () => {
    render(<PreferencesSettings />);
    fireEvent.click(screen.getByRole('button', { name: '雾林深境图片主题' }));
    fireEvent.click(screen.getByRole('radio', { name: '覆盖色' }));
    const slider = screen.getByRole('slider', { name: '遮罩强度' });
    fireEvent.change(slider, { target: { value: '0' } });
    expect(readAppearancePreferences().imageOverlayOpacity).toBe(0);
    expect(document.documentElement.style.getPropertyValue('--shell-wallpaper-overlay')).toBe('linear-gradient(transparent, transparent)');
    fireEvent.click(screen.getByRole('button', { name: '恢复默认遮罩' }));
    expect(readAppearancePreferences().imageOverlayOpacity).toBe(50);
    expect(document.documentElement.style.getPropertyValue('--shell-wallpaper-overlay')).toContain('50%');
  });

  it('retains the existing upload and appends multiple new images that survive reopening', async () => {
    localStorage.setItem(APPEARANCE_PREFERENCE_KEY, JSON.stringify({ imageThemeId: 'custom-upload', customImageDataUrl: 'data:image/webp;base64,b2xk', customImageName: '旧图片' }));
    stubThemeImageDom();
    const { unmount } = render(<PreferencesSettings />);
    const input = screen.getByLabelText('上传图片主题');
    expect(input.hasAttribute('multiple')).toBe(true);
    fireEvent.change(input, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' }), new File(['second'], 'second.webp', { type: 'image/webp' })] } });
    await screen.findByRole('button', { name: 'second图片主题' });
    expect(screen.getByRole('button', { name: '旧图片图片主题' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'first图片主题' })).toBeTruthy();
    const saved = readAppearancePreferences();
    expect(saved.customImageThemes).toHaveLength(3);
    expect(saved.imageThemeId).toBe(saved.customImageThemes[2]?.id);
    expect(new Set(saved.customImageThemes.map(image => image.id)).size).toBe(3);
    unmount();
    render(<PreferencesSettings />);
    expect(screen.getByRole('button', { name: 'first图片主题' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'second图片主题' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '旧图片图片主题' }));
    expect(readAppearancePreferences().imageThemeId).toBe('custom-upload');
  });

  it('appends repeated uploads with unique names and removes only the selected image', async () => {
    stubThemeImageDom();
    render(<PreferencesSettings />);
    const upload = () => fireEvent.change(screen.getByLabelText('上传图片主题'), { target: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] } });
    upload();
    await screen.findByRole('button', { name: 'photo图片主题' });
    const originalId = readAppearancePreferences().imageThemeId;
    upload();
    await screen.findByRole('button', { name: 'photo（2）图片主题' });
    expect(readAppearancePreferences().customImageThemes).toHaveLength(2);
    const card = screen.getByRole('button', { name: 'photo（2）图片主题' }).closest('.settings-image-theme__card')!;
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '删除图片主题' }));
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '确认删除图片主题' }));
    expect(readAppearancePreferences().imageThemeId).toBe(originalId);
    expect(screen.getByRole('button', { name: 'photo图片主题' }).getAttribute('aria-pressed')).toBe('true');
    const firstCard = screen.getByRole('button', { name: 'photo图片主题' }).closest('.settings-image-theme__card')!;
    fireEvent.click(within(firstCard as HTMLElement).getByRole('button', { name: '删除图片主题' }));
    fireEvent.click(within(firstCard as HTMLElement).getByRole('button', { name: '确认删除图片主题' }));
    expect(readAppearancePreferences().customImageThemes).toEqual([]);
    expect(readAppearancePreferences().imageThemeId).toBeNull();
    expect(document.documentElement.hasAttribute('data-image-theme')).toBe(false);
  });

  it('preserves mask changes made while images are being compressed', async () => {
    stubThemeImageDom();
    render(<PreferencesSettings />);
    fireEvent.change(screen.getByLabelText('上传图片主题'), { target: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByRole('slider', { name: '遮罩强度' }), { target: { value: '20' } });
    await screen.findByRole('button', { name: 'photo图片主题' });
    expect(readAppearancePreferences().imageOverlayOpacity).toBe(20);
  });

  it('edits and removes one image without changing another image or its selection', async () => {
    stubThemeImageDom();
    render(<PreferencesSettings />);
    fireEvent.change(screen.getByLabelText('上传图片主题'), { target: { files: [new File(['first'], 'first.png', { type: 'image/png' }), new File(['second'], 'second.png', { type: 'image/png' })] } });
    await screen.findByRole('button', { name: 'second图片主题' });
    const secondId = readAppearancePreferences().imageThemeId;
    let card = screen.getByRole('button', { name: 'first图片主题' }).closest('.settings-image-theme__card')!;
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '编辑图片主题' }));
    const editor = screen.getByRole('dialog', { name: '编辑图片主题' });
    fireEvent.change(within(editor).getByRole('textbox', { name: '名称' }), { target: { value: '编辑后的图片' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
    expect(readAppearancePreferences().imageThemeId).toBe(secondId);
    card = screen.getByRole('button', { name: '编辑后的图片图片主题' }).closest('.settings-image-theme__card')!;
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '删除图片主题' }));
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '确认删除图片主题' }));
    expect(readAppearancePreferences().customImageThemes).toHaveLength(1);
    expect(readAppearancePreferences().imageThemeId).toBe(secondId);
    expect(screen.getByRole('button', { name: 'second图片主题' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps previously saved images and reports a full local storage instead of pretending an upload succeeded', async () => {
    localStorage.setItem(APPEARANCE_PREFERENCE_KEY, JSON.stringify({ imageThemeId: 'custom-upload', customImageDataUrl: 'data:image/webp;base64,b2xk', customImageName: '旧图片' }));
    const previous = localStorage.getItem(APPEARANCE_PREFERENCE_KEY);
    stubThemeImageDom();
    render(<PreferencesSettings />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    fireEvent.change(screen.getByLabelText('上传图片主题'), { target: { files: [new File(['second'], 'second.png', { type: 'image/png' })] } });
    expect((await screen.findByRole('alert')).textContent).toContain('存储');
    expect(screen.queryByRole('button', { name: 'second图片主题' })).toBeNull();
    expect(screen.getByRole('button', { name: '旧图片图片主题' })).toBeTruthy();
    expect(localStorage.getItem(APPEARANCE_PREFERENCE_KEY)).toBe(previous);
  });
});
