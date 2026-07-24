// P7/P8 · Settings Page
// NewMax-style settings: left nav + right content.
// Sections: 主题 / 通用 / 模型 / 使用统计 / 关于
import { useState } from 'react';
import {
  BarChart3, Bot, Check, Info,
  Monitor, Moon, Palette, Settings, Shield, Sun, Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { ModelSettings, UsageSettings } from './ModelSettings.js';

// ─── Types ──────────────────────────────────────────────────────────────────

type ThemeMode = 'system' | 'light' | 'dark';
type SettingsSection = 'theme' | 'general' | 'models' | 'usage' | 'about';
type PermissionDefault = 'read-only' | 'workspace' | 'full-access';

// ─── Theme helpers ──────────────────────────────────────────────────────────

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

// ─── Section nav ────────────────────────────────────────────────────────────

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof Palette }> = [
  { id: 'theme',   label: '主题',     icon: Palette },
  { id: 'general', label: '通用',     icon: Settings },
  { id: 'models',  label: '模型',     icon: Bot },
  { id: 'usage',   label: '使用统计', icon: BarChart3 },
  { id: 'about',   label: '关于',     icon: Info },
];

// ─── Root ────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>('theme');

  // Models / usage need the full pane (dual-column); others keep the narrow shell.
  const fullBleed = section === 'models' || section === 'usage';

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left nav */}
      <nav className="flex w-[180px] shrink-0 flex-col border-r border-border bg-surface px-2 py-4">
        <p className="mb-3 px-2 text-[11px] font-medium uppercase tracking-wide text-text-faint">
          设置
        </p>
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={clsx(
                'mb-0.5 flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
                active
                  ? 'bg-accent-soft font-medium text-accent-text'
                  : 'text-text-secondary hover:bg-hover hover:text-text',
              )}
            >
              <Icon size={15} />
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <div className={clsx('flex-1', fullBleed ? 'overflow-hidden' : 'overflow-y-auto')}>
        {section === 'theme'   && <ThemeSection />}
        {section === 'general' && <GeneralSection />}
        {section === 'models'  && <ModelSettings />}
        {section === 'usage'   && <UsageSettings />}
        {section === 'about'   && <AboutSection />}
      </div>
    </div>
  );
}

// ─── Theme section ───────────────────────────────────────────────────────────

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; desc: string; icon: typeof Sun }> = [
  { mode: 'light',  label: '浅色', desc: '始终使用浅色外观',  icon: Sun },
  { mode: 'dark',   label: '深色', desc: '始终使用深色外观',  icon: Moon },
  { mode: 'system', label: '跟随系统', desc: '跟随操作系统设置自动切换', icon: Monitor },
];

