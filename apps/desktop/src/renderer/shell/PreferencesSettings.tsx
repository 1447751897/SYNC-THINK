import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  PenLine,
  RefreshCw,
  Sun,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import {
  PERSONALIZATION_LIMITS,
  PERSONALIZATION_SETTING_KEY,
  normalizePersonalizationSetting,
  type PersonalizationSetting,
} from '@sync-think/protocol/preferences';
import { writeUserName } from '../ui-preferences.js';
import { analyzeImageThemePixels } from './theme/newmax-theme-engine.js';
import { SlidingTabs } from './SlidingTabs.js';
import {
  COLOR_THEME_OPTIONS,
  CUSTOM_IMAGE_THEME_ID,
  DEFAULT_SHORTCUT_PREFERENCES,
  IMAGE_THEME_OPTIONS,
  PERSONALIZATION_CACHE_KEY,
  acceleratorFromKeyboardEvent,
  applyAppearancePreferences,
  contrastRatioFromSlider,
  defaultCustomPrimary,
  formatShortcut,
  imageThemeVariantAccent,
  randomColorPair,
  readAppearancePreferences,
  readShortcutPreferences,
  updateShortcutPreference,
  writeAppearancePreferences,
  writeShortcutPreferences,
  type AppearancePreferences,
  type ShortcutId,
  type ShortcutPreferences,
  type ThemeMode,
  type ImageThemeVariant,
} from './preferences-store.js';

type PreferencesTab = 'theme' | 'shortcuts' | 'personalization';

const PREFERENCE_TABS: Array<{
  id: PreferencesTab;
  label: string;
  icon: typeof Palette;
}> = [
  { id: 'theme', label: '主题', icon: Palette },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard },
  { id: 'personalization', label: '个性化', icon: UserRound },
];

export function PreferencesSettings() {
  const [tab, setTab] = useState<PreferencesTab>('theme');
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectTab = (next: PreferencesTab) => {
    setTab(next);
    window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
  };

  return (
    <div className="settings-preferences">
      <SlidingTabs className="settings-preferences__tabs" aria-label="偏好设置分类">
        {PREFERENCE_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-active' : undefined}
            onClick={() => selectTab(id)}
          >
            {label}
          </button>
        ))}
      </SlidingTabs>

      <div ref={scrollRef} className="settings-preferences__scroll settings-content-scroll">
        <div key={tab} className="settings-preferences__panel">
          {tab === 'theme' ? <ThemePreferences /> : null}
          {tab === 'shortcuts' ? <ShortcutPreferencesPanel /> : null}
          {tab === 'personalization' ? <PersonalizationPreferences /> : null}
        </div>
      </div>
    </div>
  );
}

const MODE_OPTIONS: Array<{ mode: ThemeMode; label: string; icon: typeof Sun }> = [
  { mode: 'light', label: '浅色', icon: Sun },
  { mode: 'dark', label: '深色', icon: Moon },
  { mode: 'system', label: '跟随系统', icon: Monitor },
];

