// P7/P8 · Settings Page
// Strictly follows the NewMax settings information architecture shown in the
// product reference screenshots: searchable left navigation, compact rows,
// page-local tabs, and a fixed completion action.
import { useMemo, useState } from 'react';
import {
  BarChart3,
  Bot,
  Check,
  CircleUserRound,
  Database,
  Info,
  Keyboard,
  Mic2,
  Monitor,
  Moon,
  Palette,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import clsx from 'clsx';
import { ModelSettings } from './ModelSettings.js';

type ThemeMode = 'system' | 'light' | 'dark';
type SettingsSection =
  | 'account'
  | 'wallet'
  | 'organization'
  | 'general'
  | 'theme'
  | 'shortcuts'
  | 'models'
  | 'voice'
  | 'insights'
  | 'connection'
  | 'security'
  | 'plugins'
  | 'data'
  | 'about';
type PermissionDefault = 'read-only' | 'workspace' | 'full-access';

const THEME_KEY = 'sync-think-shell-theme';

function readStoredTheme(): ThemeMode {
  return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'system';
}

export function applyShellTheme(mode: ThemeMode): void {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem(THEME_KEY, mode);
  window.dispatchEvent(new CustomEvent('shell-theme-applied', { detail: { mode, dark } }));
}

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof Palette;
  ready: boolean;
  keywords?: string;
}> = [
  { id: 'account', label: '账号', icon: CircleUserRound, ready: false },
  { id: 'wallet', label: '钱包', icon: WalletCards, ready: false },
  { id: 'organization', label: '组织', icon: UsersRound, ready: false },
  { id: 'general', label: '通用', icon: Settings, ready: true, keywords: '动画 权限 个性化' },
  { id: 'theme', label: '主题', icon: Palette, ready: true, keywords: '浅色 深色 外观' },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard, ready: false },
  {
    id: 'models',
    label: '模型',
    icon: Bot,
    ready: true,
    keywords: '供应商 API 密钥 CC Switch 使用统计',
  },
  { id: 'voice', label: '语音模型', icon: Mic2, ready: false },
  { id: 'insights', label: '每日回顾', icon: BarChart3, ready: false },
  { id: 'connection', label: '连接', icon: Plug, ready: false },
  { id: 'security', label: '安全查杀', icon: ShieldCheck, ready: false },
  { id: 'plugins', label: '插件', icon: Sparkles, ready: false },
  { id: 'data', label: '数据', icon: Database, ready: false },
  { id: 'about', label: '关于', icon: Info, ready: true },
];

export interface SettingsPageProps {
  onDone?(): void;
  onCatalogChanged?(): void;
}

export function SettingsPage({ onDone, onCatalogChanged }: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>('general');
  const [query, setQuery] = useState('');

  const visibleSections = useMemo(() => {
    const value = query.trim().toLocaleLowerCase('zh-CN');
    if (!value) return SECTIONS;
    return SECTIONS.filter((item) =>
      `${item.label} ${item.keywords ?? ''}`.toLocaleLowerCase('zh-CN').includes(value),
    );
  }, [query]);

  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[3];
  const fullBleed = section === 'models';

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <div className="settings-sidebar__header">
          <span>设置</span>
          <kbd>Ctrl ,</kbd>
        </div>
        <label className="settings-search">
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索"
            aria-label="搜索设置"
          />
        </label>
        <nav className="settings-nav" aria-label="设置分类">
          {visibleSections.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={clsx('settings-nav__item', active && 'is-active')}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
          {visibleSections.length === 0 ? (
            <p className="settings-nav__empty">没有匹配的设置</p>
          ) : null}
        </nav>
      </aside>

      <section className={clsx('settings-content', fullBleed && 'is-full-bleed')}>
        <div className="settings-content__topbar">
          <h1>{current.label}</h1>
        </div>
        <div className="settings-content__viewport">
          {section === 'general' && <GeneralSection />}
          {section === 'theme' && <ThemeSection />}
          {section === 'models' && <ModelSettings onCatalogChanged={onCatalogChanged} />}
          {section === 'about' && <AboutSection />}
          {!current.ready && <ComingSoonSection label={current.label} />}
        </div>
        <footer className="settings-footer">
          <button type="button" className="settings-done" onClick={onDone}>
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; icon: typeof Sun }> = [
  { mode: 'light', label: '浅色', icon: Sun },
  { mode: 'dark', label: '深色', icon: Moon },
  { mode: 'system', label: '跟随系统', icon: Monitor },
];

function ThemeSection() {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  const handleSelect = (mode: ThemeMode) => {
    setTheme(mode);
    applyShellTheme(mode);
  };

  return (
    <div className="settings-scroll settings-standard-pane">
      <section className="settings-block">
        <h2>外观</h2>
        <div className="settings-theme-grid" role="radiogroup" aria-label="外观主题">
          {THEME_OPTIONS.map(({ mode, label, icon: Icon }) => {
            const active = theme === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleSelect(mode)}
                className={clsx('settings-theme-option', active && 'is-active')}
              >
                <ThemePreview mode={mode} />
                <span className="settings-theme-option__label">
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </span>
                {active ? <Check size={14} className="settings-theme-check" /> : null}
              </button>
            );
          })}
        </div>
      </section>
      <p className="settings-note">主题切换会立即生效，并在下次启动时保留。</p>
    </div>
  );
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className={clsx('settings-theme-preview', isDark && 'is-dark')} aria-hidden="true">
      <span className="settings-theme-preview__sidebar" />
      <span className="settings-theme-preview__line is-long" />
      <span className="settings-theme-preview__line" />
    </div>
  );
}

