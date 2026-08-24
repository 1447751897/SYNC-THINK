/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPUTER_USE_PLUGIN_SETTING_KEY } from '@sync-think/protocol/plugins';
import { OPEN_GATEWAY_SETTING_KEY } from '@sync-think/protocol/gateway';
import { SettingsPage } from './SettingsPage.js';

const shellCss = readFileSync(resolve(process.cwd(), 'src/renderer/shell/shell.css'), 'utf8');

vi.mock('./ModelSettings.js', () => ({
  ModelSettings: () => null,
}));

const runtime = {
  getSettings: vi.fn(),
  setSetting: vi.fn(),
  setTheme: vi.fn(),
  pickFolder: vi.fn(),
  listWorkspaces: vi.fn(),
  getDataStorageStats: vi.fn(),
  exportData: vi.fn(),
  importData: vi.fn(),
  backupData: vi.fn(),
  compactDataStorage: vi.fn(),
  cleanConversations: vi.fn(),
  cleanEmptyAttachmentDirectories: vi.fn(),
  openDataDirectory: vi.fn(),
  getGatewayStatus: vi.fn(),
  listProviders: vi.fn(),
  listMcpServers: vi.fn(),
  registerRemoteMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  deleteMcpServer: vi.fn(),
};

beforeEach(() => {
  runtime.exportData.mockResolvedValue({
    status: 'saved',
    success: true,
    filePath: 'C:\\support\\sync-think-export.json',
    count: { workspaces: 2, conversations: 12, messages: 48 },
  });
  runtime.importData.mockResolvedValue({
    status: 'imported',
    success: true,
    imported: { workspaces: 1, conversations: 3, messages: 8 },
    skipped: 0,
  });
  runtime.getDataStorageStats.mockResolvedValue({
    success: true,
    dataDirectory: 'C:\\Users\\tester\\AppData\\Roaming\\SYNC-THINK',
    dbSizeBytes: 12 * 1024 * 1024,
    conversationFilesSizeBytes: 3 * 1024 * 1024,
    conversationCount: 12,
    messageCount: 48,
  });
  runtime.backupData.mockResolvedValue({
    success: true,
    backupPath: 'D:\\backups\\sync-think-backup-2026-08-24.db',
    sizeBytes: 12 * 1024 * 1024,
    createdAt: '2026-08-24T03:00:00.000Z',
  });
  runtime.compactDataStorage.mockResolvedValue({
    success: true,
    reclaimedBytes: 2 * 1024 * 1024,
    compacted: 12,
  });
  runtime.cleanConversations.mockResolvedValue({
    success: true,
    deletedConversations: 2,
    deletedMessages: 9,
  });
  runtime.cleanEmptyAttachmentDirectories.mockResolvedValue({
    success: true,
    removedConversationDirs: 4,
  });
  runtime.openDataDirectory.mockResolvedValue({
    opened: true,
    path: 'C:\\Users\\tester\\AppData\\Roaming\\SYNC-THINK',
  });
  runtime.pickFolder.mockResolvedValue({ canceled: false, path: 'D:\\backups' });
  runtime.listWorkspaces.mockResolvedValue({ workspaces: [] });
  runtime.listMcpServers.mockResolvedValue({ servers: [] });
  runtime.registerRemoteMcpServer.mockResolvedValue({
    server: {
      mcpServerId: 'mcp-douyin',
      name: '抖音',
      transport: 'remote-http',
      endpoint: 'https://connector.example.com/mcp',
      tools: [],
      trusted: false,
      enabled: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: '',
      createdAt: '2026-08-24T03:00:00.000Z',
      updatedAt: '2026-08-24T03:00:00.000Z',
    },
    updated: false,
    endpoint: 'https://connector.example.com/mcp',
    authConfigured: true,
    discovered: true,
  });
  runtime.setMcpServerEnabled.mockResolvedValue({ server: {} });
  runtime.deleteMcpServer.mockResolvedValue({ mcpServerId: 'mcp-douyin', deleted: true });
  runtime.getSettings.mockResolvedValue({ settings: {} });
  runtime.setSetting.mockResolvedValue({
    key: COMPUTER_USE_PLUGIN_SETTING_KEY,
    value: { enabled: true },
    updatedAt: '2026-07-31T00:00:00.000Z',
  });
  runtime.getGatewayStatus.mockResolvedValue({
    enabled: false,
    running: false,
    port: 8788,
    host: '127.0.0.1',
  });
  runtime.listProviders.mockResolvedValue({ providers: [] });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsPage layout contract', () => {
  it('keeps horizontal overflow clipped at every settings and menu scroll boundary', () => {
    expect(shellCss).toMatch(/\.settings-scroll\s*\{[^}]*overflow-x:\s*hidden;/s);
    expect(shellCss).toMatch(/\.model-settings-detail\s*\{[^}]*overflow-x:\s*hidden;/s);
    expect(shellCss).toMatch(/\.model-settings-tabs\s*\{[^}]*overflow-x:\s*hidden;/s);
    expect(shellCss).toMatch(/\.shell-menu__scroll\s*\{[^}]*overflow-x:\s*hidden;/s);
  });
});