function ThemePreferences() {
  const [preferences, setPreferences] = useState<AppearancePreferences>(() =>
    readAppearancePreferences(),
  );
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [editingCustomImage, setEditingCustomImage] = useState(false);
  const visibleImageThemes = IMAGE_THEME_OPTIONS.filter(
    (theme) => !preferences.dismissedImageThemeIds.includes(theme.id),
  );

  const commit = useCallback(
    (update: Partial<AppearancePreferences>) => {
      const next = { ...preferences, ...update, version: 1 as const };
      setPreferences(next);
      writeAppearancePreferences(next);
      applyAppearancePreferences(next);
    },
    [preferences],
  );

  const selectColorTheme = (id: (typeof COLOR_THEME_OPTIONS)[number]['id']) => {
    if (id === 'random' && preferences.colorTheme === 'random' && !preferences.imageThemeId) {
      const generated = randomColorPair();
      commit({
        imageThemeId: null,
        colorTheme: 'random',
        randomBackground: generated.background,
        randomAccent: generated.accent,
        randomMood: generated.mood,
      });
      return;
    }
    commit({ imageThemeId: null, colorTheme: id });
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(undefined);
    try {
      const generated = await compressThemeImage(file);
      commit({
        imageThemeId: CUSTOM_IMAGE_THEME_ID,
        customImageDataUrl: generated.dataUrl,
        customImageBackground: generated.background,
        customImageAccent: generated.accent,
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '图片处理失败');
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  return (
    <div className="settings-preferences__stack">
      <PreferenceSection title="外观模式">
        <div className="settings-appearance-mode" role="radiogroup" aria-label="外观模式">
          {MODE_OPTIONS.map(({ mode, label, icon: Icon }) => {
            const active = preferences.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? 'is-active' : undefined}
                onClick={() => commit({ mode })}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </PreferenceSection>

      <PreferenceSection
        title="图片主题"
        description="使用图片作为主区域背景，并自动生成配套的界面配色"
        action={
          <div className="settings-image-theme__actions">
            <div className="settings-mini-tabs" role="radiogroup" aria-label="图片背景效果">
              <button
                type="button"
                role="radio"
                aria-checked={preferences.imageEffect === 'blur'}
                className={preferences.imageEffect === 'blur' ? 'is-active' : undefined}
                onClick={() => commit({ imageEffect: 'blur' })}
              >
                模糊
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={preferences.imageEffect === 'overlay'}
                className={preferences.imageEffect === 'overlay' ? 'is-active' : undefined}
                onClick={() => commit({ imageEffect: 'overlay' })}
              >
                覆盖色
              </button>
            </div>
            {preferences.dismissedImageThemeIds.length > 0 ? (
              <button
                type="button"
                className="settings-preference-button"
                onClick={() => commit({ dismissedImageThemeIds: [] })}
              >
                <RefreshCw size={15} aria-hidden="true" />
                恢复主题
              </button>
            ) : null}
            <button
              type="button"
              className="settings-preference-button"
              disabled={uploading}
              onClick={() => uploadRef.current?.click()}
            >
              <Upload size={15} aria-hidden="true" />
              {uploading ? '处理中' : '上传图片'}
            </button>
            <input
              ref={uploadRef}
              className="settings-image-theme__input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="上传图片主题"
              onChange={(event) => void handleUpload(event.target.files?.[0])}
            />
          </div>
        }
      >
        <div className="settings-image-theme__grid">
          {visibleImageThemes.map((theme) => (
            <ImageThemeCard
              key={theme.id}
              name={theme.name}
              description={theme.description}
              imageUrl={theme.thumbnailUrl}
              active={preferences.imageThemeId === theme.id}
              onSelect={() => commit({ imageThemeId: theme.id })}
              variant={preferences.imageThemeVariants[theme.id] ?? 'soft'}
              variantColors={IMAGE_THEME_VARIANTS.map((variant) =>
                imageThemeVariantAccent(theme.background, theme.accent, variant.id),
              )}
              onVariantChange={(variant) =>
                commit({
                  imageThemeId: theme.id,
                  imageThemeVariants: {
                    ...preferences.imageThemeVariants,
                    [theme.id]: variant,
                  },
                })
              }
              onDelete={() => {
                const imageThemeVariants = { ...preferences.imageThemeVariants };
                delete imageThemeVariants[theme.id];
                commit({
                  imageThemeId:
                    preferences.imageThemeId === theme.id ? null : preferences.imageThemeId,
                  imageThemeVariants,
                  dismissedImageThemeIds: [...preferences.dismissedImageThemeIds, theme.id],
                });
              }}
            />
          ))}
          {preferences.customImageDataUrl ? (
            <ImageThemeCard
              name={preferences.customImageName}
              description="基于上传图片生成"
              imageUrl={preferences.customImageDataUrl}
              focalPoint={preferences.customImageFocalPoint}
              active={preferences.imageThemeId === CUSTOM_IMAGE_THEME_ID}
              onSelect={() => commit({ imageThemeId: CUSTOM_IMAGE_THEME_ID })}
              variant={preferences.imageThemeVariants[CUSTOM_IMAGE_THEME_ID] ?? 'soft'}
              variantColors={IMAGE_THEME_VARIANTS.map((variant) =>
                imageThemeVariantAccent(
                  preferences.customImageBackground,
                  preferences.customImageAccent,
                  variant.id,
                ),
              )}
              onVariantChange={(variant) =>
                commit({
                  imageThemeId: CUSTOM_IMAGE_THEME_ID,
                  imageThemeVariants: {
                    ...preferences.imageThemeVariants,
                    [CUSTOM_IMAGE_THEME_ID]: variant,
                  },
                })
              }
              onDelete={() => {
                const imageThemeVariants = { ...preferences.imageThemeVariants };
                delete imageThemeVariants[CUSTOM_IMAGE_THEME_ID];
                commit({
                  imageThemeId: null,
                  customImageDataUrl: null,
                  imageThemeVariants,
                });
              }}
              onEdit={() => setEditingCustomImage(true)}
            />
          ) : null}
        </div>
        {uploadError ? (
          <p className="settings-preferences__error" role="alert">
            {uploadError}
          </p>
        ) : null}
      </PreferenceSection>

      <PreferenceSection title="颜色主题">
        <div className="settings-color-theme__grid">
          {COLOR_THEME_OPTIONS.map((theme) => {
            const dark = document.documentElement.classList.contains('dark');
            const preview =
              theme.id === 'random'
                ? {
                    background: preferences.randomBackground,
                    accent: preferences.randomAccent,
                  }
                : dark
                  ? theme.dark
                  : theme.light;
            const active = !preferences.imageThemeId && preferences.colorTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                className={clsx('settings-color-theme__card', active && 'is-active')}
                aria-pressed={active}
                onClick={() => selectColorTheme(theme.id)}
              >
                <span
                  className="settings-color-theme__swatch"
                  style={{ background: preview.background }}
                >
                  <i style={{ background: preview.accent }} />
                </span>
                <span className="settings-color-theme__copy">
                  <strong>{theme.name}</strong>
                  <small>{theme.description}</small>
                </span>
                {active ? (
                  <span className="settings-color-theme__check">
                    <Check size={10} aria-hidden="true" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div
          className={clsx(
            'settings-custom-theme',
            !preferences.imageThemeId && preferences.colorTheme === 'custom' && 'is-active',
          )}
        >
          <div className="settings-custom-theme__heading">
            <span>自定义</span>
            {!preferences.imageThemeId && preferences.colorTheme === 'custom' ? (
              <span className="settings-color-theme__check">
                <Check size={10} aria-hidden="true" />
              </span>
            ) : null}
          </div>
          <div className="settings-custom-theme__grid">
            <label className="settings-custom-theme__cell">
              <span>主色</span>
              <span className="settings-custom-theme__color-row">
                <input
                  type="color"
                  value={preferences.customPrimary}
                  aria-label="自定义主色"
                  onChange={(event) =>
                    commit({
                      colorTheme: 'custom',
                      imageThemeId: null,
                      customPrimary: event.target.value,
                    })
                  }
                />
                <input
                  type="text"
                  value={preferences.customPrimary.toUpperCase()}
                  aria-label="主色十六进制值"
                  maxLength={7}
                  onChange={(event) => {
                    if (/^#[0-9a-f]{6}$/i.test(event.target.value)) {
                      commit({
                        colorTheme: 'custom',
                        imageThemeId: null,
                        customPrimary: event.target.value,
                      });
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    commit({
                      colorTheme: 'custom',
                      imageThemeId: null,
                      customPrimary: defaultCustomPrimary(),
                    })
                  }
                >
                  随主题
                </button>
              </span>
            </label>
            <label className="settings-custom-theme__cell">
              <span>纯度</span>
              <span className="settings-custom-theme__range-row">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={preferences.customPurity}
                  onChange={(event) =>
                    commit({
                      colorTheme: 'custom',
                      imageThemeId: null,
                      customPurity: Number(event.target.value),
                    })
                  }
                />
                <b>{preferences.customPurity}</b>
              </span>
            </label>
            <label className="settings-custom-theme__cell">
              <span>对比度</span>
              <span className="settings-custom-theme__range-row">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={preferences.customContrast}
                  onChange={(event) =>
                    commit({
                      colorTheme: 'custom',
                      imageThemeId: null,
                      customContrast: Number(event.target.value),
                    })
                  }
                />
                <b>{contrastRatioFromSlider(preferences.customContrast).toFixed(1)}:1</b>
              </span>
            </label>
          </div>
        </div>
      </PreferenceSection>

      <PreferenceSection
        title="对话字体"
        action={
          <PreferenceToggle
            checked={preferences.useSerifFont}
            label="衬线体"
            text="衬线体"
            onChange={(useSerifFont) => commit({ useSerifFont })}
          />
        }
      >
        <div className="settings-chat-font__range">
          <span>小</span>
          <input
            type="range"
            min="12"
            max="18"
            step="1"
            value={preferences.chatFontSize}
            aria-label="对话字体大小"
            onChange={(event) => commit({ chatFontSize: Number(event.target.value) })}
          />
          <span>大</span>
        </div>
        <div
          className="settings-chat-font__preview"
          style={{
            fontFamily: preferences.useSerifFont ? 'var(--font-serif)' : 'var(--font-sans)',
            fontSize: preferences.chatFontSize,
          }}
        >
          这是对话中的预览文字效果。The quick brown fox jumps over the lazy dog.
        </div>
      </PreferenceSection>
      {editingCustomImage && preferences.customImageDataUrl ? (
        <CustomImageThemeEditor
          imageUrl={preferences.customImageDataUrl}
          name={preferences.customImageName}
          focalPoint={preferences.customImageFocalPoint}
          onClose={() => setEditingCustomImage(false)}
          onSave={(customImageName, customImageFocalPoint) => {
            commit({ customImageName, customImageFocalPoint });
            setEditingCustomImage(false);
          }}
        />
      ) : null}
    </div>
  );
}

function PreferenceSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-preference-section">
      <div className="settings-preference-section__header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ImageThemeCard({
  name,
  description,
  imageUrl,
  focalPoint,
  active,
  onSelect,
  variant,
  variantColors,
  onVariantChange,
  onDelete,
  onEdit,
}: {
  name: string;
  description: string;
  imageUrl: string;
  focalPoint?: { x: number; y: number };
  active: boolean;
  onSelect(): void;
  variant: ImageThemeVariant;
  variantColors: string[];
  onVariantChange?(variant: ImageThemeVariant): void;
  onDelete?(): void;
  onEdit?(): void;
}) {
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  return (
    <div
      className={clsx('settings-image-theme__card', active && 'is-active')}
      data-image-theme-active={active ? 'true' : 'false'}
    >
      <button
        type="button"
        className="settings-image-theme__select"
        aria-label={`${name}图片主题`}
        aria-pressed={active}
        onClick={onSelect}
      >
        <span
          className="settings-image-theme__photo"
          style={{
            backgroundImage: `url("${imageUrl}")`,
            backgroundPosition: focalPoint ? `${focalPoint.x}% ${focalPoint.y}%` : 'center',
          }}
        />
        <span className="settings-image-theme__shade" />
        <span className="settings-image-theme__copy">
          <strong>{name}</strong>
          <small>{description}</small>
        </span>
      </button>
      {onVariantChange ? (
        <span className="settings-image-theme__variants" role="group" aria-label="图片主题强调色">
          {IMAGE_THEME_VARIANTS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              data-image-theme-variant={item.id}
              title={item.label}
              aria-label={item.label}
              aria-pressed={active && variant === item.id}
              onClick={(event) => {
                event.stopPropagation();
                onVariantChange(item.id);
              }}
            >
              <i
                className={active && variant === item.id ? 'is-active' : undefined}
                style={{ background: variantColors[index] }}
              />
            </button>
          ))}
        </span>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className={clsx('settings-image-theme__delete', deleteConfirming && 'is-confirming')}
          title={deleteConfirming ? '再次点击确认删除' : '删除图片主题'}
          aria-label={deleteConfirming ? '确认删除图片主题' : '删除图片主题'}
          onClick={() => {
            if (deleteConfirming) onDelete();
            else setDeleteConfirming(true);
          }}
          onBlur={() => setDeleteConfirming(false)}
        >
          {deleteConfirming ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Trash2 size={14} aria-hidden="true" />
          )}
        </button>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          className="settings-image-theme__edit"
          title="编辑图片主题"
          aria-label="编辑图片主题"
          onClick={onEdit}
        >
          <PenLine size={14} aria-hidden="true" />
        </button>
      ) : null}
      {active ? (
        <span className="settings-image-theme__check">
          <Check size={10} aria-hidden="true" />
        </span>
      ) : null}
    </div>
  );
}

const IMAGE_THEME_VARIANTS: Array<{ id: ImageThemeVariant; label: string }> = [
  { id: 'mono', label: '纯灰' },
  { id: 'neutral', label: '中性' },
  { id: 'soft', label: '轻调' },
  { id: 'rich', label: '浓郁' },
];

function CustomImageThemeEditor({
  imageUrl,
  name,
  focalPoint,
  onClose,
  onSave,
}: {
  imageUrl: string;
  name: string;
  focalPoint: { x: number; y: number };
  onClose(): void;
  onSave(name: string, focalPoint: { x: number; y: number }): void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftFocalPoint, setDraftFocalPoint] = useState(focalPoint);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const updateFocalPoint = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setDraftFocalPoint({
      x: Math.round(((event.clientX - rect.left) / rect.width) * 100),
      y: Math.round(((event.clientY - rect.top) / rect.height) * 100),
    });
  };

  return (
    <div className="settings-image-editor__backdrop" onMouseDown={onClose}>
      <section
        className="settings-image-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-image-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="settings-image-editor-title">编辑图片主题</h2>
          <button type="button" aria-label="关闭图片主题编辑" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <label>
          <span>名称</span>
          <input
            type="text"
            value={draftName}
            maxLength={48}
            onChange={(event) => setDraftName(event.target.value)}
          />
        </label>
        <div className="settings-image-editor__focus">
          <span>焦点位置</span>
          <button
            type="button"
            aria-label="图片焦点位置"
            style={{
              backgroundImage: `url("${imageUrl}")`,
              backgroundPosition: `${draftFocalPoint.x}% ${draftFocalPoint.y}%`,
            }}
            onPointerDown={updateFocalPoint}
            onPointerMove={(event) => {
              if (event.buttons === 1) updateFocalPoint(event);
            }}
          >
            <i style={{ left: `${draftFocalPoint.x}%`, top: `${draftFocalPoint.y}%` }} />
          </button>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => onSave(draftName.trim() || name, draftFocalPoint)}
          >
            保存
          </button>
        </footer>
      </section>
    </div>
  );
}

export interface CompressedThemeImage {
  dataUrl: string;
  background: string;
  accent: string;
}

export async function compressThemeImage(file: File): Promise<CompressedThemeImage> {
  if (!file.type.startsWith('image/')) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('图片大小需小于 20 MB');
  const source = await readFileAsDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('图片内容无法读取'));
    element.src = source;
  });
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error('图片尺寸无效');
  }
  const scale = Math.min(1, 1600 / image.naturalWidth, 1000 / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('图片处理组件不可用');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const palette = extractImagePalette(context, canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL('image/webp', 0.82),
    ...palette,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片文件无法读取'));
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        resolve(reader.result);
        return;
      }
      reject(new Error('图片文件无法读取'));
    };
    reader.readAsDataURL(file);
  });
}