const PERMISSION_OPTIONS: Array<{
  value: PermissionDefault;
  label: string;
  desc: string;
}> = [
  { value: 'read-only', label: '询问批准', desc: '执行工具前先询问你' },
  { value: 'workspace', label: '为我批准', desc: '在工作区内自动执行' },
  { value: 'full-access', label: '完全访问', desc: '直接执行并保留审计记录' },
];

function GeneralSection() {
  const [tab, setTab] = useState<'general' | 'personal'>('general');
  const [permission, setPermission] = useState<PermissionDefault>(
    () =>
      (localStorage.getItem('sync-think-default-permission') as PermissionDefault) || 'workspace',
  );
  const [animationEnabled, setAnimationEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem('sync-think-animation');
    return stored === null ? true : stored === '1';
  });

  const handlePermission = (value: PermissionDefault) => {
    setPermission(value);
    localStorage.setItem('sync-think-default-permission', value);
  };

  const handleAnimation = (enabled: boolean) => {
    setAnimationEnabled(enabled);
    localStorage.setItem('sync-think-animation', enabled ? '1' : '0');
    document.documentElement.toggleAttribute('data-reduced-motion', !enabled);
  };

  return (
    <div className="settings-scroll settings-standard-pane">
      <div className="settings-segmented" role="tablist" aria-label="通用设置分类">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'general'}
          className={tab === 'general' ? 'is-active' : undefined}
          onClick={() => setTab('general')}
        >
          通用
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'personal'}
          className={tab === 'personal' ? 'is-active' : undefined}
          onClick={() => setTab('personal')}
        >
          个性化
        </button>
      </div>

      {tab === 'general' ? (
        <>
          <div className="settings-rows">
            <SettingRow
              title="界面动画"
              description="开启界面过渡动画"
              control={
                <Toggle checked={animationEnabled} label="界面动画" onChange={handleAnimation} />
              }
            />
            <SettingRow
              title="命令白名单"
              description="允许自动运行的命令"
              control={
                <Toggle checked={false} label="命令白名单" disabled onChange={() => undefined} />
              }
            />
          </div>

          <section className="settings-permission-section">
            <h2>权限模式</h2>
            <div className="settings-permission-grid" role="radiogroup" aria-label="默认权限模式">
              {PERMISSION_OPTIONS.map(({ value, label, desc }) => {
                const active = permission === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={clsx('settings-permission-option', active && 'is-active')}
                    onClick={() => handlePermission(value)}
                  >
                    <span>{label}</span>
                    <small>{desc}</small>
                    {active ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <div className="settings-empty-panel">
          <CircleUserRound size={24} aria-hidden="true" />
          <p>个性化设置将在后续切片接入。</p>
        </div>
      )}
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settings-scroll settings-standard-pane">
      <div className="settings-about-head">
        <div className="settings-app-mark">S</div>
        <div>
          <h2>Sync-Think</h2>
          <p>AI 工作助手 · 多智能体编排工作台</p>
          <span>版本 0.1.0-dev</span>
        </div>
      </div>
      <div className="settings-rows">
        <SettingRow title="运行环境" description="Electron + Node.js" />
        <SettingRow title="界面框架" description="React + Tailwind v4" />
        <SettingRow title="数据库" description="SQLite (better-sqlite3)" />
      </div>
    </div>
  );
}

function ComingSoonSection({ label }: { label: string }) {
  return (
    <div className="settings-scroll settings-standard-pane">
      <div className="settings-empty-panel">
        <p>“{label}”能力尚未接入。</p>
        <span>入口按照 NewMax 信息架构保留，接入时不会再调整设置布局。</span>
      </div>
    </div>
  );
}

function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control?: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div>
        <p>{title}</p>
        {description ? <span>{description}</span> : null}
      </div>
      {control ? <div className="settings-row__control">{control}</div> : null}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('settings-toggle', checked && 'is-checked')}
    >
      <span />
    </button>
  );
}
