// P7/P8 · Settings Page
// Follows the SYNC-THINK settings information architecture shown in the
// product reference screenshots: searchable left navigation, compact rows,
// page-local tabs, and a fixed completion action.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaemonCard } from './DaemonCard.js';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  CircleUserRound,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Info,
  Keyboard,
  Link2,
  LoaderCircle,
  MessageCircle,
  Mic2,
  Monitor,
  Network,
  Palette,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  Upload,
  WandSparkles,
  WalletCards,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  BotChannelConfigSummary,
  DataStorageStatsResponse,
  McpServerSummary,
  WorkspaceSummary,
} from '@sync-think/protocol';
import {
  SYNC_THINK_CONNECTOR_CATALOG,
  type ManagedConnectorCatalogItem,
} from './connector-catalog.js';
import telegramIcon from './assets/connectors/telegram.png';
import { BotConversationPane } from './BotConversationPane.js';
import { WebSearchSettings } from './WebSearchSettings.js';
import {
  COMPUTER_USE_PLUGIN_SETTING_KEY,
  normalizeComputerUsePluginSetting,
} from '@sync-think/protocol/plugins';
import {
  COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY,
  normalizeComputerUseApprovalPolicySetting,
  removePersistentComputerUseApp,
  type ComputerUseApprovalPolicySetting,
  type PersistentComputerUseApp,
} from '@sync-think/protocol/tool-approval';
// Subpath import on purpose: the protocol barrel reaches node:os / node:crypto
// through the pipe + handshake modules, which cannot be bundled for the renderer.
import {
  OPEN_GATEWAY_SETTING_KEY,
  normalizeOpenGatewaySetting,
  type GatewayLogsFilter,
  type GatewayRequestLogEntry,
  type OpenGatewaySetting,
  type OpenGatewayStatusResponse,
  type OpenGatewayUpstreamProtocol,
} from '@sync-think/protocol/gateway';
import {
  ModelSettings,
  type ModelSettingsDetailView,
  type ModelSettingsHandle,
} from './ModelSettings.js';
import { DesktopUpdatePanel } from './DesktopUpdatePanel.js';
import { KernelUpdatePanel } from './KernelUpdatePanel.js';
import { SlidingTabs } from './SlidingTabs.js';
import { PreferencesSettings } from './PreferencesSettings.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo, resolveKernelDisplayName } from './brand-icons.js';
import { decideSettingsPageAction } from './settings-unsaved.js';
import {
  applyShellMotionPreference,
  readAgentPreferences,
  readDefaultPermission,
  writeAgentPreferences,
  writeDefaultPermission,
  type AgentPreferences,
  type AgentThinkingBudget,
  type DefaultPermissionPreference,
} from '../ui-preferences.js';

export type SettingsSection =
  | 'account'
  | 'wallet'
  | 'general'
  | 'theme'
  | 'shortcuts'
  | 'models'
  | 'voice'
  | 'insights'
  | 'connection'
  | 'security'
  | 'plugins'
  | 'computer-use'
  | 'data'
  | 'about';
type PermissionDefault = DefaultPermissionPreference;

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof Palette;
  ready: boolean;
  visible?: boolean;
  keywords?: string;
}> = [
  { id: 'account', label: '账号', icon: CircleUserRound, ready: false },
  { id: 'wallet', label: '钱包', icon: WalletCards, ready: false },
  { id: 'general', label: '通用', icon: Settings, ready: true, keywords: '动画 权限' },
  {
    id: 'theme',
    label: '偏好',
    icon: WandSparkles,
    ready: true,
    keywords: '主题 浅色 深色 外观 图片 配色 字体 快捷键 个性化 提示词',
  },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard, ready: false, visible: false },
  {
    id: 'models',
    label: '模型',
    icon: Bot,
    ready: true,
    keywords: '供应商 API 密钥 CC Switch 使用统计',
  },
  { id: 'voice', label: '语音模型', icon: Mic2, ready: false, visible: false },
  { id: 'insights', label: '每日回顾', icon: BarChart3, ready: false },
  {
    id: 'connection',
    label: '连接',
    icon: Plug,
    ready: true,
    keywords: 'AI 模型网关 协议转换 Claude Code Codex 反向代理 baseUrl 端口 /v1/models',
  },
  { id: 'security', label: '安全查杀', icon: ShieldCheck, ready: false, visible: false },
  {
    id: 'plugins',
    label: '插件',
    icon: Sparkles,
    ready: true,
    visible: false,
    keywords: 'Computer Use 桌面 UIA 自动化',
  },
  {
    id: 'computer-use',
    label: '电脑操作',
    icon: Monitor,
    ready: true,
    keywords: 'Computer Use 桌面 Windows UIA 自动化 任何应用',
  },
  {
    id: 'data',
    label: '数据',
    icon: Database,
    ready: true,
    keywords: '诊断 导出 隐私 崩溃 恢复 日志',
  },
  { id: 'about', label: '关于', icon: Info, ready: true },
];

const AVAILABLE_SECTIONS = SECTIONS.filter((item) => item.ready && item.visible !== false);

function resolveSettingsSection(section?: SettingsSection): SettingsSection {
  if (section === 'plugins') return 'computer-use';
  if (section === 'shortcuts') return 'theme';
  return AVAILABLE_SECTIONS.some((item) => item.id === section) ? section! : 'general';
}

export interface SettingsPageProps {
  initialSection?: SettingsSection;
  initialModelDetail?: ModelSettingsDetailView;
  initialConnectionTab?: ConnectionTab;
  navigationKey?: string | number;
  onDone?(): void;
  onCatalogChanged?(): void;
  onDirtyChange?(dirty: boolean): void;
}

export function SettingsPage({
  initialSection,
  initialModelDetail,
  initialConnectionTab,
  navigationKey,
  onDone,
  onCatalogChanged,
  onDirtyChange,
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>(() => resolveSettingsSection(initialSection));
  const [query, setQuery] = useState('');
  const [modelDirty, setModelDirty] = useState(false);
  const [completing, setCompleting] = useState(false);
  const modelSettingsRef = useRef<ModelSettingsHandle | null>(null);

  useEffect(() => {
    if (initialSection) setSection(resolveSettingsSection(initialSection));
  }, [initialSection, navigationKey]);

  const reportDirty = useCallback(
    (dirty: boolean) => {
      setModelDirty(dirty);
      onDirtyChange?.(dirty);
    },
    [onDirtyChange],
  );

  const handleDone = async () => {
    if (completing) return;
    // When on the models page, force connectivity test before close/save.
    if (section === 'models' && modelSettingsRef.current) {
      setCompleting(true);
      try {
        const ok = await modelSettingsRef.current.complete();
        if (!ok) return;
        reportDirty(false);
      } finally {
        setCompleting(false);
      }
    }
    onDone?.();
  };

  const visibleSections = useMemo(() => {
    const value = query.trim().toLocaleLowerCase('zh-CN');
    if (!value) return AVAILABLE_SECTIONS;
    return AVAILABLE_SECTIONS.filter((item) =>
      `${item.label} ${item.keywords ?? ''}`.toLocaleLowerCase('zh-CN').includes(value),
    );
  }, [query]);

  const current =
    AVAILABLE_SECTIONS.find((item) => item.id === section)!;
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
                onClick={() => {
                  const decision = decideSettingsPageAction(
                    {
                      kind: 'select-section',
                      currentSection: section,
                      nextSection: item.id,
                    },
                    modelDirty,
                    (message) => confirm(message),
                  );
                  if (decision.kind !== 'select-section') return;
                  if (decision.discardChanges) reportDirty(false);
                  setSection(decision.section as SettingsSection);
                }}
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
          {section === 'theme' && <PreferencesSettings />}
          {section === 'models' && (
            <ModelSettings
              ref={modelSettingsRef}
              initialDetailView={initialModelDetail}
              navigationKey={navigationKey}
              onCatalogChanged={onCatalogChanged}
              onDirtyChange={reportDirty}
            />
          )}
          {(section === 'plugins' || section === 'computer-use') && <ComputerUsePluginSection />}
          {section === 'connection' && (
            <ConnectionSection initialTab={initialConnectionTab} navigationKey={navigationKey} />
          )}
          {section === 'data' && <DataDiagnosticsSection />}
          {section === 'about' && <AboutSection />}
        </div>
        <footer className="settings-footer">
          <button
            type="button"
            className="settings-done"
            disabled={completing}
            onClick={() => void handleDone()}
          >
            {completing ? '测试连接中…' : '完成'}
          </button>
        </footer>
      </section>
    </div>
  );
}

const PERMISSION_OPTIONS: Array<{
  value: PermissionDefault;
  label: string;
  desc: string;
}> = [
  { value: 'ask', label: '询问批准', desc: '执行工具前先询问你' },
  { value: 'workspace', label: '为我批准', desc: '在工作区内自动执行' },
  { value: 'full-access', label: '完全访问', desc: '直接执行并保留审计记录' },
];

type GeneralTab = 'app' | 'agent' | 'task';

const GENERAL_TABS: Array<{ id: GeneralTab; label: string }> = [
  { id: 'app', label: '应用' },
  { id: 'agent', label: 'Agent' },
  { id: 'task', label: '任务' },
];

const THINKING_OPTIONS: Array<{ value: AgentThinkingBudget; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'minimal', label: '极低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' },
  { value: 'max', label: '最高' },
  { value: 'off', label: '关闭' },
];

function GeneralSection() {
  const [tab, setTab] = useState<GeneralTab>('app');
  const [permission, setPermission] = useState<PermissionDefault>(() => readDefaultPermission());
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferences>(() =>
    readAgentPreferences(),
  );
  const [animationEnabled, setAnimationEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem('sync-think-animation');
    return stored === null ? true : stored === '1';
  });

  const handlePermission = (value: PermissionDefault) => {
    setPermission(value);
    writeDefaultPermission(value);
  };

  const handleAnimation = (enabled: boolean) => {
    setAnimationEnabled(enabled);
    localStorage.setItem('sync-think-animation', enabled ? '1' : '0');
    applyShellMotionPreference(enabled);
  };

  const updateAgentPreference = <K extends keyof AgentPreferences>(
    key: K,
    value: AgentPreferences[K],
  ) => {
    const next = { ...agentPreferences, [key]: value } as AgentPreferences;
    setAgentPreferences(next);
    writeAgentPreferences(next);
  };

  return (
    <div className="settings-scroll settings-standard-pane settings-general-page">
      <div className="settings-general-tabs" role="tablist" aria-label="通用设置分类">
        {GENERAL_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={clsx(tab === id && 'is-active')}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="settings-general-panel" key={tab}>
        {tab === 'app' ? (
          <div className="settings-rows">
            <SettingRow
              title="界面动画"
              description="开启界面过渡动画"
              control={
                <Toggle checked={animationEnabled} label="界面动画" onChange={handleAnimation} />
              }
            />
          </div>
        ) : null}

        {tab === 'agent' ? (
          <AgentGeneralPanel
            permission={permission}
            agentPreferences={agentPreferences}
            onPermissionChange={handlePermission}
            onAgentPreferenceChange={updateAgentPreference}
          />
        ) : null}

        {tab === 'task' ? <DaemonCard /> : null}
      </div>
    </div>
  );
}