function extractImagePalette(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): { background: string; accent: string } {
  const sampleWidth = Math.min(80, width);
  const sampleHeight = Math.min(50, height);
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const sample = canvas.getContext('2d', { willReadFrequently: true });
  if (!sample) return { background: '#ffffff', accent: '#000000' };
  sample.drawImage(context.canvas, 0, 0, sampleWidth, sampleHeight);
  const palette = analyzeImageThemePixels(sample.getImageData(0, 0, sampleWidth, sampleHeight).data);
  return { background: palette.background, accent: palette.accent };
}

interface ShortcutDefinition {
  id: ShortcutId;
  label: string;
  description: string;
  allowSingleKey?: boolean;
  disabled?: boolean;
  displayAsRange?: boolean;
}

const SYSTEM_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: 'quickWindow',
    label: '快捷键唤起窗口',
    description: '在桌面任意位置显示或隐藏 SYNC-THINK',
  },
  {
    id: 'voiceInput',
    label: '语音输入',
    description: '按住快捷键录音，松开自动转录',
  },
];

const APP_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: 'newChat',
    label: '新建对话',
    description: '在当前工作区快速创建或切换到草稿对话',
  },
  {
    id: 'conversationSearch',
    label: '搜索对话',
    description: '打开侧边栏对话搜索',
  },
  {
    id: 'planMode',
    label: '切换规划模式',
    description: '开启或退出当前对话的规划模式',
  },
  {
    id: 'goalMode',
    label: '切换目标模式',
    description: '开启或退出当前对话的目标模式',
  },
  {
    id: 'promptEnhancement',
    label: '优化提示词',
    description: '输入普通文本后触发提示词优化',
    allowSingleKey: true,
  },
  {
    id: 'workspaceSwitch',
    label: '切换工作区',
    description: '按编号切换当前工作区',
    displayAsRange: true,
  },
  {
    id: 'closeTab',
    label: '关闭标签页',
    description: '关闭当前聚焦的文件、终端、浏览器或对话标签',
  },
  {
    id: 'saveFile',
    label: '保存文件',
    description: '保存当前文件编辑器内容',
  },
  {
    id: 'sidebarLeft',
    label: '收起 / 展开左侧边栏',
    description: '切换左侧导航与最近对话面板',
  },
  {
    id: 'sidebarRight',
    label: '收起 / 展开右侧文件面板',
    description: '切换右侧工作区文件列表面板',
  },
];

