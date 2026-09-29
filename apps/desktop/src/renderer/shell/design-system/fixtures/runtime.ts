import * as data from './data.js';
/** Installed ONLY in the standalone preview document, never in the host app.
 * Native bridge calls and persistence are in-memory. Network is denied by CSP. */
export function installPreviewRuntime() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: storage });
  const noop = () => {};
  const settings = new Map<string, unknown>();
  const stats = {
    messages: 24,
    conversations: 3,
    agents: 3,
    teams: 1,
    skills: 1,
    totalBytes: 245760,
  };
  const results: Record<string, unknown> = {
    collaboration: { snapshot: data.collaboration, activities: [] },
    activityListRuns: {
      entries: [
        {
          runId: 'demo-run',
          workspaceId: data.workspaces[0].workspaceId,
          conversationId: data.conversations[0].id,
          title: '组件与主题一致性检查',
          state: 'completed',
          source: 'chat',
          startedAt: data.timestamp,
          finishedAt: data.timestamp,
        },
        {
          runId: 'demo-run-2',
          workspaceId: data.workspaces[0].workspaceId,
          title: '整理设计研究资料',
          state: 'running',
          source: 'scheduled',
          startedAt: data.timestamp,
        },
      ],
      counts: { running: 1, completed: 1, failed: 0, cancelled: 0, paused: 0 },
    },
    listGlobalAgentWorkspaceActivations: { activations: [] },
    gitReadIdentity: {
      ok: true,
      identity: { name: 'Design Team', email: 'design@example.test' },
      effectiveIdentity: { name: 'Design Team', email: 'design@example.test' },
      scope: 'local',
    },
    listWorkspaces: { workspaces: data.workspaces },
    listConversations: { conversations: data.conversations },
    listGlobalAgents: { agents: data.agents },
    listAgents: { agents: data.agents },
    listTeams: { teams: data.teams },
    listModels: { models: data.models },
    listSkillVersions: { skills: data.skills, versions: data.skills },
    listSkills: { skills: data.skills },
    listMcpServers: {
      servers: [
        {
          mcpServerId: 'demo-mcp',
          notes: '读取项目文件与设计文档',
          serverId: 'demo-mcp',
          id: 'demo-mcp',
          name: 'Project Files',
          transport: 'stdio',
          enabled: true,
          status: 'connected',
          toolCount: 8,
        },
      ],
    },
    listConversationMessages: {
      messages: data.messages.map((message, index) => ({
        ...message,
        sequence: index + 1,
        blocks: [{ type: 'text', text: message.content }],
      })),
      hasMore: false,
      nextBeforeSequence: null,
    },
    listMessages: { messages: data.messages, hasMore: false, totalCount: 2 },
    getMessages: { messages: data.messages, hasMore: false },
    conversationMessages: { messages: data.messages, hasMore: false },
    listScheduledTasks: { tasks: data.tasks },
    scheduledTaskHistory: {
      entries: [
        {
          id: 'demo-history',
          taskId: data.task.id,
          status: 'success',
          firedAt: data.timestamp,
          summary: '所有组件的主题一致性检查通过。',
        },
      ],
    },
    listBrowserProfiles: { profiles: [data.profile] },
    listBrowserSiteSessions: { sessions: [] },
    listBrowserRecordings: { recordings: [] },
    'browserWorkflow.list': { tasks: data.browserTasks, livePages: [] },
    'browserWorkflow.get': {
      task: data.browserTasks[0],
      version: {
        id: 'v1',
        steps: [
          { kind: 'navigate', url: 'https://example.test/design' },
          { kind: 'click', locator: { kind: 'css', selector: 'button' } },
        ],
        stepCount: 2,
      },
      reviews: [],
      recentRuns: [],
      schedule: { enabled: true, intervalMinutes: 60 },
    },
    conversationPlanGet: { plan: data.plan },
    conversationPlanRevise: { plan: data.plan },
    conversationPlanApprove: { plan: { ...data.plan, state: 'approved' } },
    getRuntimeStatus: { connected: true, status: 'ready' },
    dataStorageStats: { ...stats, stats },
    getDataStorageStats: { ...stats, stats },
    getDataStoragePaths: {
      root: '/demo/sync-think',
      workspaceRoot: '/demo/sync-think',
      globalRoot: '/demo/global',
    },
    detectKernels: {
      kernels: [
        {
          id: 'codex',
          kernelId: 'codex',
          name: 'Codex',
          installed: true,
          available: true,
          version: '1.0.0',
        },
      ],
    },
    listProjectFiles: { entries: data.files, files: data.files },
    readProjectFile: {
      ok: true,
      path: 'README.md',
      content: data.markdown,
      text: data.markdown,
      mtimeMs: 1,
      size: 500,
    },
    gitStatus: {
      ok: true,
      root: '/demo/sync-think',
      isRepo: true,
      isRepository: true,
      branch: 'main',
      currentBranch: 'main',
      ahead: 0,
      behind: 0,
      files: [
        {
          path: 'src/theme/tokens.css',
          status: 'M',
          staged: false,
          indexStatus: ' ',
          worktreeStatus: 'M',
        },
      ],
      staged: [],
      unstaged: [{ path: 'src/theme/tokens.css', status: 'M' }],
      untracked: [],
    },
    gitDiff: { ok: true, diff: data.diff, patch: data.diff },
    gitBranches: {
      ok: true,
      branches: [
        { name: 'main', current: true },
        { name: 'design/components', current: false },
      ],
    },
    gitLog: {
      ok: true,
      commits: [
        {
          hash: 'd3a12ef',
          subject: '完善组件主题与交互',
          author: 'Design Team',
          date: data.timestamp,
        },
      ],
    },
    getDaemonStatus: { enabled: false, running: false, tasks: [] },
    listActivity: { items: [], entries: [] },
  };
  const fallback = {
    ok: true,
    success: true,
    connected: true,
    enabled: true,
    status: 'ready',
    settings: {},
    items: [],
    entries: [],
    events: [],
    messages: [],
    conversations: [],
    agents: [],
    teams: [],
    models: [],
    providers: [],
    skills: [],
    versions: [],
    servers: [],
    tools: [],
    tasks: [],
    runs: [],
    files: [],
    paths: [],
    history: [],
    profiles: [],
    bindings: [],
    groups: [],
    snapshots: [],
    workspaces: data.workspaces,
    total: 0,
    totalCount: 0,
    hasMore: false,
    stats,
  };
  function namespace(prefix = ''): object {
    return new Proxy(function () {}, {
      get(_target, key) {
        if (key === 'then') return undefined;
        if (key === Symbol.toStringTag) return 'PreviewBridge';
        const name = prefix ? `${prefix}.${String(key)}` : String(key);
        return namespace(name);
      },
      apply(_target, _self, args) {
        if (prefix === 'watchProjectFile')
          return { ready: Promise.resolve(), unsubscribe: async () => {} };
        if (prefix === 'listCapabilityGovernance') return Promise.resolve(undefined);
        if (/^(on|subscribe)|\.(on|subscribe)/.test(prefix)) return noop;
        if (prefix === 'getSetting')
          return Promise.resolve({ value: settings.get(args[0]?.key) ?? null });
        if (prefix === 'setSetting') {
          settings.set(args[0]?.key, args[0]?.value);
          return Promise.resolve({ ok: true });
        }
        if (prefix === 'getSettings')
          return Promise.resolve({ settings: Object.fromEntries(settings) });
        if (prefix === 'readProjectFile') {
          const p = args[0]?.path ?? '';
          return Promise.resolve({
            ok: true,
            path: p,
            content: p.endsWith('.tsx')
              ? data.code
              : p.endsWith('.html')
                ? data.html
                : data.markdown,
            text: data.markdown,
            mtimeMs: 1,
            size: 500,
          });
        }
        if (prefix in results) return Promise.resolve(results[prefix]);
        return Promise.resolve({
          ...fallback,
          ...(/create|update/i.test(prefix)
            ? { agent: data.agents[0], task: data.task, team: data.teams[0] }
            : {}),
        });
      },
    });
  }
  const update = {
    getSnapshot: async () => ({
      status: 'idle',
      currentVersion: '0.1.0',
      channel: 'stable',
      configured: false,
    }),
    onSnapshot: () => noop,
    onStatus: () => noop,
    checkForUpdates: async () => ({ status: 'idle' }),
  };
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: namespace(),
      platform: 'preview',
      terminal: {
        exists: async () => true,
        getBuffer: async () =>
          '\x1b[32m✓ Sync-Think component checks\x1b[0m\r\n\r\n  theme.test.ts             8 passed\r\n  components.test.tsx      16 passed\r\n\r\n\x1b[32m  24 tests passed in 1.28s\x1b[0m\r\n\r\n/demo/sync-think $ ',
        create: async () => ({ ok: true, sessionId: 'demo-terminal' }),
        write: noop,
        resize: noop,
        onData: () => noop,
        onExit: () => noop,
      },
      onEvent: () => noop,
      desktopUpdate: update,
      kernelUpdate: update,
    },
  });
  Object.defineProperty(window, 'open', { configurable: true, value: () => null });
  return { storage, settings };
}
