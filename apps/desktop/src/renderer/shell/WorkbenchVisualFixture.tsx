/** Full desktop shell in a deterministic, in-memory QA runtime. Never imported by production. */
import { applyNewmaxSkin } from './theme/apply-newmax-appearance.js';
import { clearWorkbenchAppearance } from './theme/apply-workbench-appearance.js';
import type { ColorThemeId } from './preferences-store.js';
import { ShellApp } from './ShellApp.js';
import { installPreviewRuntime } from './design-system/fixtures/runtime.js';
import * as data from './design-system/fixtures/data.js';
import { createCalendarPreviewRuntime } from './design-system/fixtures/calendar.js';
import { SHELL_BOOT_SNAPSHOT_KEY } from './shell-boot-snapshot.js';
import { botAvatarSeed } from './bot-avatar.js';
import { writeActiveWorkspaceId, writeNewConversationModel, writeNewConversationKernel } from '../ui-preferences.js';
import { applyAppearancePreferences, readAppearancePreferences } from './preferences-store.js';

const params = new URLSearchParams(location.search);
// Opt-in editor QA uses real persisted avatar formats, without changing product records.
const taskEditorPreview = params.get('task-editor') === 'avatars';
const workspaceNavigationPreview = params.get('navigation') === 'workspaces';
const previewConversations = workspaceNavigationPreview ? [...data.conversations,
  { ...data.conversations[0], id: 'demo-design-conversation', workspaceId: 'demo-design', title: '设计工作区的会话' },
  { ...data.conversations[1], id: 'demo-design-archive', workspaceId: 'demo-design', title: '设计工作区的归档', archivedAt: data.timestamp },
] : data.conversations;
const previewAgents = taskEditorPreview ? data.agents.map((agent, index) => ({ ...agent, avatar: botAvatarSeed((['flower', 'triangle', 'drop'] as const)[index] ?? 'circle') })) : data.agents;
const calendarPreview = ['sample', 'hourly-missing'].includes(params.get('calendar') ?? '') ? createCalendarPreviewRuntime({ agentId: data.agents[1].id, modelId: data.models[0].modelId, teamId: data.teams[0].id, workspaceId: data.workspaces[0].workspaceId }, new Date(), params.get('calendar') === 'hourly-missing' ? 'hourly-missing' : 'sample') : null;
const { storage } = installPreviewRuntime();
const bridge = window.syncThink!;
const runtime = bridge.runtime!;
Object.defineProperty(window, 'syncThink', { configurable: true, value: {
  ...bridge,
  runtime: new Proxy(runtime, { get(target, key) {
    if (workspaceNavigationPreview && key === 'listConversations') return async () => ({ conversations: previewConversations });
    if (taskEditorPreview && (key === 'listGlobalAgents' || key === 'listAgents')) return async () => ({ agents: previewAgents });
    // Opt-in latency exposes refresh flicker without touching any product data.
    if (calendarPreview && key === 'scheduledTaskHistory' && params.get('calendar-latency') === '600') return async (...args: Parameters<typeof calendarPreview.scheduledTaskHistory>) => {
      await new Promise(resolve => window.setTimeout(resolve, 600));
      return calendarPreview.scheduledTaskHistory(...args);
    }
    if (calendarPreview && typeof key === 'string' && key in calendarPreview) return calendarPreview[key as keyof typeof calendarPreview];
    if (key === 'connect') return async () => ({ ok: true, result: { snapshot: [] } });
    if (key === 'listProjectDir') return async () => ({ entries: data.files.filter(file => file.type === 'file') });
    if (key === 'gitChanged') return async () => ({ isRepo: true, branch: 'main', detached: false, ahead: 0, behind: 0, operation: null, changeCount: 1 });
    if (key === 'gitWorktrees') return async () => ({ repoName: 'sync-think', worktrees: [{ path: '/demo/sync-think', name: 'sync-think', main: true, active: true, branch: 'main', changeCount: 1 }] });
    if (key === 'listProviders') return async () => ({ providers: [{ providerId: 'demo-provider', name: 'OpenAI', enabled: true, protocol: 'openai', models: data.models }] });
    return Reflect.get(target, key);
  } }),
} });
storage.setItem(SHELL_BOOT_SNAPSHOT_KEY, JSON.stringify({ ...data, conversations: previewConversations, agents: previewAgents, modelNames: data.models.map(m => [m.modelId, m.displayName]) }));
writeActiveWorkspaceId(data.workspaces[0].workspaceId);
writeNewConversationModel(data.models[0].modelId);
writeNewConversationKernel('builtin');
const theme: 'light' | 'dark' = params.get('theme') === 'dark' ? 'dark' : 'light';
const colorTheme: ColorThemeId = params.get('palette') === 'azure' ? 'azure' : 'default';
const preferences = { ...readAppearancePreferences(), mode: theme, colorTheme, ...(params.get('wallpaper') === 'true' ? { imageThemeId: 'preset-lakewood' } : {}) };
applyAppearancePreferences(preferences);
if (params.get('design') === 'legacy') {
  clearWorkbenchAppearance(document.documentElement);
  applyNewmaxSkin(document.documentElement, preferences, theme === 'dark');
  delete document.documentElement.dataset.shellDesign;
}
export default function WorkbenchVisualFixture() { return <ShellApp />; }