function ShortcutPreferencesPanel() {
  const [preferences, setPreferences] = useState<ShortcutPreferences>(() =>
    readShortcutPreferences(),
  );
  const [registrationError, setRegistrationError] = useState<string>();

  const commit = (id: ShortcutId, update: Partial<ShortcutPreferences[ShortcutId]>) => {
    const next = updateShortcutPreference(id, update);
    setPreferences(next);
    if (id === 'quickWindow') {
      void window.syncThink?.runtime
        ?.setGlobalShortcut?.({
          accelerator: next.quickWindow.accelerator,
          enabled: next.quickWindow.enabled,
        })
        .then((result) => {
          setRegistrationError(
            result.registered || !next.quickWindow.enabled
              ? undefined
              : (result.error ?? '快捷键注册失败'),
          );
        })
        .catch((error: unknown) =>
          setRegistrationError(error instanceof Error ? error.message : '快捷键注册失败'),
        );
    }
  };

  return (
    <div className="settings-shortcuts">
      <ShortcutGroup
        title="系统快捷键"
        definitions={SYSTEM_SHORTCUTS}
        preferences={preferences}
        onChange={commit}
      />
      {registrationError ? (
        <p className="settings-preferences__error" role="alert">
          {registrationError}
        </p>
      ) : null}
      <div className="settings-shortcuts__group-divider" />
      <ShortcutGroup
        title="应用快捷键"
        definitions={APP_SHORTCUTS}
        preferences={preferences}
        onChange={commit}
      />
    </div>
  );
}

