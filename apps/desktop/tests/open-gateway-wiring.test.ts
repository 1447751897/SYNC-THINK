import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(
  new URL('../src/renderer/shell/SettingsPage.tsx', import.meta.url),
  'utf8',
);
const shellCss = readFileSync(new URL('../src/renderer/shell/shell.css', import.meta.url), 'utf8');

describe('open gateway status IPC wiring', () => {
  it('reads status through trusted Main IPC with no renderer-supplied payload', () => {
    const handlerStart = mainSource.indexOf("ipcMain.handle('runtime:gateway-status'");
    expect(handlerStart).toBeGreaterThan(-1);
    const nextHandler = mainSource.indexOf('ipcMain.handle(', handlerStart + 1);
    const handlerSource = mainSource.slice(
      handlerStart,
      nextHandler === -1 ? mainSource.length : nextHandler,
    );

    expect(handlerSource).toContain('assertRuntimeIpcSource(event)');
    expect(handlerSource).toContain('ensureRuntimeConnection()');
    expect(handlerSource).toContain("request<OpenGatewayStatusResponse>('gateway.status', {})");
    // Status is read-only: the renderer must not be able to steer the command.
    expect(handlerSource).not.toContain('value');
  });

  it('exposes a read-only bridge method and declares its type', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:gateway-status')");
    expect(preloadSource).toMatch(/getGatewayStatus:\s*\(\)\s*=>/);
    expect(globalSource).toMatch(/getGatewayStatus\?\(\):\s*Promise</);
    expect(globalSource).toContain('OpenGatewayStatusResponse');
  });
});

describe('open gateway settings section', () => {
  it('registers the connection section that the search box can find', () => {
    expect(settingsSource).toMatch(/id:\s*'connection',\s*\n\s*label:\s*'连接'/);
    expect(settingsSource).toContain("keywords: 'AI 模型网关 协议转换");
    expect(settingsSource).toContain("{section === 'connection' && <ConnectionSection />}");
    // The gateway no longer has its own sidebar section.
    expect(settingsSource).not.toContain("{ section === 'gateway'");
    // The `general` fallback is index-based; inserting ahead of it would break it.
    const sections = settingsSource.slice(
      settingsSource.indexOf('const SECTIONS'),
      settingsSource.indexOf('export interface SettingsPageProps'),
    );
    expect(sections.indexOf("id: 'general'")).toBeLessThan(sections.indexOf("id: 'connection'"));
    expect(settingsSource).toContain('SECTIONS.find((item) => item.id === section) ?? SECTIONS[3]');
  });

  it('persists through the shared settings bridge and re-polls status afterwards', () => {
    const section = settingsSource.slice(
      settingsSource.indexOf('function ConnectionSection'),
      settingsSource.indexOf('type DiagnosticsExportState'),
    );
    expect(section).toContain('OPEN_GATEWAY_SETTING_KEY');
    expect(section).toContain('normalizeOpenGatewaySetting');
    expect(section).toContain('runtime.setSetting({ key: OPEN_GATEWAY_SETTING_KEY, value: next })');
    // The runtime rebinds after answering settings.set, so status must be re-read.
    expect(section).toMatch(/await runtime\.setSetting\([\s\S]{0,120}await refreshStatus\(\)/);
    expect(section).toContain("setPortDraft(previous.port === 0 ? '' : String(previous.port))");
  });

  it('renders a read-only upstream line and never exposes per-run tickets or keys', () => {
    const section = settingsSource.slice(
      settingsSource.indexOf('function ConnectionSection'),
      settingsSource.indexOf('type DiagnosticsExportState'),
    );
    expect(section).not.toContain('externalToken');
    expect(section).not.toContain('ticket');
    // The card is a pure converter: it reflects the routed upstream only.
    expect(section).toContain('settings-gateway-upstream');
    expect(section).toContain('lastUpstream');
    expect(settingsSource).toContain('masked && !revealed');
  });

  it('styles the card with theme tokens only', () => {
    expect(shellCss).toContain('.settings-gateway-value');
    expect(shellCss).toContain('.settings-gateway-button');
    expect(shellCss).toContain('.settings-gateway-card');
    const block = shellCss.slice(
      shellCss.indexOf('.settings-gateway-actions'),
      shellCss.indexOf('.settings-toggle {'),
    );
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).toContain('var(--color-error)');
  });
});