function ThemeSection() {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  const handleSelect = (mode: ThemeMode) => {
    setTheme(mode);
    applyShellTheme(mode);
  };

  return (
    <ContentShell title="主题">
      <SettingGroup label="外观模式">
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(({ mode, label, desc }) => {
            const active = theme === mode;
            return (
              <button
                key={mode}
                onClick={() => handleSelect(mode)}
                className={clsx(
                  'relative flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center transition-all',
                  active
                    ? 'border-accent/50 bg-accent-soft shadow-sm'
                    : 'border-border bg-surface hover:border-border-strong hover:shadow-sm',
                )}
              >
                {active && (
                  <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent">
                    <Check size={10} className="text-white" />
                  </span>
                )}
                <ThemePreview mode={mode} />
                <div>
                  <p className={clsx('text-[13px] font-medium', active ? 'text-accent-text' : 'text-text')}>
                    {label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-faint">{desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </SettingGroup>

      <SettingGroup label="提示" className="mt-6">
        <p className="text-[12.5px] text-text-secondary leading-relaxed">
          主题切换立即生效，无需重启。下次打开时将保留您的选择。
        </p>
      </SettingGroup>
    </ContentShell>
  );
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const bg = isDark ? '#151815' : '#f7f8f7';
  const sidebar = isDark ? '#1c201c' : '#ffffff';
  const line = isDark ? '#2c322c' : '#e4e7e4';
  const dot = '#4caf7a';

  return (
    <div
      className="h-12 w-full overflow-hidden rounded-lg border"
      style={{ background: bg, borderColor: line }}
    >
      <div className="flex h-full">
        <div className="w-8 h-full" style={{ background: sidebar, borderRight: `1px solid ${line}` }}>
          {[0,1,2].map(i => (
            <div key={i} className="mx-1 my-1 h-1 rounded-full" style={{ background: line, marginTop: i === 0 ? 4 : 3 }} />
          ))}
        </div>
        <div className="flex-1 p-1.5 flex flex-col gap-1">
          <div className="h-1.5 w-3/4 rounded-full" style={{ background: line }} />
          <div className="flex justify-end">
            <div className="h-1.5 w-1/2 rounded-full" style={{ background: dot, opacity: 0.6 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── General section ─────────────────────────────────────────────────────────

const PERMISSION_OPTIONS: Array<{ value: PermissionDefault; label: string; desc: string; icon: typeof Shield }> = [
  { value: 'read-only',   label: '询问批准', desc: '几乎所有工具操作都先询问你',       icon: Shield },
  { value: 'workspace',   label: '为我批准', desc: '低风险操作自动执行，危险操作再问', icon: Shield },
  { value: 'full-access', label: '完全访问', desc: '直接执行可用操作，只记录审计日志', icon: Zap },
];

function GeneralSection() {
  const [permission, setPermission] = useState<PermissionDefault>(() =>
    (localStorage.getItem('sync-think-default-permission') as PermissionDefault) || 'workspace',
  );

  const handlePermission = (val: PermissionDefault) => {
    setPermission(val);
    localStorage.setItem('sync-think-default-permission', val);
  };

  return (
    <ContentShell title="通用">
      <SettingGroup label="默认权限模式" hint="新建对话时使用的默认权限档。可以在每条对话的 Compose 工具栏中随时修改。">
        <div className="space-y-2">
          {PERMISSION_OPTIONS.map(({ value, label, desc, icon: Icon }) => {
            const active = permission === value;
            return (
              <button
                key={value}
                onClick={() => handlePermission(value)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                  active
                    ? 'border-accent/40 bg-accent-soft'
                    : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <Icon size={16} className={active ? 'text-accent-text' : 'text-text-faint'} />
                <div className="flex-1">
                  <p className={clsx('text-[13px] font-medium', active ? 'text-accent-text' : 'text-text')}>
                    {label}
                  </p>
                  <p className="text-[11.5px] text-text-faint">{desc}</p>
                </div>
                {active && <Check size={14} className="text-accent shrink-0" />}
              </button>
            );
          })}
        </div>
      </SettingGroup>
    </ContentShell>
  );
}

// ─── About section ────────────────────────────────────────────────────────────

function AboutSection() {
  return (
    <ContentShell title="关于">
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-white text-[28px] font-bold shadow-lg">
          S
        </div>
        <div className="text-center">
          <h2 className="text-[18px] font-semibold text-text">Sync-Think</h2>
          <p className="mt-1 text-[13px] text-text-secondary">AI 工作助手 · 多智能体编排工作台</p>
          <p className="mt-0.5 text-[12px] text-text-faint">版本 0.1.0-dev</p>
        </div>
      </div>

      <SettingGroup label="技术栈">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['运行环境', 'Electron + Node.js'],
            ['界面框架', 'React + Tailwind v4'],
            ['数据库', 'SQLite (better-sqlite3)'],
            ['协议', 'Named Pipe + JSON'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="text-[11px] text-text-faint">{k}</p>
              <p className="text-[12.5px] text-text">{v}</p>
            </div>
          ))}
        </div>
      </SettingGroup>
    </ContentShell>
  );
}

// ─── Shared layout helpers ───────────────────────────────────────────────────

function ContentShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[620px] px-8 py-8">
      <h1 className="mb-6 text-[18px] font-semibold text-text">{title}</h1>
      {children}
    </div>
  );
}

function SettingGroup({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx('mb-6', className)}>
      <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-text-faint">{label}</p>
      {hint && <p className="mb-3 text-[12.5px] text-text-secondary leading-relaxed">{hint}</p>}
      {children}
    </div>
  );
}