function ShortcutGroup({
  title,
  definitions,
  preferences,
  onChange,
}: {
  title: string;
  definitions: ShortcutDefinition[];
  preferences: ShortcutPreferences;
  onChange(id: ShortcutId, update: Partial<ShortcutPreferences[ShortcutId]>): void;
}) {
  return (
    <section className="settings-shortcuts__group">
      <h2>{title}</h2>
      <div className="settings-shortcuts__rows">
        {definitions.map((definition) => (
          <ShortcutRow
            key={definition.id}
            definition={definition}
            preference={preferences[definition.id]}
            allPreferences={preferences}
            onChange={(update) => onChange(definition.id, update)}
          />
        ))}
      </div>
    </section>
  );
}

function ShortcutRow({
  definition,
  preference,
  allPreferences,
  onChange,
}: {
  definition: ShortcutDefinition;
  preference: ShortcutPreferences[ShortcutId];
  allPreferences: ShortcutPreferences;
  onChange(update: Partial<ShortcutPreferences[ShortcutId]>): void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!editing) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setEditing(false);
        setError(undefined);
        return;
      }
      const captured = acceleratorFromKeyboardEvent(event, definition.allowSingleKey);
      if (!captured) return;
      const accelerator = definition.displayAsRange ? captured.replace(/\+[^+]+$/, '+1') : captured;
      const conflict = (Object.keys(allPreferences) as ShortcutId[]).find(
        (id) =>
          id !== definition.id &&
          allPreferences[id].enabled &&
          allPreferences[id].accelerator === accelerator,
      );
      if (conflict) {
        setError(
          `已被“${[...SYSTEM_SHORTCUTS, ...APP_SHORTCUTS].find((item) => item.id === conflict)?.label ?? conflict}”使用`,
        );
        return;
      }
      onChange({ accelerator });
      setEditing(false);
      setError(undefined);
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [allPreferences, definition, editing, onChange]);

  const display = definition.displayAsRange
    ? `${formatShortcut(preference.accelerator).replace(/\+?1$/, '')} 1-9`
    : formatShortcut(preference.accelerator);

  return (
    <div className={clsx('settings-shortcut-row', definition.disabled && 'is-disabled')}>
      <div className="settings-shortcut-row__copy">
        <strong>{definition.label}</strong>
        <span>{definition.description}</span>
        {error ? <small role="alert">{error}</small> : null}
      </div>
      <div className="settings-shortcut-row__control">
        {preference.enabled && !definition.disabled ? (
          <button
            type="button"
            className={clsx('settings-shortcut-key', editing && 'is-editing')}
            aria-label={`修改${definition.label}快捷键`}
            onClick={() => setEditing(true)}
          >
            {editing ? '请按快捷键' : display}
          </button>
        ) : null}
        <PreferenceToggle
          checked={preference.enabled && !definition.disabled}
          disabled={definition.disabled}
          label={definition.label}
          onChange={(enabled) => onChange({ enabled })}
        />
      </div>
    </div>
  );
}

