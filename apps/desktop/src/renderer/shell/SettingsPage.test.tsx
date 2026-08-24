/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COMPUTER_USE_PLUGIN_SETTING_KEY } from '@sync-think/protocol/plugins';
import { OPEN_GATEWAY_SETTING_KEY } from '@sync-think/protocol/gateway';
import { SettingsPage } from './SettingsPage.js';

vi.mock('./ModelSettings.js', () => ({
  ModelSettings: () => null,
}));

const runtime = {
  getSettings: vi.fn(),
  setSetting: vi.fn(),
  setTheme: vi.fn(),
  exportDiagnostics: vi.fn(),
  getGatewayStatus: vi.fn(),
  listProviders: vi.fn(),
};

beforeEach(() => {
  runtime.exportDiagnostics.mockResolvedValue({
    status: 'saved',
    path: 'C:\\support\\sync-think-diagnostics.json',
    diagnosticCount: 12,
    crashReportCount: 2,
    generatedAt: '2026-08-02T00:00:00.000Z',
  });
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

async function openDataDiagnostics() {
  render(<SettingsPage />);
  const dataButton = screen.getByRole('button', { name: '数据' });
  dataButton.focus();
  fireEvent.click(dataButton);
  const exportButton = await screen.findByRole('button', { name: '导出诊断 JSON' });
  exportButton.focus();
  return exportButton;
}

describe('SettingsPage diagnostics export', () => {
  it('exposes the data section with explicit privacy and retention boundaries', async () => {
    const exportButton = await openDataDiagnostics();

    expect(exportButton).toBe(document.activeElement);
    expect(screen.queryByText(/能力尚未接入/)).toBeNull();
    expect(screen.getByText(/API Key、原始提示词、原始消息内容/)).toBeTruthy();
    expect(screen.getByText('最多 20 条 / 14 天')).toBeTruthy();
    expect(screen.getByText(/不会自动上传/)).toBeTruthy();
    expect(exportButton.getAttribute('aria-describedby')).toContain('diagnostics-privacy');
  });

  it('exports a scrubbed diagnostics bundle and announces saved counts', async () => {
    const exportButton = await openDataDiagnostics();
    fireEvent.click(exportButton);

    expect((await screen.findByRole('status')).textContent).toContain(
      '已保存 12 条诊断与 2 条崩溃记录',
    );
    expect(runtime.exportDiagnostics).toHaveBeenCalledWith({});
    expect(screen.getByRole('status').textContent).toContain('sync-think-diagnostics.json');
  });

  it('reports cancellation without treating it as an error', async () => {
    runtime.exportDiagnostics.mockResolvedValue({
      status: 'cancelled',
      diagnosticCount: 4,
      crashReportCount: 1,
      generatedAt: '2026-08-02T00:00:00.000Z',
    });
    const exportButton = await openDataDiagnostics();
    fireEvent.click(exportButton);

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('已取消保存');
    expect(status.textContent).toContain('4 条诊断与 1 条崩溃记录');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces export failures and restores the action', async () => {
    runtime.exportDiagnostics.mockRejectedValue(new Error('disk full'));
    const exportButton = await openDataDiagnostics();
    fireEvent.click(exportButton);

    expect((await screen.findByRole('alert')).textContent).toContain('disk full');
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
  });
});

async function openGateway() {
  render(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '连接' }));
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
