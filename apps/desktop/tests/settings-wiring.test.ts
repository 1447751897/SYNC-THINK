import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/settings-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Settings IPC wiring', () => {
  it('registers reads and writes through the typed Settings boundary', () => {
    expect(handlerSource).toContain("host.handle('runtime:settings-get'");
    expect(handlerSource).toContain("host.handle('runtime:settings-set'");
    expect(handlerSource).toContain("host.requestSettings('settings.get'");
    expect(handlerSource).toContain("host.requestSettings('settings.set'");
    expect(mainSource).toContain('registerSettingsHandlers({');
    expect(mainSource).toContain('requestSettings:');
    expect(mainSource).not.toContain("request('settings.get'");
    expect(mainSource).not.toContain("request('settings.set'");
  });

  it('keeps the existing Renderer bridge payload and response contracts', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:settings-get', payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:settings-set', payload)");
    expect(globalSource).toContain('getSettings(payload?: GetSettingsPayload)');
    expect(globalSource).toContain('setSetting(payload: SetSettingPayload)');
    expect(globalSource).toContain('Promise<GetSettingsResponse>');
    expect(globalSource).toContain('Promise<SetSettingResponse>');
  });
});