async function openPlugins() {
  render(<SettingsPage />);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索设置' }), {
    target: { value: '插件' },
  });
  fireEvent.click(screen.getByRole('button', { name: '插件' }));
  const toggle = await screen.findByRole('switch', { name: '启用 Computer Use 插件' });
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
  return toggle;
}

describe('SettingsPage Computer Use plugin', () => {
  it('defaults to disabled and replaces the plugins coming-soon placeholder', async () => {
    const toggle = await openPlugins();

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/能力尚未接入/)).toBeNull();
    expect(runtime.getSettings).toHaveBeenCalledWith({
      keys: [COMPUTER_USE_PLUGIN_SETTING_KEY],
    });
  });

  it('loads the persisted enabled state', async () => {
    runtime.getSettings.mockResolvedValue({
      settings: { [COMPUTER_USE_PLUGIN_SETTING_KEY]: { enabled: true } },
    });

    const toggle = await openPlugins();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('persists an enabled toggle using the existing settings bridge', async () => {
    const toggle = await openPlugins();
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: COMPUTER_USE_PLUGIN_SETTING_KEY,
        value: { enabled: true },
      }),
    );
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('rolls the toggle back when persistence fails', async () => {
    runtime.setSetting.mockRejectedValue(new Error('save failed'));
    const toggle = await openPlugins();
    fireEvent.click(toggle);

    await screen.findByRole('alert');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('alert').textContent).toContain('save failed');
  });
});

async function openDataSettings() {
  render(<SettingsPage />);
  const dataButton = screen.getByRole('button', { name: '数据' });
  dataButton.focus();
  fireEvent.click(dataButton);
  const exportButton = await screen.findByRole('button', { name: '导出数据' });
  exportButton.focus();
  await waitFor(() => expect(runtime.getDataStorageStats).toHaveBeenCalled());
  return exportButton;
}

