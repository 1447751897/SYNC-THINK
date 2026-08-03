/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COMPUTER_USE_PLUGIN_SETTING_KEY } from '@sync-think/protocol/plugins';
import { SettingsPage } from './SettingsPage.js';

vi.mock('./ModelSettings.js', () => ({
  ModelSettings: () => null,
}));

const runtime = {
  getSettings: vi.fn(),
  setSetting: vi.fn(),
  setTheme: vi.fn(),
  exportDiagnostics: vi.fn(),
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
