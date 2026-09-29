import { TOKEN_CATALOG } from './catalog.generated.js';
import { NEWMAX_NAMED_THEME_VARS } from '../theme/newmax-named-themes.js';

export type PreviewMode = 'light' | 'dark';
export type ThemeValues = Record<string, string>;
export const PRESETS = [
  { id: 'default', label: '当前默认', detail: 'Token JSON · 中性蓝' },
  { id: 'azure', label: 'Azure', detail: '现有命名主题 · 蓝色' },
  { id: 'claude', label: 'Claude', detail: '现有命名主题 · 暖灰' },
] as const;
export type PresetId = (typeof PRESETS)[number]['id'];
export interface DesignDraft {
  version: 1;
  mode: PreviewMode;
  preset: PresetId;
  overrides: Record<PreviewMode, ThemeValues>;
}
export const STORAGE_KEY = 'sync-think.design-system.draft.v1';
export const newDraft = (): DesignDraft => ({
  version: 1,
  mode: 'light',
  preset: 'default',
  overrides: { light: {}, dark: {} },
});
const allowed = new Set(TOKEN_CATALOG.map((token) => token.name));
// Same semantic roles used by the shipping appearance adapter. Workbench and
// composer colors are explicitly mapped so nested specimens do not inherit the host skin.
const aliases: Record<string, string> = {
  '--color-text': '--ds-text-primary',
  '--color-text-secondary': '--ds-text-secondary',
  '--color-text-faint': '--ds-text-tertiary',
  '--color-icon': '--ds-icon',
  '--color-accent': '--ds-brand-primary',
  '--color-accent-fg': '--ds-brand-primary-text',
  '--color-settings-action': '--ds-brand-primary',
  '--color-settings-action-fg': '--ds-brand-primary-text',
  '--color-selection-border': '--ds-brand-primary',
  '--color-focus-ring': '--ds-brand-primary',
  '--color-info': '--ds-brand-primary',
  '--color-success': '--ds-brand-primary',
  '--color-hover': '--ds-on-surface',
  '--color-control-hover': '--ds-on-surface',
  '--color-border': '--ds-divider',
  '--color-page': '--ds-surface-200',
  '--color-page-gutter': '--ds-surface-200',
  '--color-panel': '--ds-surface-200',
  '--color-chat': '--ds-surface-200',
  '--color-surface': '--ds-surface-100',
  '--color-overlay': '--ds-surface-100',
  '--color-control': '--ds-surface-100',
  '--color-active': '--ds-surface-100',
  '--color-selection': '--ds-surface-100',
  '--color-sidebar': '--ds-surface-300',
  '--color-elevated': '--ds-surface-300',
  '--color-recent': '--ds-surface-300',
  '--color-stage-tabs': '--ds-surface-300',
  '--color-workbench': '--ds-surface-200',
  '--color-workbench-content': '--ds-surface-200',
  '--color-tab-strip': '--ds-surface-200',
  '--composer-surface': '--ds-surface-300',
  '--composer-text': '--ds-text-primary',
  '--composer-text-secondary': '--ds-text-secondary',
  '--composer-text-faint': '--ds-text-tertiary',
};
export function themeValues(draft: DesignDraft, mode: PreviewMode = draft.mode): ThemeValues {
  const values = Object.fromEntries(TOKEN_CATALOG.map((t) => [t.name, t[mode]]));
  if (draft.preset !== 'default') {
    const named = NEWMAX_NAMED_THEME_VARS[draft.preset][mode] as Record<string, string>;
    for (const [name, source] of Object.entries(aliases))
      if (named[source]) values[name] = named[source];
    values['--color-accent-soft'] =
      'color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))';
    values['--color-accent-text'] = 'var(--color-accent)';
  }
  return { ...values, ...draft.overrides[mode] };
}
export function validTokenValue(name: string, value: unknown): value is string {
  if (
    !allowed.has(name) ||
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1500 ||
    /[;{}<>]|url\s*\(|\/\*/i.test(value)
  )
    return false;
  const token = TOKEN_CATALOG.find((t) => t.name === name)!;
  if (token.group === 'fonts') return true;
  const property =
    name === '--shell-tab-shadow'
      ? 'filter'
      : /shadow/.test(name)
        ? 'box-shadow'
        : /ease/.test(name)
          ? 'transition-timing-function'
          : /duration/.test(name)
            ? 'transition-duration'
            : name.startsWith('--color-') ||
                name.startsWith('--preference-color-') ||
                token.group === 'tabs' ||
                /^(surface|border(?:-strong)?|text(?:-secondary|-faint)?|hover)$/.test(
                  name.replace('--composer-', ''),
                )
              ? 'color'
              : /padding/.test(name)
                ? 'padding'
                : /margin/.test(name)
                  ? 'margin'
                  : /line-height/.test(name)
                    ? 'line-height'
                    : 'width';
  return (
    typeof CSS === 'undefined' ||
    typeof CSS.supports !== 'function' ||
    CSS.supports(property, value)
  );
}
export function parseDraft(raw: string): DesignDraft {
  const input: unknown = JSON.parse(raw);
  if (!input || typeof input !== 'object') throw new Error('主题数据需要是对象');
  const d = input as Partial<DesignDraft>;
  if (
    d.version !== 1 ||
    !['light', 'dark'].includes(d.mode ?? '') ||
    !PRESETS.some((p) => p.id === d.preset) ||
    !d.overrides
  )
    throw new Error('主题格式或版本不匹配');
  const draft = newDraft();
  draft.mode = d.mode!;
  draft.preset = d.preset!;
  for (const mode of ['light', 'dark'] as const) {
    const entries = d.overrides[mode];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries))
      throw new Error('缺少明暗主题数据');
    for (const [name, value] of Object.entries(entries)) {
      if (!validTokenValue(name, value)) throw new Error(`无效 token: ${name}`);
      draft.overrides[mode][name] = value;
    }
  }
  return draft;
}
export function readDraft(): DesignDraft {
  try {
    return parseDraft(localStorage.getItem(STORAGE_KEY) ?? '');
  } catch {
    return newDraft();
  }
}
export function exportThemeCss(draft: DesignDraft): string {
  return [
    '/* SYNC-THINK theme preview. Explicitly scope this class before applying. */',
    ...(['light', 'dark'] as const).map(
      (mode) =>
        `.design-system-theme${mode === 'dark' ? '.dark' : ':not(.dark)'} {\n${Object.entries(
          themeValues(draft, mode),
        )
          .map(([k, v]) => `  ${k}: ${v};`)
          .join('\n')}\n}`,
    ),
  ].join('\n\n');
}