function AgentGeneralPanel({
  permission,
  agentPreferences,
  onPermissionChange,
  onAgentPreferenceChange,
}: {
  permission: PermissionDefault;
  agentPreferences: AgentPreferences;
  onPermissionChange(value: PermissionDefault): void;
  onAgentPreferenceChange<K extends keyof AgentPreferences>(
    key: K,
    value: AgentPreferences[K],
  ): void;
}) {
  return (
    <div className="settings-general-agent">
      <section className="settings-general-block" aria-labelledby="settings-permission-title">
        <h2 id="settings-permission-title">权限模式</h2>
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
                onClick={() => onPermissionChange(value)}
              >
                <span>{label}</span>
                <small>{desc}</small>
                {active ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="settings-general-block" aria-labelledby="settings-prompt-title">
        <SettingRow
          title="提示词优化"
          description="开启后，输入框有内容时悬停可点击优化按钮；只改写草稿，不会自动发送。"
          control={
            <Toggle
              checked={agentPreferences.promptEnhancementEnabled}
              label="提示词优化"
              onChange={(value) => onAgentPreferenceChange('promptEnhancementEnabled', value)}
            />
          }
        />
        <div className="settings-general-select-row">
          <div>
            <p id="settings-prompt-title">优化模型</p>
            <span>建议选择响应速度较快的模型，例如 Gemini Flash、GPT mini 或 Claude Haiku。</span>
          </div>
          <AgentModelSelect
            value={agentPreferences.promptEnhancementModelId}
            onChange={(value) => onAgentPreferenceChange('promptEnhancementModelId', value)}
          />
        </div>
      </section>

      <section className="settings-general-block" aria-labelledby="settings-thinking-title">
        <div className="settings-general-heading">
          <h2 id="settings-thinking-title">思考模式</h2>
          <p>新对话的默认思考强度。已在对话中单独调整过的对话会保留自己的设置。</p>
        </div>
        <div className="settings-thinking-options" role="radiogroup" aria-label="思考模式">
          {THINKING_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-label={label}
              aria-checked={agentPreferences.thinkingBudget === value}
              className={clsx(agentPreferences.thinkingBudget === value && 'is-active')}
              onClick={() => onAgentPreferenceChange('thinkingBudget', value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section
        className="settings-general-block settings-general-display"
        aria-labelledby="settings-display-title"
      >
        <h2 id="settings-display-title">显示</h2>
        <div className="settings-rows">
          <SettingRow
            title="收起执行过程"
            description="开启后合并为一条可展开的执行摘要；关闭时直接展示完整过程，不生成额外的「执行过程」折叠项"
            control={
              <Toggle
                checked={agentPreferences.collapseExecutionProcess}
                label="收起执行过程"
                onChange={(value) => onAgentPreferenceChange('collapseExecutionProcess', value)}
              />
            }
          />
          <SettingRow
            title="显示工具调用"
            description="在对话中显示 AI 使用的工具详情"
            control={
              <Toggle
                checked={agentPreferences.showToolUse}
                label="显示工具调用"
                onChange={(value) => onAgentPreferenceChange('showToolUse', value)}
              />
            }
          />
          <SettingRow
            title="显示思考过程"
            description="在执行过程中显示 Think 行；关闭后时间线只保留说明、状态和工具动作"
            control={
              <Toggle
                checked={agentPreferences.showThinking}
                label="显示思考过程"
                onChange={(value) => onAgentPreferenceChange('showThinking', value)}
              />
            }
          />
          <SettingRow
            title="默认展开工具调用"
            description="自动展开工具调用的输入和输出内容"
            control={
              <Toggle
                checked={agentPreferences.toolCallExpandedByDefault}
                label="默认展开工具调用"
                onChange={(value) => onAgentPreferenceChange('toolCallExpandedByDefault', value)}
              />
            }
          />
        </div>
      </section>
    </div>
  );
}

function AgentModelSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange(value: string | null): void;
}) {
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    let disposed = false;
    const listProviders = window.syncThink?.runtime?.listProviders;
    if (!listProviders)
      return () => {
        disposed = true;
      };
    void listProviders({})
      .then((response) => {
        if (disposed) return;
        const next: Array<{ value: string; label: string }> = [];
        for (const provider of response.providers ?? []) {
          for (const model of provider.models ?? []) {
            const modelId = String(model.modelId ?? '').trim();
            if (!modelId) continue;
            next.push({
              value: modelId,
              label: `${model.displayName || model.providerModelId || modelId} · ${provider.name}`,
            });
          }
        }
        setOptions(
          next.filter(
            (item, index) =>
              next.findIndex((candidate) => candidate.value === item.value) === index,
          ),
        );
      })
      .catch(() => {
        if (!disposed) setOptions([]);
      });
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <select
      className="settings-general-select"
      aria-label="优化模型"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">自动选择</option>
      {value && !options.some((option) => option.value === value) ? (
        <option value={value}>{value}</option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ComputerUsePluginSection() {
  const [enabled, setEnabled] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState<ComputerUseApprovalPolicySetting>(() =>
    normalizeComputerUseApprovalPolicySetting(undefined),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    const runtime = window.syncThink?.runtime;
    if (!runtime) {
      setError('Runtime 连接不可用，无法读取插件状态。');
      setLoading(false);
      return () => {
        disposed = true;
      };
    }
    void runtime
      .getSettings({
        keys: [COMPUTER_USE_PLUGIN_SETTING_KEY, COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY],
      })
      .then((response) => {
        if (disposed) return;
        setEnabled(
          normalizeComputerUsePluginSetting(response.settings[COMPUTER_USE_PLUGIN_SETTING_KEY])
            .enabled,
        );
        setApprovalPolicy(
          normalizeComputerUseApprovalPolicySetting(
            response.settings[COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY],
          ),
        );
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        setError(reason instanceof Error ? reason.message : '无法读取 Computer Use 插件状态。');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const handleEnabledChange = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    setError(undefined);
    try {
      const runtime = window.syncThink?.runtime;
      if (!runtime) throw new Error('Runtime 连接不可用。');
      await runtime.setSetting({
        key: COMPUTER_USE_PLUGIN_SETTING_KEY,
        value: { enabled: next },
      });
    } catch (reason) {
      setEnabled(previous);
      setError(reason instanceof Error ? reason.message : '保存 Computer Use 插件状态失败。');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAllowedApp = async (app: PersistentComputerUseApp) => {
    const nextPolicy = removePersistentComputerUseApp(approvalPolicy, app);
    setSaving(true);
    setError(undefined);
    try {
      const runtime = window.syncThink?.runtime;
      if (!runtime) throw new Error('Runtime 连接不可用。');
      await runtime.setSetting({
        key: COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY,
        value: nextPolicy,
      });
      setApprovalPolicy(nextPolicy);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移除应用授权失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-scroll settings-standard-pane settings-computer-use-page">
      <section className="settings-computer-use-intro" aria-labelledby="computer-use-control-title">
        <h2 id="computer-use-control-title">控制</h2>
        <p>
          允许 SYNC-THINK 在任务执行期间查看和操作当前 Windows 桌面上的图形应用。Windows
          无需额外系统授权，但普通权限的 SYNC-THINK 对管理员身份运行的应用操作受限。
        </p>
      </section>
      <div className="settings-computer-use-toggle">
        <SettingRow
          title="任何应用"
          description="开启电脑操作总开关；具体应用仍需逐次、当前会话或始终允许"
          control={
            <Toggle
              checked={enabled}
              disabled={loading || saving}
              label="任何应用"
              onChange={(next) => void handleEnabledChange(next)}
            />
          }
        />
      </div>
      <section className="settings-computer-use-allowed" aria-labelledby="computer-use-apps-title">
        <h2 id="computer-use-apps-title">始终允许的应用</h2>
        <p>这些应用在后续任务中无需再次确认即可操作。</p>
        {approvalPolicy.alwaysAllowedApps.length > 0 ? (
          <div className="settings-rows">
            {approvalPolicy.alwaysAllowedApps.map((app) => (
              <SettingRow
                key={`${app.field}:${app.value}`}
                title={app.value}
                description={app.field === 'app_id' ? 'Windows 应用' : 'macOS 应用'}
                control={
                  <button
                    type="button"
                    className="settings-gateway-button"
                    aria-label={`移除 ${app.value}`}
                    title={`移除 ${app.value}`}
                    disabled={loading || saving}
                    onClick={() => void handleRemoveAllowedApp(app)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                }
              />
            ))}
          </div>
        ) : (
          <p className="settings-note">尚未始终允许任何应用</p>
        )}
      </section>
      {error ? (
        <p className="settings-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type ConnectionTab =
  'connectors' | 'mcp' | 'plugins' | 'search' | 'bots' | 'gateway' | 'network';

type ConnectorSelection =
  | { kind: 'managed'; item: ManagedConnectorCatalogItem }
  | { kind: 'server'; server: McpServerSummary }
  | { kind: 'new' };

function managedConnectorServer(
  servers: readonly McpServerSummary[],
  item: ManagedConnectorCatalogItem,
): McpServerSummary | undefined {
  const currentNote = `SYNC-THINK connector: ${item.id}`;
  const legacyNote = `NewMax connector: ${item.id}`;
  return servers.find(
    (server) =>
      server.notes.trim() === currentNote ||
      server.notes.trim() === legacyNote ||
      server.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase(),
  );
}

const CONNECTION_TABS: Array<{ id: ConnectionTab; label: string }> = [
  { id: 'connectors', label: '连接器' },
  { id: 'mcp', label: 'MCP' },
  { id: 'plugins', label: '插件' },
  { id: 'search', label: '搜索服务' },
  { id: 'bots', label: '机器人对话' },
  { id: 'gateway', label: '开放网关' },
  { id: 'network', label: '网络' },
];

export interface ConnectionSectionProps {
  initialTab?: ConnectionTab;
  navigationKey?: string | number;
}

export function ConnectionSection({ initialTab, navigationKey }: ConnectionSectionProps = {}) {
  const [tab, setTab] = useState<ConnectionTab>(initialTab ?? 'connectors');
  const [providerTab, setProviderTab] = useState<'sync-think' | 'third-party'>('sync-think');
  const [query, setQuery] = useState('');
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [serversLoading, setServersLoading] = useState(true);
  const [selection, setSelection] = useState<ConnectorSelection>();
  const [managedSetup, setManagedSetup] = useState<ManagedConnectorCatalogItem>();
  const [busyId, setBusyId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!initialTab) return;
    setTab(initialTab);
    setSelection(undefined);
    setManagedSetup(undefined);
    setError(undefined);
    setNotice(undefined);
  }, [initialTab, navigationKey]);

  const loadServers = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listMcpServers) {
      setServersLoading(false);
      return;
    }
    setServersLoading(true);
    try {
      const response = await runtime.listMcpServers({ limit: 100 });
      setServers(response.servers);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取 MCP 连接失败。');
    } finally {
      setServersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const saveConnection = async (payload: {
    name: string;
    endpoint: string;
    key?: string;
    authScheme: 'bearer' | 'api-key';
    notes: string;
    managedItem?: ManagedConnectorCatalogItem;
  }) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.registerRemoteMcpServer) {
      setError('Runtime 连接不可用。');
      return;
    }
    setBusyId('save');
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await runtime.registerRemoteMcpServer({
        name: payload.name,
        endpoint: payload.endpoint,
        ...(payload.key ? { key: payload.key } : {}),
        authScheme: payload.authScheme,
        discoverTools: true,
        trusted: false,
        notes: payload.notes,
      });
      setNotice(
        result.discoveryError
          ? `连接已保存，工具发现失败：${result.discoveryError}`
          : `已连接 ${result.server.name}${result.discovered ? `，发现 ${result.server.tools.length} 个工具` : ''}。`,
      );
      if (payload.managedItem) {
        setSelection({ kind: 'managed', item: payload.managedItem });
        setManagedSetup(undefined);
      } else {
        setSelection(undefined);
      }
      await loadServers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '连接失败。');
    } finally {
      setBusyId(undefined);
    }
  };

  const setServerEnabled = async (server: McpServerSummary, enabled: boolean) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.setMcpServerEnabled || busyId) return;
    setBusyId(server.mcpServerId);
    setError(undefined);
    try {
      await runtime.setMcpServerEnabled({ mcpServerId: server.mcpServerId, enabled });
      setServers((current) =>
        current.map((item) =>
          item.mcpServerId === server.mcpServerId ? { ...item, enabled } : item,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新连接状态失败。');
    } finally {
      setBusyId(undefined);
    }
  };

  const deleteServer = async (server: McpServerSummary) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.deleteMcpServer || busyId) return;
    if (!confirm(`确定删除“${server.name}”连接吗？`)) return;
    setBusyId(server.mcpServerId);
    setError(undefined);
    try {
      await runtime.deleteMcpServer({ mcpServerId: server.mcpServerId });
      setSelection(undefined);
      setNotice(`已删除 ${server.name}。`);
      await loadServers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除连接失败。');
    } finally {
      setBusyId(undefined);
    }
  };

  const refreshServerTools = async (server: McpServerSummary) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.refreshMcpTools || busyId) return;
    setBusyId(server.mcpServerId);
    setError(undefined);
    try {
      await runtime.refreshMcpTools({ mcpServerId: server.mcpServerId, maxTools: 200 });
      setNotice(`已刷新 ${server.name} 的可调用动作。`);
      await loadServers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '刷新连接器动作失败。');
    } finally {
      setBusyId(undefined);
    }
  };

  const connectedNames = useMemo(
    () => new Set(servers.map((server) => server.name.trim().toLocaleLowerCase())),
    [servers],
  );

  return (
    <div className="settings-connection-page">
      <SlidingTabs className="settings-connection-tabs" aria-label="连接设置分类">
        {CONNECTION_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'is-active' : undefined}
            onClick={() => {
              setTab(item.id);
              setSelection(undefined);
              setManagedSetup(undefined);
              setError(undefined);
              setNotice(undefined);
            }}
          >
            {item.label}
          </button>
        ))}
      </SlidingTabs>

      <div className="settings-connection-body">
        {tab === 'connectors' ? (
          selection ? (
            selection.kind === 'managed' ? (
              <>
                <ManagedConnectorDetail
                  item={selection.item}
                  server={managedConnectorServer(servers, selection.item)}
                  busy={Boolean(busyId)}
                  notice={notice}
                  error={error}
                  onBack={() => {
                    setSelection(undefined);
                    setManagedSetup(undefined);
                    setError(undefined);
                  }}
                  onConfigure={() => setManagedSetup(selection.item)}
                  onToggle={(server, enabled) => void setServerEnabled(server, enabled)}
                  onRefresh={(server) => void refreshServerTools(server)}
                />
                {managedSetup ? (
                  <ManagedConnectorSetupDialog
                    item={managedSetup}
                    busy={busyId === 'save'}
                    error={error}
                    onClose={() => {
                      setManagedSetup(undefined);
                      setError(undefined);
                    }}
                    onSave={(payload) =>
                      void saveConnection({
                        ...payload,
                        notes: `SYNC-THINK connector: ${managedSetup.id}`,
                        managedItem: managedSetup,
                      })
                    }
                  />
                ) : null}
              </>
            ) : (
              <RemoteMcpConnectionForm
                key={selection.kind === 'server' ? selection.server.mcpServerId : 'new'}
                selection={selection}
                busy={busyId === 'save'}
                error={error}
                onBack={() => {
                  setSelection(undefined);
                  setError(undefined);
                }}
                onDelete={
                  selection.kind === 'server'
                    ? () => void deleteServer(selection.server)
                    : undefined
                }
                onSave={(payload) => void saveConnection(payload)}
              />
            )
          ) : (
            <ConnectorCatalog
              providerTab={providerTab}
              query={query}
              servers={servers}
              loading={serversLoading}
              connectedNames={connectedNames}
              notice={notice}
              error={error}
              onProviderTabChange={setProviderTab}
              onQueryChange={setQuery}
              onOpenManaged={(item) => setSelection({ kind: 'managed', item })}
              onOpenServer={(server) => setSelection({ kind: 'server', server })}
              onAddServer={() => setSelection({ kind: 'new' })}
              onToggleServer={(server, enabled) => void setServerEnabled(server, enabled)}
            />
          )
        ) : null}
        {tab === 'mcp' ? (
          <McpManagementPane
            servers={servers}
            loading={serversLoading}
            busyId={busyId}
            notice={notice}
            error={error}
            onAdd={() => {
              setTab('connectors');
              setProviderTab('third-party');
              setSelection({ kind: 'new' });
            }}
            onOpen={(server) => {
              setTab('connectors');
              setProviderTab('third-party');
              setSelection({ kind: 'server', server });
            }}
            onToggle={(server, enabled) => void setServerEnabled(server, enabled)}
            onRefresh={() => void loadServers()}
          />
        ) : null}
        {tab === 'plugins' ? <ComputerUsePluginSection /> : null}
        {tab === 'gateway' ? <OpenGatewaySection /> : null}
        {tab === 'search' ? <WebSearchSettings /> : null}
        {tab === 'bots' ? <BotConversationPane /> : null}
        {tab === 'network' ? (
          <ConnectionEmptyPane
            className="settings-network-empty"
            icon={Network}
            title="网络使用系统代理设置"
          />
        ) : null}
      </div>
    </div>
  );
}

function ConnectorCatalog({
  providerTab,
  query,
  servers,
  loading,
  connectedNames,
  notice,
  error,
  onProviderTabChange,
  onQueryChange,
  onOpenManaged,
  onOpenServer,
  onAddServer,
  onToggleServer,
}: {
  providerTab: 'sync-think' | 'third-party';
  query: string;
  servers: McpServerSummary[];
  loading: boolean;
  connectedNames: Set<string>;
  notice?: string;
  error?: string;
  onProviderTabChange(value: 'sync-think' | 'third-party'): void;
  onQueryChange(value: string): void;
  onOpenManaged(item: ManagedConnectorCatalogItem): void;
  onOpenServer(server: McpServerSummary): void;
  onAddServer(): void;
  onToggleServer(server: McpServerSummary, enabled: boolean): void;
}) {
  const needle = query.trim().toLocaleLowerCase();
  const visibleServers = servers.filter(
    (server) => !needle || `${server.name} ${server.endpoint}`.toLocaleLowerCase().includes(needle),
  );

  return (
    <div className="settings-connector-catalog">
      <div className="settings-provider-switcher">
        <SlidingTabs className="settings-provider-switcher__tabs" aria-label="连接器 Provider">
          <button
            type="button"
            role="tab"
            className={providerTab === 'sync-think' ? 'is-active' : undefined}
            aria-selected={providerTab === 'sync-think'}
            onClick={() => onProviderTabChange('sync-think')}
          >
            SYNC-THINK Provider
          </button>
          <button
            type="button"
            role="tab"
            className={providerTab === 'third-party' ? 'is-active' : undefined}
            aria-selected={providerTab === 'third-party'}
            onClick={() => onProviderTabChange('third-party')}
          >
            第三方 Provider
          </button>
        </SlidingTabs>
        {providerTab === 'third-party' ? (
          <label className="settings-provider-search">
            <Search size={13} aria-hidden="true" />
            <input
              value={query}
              aria-label="搜索第三方 Provider"
              placeholder="搜索 Provider"
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="settings-connectors-summary">
        <span>
          {providerTab === 'sync-think'
            ? 'SYNC-THINK 连接器目录；动作数量以实际 MCP 工具发现结果为准。'
            : '通过远程 MCP 接入第三方 Provider，并在 Runtime 中发现可用工具。'}
        </span>
        {providerTab === 'third-party' ? (
          <button type="button" className="settings-connectors-add" onClick={onAddServer}>
            <Plus size={13} aria-hidden="true" />
            添加 Provider
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className="settings-connectors-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="settings-connectors-notice is-error" role="alert">
          {error}
        </p>
      ) : null}

      {providerTab === 'sync-think' ? (
        <div className="settings-connectors-scroll">
          <div className="settings-connectors-grid">
            {SYNC_THINK_CONNECTOR_CATALOG.map((item) => {
              const connected = connectedNames.has(item.name.toLocaleLowerCase());
              return (
                <button
                  key={item.id}
                  type="button"
                  className="settings-connector-row"
                  aria-label={`${connected ? '打开' : '连接'} ${item.name}`}
                  onClick={() => onOpenManaged(item)}
                >
                  <img src={item.icon} alt="" draggable={false} />
                  <span>{item.name}</span>
                  <small className={connected ? 'is-connected' : undefined}>
                    {connected ? '✓ 已连接' : '连接 ›'}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="settings-connectors-scroll">
          {loading ? (
            <p className="settings-connectors-empty">正在读取连接…</p>
          ) : visibleServers.length === 0 ? (
            <div className="settings-connectors-empty">
              <Server size={24} aria-hidden="true" />
              <span>
                {servers.length === 0 ? '尚未添加第三方 Provider' : '没有匹配的 Provider'}
              </span>
            </div>
          ) : (
            <div className="settings-third-party-list">
              {visibleServers.map((server) => (
                <div key={server.mcpServerId} className="settings-third-party-row">
                  <button type="button" onClick={() => onOpenServer(server)}>
                    <span className="settings-third-party-row__icon">
                      <Link2 size={15} aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{server.name}</strong>
                      <small>{server.endpoint}</small>
                    </span>
                  </button>
                  <Toggle
                    checked={server.enabled}
                    label={`${server.name} 连接`}
                    onChange={(enabled) => onToggleServer(server, enabled)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ManagedConnectorDetail({
  item,
  server,
  busy,
  notice,
  error,
  onBack,
  onConfigure,
  onToggle,
  onRefresh,
}: {
  item: ManagedConnectorCatalogItem;
  server?: McpServerSummary;
  busy: boolean;
  notice?: string;
  error?: string;
  onBack(): void;
  onConfigure(): void;
  onToggle(server: McpServerSummary, enabled: boolean): void;
  onRefresh(server: McpServerSummary): void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const tools = (server?.tools ?? []).filter(
    (tool) => !needle || `${tool.name} ${tool.description}`.toLocaleLowerCase().includes(needle),
  );
  const enabled = server?.enabled === true;

  return (
    <section className="settings-managed-connector" aria-label={`${item.name} 连接器详情`}>
      <button type="button" className="settings-connector-back" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" />
        返回
      </button>

      <div className="settings-managed-connector__hero">
        <div className="settings-managed-connector__identity">
          <img src={item.icon} alt="" draggable={false} />
          <div>
            <h2>{item.name}</h2>
            <div>
              <span>MCP 连接器</span>
              <span className={clsx('settings-managed-connector__status', enabled && 'is-enabled')}>
                {enabled ? '已启用' : server ? '已停用' : '未配置'}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className={clsx('settings-managed-connector__toggle', enabled && 'is-enabled')}
          disabled={busy}
          onClick={() => {
            if (!server) onConfigure();
            else onToggle(server, !server.enabled);
          }}
        >
          {busy ? <LoaderCircle size={14} className="is-spinning" aria-hidden="true" /> : null}
          {enabled ? '停用连接器' : '启用连接器'}
        </button>
      </div>

      {notice ? (
        <p className="settings-connectors-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="settings-connectors-notice is-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="settings-managed-actions">
        <div className="settings-managed-actions__head">
          <div>
            <strong>可调用动作</strong>
            <span>{server?.tools.length ?? 0} 个动作</span>
          </div>
          <div>
            {server ? (
              <button
                type="button"
                className="settings-managed-actions__refresh"
                aria-label="刷新可调用动作"
                disabled={busy}
                onClick={() => onRefresh(server)}
              >
                <RefreshCw size={13} aria-hidden="true" />
              </button>
            ) : null}
            <label className="settings-managed-actions__search">
              <Search size={13} aria-hidden="true" />
              <input
                aria-label="搜索动作"
                value={query}
                placeholder="搜索动作…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="settings-managed-actions__list">
          {!server ? (
            <div className="settings-managed-actions__empty">
              <Plug size={18} aria-hidden="true" />
              <strong>连接 Provider 后自动发现动作</strong>
              <span>
                不需要手工提供动作名称。点击“启用连接器”，填写该服务的 MCP 地址与凭证； Runtime
                会通过 <code>tools/list</code> 读取真实动作并显示在这里。
              </span>
            </div>
          ) : tools.length === 0 ? (
            <div className="settings-managed-actions__empty">
              {server.tools.length === 0 ? '服务当前没有返回可调用动作。' : '没有匹配的动作。'}
            </div>
          ) : (
            tools.map((tool) => (
              <div key={tool.name} className="settings-managed-action-row">
                <span aria-hidden="true">›</span>
                <div>
                  <strong>{tool.name}</strong>
                  {tool.description ? <small>{tool.description}</small> : null}
                </div>
                <span className="settings-managed-action-row__method">MCP</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ManagedConnectorSetupDialog({
  item,
  busy,
  error,
  onClose,
  onSave,
}: {
  item: ManagedConnectorCatalogItem;
  busy: boolean;
  error?: string;
  onClose(): void;
  onSave(payload: {
    name: string;
    endpoint: string;
    key?: string;
    authScheme: 'bearer' | 'api-key';
  }): void;
}) {
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [authScheme, setAuthScheme] = useState<'bearer' | 'api-key'>('bearer');
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="settings-connector-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`配置${item.name}连接器`}
        className="settings-connector-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-connector-dialog__head">
          <img src={item.icon} alt="" draggable={false} />
          <div>
            <h3>配置 {item.name}</h3>
            <p>连接后由 Runtime 读取服务真实提供的 MCP 工具。</p>
          </div>
          <button type="button" aria-label="关闭连接器配置" onClick={onClose}>
            ×
          </button>
        </div>
        <form
          className="settings-connector-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!endpoint.trim() || busy) return;
            onSave({
              name: item.name,
              endpoint: endpoint.trim(),
              ...(apiKey.trim() ? { key: apiKey.trim() } : {}),
              authScheme,
            });
          }}
        >
          <label>
            <span>MCP 服务地址</span>
            <input
              type="url"
              aria-label="MCP 服务地址"
              value={endpoint}
              placeholder="https://provider.example.com/mcp"
              autoFocus
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          <div className="settings-connector-form__auth-row">
            <label>
              <span>鉴权方式</span>
              <select
                aria-label="鉴权方式"
                value={authScheme}
                onChange={(event) => setAuthScheme(event.target.value as 'bearer' | 'api-key')}
              >
                <option value="bearer">Bearer Token</option>
                <option value="api-key">API Key Header</option>
              </select>
            </label>
            <label>
              <span>API Key</span>
              <div className="settings-connector-form__secret">
                <input
                  type={showKey ? 'text' : 'password'}
                  aria-label="API Key"
                  value={apiKey}
                  placeholder="可选"
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setShowKey((current) => !current)}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          </div>
          {error ? (
            <p className="settings-connector-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="settings-connector-form__actions">
            <button type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button type="submit" className="is-primary" disabled={busy || !endpoint.trim()}>
              {busy ? <LoaderCircle size={14} className="is-spinning" /> : <Plug size={14} />}
              {busy ? '正在连接' : '保存并启用'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const BOT_CHANNELS = [
  { id: 'telegram', label: 'Telegram', badge: 'TG', available: true },
  { id: 'feishu', label: '飞书', badge: '飞', available: false },
  { id: 'wecom', label: '企业微信', badge: '企', available: false },
  { id: 'wechat', label: '微信', badge: '微', available: false },
  { id: 'discord', label: 'Discord', badge: 'D', available: false },
  { id: 'dingtalk', label: '钉钉', badge: '钉', available: false },
  { id: 'qq', label: 'QQ', badge: 'Q', available: false },
] as const;

const EMPTY_TELEGRAM_CONFIG: BotChannelConfigSummary = {
  platform: 'telegram',
  enabled: false,
  credentialsConfigured: false,
  proxyUrl: '',
  connected: false,
  state: 'disconnected',
};

export function LegacyBotConversationPane() {
  const [config, setConfig] = useState<BotChannelConfigSummary>(EMPTY_TELEGRAM_CONFIG);
  const [token, setToken] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const tokenInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const runtime = window.syncThink?.runtime;
        if (!runtime?.getBotChannelConfig) throw new Error('Runtime 连接不可用。');
        const response = await runtime.getBotChannelConfig({ platform: 'telegram' });
        if (!active) return;
        setConfig(response);
        setProxyUrl(response.proxyUrl ?? '');
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : '读取机器人设置失败。');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const save = async (enabled: boolean, verifyFirst: boolean) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.saveBotChannelConfig) {
      setError('Runtime 连接不可用。');
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await runtime.saveBotChannelConfig({
        platform: 'telegram',
        ...(token.trim() ? { token: token.trim() } : {}),
        proxyUrl: proxyUrl.trim(),
        enabled,
        testConnection: verifyFirst,
      });
      setConfig(response.config);
      setToken('');
      setNotice(
        enabled
          ? `Telegram 已启用${response.config.botUsername ? `：@${response.config.botUsername}` : ''}`
          : verifyFirst
            ? '连接测试通过，设置已保存。'
            : 'Telegram 已停用。',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Telegram 设置保存失败。');
      if (enabled && !config.credentialsConfigured && !token.trim()) {
        tokenInputRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-bot-pane" aria-label="机器人对话设置">
      <aside className="settings-bot-channels" aria-label="机器人通道">
        {BOT_CHANNELS.map((channel) => (
          <button
            key={channel.id}
            type="button"
            className={channel.id === 'telegram' ? 'is-active' : undefined}
            disabled={!channel.available}
            aria-label={channel.available ? channel.label : `${channel.label}，尚未接入`}
          >
            {channel.id === 'telegram' ? (
              <img src={telegramIcon} alt="" draggable={false} />
            ) : (
              <span className={`settings-bot-channel-badge is-${channel.id}`}>{channel.badge}</span>
            )}
            <span>{channel.label}</span>
            {!channel.available ? <small>待接入</small> : null}
          </button>
        ))}
      </aside>

      <div className="settings-bot-config">
        <div className="settings-bot-config__hero">
          <div>
            <img src={telegramIcon} alt="" draggable={false} />
            <div>
              <h2>Telegram</h2>
              <p>
                {loading
                  ? '正在读取设置…'
                  : config.connected
                    ? `已连接${config.botUsername ? ` · @${config.botUsername}` : ''}`
                    : '未连接'}
              </p>
            </div>
          </div>
          <Toggle
            checked={config.enabled}
            disabled={loading || busy}
            label="启用 Telegram 机器人"
            onChange={(enabled) => {
              if (enabled && !config.credentialsConfigured && !token.trim()) {
                setNotice(undefined);
                setError('请先填写 Bot Token，再启用 Telegram 机器人。');
                tokenInputRef.current?.focus();
                return;
              }
              void save(enabled, false);
            }}
          />
        </div>

        <button
          type="button"
          className="settings-bot-docs"
          onClick={() =>
            void window.syncThink?.runtime?.openExternalUrl?.(
              'https://core.telegram.org/bots/tutorial#obtain-your-bot-token',
            )
          }
        >
          通过 @BotFather 创建 Bot 并获取 Token
          <ArrowRight size={13} aria-hidden="true" />
        </button>

        <div className="settings-bot-form">
          <label>
            <span>Bot Token</span>
            <div className="settings-bot-secret">
              <input
                ref={tokenInputRef}
                type={showToken ? 'text' : 'password'}
                aria-label="Bot Token"
                value={token}
                placeholder={
                  config.credentialsConfigured ? '已安全保存，留空保持不变' : '123456:ABC-DEF…'
                }
                autoComplete="off"
                onChange={(event) => {
                  setToken(event.target.value);
                  if (error?.includes('Bot Token')) setError(undefined);
                }}
              />
              <button
                type="button"
                aria-label={showToken ? '隐藏 Bot Token' : '显示 Bot Token'}
                onClick={() => setShowToken((current) => !current)}
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
          <label>
            <span>代理地址</span>
            <input
              aria-label="代理地址"
              value={proxyUrl}
              placeholder="http://127.0.0.1:7890"
              onChange={(event) => setProxyUrl(event.target.value)}
            />
            <small>网络受限时可填写 HTTP/HTTPS 代理；直连环境留空。</small>
          </label>
        </div>

        {notice ? (
          <p className="settings-connectors-notice" role="status">
            <Check size={13} aria-hidden="true" />
            {notice}
          </p>
        ) : null}
        {error || config.lastError ? (
          <p className="settings-connectors-notice is-error" role="alert">
            <AlertCircle size={13} aria-hidden="true" />
            {error ?? config.lastError}
          </p>
        ) : null}

        <button
          type="button"
          className="settings-bot-test"
          disabled={busy || loading || (!token.trim() && !config.credentialsConfigured)}
          onClick={() => void save(config.enabled, true)}
        >
          {busy ? <LoaderCircle size={14} className="is-spinning" /> : <MessageCircle size={14} />}
          {busy ? '正在测试' : '测试并保存'}
        </button>
      </div>
    </section>
  );
}

function RemoteMcpConnectionForm({
  selection,
  busy,
  error,
  onBack,
  onDelete,
  onSave,
}: {
  selection: Exclude<ConnectorSelection, { kind: 'managed' }>;
  busy: boolean;
  error?: string;
  onBack(): void;
  onDelete?: () => void;
  onSave(payload: {
    name: string;
    endpoint: string;
    key?: string;
    authScheme: 'bearer' | 'api-key';
    notes: string;
  }): void;
}) {
  const server = selection.kind === 'server' ? selection.server : undefined;
  const [name, setName] = useState(server?.name ?? '');
  const [endpoint, setEndpoint] = useState(server?.endpoint ?? '');
  const [apiKey, setApiKey] = useState('');
  const [authScheme, setAuthScheme] = useState<'bearer' | 'api-key'>('bearer');
  const [showKey, setShowKey] = useState(false);
  const title = server?.name ?? '添加第三方 Provider';

  return (
    <div className="settings-connector-detail">
      <button type="button" className="settings-connector-back" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" />
        返回连接器
      </button>
      <div className="settings-connector-detail__head">
        <span className="settings-connector-detail__icon">
          <Server size={20} aria-hidden="true" />
        </span>
        <div>
          <h2>{title}</h2>
          <p>远程 MCP Provider</p>
        </div>
      </div>
      <form
        className="settings-connector-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !endpoint.trim() || busy) return;
          onSave({
            name: name.trim(),
            endpoint: endpoint.trim(),
            ...(apiKey.trim() ? { key: apiKey.trim() } : {}),
            authScheme,
            notes: server?.notes ?? '',
          });
        }}
      >
        <label>
          <span>名称</span>
          <input
            aria-label="连接器名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          <span>MCP 服务地址</span>
          <input
            type="url"
            aria-label="MCP 服务地址"
            value={endpoint}
            placeholder="https://provider.example.com/mcp"
            onChange={(event) => setEndpoint(event.target.value)}
          />
        </label>
        <div className="settings-connector-form__auth-row">
          <label>
            <span>鉴权方式</span>
            <select
              aria-label="鉴权方式"
              value={authScheme}
              onChange={(event) => setAuthScheme(event.target.value as 'bearer' | 'api-key')}
            >
              <option value="bearer">Bearer Token</option>
              <option value="api-key">API Key Header</option>
            </select>
          </label>
          <label>
            <span>API Key</span>
            <div className="settings-connector-form__secret">
              <input
                type={showKey ? 'text' : 'password'}
                aria-label="API Key"
                value={apiKey}
                placeholder={server?.authConfigured ? '留空保留现有密钥' : '可选'}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button
                type="button"
                aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                onClick={() => setShowKey((current) => !current)}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
        </div>
        {error ? (
          <p className="settings-connector-form__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="settings-connector-form__actions">
          {onDelete ? (
            <button type="button" className="is-danger" disabled={busy} onClick={onDelete}>
              <Trash2 size={14} aria-hidden="true" />
              删除连接
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="is-primary"
            disabled={busy || !name.trim() || !endpoint.trim()}
          >
            <Plug size={14} aria-hidden="true" />
            {busy ? '正在连接' : '保存并连接'}
          </button>
        </div>
      </form>
    </div>
  );
}

function McpManagementPane({
  servers,
  loading,
  busyId,
  notice,
  error,
  onAdd,
  onOpen,
  onToggle,
  onRefresh,
}: {
  servers: McpServerSummary[];
  loading: boolean;
  busyId?: string;
  notice?: string;
  error?: string;
  onAdd(): void;
  onOpen(server: McpServerSummary): void;
  onToggle(server: McpServerSummary, enabled: boolean): void;
  onRefresh(): void;
}) {
  return (
    <div className="settings-mcp-pane">
      <div className="settings-mcp-pane__head">
        <div>
          <h2>MCP 服务</h2>
          <p>已注册的远程服务会向 Agent 提供发现到的工具。</p>
        </div>
        <div>
          <button type="button" aria-label="刷新 MCP" onClick={onRefresh}>
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button type="button" className="is-primary" onClick={onAdd}>
            <Plus size={14} aria-hidden="true" />
            添加 MCP
          </button>
        </div>
      </div>
      {notice ? (
        <p className="settings-connectors-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="settings-connectors-notice is-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="settings-connectors-empty">正在读取 MCP 服务…</p>
      ) : servers.length === 0 ? (
        <div className="settings-connectors-empty">
          <Server size={26} aria-hidden="true" />
          <span>尚未注册 MCP 服务</span>
        </div>
      ) : (
        <div className="settings-third-party-list">
          {servers.map((server) => (
            <div key={server.mcpServerId} className="settings-third-party-row">
              <button type="button" onClick={() => onOpen(server)}>
                <span className="settings-third-party-row__icon">
                  <Server size={15} aria-hidden="true" />
                </span>
                <span>
                  <strong>{server.name}</strong>
                  <small>
                    {server.tools.length} 个工具 · {server.endpoint}
                  </small>
                </span>
              </button>
              <Toggle
                checked={server.enabled}
                disabled={busyId === server.mcpServerId}
                label={`${server.name} MCP`}
                onChange={(enabled) => onToggle(server, enabled)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionEmptyPane({
  icon: Icon,
  title,
  className,
}: {
  icon: typeof Search;
  title: string;
  className?: string;
}) {
  return (
    <div className={clsx('settings-connectors-empty settings-connectors-empty--pane', className)}>
      <Icon size={26} aria-hidden="true" />
      <span>{title}</span>
    </div>
  );
}

/** Copy-to-clipboard row used for the gateway base URLs and external token. */
function CopyableValue({
  label,
  value,
  masked,
}: {
  label: string;
  value: string;
  masked?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const shown = masked && !revealed ? `${value.slice(0, 9)}••••••••••` : value;

  return (
    <div className="settings-row">
      <div>
        <p>{label}</p>
        <span className="settings-gateway-value">{shown}</span>
      </div>
      <div className="settings-row__control settings-gateway-actions">
        {masked ? (
          <button
            type="button"
            className="settings-gateway-button"
            onClick={() => setRevealed((prev) => !prev)}
          >
            {revealed ? '隐藏' : '显示'}
          </button>
        ) : null}
        <button
          type="button"
          className="settings-gateway-button"
          aria-label={`复制${label}`}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(value)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          <Copy size={13} aria-hidden="true" />
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * AI 模型网关 — a pure protocol-format converter on the connection page.
 *
 * Per-run traffic is routed by ticket (issued by the runtime when a run starts),
 * so this card never has to pick a provider: whatever the user selected in the
 * conversation input wins. The read-only upstream line mirrors the most recent
 * run the gateway actually routed. External terminal clients (no run context)
 * resolve model names through the catalog; no default-provider setting exists.
 */
function OpenGatewaySection() {
  const [setting, setSetting] = useState<OpenGatewaySetting>({ enabled: false, port: 0 });
  const [portDraft, setPortDraft] = useState('');
  const [status, setStatus] = useState<OpenGatewayStatusResponse>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const disposedRef = useRef(false);

  // The runtime rebinds the listener *after* answering settings.set, so the
  // bound state can only be learned by re-reading gateway.status.
  const refreshStatus = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getGatewayStatus) return;
    try {
      const next = await runtime.getGatewayStatus();
      if (!disposedRef.current) setStatus(next);
    } catch {
      // Status is advisory; a failed poll must not clobber the form.
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    const runtime = window.syncThink?.runtime;
    if (!runtime) {
      setError('Runtime 连接不可用，无法读取网关配置。');
      setLoading(false);
      return () => {
        disposedRef.current = true;
      };
    }
    void (async () => {
      try {
        const response = await runtime.getSettings({ keys: [OPEN_GATEWAY_SETTING_KEY] });
        if (disposedRef.current) return;
        const next = normalizeOpenGatewaySetting(response.settings[OPEN_GATEWAY_SETTING_KEY]);
        setSetting(next);
        setPortDraft(next.port === 0 ? '' : String(next.port));
        setError(undefined);
      } catch (reason) {
        if (!disposedRef.current) {
          setError(reason instanceof Error ? reason.message : '无法读取网关配置。');
        }
      } finally {
        if (!disposedRef.current) setLoading(false);
      }
      await refreshStatus();
    })();
    return () => {
      disposedRef.current = true;
    };
  }, [refreshStatus]);

  const persist = async (next: OpenGatewaySetting) => {
    const previous = setting;
    setSetting(next);
    setSaving(true);
    setError(undefined);
    try {
      const runtime = window.syncThink?.runtime;
      if (!runtime) throw new Error('Runtime 连接不可用。');
      await runtime.setSetting({ key: OPEN_GATEWAY_SETTING_KEY, value: next });
      await refreshStatus();
    } catch (reason) {
      setSetting(previous);
      setPortDraft(previous.port === 0 ? '' : String(previous.port));
      setError(reason instanceof Error ? reason.message : '保存网关配置失败。');
    } finally {
      if (!disposedRef.current) setSaving(false);
    }
  };

  const commitPort = (raw: string) => {
    const trimmed = raw.trim();
    // Empty input = OS auto-assign (port 0). The normalizer snaps out-of-range
    // values to 0, so validate here rather than relying on the round-trip.
    if (trimmed === '') {
      setError(undefined);
      if (setting.port === 0) return;
      void persist({ ...setting, port: 0 });
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      setPortDraft(setting.port === 0 ? '' : String(setting.port));
      setError('端口需为 1024-65535 之间的整数，或留空自动分配。');
      return;
    }
    setError(undefined);
    if (parsed === setting.port) return;
    void persist({ ...setting, port: parsed });
  };

  const statusText = (() => {
    if (loading) return '正在读取网关状态…';
    if (!setting.enabled) return '已停用：内核直连所选供应商，不经过本机转换。';
    if (status?.running) return `运行中：监听 127.0.0.1:${status.port}。`;
    if (status?.failureDetail) return status.failureDetail;
    if (status?.failure === 'bind-failed') return '网关启动失败，请查看 Runtime 日志。';
    return '正在启动网关…';
  })();

  const protocolLabel = (protocol: OpenGatewayUpstreamProtocol | undefined) =>
    protocol === 'anthropic-messages' ? 'Anthropic 格式' : 'OpenAI 格式';

  return (
    <div className="settings-scroll settings-standard-pane">
      <div className="settings-gateway-card">
        <div className="settings-gateway-card__head">
          <div className="settings-gateway-card__identity">
            <span className="settings-gateway-card__icon" aria-hidden="true">
              <Network size={18} />
            </span>
            <div>
              <h2 className="settings-gateway-card__title">AI 模型网关</h2>
              <p className="settings-gateway-card__subtitle">支持 OpenAI / Anthropic 双格式调用</p>
            </div>
          </div>
          <div className="settings-gateway-card__meta">
            {status?.running ? (
              <span
                className="settings-gateway-card__port"
                data-testid="settings-gateway-running-port"
              >
                {status.port}
              </span>
            ) : null}
            <Toggle
              checked={setting.enabled}
              disabled={loading || saving}
              label="启用网关"
              onChange={(next) => void persist({ ...setting, enabled: next })}
            />
          </div>
        </div>

        <div className="settings-gateway-card__body">
          <div className="settings-row">
            <div>
              <p>监听端口</p>
              <span>仅绑定 127.0.0.1，留空自动分配端口。</span>
            </div>
            <div className="settings-row__control">
              <input
                data-testid="settings-gateway-port"
                className="st-field-input"
                style={{ width: 120 }}
                inputMode="numeric"
                placeholder="自动分配"
                aria-label="网关监听端口"
                value={portDraft}
                disabled={loading || saving}
                onChange={(event) => setPortDraft(event.target.value)}
                onBlur={(event) => commitPort(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitPort(event.currentTarget.value);
                }}
              />
            </div>
          </div>

          {status?.running ? (
            <div className="settings-gateway-card__routes">
              <p className="settings-gateway-card__routes-title">可用接口</p>
              <div
                className="settings-gateway-card__route"
                data-testid="settings-gateway-route-openai"
              >
                <code>POST /v1/chat/completions</code>
                <span>OpenAI 格式</span>
              </div>
              <div
                className="settings-gateway-card__route"
                data-testid="settings-gateway-route-anthropic"
              >
                <code>POST /v1/messages</code>
                <span>Anthropic 格式</span>
              </div>
              <div
                className="settings-gateway-card__route"
                data-testid="settings-gateway-route-models"
              >
                <code>GET /v1/models</code>
                <span>模型列表</span>
              </div>
              <div className="settings-gateway-card__copy">
                {status.anthropicBaseUrl ? (
                  <CopyableValue
                    label="Anthropic 入口 (ANTHROPIC_BASE_URL)"
                    value={status.anthropicBaseUrl}
                  />
                ) : null}
                {status.openaiBaseUrl ? (
                  <CopyableValue
                    label="OpenAI 入口 (OPENAI_BASE_URL)"
                    value={status.openaiBaseUrl}
                  />
                ) : null}
                {status.modelsBaseUrl ? (
                  <CopyableValue label="模型列表 (GET /v1/models)" value={status.modelsBaseUrl} />
                ) : null}
              </div>
            </div>
          ) : null}

          <p className="settings-gateway-card__upstream" data-testid="settings-gateway-upstream">
            {status?.lastUpstream
              ? `上游：${status.lastUpstream.providerName}（${protocolLabel(
                  status.lastUpstream.protocol,
                )}），网关自动转换协议`
              : '上游：跟随对话所选供应商与模型，网关自动转换协议'}
          </p>
        </div>
      </div>

      <p
        className={clsx(
          'settings-note',
          status?.failure && setting.enabled && 'settings-gateway-note--alert',
        )}
        data-testid="settings-gateway-status"
        aria-live="polite"
      >
        {statusText}
      </p>
      <p className="settings-note">
        内部对话按「运行票据」路由：启动时锁定对话输入框里选择的供应商与模型，多个供应商存在同名模型也不会串。
      </p>
      {error ? (
        <p className="settings-note" role="alert">
          {error}
        </p>
      ) : null}

      <GatewayAuditLogs />
    </div>
  );
}

const GATEWAY_PAGE_SIZE = 50;

const GATEWAY_DIALECT_LABEL: Record<OpenGatewayUpstreamProtocol, string> = {
  'anthropic-messages': 'Anthropic',
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
};

const GATEWAY_KERNEL_LABEL: Record<string, string> = {
  codex: resolveKernelDisplayName('codex'),
  'claude-code': resolveKernelDisplayName('claude-code'),
  native: resolveKernelDisplayName('native'),
  external: '外部 CLI',
};

/** Try to pretty-print JSON; fall back to the raw text (truncated bodies). */
function prettyJsonText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

function formatLogTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * 网关转换审计日志（AI 模型网关卡片下方）。
 *
 * 每次代理/转换请求都会记录：原始格式（inbound body）、转换后格式（upstream
 * body）与驱动该请求的内核（外部 CLI 记为 external）。内存环形缓冲，分页查看，
 * 可筛选（类型 / 状态 / 内核）、清空与导出 JSON。
 */
function GatewayAuditLogs() {
  const [entries, setEntries] = useState<GatewayRequestLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<GatewayLogsFilter>({});
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getGatewayLogs) return;
    try {
      const next = await runtime.getGatewayLogs({
        offset: page * GATEWAY_PAGE_SIZE,
        limit: GATEWAY_PAGE_SIZE,
        filter,
      });
      setEntries(next.entries);
      setTotal(next.total);
      setHasMore(next.hasMore);
    } catch {
      // Advisory panel; a failed poll keeps the last rendered page.
    }
  }, [page, filter]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const patchFilter = (patch: GatewayLogsFilter) => {
    setFilter((previous) => ({ ...previous, ...patch }));
    setPage(0);
    setExpandedId(undefined);
  };

  const clearAll = async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.clearGatewayLogs || clearing) return;
    setClearing(true);
    try {
      await runtime.clearGatewayLogs();
      setPage(0);
      setExpandedId(undefined);
      await refresh();
    } finally {
      setClearing(false);
    }
  };

  const exportJson = () => {
    if (entries.length === 0) return;
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gateway-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const kernelOptions = [
    { value: undefined, label: '全部内核' },
    { value: 'codex', label: resolveKernelDisplayName('codex') },
    { value: 'claude-code', label: resolveKernelDisplayName('claude-code') },
    { value: 'native', label: resolveKernelDisplayName('native') },
    { value: 'external', label: '外部 CLI' },
  ] as const;

  return (
    <div className="settings-gateway-logs" data-testid="settings-gateway-logs">
      <div className="settings-gateway-logs__head">
        <div className="settings-gateway-logs__title">
          <h3>网关请求日志</h3>
          <span className="settings-gateway-logs__count">
            {total > 0 ? `${total} 条` : '暂无请求'}
          </span>
        </div>
        <div className="settings-gateway-logs__actions">
          <button
            type="button"
            className="settings-gateway-logs__action"
            onClick={() => void refresh()}
            title="刷新"
          >
            <RefreshCw size={13} />
            刷新
          </button>
          <button
            type="button"
            className="settings-gateway-logs__action"
            onClick={exportJson}
            disabled={entries.length === 0}
            title="导出当前页为 JSON 文件"
          >
            <Download size={13} />
            导出 JSON
          </button>
          <button
            type="button"
            className="settings-gateway-logs__action settings-gateway-logs__action--danger"
            onClick={() => void clearAll()}
            disabled={clearing || total === 0}
            title="清空全部日志"
          >
            <Trash2 size={13} />
            清空
          </button>
        </div>
      </div>

      <div className="settings-gateway-logs__filters">
        <div className="settings-gateway-logs__filter-group">
          <span className="settings-gateway-logs__filter-label">类型</span>
          <button
            type="button"
            className={clsx(
              'settings-gateway-logs__chip',
              filter.converted === undefined && 'is-active',
            )}
            onClick={() => patchFilter({ converted: undefined })}
          >
            全部
          </button>
          <button
            type="button"
            className={clsx(
              'settings-gateway-logs__chip',
              filter.converted === true && 'is-active',
            )}
            onClick={() => patchFilter({ converted: true })}
          >
            转换
          </button>
          <button
            type="button"
            className={clsx(
              'settings-gateway-logs__chip',
              filter.converted === false && 'is-active',
            )}
            onClick={() => patchFilter({ converted: false })}
          >
            直通
          </button>
        </div>
        <div className="settings-gateway-logs__filter-group">
          <span className="settings-gateway-logs__filter-label">状态</span>
          <button
            type="button"
            className={clsx(
              'settings-gateway-logs__chip',
              filter.status === undefined && 'is-active',
            )}
            onClick={() => patchFilter({ status: undefined })}
          >
            全部
          </button>
          <button
            type="button"
            className={clsx(
              'settings-gateway-logs__chip',
              filter.status === 'success' && 'is-active',
            )}
            onClick={() => patchFilter({ status: 'success' })}
          >
            成功
          </button>
          <button
            type="button"
            className={clsx(
              'settings-gateway-logs__chip',
              filter.status === 'error' && 'is-active',
            )}
            onClick={() => patchFilter({ status: 'error' })}
          >
            失败
          </button>
        </div>
        <div className="settings-gateway-logs__filter-group">
          <span className="settings-gateway-logs__filter-label">内核</span>
          {kernelOptions.map((option) => (
            <button
              key={option.value ?? 'all'}
              type="button"
              className={clsx(
                'settings-gateway-logs__chip',
                filter.kernelId === option.value && 'is-active',
              )}
              onClick={() => patchFilter({ kernelId: option.value })}
              title={option.label}
            >
              {option.value && option.value !== 'external' ? (
                <BrandLogoMark logo={resolveKernelBrandLogo(option.value)!} size={12} />
              ) : option.value === 'external' ? (
                <TerminalSquare size={11} />
              ) : null}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="settings-gateway-logs__empty">
          {total === 0 ? '还没有网关请求记录。' : '当前筛选条件下没有匹配的请求。'}
        </div>
      ) : (
        <div className="settings-gateway-logs__list">
          {entries.map((entry) => {
            const kernelLogo =
              entry.kernelId && entry.kernelId !== 'external'
                ? resolveKernelBrandLogo(entry.kernelId)
                : undefined;
            const expanded = expandedId === entry.id;
            return (
              <div key={entry.id}>
                <button
                  type="button"
                  className={clsx(
                    'settings-gateway-logs__row',
                    entry.status === 'error' && 'is-error',
                  )}
                  onClick={() => setExpandedId(expanded ? undefined : entry.id)}
                  data-testid="gateway-log-row"
                >
                  <span className="settings-gateway-logs__time">
                    {formatLogTime(entry.occurredAt)}
                  </span>
                  <span
                    className="settings-gateway-logs__kernel"
                    title={GATEWAY_KERNEL_LABEL[entry.kernelId ?? 'external'] ?? entry.kernelId}
                  >
                    {kernelLogo ? (
                      <BrandLogoMark logo={kernelLogo} size={14} />
                    ) : (
                      <TerminalSquare size={13} />
                    )}
                  </span>
                  <span className="settings-gateway-logs__dialect">
                    {GATEWAY_DIALECT_LABEL[entry.inboundDialect]}
                    <ArrowRight size={10} />
                    {GATEWAY_DIALECT_LABEL[entry.upstreamProtocol]}
                  </span>
                  <code className="settings-gateway-logs__model">{entry.model}</code>
                  {entry.status === 'success' ? (
                    <span className="settings-gateway-logs__status is-ok" title="成功">
                      <Check size={13} />
                    </span>
                  ) : (
                    <span
                      className="settings-gateway-logs__status is-err"
                      title={entry.errorMessage ?? '失败'}
                    >
                      <AlertCircle size={13} />
                    </span>
                  )}
                  <span className="settings-gateway-logs__latency">
                    {entry.latencyMs !== undefined ? `${entry.latencyMs}ms` : '—'}
                  </span>
                </button>
                {expanded ? (
                  <div className="settings-gateway-logs__detail">
                    <div className="settings-gateway-logs__detail-meta">
                      <span>
                        内核：
                        {GATEWAY_KERNEL_LABEL[entry.kernelId ?? 'external'] ??
                          entry.kernelId ??
                          '外部'}
                      </span>
                      {entry.runId ? <span>运行：{entry.runId}</span> : null}
                      <span>
                        耗时：{entry.latencyMs !== undefined ? `${entry.latencyMs}ms` : '—'}
                      </span>
                      {entry.truncated ? <span>正文已截断</span> : null}
                    </div>
                    {entry.errorMessage ? (
                      <p className="settings-gateway-logs__detail-error">{entry.errorMessage}</p>
                    ) : null}
                    <div className="settings-gateway-logs__detail-bodies">
                      <div className="settings-gateway-logs__detail-body">
                        <p>原始格式（{GATEWAY_DIALECT_LABEL[entry.inboundDialect]}）</p>
                        <pre>{prettyJsonText(entry.rawRequest)}</pre>
                      </div>
                      <div className="settings-gateway-logs__detail-body">
                        <p>
                          {entry.converted ? '转换后格式' : '上游请求格式'}（
                          {GATEWAY_DIALECT_LABEL[entry.upstreamProtocol]}）
                        </p>
                        <pre>{prettyJsonText(entry.convertedRequest)}</pre>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="settings-gateway-logs__pager">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => {
            setPage((current) => Math.max(current - 1, 0));
            setExpandedId(undefined);
          }}
        >
          上一页
        </button>
        <span>
          第 {page + 1} 页 · 共 {total} 条
        </span>
        <button
          type="button"
          disabled={!hasMore}
          onClick={() => {
            setPage((current) => current + 1);
            setExpandedId(undefined);
          }}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

const DATA_BACKUP_SETTING_KEY = 'data.backup.preferences';

interface DataBackupPreference {
  directory: string;
  lastBackupAt?: string;
}

type DataFeedback = { tone: 'working' | 'success' | 'error'; text: string };

function normalizeDataBackupPreference(value: unknown): DataBackupPreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { directory: '' };
  const record = value as Record<string, unknown>;
  return {
    directory: typeof record.directory === 'string' ? record.directory : '',
    ...(typeof record.lastBackupAt === 'string' ? { lastBackupAt: record.lastBackupAt } : {}),
  };
}

function formatDataBytes(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index]!;
  }
  return `${amount.toFixed(1)} ${unit}`;
}

function formatBackupTime(value: string | undefined): string {
  if (!value) return '从未备份';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export function DataDiagnosticsSection() {
  const [stats, setStats] = useState<DataStorageStatsResponse>();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [exportScope, setExportScope] = useState('all');
  const [backupDirectory, setBackupDirectory] = useState('');
  const [lastBackupAt, setLastBackupAt] = useState<string>();
  const [cleanupRange, setCleanupRange] = useState('month');
  const [busyAction, setBusyAction] = useState<string>();
  const [feedback, setFeedback] = useState<DataFeedback>();

  const refreshStats = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getDataStorageStats) return;
    const response = await runtime.getDataStorageStats();
    setStats(response);
  }, []);

  useEffect(() => {
    let disposed = false;
    const runtime = window.syncThink?.runtime;
    if (!runtime) return undefined;
    void Promise.all([
      runtime.getDataStorageStats(),
      runtime.listWorkspaces({}),
      runtime.getSettings({ keys: [DATA_BACKUP_SETTING_KEY] }),
    ])
      .then(([nextStats, workspaceResponse, settingResponse]) => {
        if (disposed) return;
        setStats(nextStats);
        setWorkspaces(workspaceResponse.workspaces);
        const preference = normalizeDataBackupPreference(
          settingResponse.settings[DATA_BACKUP_SETTING_KEY],
        );
        setBackupDirectory(preference.directory);
        setLastBackupAt(preference.lastBackupAt);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setFeedback({
            tone: 'error',
            text: reason instanceof Error ? reason.message : '读取数据状态失败。',
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const handleExport = async () => {
    if (busyAction) return;
    setBusyAction('export');
    setFeedback({ tone: 'working', text: '正在导出数据…' });
    try {
      const runtime = window.syncThink?.runtime;
      if (!runtime?.exportData) throw new Error('数据导出服务尚未就绪。');
      const result = await runtime.exportData(
        exportScope === 'all' ? {} : { workspaceId: exportScope },
      );
      if (result.status === 'saved') {
        setFeedback({
          tone: 'success',
          text: `已导出 ${result.count.workspaces} 个工作区、${result.count.conversations} 个对话、${result.count.messages} 条消息：${result.filePath}`,
        });
      } else {
        setFeedback({ tone: 'success', text: '已取消导出。' });
      }
    } catch (reason) {
      setFeedback({
        tone: 'error',
        text: reason instanceof Error ? reason.message : '数据导出失败。',
      });
    } finally {
      setBusyAction(undefined);
    }
  };

  const handleImport = async () => {
    if (busyAction) return;
    setBusyAction('import');
    setFeedback({ tone: 'working', text: '正在导入数据…' });
    try {
      const runtime = window.syncThink?.runtime;
      if (!runtime?.importData) throw new Error('数据导入服务尚未就绪。');
      const result = await runtime.importData({ conflictStrategy: 'skip' });
      if (result.status === 'imported') {
        setFeedback({
          tone: 'success',
          text: `已导入 ${result.imported.workspaces} 个工作区、${result.imported.conversations} 个对话、${result.imported.messages} 条消息${result.skipped > 0 ? `，跳过 ${result.skipped} 条冲突数据` : ''}。`,
        });
        await refreshStats();
      } else {
        setFeedback({ tone: 'success', text: '已取消导入。' });
      }
    } catch (reason) {
      setFeedback({
        tone: 'error',
        text: reason instanceof Error ? reason.message : '数据导入失败。',
      });
    } finally {
      setBusyAction(undefined);
    }
  };

  const handleSelectBackupDirectory = async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.pickFolder) return;
    const result = await runtime.pickFolder({ title: '选择备份目录' });
    if (result.canceled || !result.path) return;
    setBackupDirectory(result.path);
    await runtime.setSetting({
      key: DATA_BACKUP_SETTING_KEY,
      value: { directory: result.path, ...(lastBackupAt ? { lastBackupAt } : {}) },
    });
  };

  const handleBackup = async () => {
    if (!backupDirectory || busyAction) return;
    setBusyAction('backup');
    setFeedback({ tone: 'working', text: '正在创建数据库备份…' });
    try {
      const runtime = window.syncThink?.runtime;
      if (!runtime?.backupData) throw new Error('备份服务尚未就绪。');
      const result = await runtime.backupData({ targetDirectory: backupDirectory });
      setLastBackupAt(result.createdAt);
      setFeedback({
        tone: 'success',
        text: `备份完成：${result.backupPath}（${formatDataBytes(result.sizeBytes)}）`,
      });
      await runtime.setSetting({
        key: DATA_BACKUP_SETTING_KEY,
        value: { directory: backupDirectory, lastBackupAt: result.createdAt },
      });
    } catch (reason) {
      setFeedback({
        tone: 'error',
        text: reason instanceof Error ? reason.message : '备份失败。',
      });
    } finally {
      setBusyAction(undefined);
    }
  };

  const runMaintenance = async (
    action: string,
    workingText: string,
    operation: () => Promise<string>,
  ) => {
    if (busyAction) return;
    setBusyAction(action);
    setFeedback({ tone: 'working', text: workingText });
    try {
      setFeedback({ tone: 'success', text: await operation() });
      await refreshStats();
    } catch (reason) {
      setFeedback({
        tone: 'error',
        text: reason instanceof Error ? reason.message : '操作失败。',
      });
    } finally {
      setBusyAction(undefined);
    }
  };

  const cleanupBeforeTimestamp = () => {
    const days = cleanupRange === 'year' ? 365 : cleanupRange === 'quarter' ? 90 : 30;
    return Date.now() - days * 24 * 60 * 60 * 1000;
  };

  return (
    <div className="settings-scroll settings-data-page settings-diagnostics-export">
      <section className="settings-data-card" aria-labelledby="data-migration-title">
        <h2 className="settings-data-card__title" id="data-migration-title">
          数据迁移
        </h2>
        <div className="settings-data-card__body settings-data-stack">
          <div className="settings-data-row settings-data-row--adaptive">
            <p className="settings-data-row-label">导出</p>
            <div className="settings-data-actions">
              <select
                className="settings-data-select settings-data-select--scope"
                aria-label="导出范围"
                value={exportScope}
                onChange={(event) => setExportScope(event.target.value)}
              >
                <option value="all">全部数据</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              <select
                className="settings-data-select settings-data-select--format"
                aria-label="导出格式"
                value="json"
                onChange={() => undefined}
              >
                <option value="json">JSON</option>
              </select>
              <button
                type="button"
                className="settings-data-button settings-data-button--secondary settings-diagnostics-export__button"
                disabled={Boolean(busyAction)}
                aria-label="导出数据"
                onClick={() => void handleExport()}
              >
                <Download size={14} aria-hidden="true" />
                {busyAction === 'export' ? '正在导出' : '导出'}
              </button>
            </div>
          </div>
          {feedback ? (
            <span
              className={clsx(
                'settings-data-status',
                feedback.tone === 'error' && 'is-error',
                feedback.tone === 'success' && 'is-saved',
              )}
              role={feedback.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {feedback.text}
            </span>
          ) : null}
          <div className="settings-data-divider" />
          <div className="settings-data-row">
            <div className="settings-data-copy">
              <strong>导入数据</strong>
              <p>支持导入 JSON 格式的导出文件</p>
            </div>
            <button
              type="button"
              className="settings-data-button settings-data-button--secondary"
              disabled={Boolean(busyAction)}
              onClick={() => void handleImport()}
            >
              <Upload size={14} aria-hidden="true" />
              {busyAction === 'import' ? '正在导入' : '选择并导入'}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-data-card" aria-labelledby="data-backup-title">
        <h2 className="settings-data-card__title" id="data-backup-title">
          数据备份
        </h2>
        <div className="settings-data-card__body settings-data-stack">
          <div className="settings-data-row">
            <div className="settings-data-copy">
              <strong>备份目录</strong>
              <p className="settings-data-path" title={backupDirectory || '未设置'}>
                {backupDirectory || '未设置'}
              </p>
            </div>
            <button
              type="button"
              className="settings-data-button settings-data-button--ghost"
              disabled={Boolean(busyAction)}
              onClick={() => void handleSelectBackupDirectory()}
            >
              <FolderOpen size={14} aria-hidden="true" />
              选择目录
            </button>
          </div>
          <div className="settings-data-divider" />
          <div className="settings-data-row">
            <div className="settings-data-copy">
              <strong>备份频率</strong>
              <p>自动备份的执行频率</p>
            </div>
            <select
              className="settings-data-select settings-data-select--frequency"
              aria-label="备份频率"
              value="manual"
              onChange={() => undefined}
            >
              <option value="manual">手动</option>
            </select>
          </div>
          <div className="settings-data-divider" />
          <div className="settings-data-row">
            <div className="settings-data-copy">
              <strong>上次备份</strong>
              <p>{formatBackupTime(lastBackupAt)}</p>
            </div>
            <button
              type="button"
              className="settings-data-button settings-data-button--secondary"
              disabled={!backupDirectory || Boolean(busyAction)}
              onClick={() => void handleBackup()}
            >
              <Save size={14} aria-hidden="true" />
              {busyAction === 'backup' ? '正在备份' : '立即备份'}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-data-card" aria-labelledby="data-storage-title">
        <h2 className="settings-data-card__title" id="data-storage-title">
          存储管理
        </h2>
        <div className="settings-data-card__body settings-data-stack">
          <div className="settings-data-storage-stats">
            <div>
              <span>数据库大小</span>
              <strong>{formatDataBytes(stats?.dbSizeBytes)}</strong>
            </div>
            <div>
              <span>对话文件</span>
              <strong>{formatDataBytes(stats?.conversationFilesSizeBytes)}</strong>
            </div>
            <div>
              <span>对话数量</span>
              <strong>{stats ? `${stats.conversationCount} 个` : '—'}</strong>
            </div>
            <div>
              <span>消息数量</span>
              <strong>{stats ? `${stats.messageCount} 条` : '—'}</strong>
            </div>
          </div>
          <div className="settings-data-row">
            <div className="settings-data-copy">
              <strong>数据目录</strong>
              <p>数据库、对话记录、配置等所有数据所在位置</p>
            </div>
            <button
              type="button"
              className="settings-data-button settings-data-button--ghost"
              disabled={Boolean(busyAction)}
              onClick={() =>
                void runMaintenance('open-directory', '正在打开数据目录…', async () => {
                  const runtime = window.syncThink?.runtime;
                  if (!runtime?.openDataDirectory) throw new Error('数据目录服务尚未就绪。');
                  const result = await runtime.openDataDirectory();
                  if (!result.opened) throw new Error(result.error || '打开数据目录失败。');
                  return `已打开数据目录：${result.path}`;
                })
              }
            >
              <FolderOpen size={14} aria-hidden="true" />
              打开目录
            </button>
          </div>
          <div className="settings-data-divider" />
          <div className="settings-data-row">
            <div className="settings-data-copy">
              <strong>优化存储</strong>
              <p>压缩对话记录中的冗余数据，回收磁盘空间，不会删除任何对话</p>
            </div>
            <button
              type="button"
              className="settings-data-button settings-data-button--tertiary"
              aria-label="优化存储"
              disabled={Boolean(busyAction)}
              onClick={() =>
                void runMaintenance('compact', '正在优化存储…', async () => {
                  const runtime = window.syncThink?.runtime;
                  if (!runtime?.compactDataStorage) throw new Error('存储优化服务尚未就绪。');
                  const result = await runtime.compactDataStorage();
                  return `存储优化完成，处理 ${result.compacted} 项，回收 ${formatDataBytes(result.reclaimedBytes)}。`;
                })
              }
            >
              <WandSparkles size={14} aria-hidden="true" />
              优化
            </button>
          </div>
          <div className="settings-data-divider" />
          <div className="settings-data-row">
            <div className="settings-data-copy">
              <strong>清理空附件目录</strong>
              <p>清理工作区中当前或旧版遗留的空对话附件目录，不会删除对话记录或附件文件</p>
            </div>
            <button
              type="button"
              className="settings-data-button settings-data-button--tertiary"
              aria-label="清理空附件目录"
              disabled={Boolean(busyAction)}
              onClick={() =>
                void runMaintenance('clean-attachments', '正在检查空附件目录…', async () => {
                  const runtime = window.syncThink?.runtime;
                  if (!runtime?.cleanEmptyAttachmentDirectories) {
                    throw new Error('附件目录清理服务尚未就绪。');
                  }
                  const result = await runtime.cleanEmptyAttachmentDirectories();
                  return `已清理 ${result.removedConversationDirs} 个空附件目录。`;
                })
              }
            >
              <Trash2 size={14} aria-hidden="true" />
              清理
            </button>
          </div>
          <div className="settings-data-divider" />
          <div className="settings-data-row">
            <p className="settings-data-row-label">清理范围</p>
            <div className="settings-data-actions">
              <select
                className="settings-data-select settings-data-select--range"
                aria-label="对话清理范围"
                value={cleanupRange}
                disabled={Boolean(busyAction)}
                onChange={(event) => setCleanupRange(event.target.value)}
              >
                <option value="month">1 个月前</option>
                <option value="quarter">3 个月前</option>
                <option value="year">1 年前</option>
              </select>
              <button
                type="button"
                className="settings-data-button settings-data-button--tertiary"
                aria-label="按范围清理对话"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  if (!confirm('确定清理所选时间范围之前的对话和消息吗？')) return;
                  void runMaintenance('clean-range', '正在清理对话…', async () => {
                    const runtime = window.syncThink?.runtime;
                    if (!runtime?.cleanConversations) throw new Error('对话清理服务尚未就绪。');
                    const result = await runtime.cleanConversations({
                      beforeTimestamp: cleanupBeforeTimestamp(),
                    });
                    return `已清理 ${result.deletedConversations} 个对话、${result.deletedMessages} 条消息。`;
                  });
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                清理
              </button>
            </div>
          </div>
          <div className="settings-data-divider" />
          <div className="settings-data-row">
            <div className="settings-data-copy">
              <strong>清空对话历史</strong>
              <p>仅删除对话和消息记录，保留账号、设置、模型、技能等其它数据</p>
            </div>
            <button
              type="button"
              className="settings-data-button settings-data-button--danger-subtle"
              disabled={Boolean(busyAction)}
              onClick={() => {
                if (!confirm('确定清空全部对话历史吗？此操作不会删除其它设置。')) return;
                void runMaintenance('clean-all', '正在清空对话历史…', async () => {
                  const runtime = window.syncThink?.runtime;
                  if (!runtime?.cleanConversations) throw new Error('对话清理服务尚未就绪。');
                  const result = await runtime.cleanConversations({});
                  return `已清空 ${result.deletedConversations} 个对话、${result.deletedMessages} 条消息。`;
                });
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              清空对话
            </button>
          </div>
        </div>
      </section>

      <section className="settings-data-card" aria-labelledby="data-wipe-title">
        <h2 className="settings-data-card__title" id="data-wipe-title">
          清空本机数据
        </h2>
        <div className="settings-data-card__body settings-data-row">
          <div className="settings-data-copy">
            <strong>删除并退出</strong>
            <p>
              永久删除本机对话、设置、Skill、插件、日志等并退出应用。Claude CLI 共享目录不会被删。
            </p>
          </div>
          <button
            type="button"
            className="settings-data-button settings-data-button--danger is-static"
            title="当前版本暂未开放清空本机数据"
            disabled
          >
            <Trash2 size={16} aria-hidden="true" />
            删除并退出
          </button>
        </div>
      </section>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settings-scroll settings-about-page">
      <DesktopUpdatePanel />
      <KernelUpdatePanel />
      <p className="settings-about-copyright">© 2026 SYNC-THINK. All rights reserved.</p>
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
