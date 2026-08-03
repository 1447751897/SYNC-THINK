import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PLUGINS,
  COMPUTER_USE_PLUGIN_ID,
  COMPUTER_USE_PLUGIN_SETTING_KEY,
  isComputerUsePluginEnabled,
  normalizeComputerUsePluginSetting,
} from './plugins.js';

describe('built-in plugin registry', () => {
  it('ships Computer Use as bundled but disabled by default', () => {
    expect(BUILT_IN_PLUGINS).toEqual([
      expect.objectContaining({
        id: COMPUTER_USE_PLUGIN_ID,
        bundled: true,
        defaultEnabled: false,
        settingKey: COMPUTER_USE_PLUGIN_SETTING_KEY,
      }),
    ]);
  });

  it('only enables Computer Use for an explicit boolean true setting', () => {
    expect(normalizeComputerUsePluginSetting(undefined)).toEqual({ enabled: false });
    expect(normalizeComputerUsePluginSetting({ enabled: false })).toEqual({ enabled: false });
    expect(normalizeComputerUsePluginSetting({ enabled: 'true' })).toEqual({ enabled: false });
    expect(isComputerUsePluginEnabled({ enabled: true })).toBe(true);
  });
});