function readCachedPersonalization(): PersonalizationSetting {
  try {
    return normalizePersonalizationSetting(
      JSON.parse(localStorage.getItem(PERSONALIZATION_CACHE_KEY) ?? 'null'),
    );
  } catch {
    return normalizePersonalizationSetting(null);
  }
}

function PersonalizationPreferences() {
  const [profile, setProfile] = useState<PersonalizationSetting>(() => readCachedPersonalization());
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let disposed = false;
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getSettings) {
      setHydrated(true);
      return () => {
        disposed = true;
      };
    }
    void runtime
      .getSettings({ keys: [PERSONALIZATION_SETTING_KEY] })
      .then((response) => {
        if (disposed) return;
        const value = response.settings[PERSONALIZATION_SETTING_KEY];
        if (value !== undefined) setProfile(normalizePersonalizationSetting(value));
      })
      .finally(() => {
        if (!disposed) setHydrated(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setStatus('saving');
    const timer = window.setTimeout(() => {
      const normalized = normalizePersonalizationSetting(profile);
      try {
        localStorage.setItem(PERSONALIZATION_CACHE_KEY, JSON.stringify(normalized));
      } catch {
        // Runtime remains the source of truth when renderer storage is full.
      }
      writeUserName(normalized.name);
      window.dispatchEvent(new CustomEvent('shell-user-name-changed'));
      const persist = window.syncThink?.runtime?.setSetting?.({
        key: PERSONALIZATION_SETTING_KEY,
        value: normalized,
      });
      if (!persist) {
        setStatus('saved');
        return;
      }
      void persist.then(() => setStatus('saved')).catch(() => setStatus('error'));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [hydrated, profile]);

  return (
    <div className="settings-personalization">
      <label className="settings-personalization__field">
        <span>姓名</span>
        <small>让 AI 知道你是谁</small>
        <input
          type="text"
          value={profile.name}
          maxLength={PERSONALIZATION_LIMITS.name}
          placeholder="输入你的名字"
          onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <label className="settings-personalization__field">
        <span>工作描述</span>
        <small>帮助 AI 理解你的背景，以便提供更贴合的回答</small>
        <textarea
          rows={3}
          value={profile.workDescription}
          maxLength={PERSONALIZATION_LIMITS.workDescription}
          placeholder="例如：我是一名前端工程师，主要使用 React 和 TypeScript 开发 Web 应用"
          onChange={(event) =>
            setProfile((current) => ({ ...current, workDescription: event.target.value }))
          }
        />
      </label>
      <label className="settings-personalization__field">
        <span>全局提示词</span>
        <small>自定义指令会附加到每次对话的系统提示词中</small>
        <textarea
          rows={6}
          value={profile.globalPrompt}
          maxLength={PERSONALIZATION_LIMITS.globalPrompt}
          placeholder="给 AI 的自定义指令，例如：请用中文回答，代码注释用英文"
          onChange={(event) =>
            setProfile((current) => ({ ...current, globalPrompt: event.target.value }))
          }
        />
      </label>
      {status === 'error' ? (
        <span className="settings-personalization__status" role="alert">
          保存失败
        </span>
      ) : null}
    </div>
  );
}

function PreferenceToggle({
  checked,
  disabled,
  label,
  text,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  text?: string;
  onChange(value: boolean): void;
}) {
  return (
    <label className={clsx('settings-preference-toggle', disabled && 'is-disabled')}>
      {text ? <span>{text}</span> : null}
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        className={checked ? 'is-checked' : undefined}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </label>
  );
}

export function resetShortcutPreferences(): void {
  writeShortcutPreferences(
    Object.fromEntries(
      (Object.keys(DEFAULT_SHORTCUT_PREFERENCES) as ShortcutId[]).map((id) => [
        id,
        { ...DEFAULT_SHORTCUT_PREFERENCES[id] },
      ]),
    ) as ShortcutPreferences,
  );
}