describe('SettingsPage data management', () => {
  it('uses the NewMax information architecture with live storage values', async () => {
    await openDataSettings();

    expect(screen.getByRole('region', { name: '云端同步' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '数据迁移' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '数据备份' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '存储管理' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '清空本机数据' })).toBeTruthy();
    expect(screen.getByText('全部数据')).toBeTruthy();
    expect(screen.getByText('数据库大小')).toBeTruthy();
    expect(screen.getByText('对话文件')).toBeTruthy();
    expect(screen.getByText('对话数量')).toBeTruthy();
    expect(screen.getByText('消息数量')).toBeTruthy();
    expect(screen.getByText('12.0 MB')).toBeTruthy();
    expect(screen.getByText('3.0 MB')).toBeTruthy();
    expect(screen.getByText('12 个')).toBeTruthy();
    expect(screen.getByText('48 条')).toBeTruthy();

    const syncToggle = screen.getByRole('switch', { name: '设置云同步' });
    expect(syncToggle.getAttribute('aria-checked')).toBe('false');
    expect((syncToggle as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '选择并导入' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: '选择目录' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: '立即备份' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('selects a backup directory and performs an online database backup', async () => {
    await openDataSettings();
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }));

    await waitFor(() => expect(runtime.pickFolder).toHaveBeenCalledWith({ title: '选择备份目录' }));
    expect(screen.getByTitle('D:\\backups').textContent).toBe('D:\\backups');
    const backupButton = screen.getByRole('button', { name: '立即备份' });
    expect((backupButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(backupButton);
    await waitFor(() =>
      expect(runtime.backupData).toHaveBeenCalledWith({ targetDirectory: 'D:\\backups' }),
    );
    expect((await screen.findByRole('status')).textContent).toContain('备份完成');
  });

  it('locks the NewMax card and compact-control geometry in CSS', () => {
    expect(shellCss).toMatch(
      /\.settings-data-card\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*18px;/s,
    );
    expect(shellCss).toMatch(/\.settings-data-card__body\s*\{[^}]*margin-top:\s*8px;/s);
    expect(shellCss).toMatch(/\.settings-data-stack\s*\{[^}]*gap:\s*12px;/s);
    expect(shellCss).toMatch(
      /\.settings-data-button,\s*\.settings-data-select\s*\{[^}]*height:\s*28px;/s,
    );
    expect(shellCss).toMatch(/\.settings-data-storage-stats\s*\{[^}]*repeat\(4,/s);
    expect(shellCss).not.toContain('.settings-data-card--sync');
  });

  it('exports complete user data and announces the saved counts', async () => {
    const exportButton = await openDataSettings();
    fireEvent.click(exportButton);

    expect((await screen.findByRole('status')).textContent).toContain(
      '已导出 2 个工作区、12 个对话、48 条消息',
    );
    expect(runtime.exportData).toHaveBeenCalledWith({});
    expect(screen.getByRole('status').textContent).toContain('sync-think-export.json');
  });

  it('imports a selected JSON export with skip-on-conflict semantics', async () => {
    await openDataSettings();
    fireEvent.click(screen.getByRole('button', { name: '选择并导入' }));

    await waitFor(() =>
      expect(runtime.importData).toHaveBeenCalledWith({ conflictStrategy: 'skip' }),
    );
    expect((await screen.findByRole('status')).textContent).toContain(
      '已导入 1 个工作区、3 个对话、8 条消息',
    );
  });

  it('opens the data directory and runs both non-destructive storage maintenance actions', async () => {
    await openDataSettings();
    fireEvent.click(screen.getByRole('button', { name: '打开目录' }));
    await waitFor(() => expect(runtime.openDataDirectory).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '优化存储' }));
    await waitFor(() => expect(runtime.compactDataStorage).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '清理空附件目录' }));
    await waitFor(() => expect(runtime.cleanEmptyAttachmentDirectories).toHaveBeenCalled());
  });

  it('announces export failures and restores the action', async () => {
    runtime.exportData.mockRejectedValue(new Error('disk full'));
    const exportButton = await openDataSettings();
    fireEvent.click(exportButton);

    expect((await screen.findByRole('alert')).textContent).toContain('disk full');
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('SettingsPage NewMax connection catalog', () => {
  it('matches the NewMax tabs, provider switcher and three-column catalog', async () => {
    render(<SettingsPage />);
    const navigation = screen.getByRole('navigation', { name: '设置分类' });
    expect(
      Array.from(navigation.querySelectorAll('button span'), (node) => node.textContent),
    ).toEqual(['账号', '钱包', '通用', '偏好', '模型', '每日回顾', '连接', '数据', '关于']);
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    expect(await screen.findByRole('tab', { name: '连接器' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'MCP' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '插件' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '搜索服务' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '机器人对话' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '开放网关' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '网络' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'NewMax Provider' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '第三方 Provider' })).toBeTruthy();
    expect(screen.getByText('NewMax 提供的托管连接器，云端执行、按量计费。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '连接 抖音' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '连接 TikTok' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '连接 企查查' })).toBeTruthy();
    expect(document.querySelectorAll('.settings-connector-row')).toHaveLength(27);
  });

  it('opens a real remote MCP connection form from a managed connector', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    fireEvent.click(await screen.findByRole('button', { name: '连接 抖音' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'MCP 服务地址' }), {
      target: { value: 'https://connector.example.com/mcp' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));

    await waitFor(() =>
      expect(runtime.registerRemoteMcpServer).toHaveBeenCalledWith({
        name: '抖音',
        endpoint: 'https://connector.example.com/mcp',
        key: 'secret-key',
        authScheme: 'bearer',
        discoverTools: true,
        trusted: false,
        notes: 'NewMax connector: douyin',
      }),
    );
  });
});

async function openGateway() {
  render(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '连接' }));
  fireEvent.click(await screen.findByRole('tab', { name: '开放网关' }));
  const toggle = await screen.findByRole('switch', { name: '启用网关' });
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
  return toggle;
}

describe('SettingsPage open gateway', () => {
  it('defaults to disabled with an auto-assigned port and reads the persisted setting', async () => {
    const toggle = await openGateway();

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/能力尚未接入/)).toBeNull();
    expect(runtime.getSettings).toHaveBeenCalledWith({ keys: [OPEN_GATEWAY_SETTING_KEY] });
    // Empty port input = OS auto-assign (port 0).
    expect((screen.getByTestId('settings-gateway-port') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('settings-gateway-status').textContent).toContain('已停用');
  });

  it('enables the gateway and re-polls status for the bound port', async () => {
    const toggle = await openGateway();
    runtime.getGatewayStatus.mockResolvedValue({
      enabled: true,
      running: true,
      port: 55349,
      host: '127.0.0.1',
      anthropicBaseUrl: 'http://127.0.0.1:55349/anthropic',
      openaiBaseUrl: 'http://127.0.0.1:55349/openai/v1',
      modelsBaseUrl: 'http://127.0.0.1:55349/v1/models',
      lastUpstream: {
        providerId: 'prov-a',
        providerName: 'Relay A',
        protocol: 'openai-chat',
        model: 'gpt-5.6-sol',
      },
    });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: OPEN_GATEWAY_SETTING_KEY,
        value: { enabled: true, port: 0 },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('settings-gateway-status').textContent).toContain(
        '监听 127.0.0.1:55349',
      ),
    );
    expect(screen.getByTestId('settings-gateway-running-port').textContent).toContain('55349');
    // Interface table rows (figure 三): OpenAI / Anthropic / model list.
    expect(screen.getByTestId('settings-gateway-route-openai').textContent).toContain(
      'POST /v1/chat/completions',
    );
    expect(screen.getByTestId('settings-gateway-route-anthropic').textContent).toContain(
      'POST /v1/messages',
    );
    expect(screen.getByTestId('settings-gateway-route-models').textContent).toContain(
      'GET /v1/models',
    );
    // Base URLs are only offered once a listener is actually bound. The long-lived
    // external token is no longer rendered — in-app runs use per-run tickets.
    expect(screen.getByText('http://127.0.0.1:55349/anthropic')).toBeTruthy();
    expect(screen.getByText('http://127.0.0.1:55349/openai/v1')).toBeTruthy();
    expect(screen.queryByText(/stgx_/)).toBeNull();
    expect(screen.queryByRole('button', { name: '显示' })).toBeNull();
    // Read-only upstream line mirrors the provider the run actually routed.
    expect(screen.getByTestId('settings-gateway-upstream').textContent).toContain('Relay A');
    expect(screen.getByTestId('settings-gateway-upstream').textContent).toContain('OpenAI 格式');
  });

  it('persists a valid port on Enter and rejects an out-of-range one', async () => {
    await openGateway();
    const port = screen.getByTestId('settings-gateway-port');

    fireEvent.change(port, { target: { value: '9001' } });
    fireEvent.keyDown(port, { key: 'Enter' });
    await waitFor(() =>
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: OPEN_GATEWAY_SETTING_KEY,
        value: { enabled: false, port: 9001 },
      }),
    );

    runtime.setSetting.mockClear();
    fireEvent.change(port, { target: { value: '80' } });
    fireEvent.blur(port);
    expect((await screen.findByRole('alert')).textContent).toContain('1024-65535');
    expect(runtime.setSetting).not.toHaveBeenCalled();
    // The rejected value snaps back rather than lying about what is persisted.
    expect((port as HTMLInputElement).value).toBe('9001');
  });

  it('clears a persisted port back to auto-assign (port 0) on empty input', async () => {
    runtime.getSettings.mockResolvedValue({
      settings: { [OPEN_GATEWAY_SETTING_KEY]: { enabled: true, port: 8788 } },
    });
    await openGateway();
    const port = screen.getByTestId('settings-gateway-port') as HTMLInputElement;
    expect(port.value).toBe('8788');

    fireEvent.change(port, { target: { value: '' } });
    fireEvent.blur(port);
    await waitFor(() =>
      expect(runtime.setSetting).toHaveBeenCalledWith({
        key: OPEN_GATEWAY_SETTING_KEY,
        value: { enabled: true, port: 0 },
      }),
    );
  });

  it('never renders an external default-provider select (ticket-based routing)', async () => {
    runtime.listProviders.mockResolvedValue({
      providers: [{ providerId: 'prov-a', name: 'Relay A', enabled: true }],
    });
    await openGateway();

    expect(screen.queryByTestId('settings-gateway-default-provider')).toBeNull();
    // The connection card must not need the provider catalog at all.
    expect(runtime.listProviders).not.toHaveBeenCalled();
  });

  it('surfaces a port conflict reported by the runtime', async () => {
    runtime.getSettings.mockResolvedValue({
      settings: { [OPEN_GATEWAY_SETTING_KEY]: { enabled: true, port: 8788 } },
    });
    runtime.getGatewayStatus.mockResolvedValue({
      enabled: true,
      running: false,
      port: 8788,
      host: '127.0.0.1',
      failure: 'port-in-use',
      failureDetail: '端口 8788 已被占用，请在设置中改用其他端口。',
    });
    await openGateway();

    await waitFor(() =>
      expect(screen.getByTestId('settings-gateway-status').textContent).toContain('已被占用'),
    );
    // No base URL is advertised when nothing is listening.
    expect(screen.queryByText(/127\.0\.0\.1:8788\/anthropic/)).toBeNull();
  });

  it('rolls the toggle back when persistence fails', async () => {
    runtime.setSetting.mockRejectedValue(new Error('gateway save failed'));
    const toggle = await openGateway();
    fireEvent.click(toggle);

    expect((await screen.findByRole('alert')).textContent).toContain('gateway save failed');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
});
