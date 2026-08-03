export const COMPUTER_USE_PLUGIN_ID = 'computer-use' as const;
export const COMPUTER_USE_PLUGIN_SETTING_KEY = 'plugin.computer-use' as const;

export interface ComputerUsePluginSetting {
  enabled: boolean;
}

export interface BuiltInPluginDefinition {
  id: typeof COMPUTER_USE_PLUGIN_ID;
  name: string;
  description: string;
  bundled: true;
  defaultEnabled: false;
  settingKey: typeof COMPUTER_USE_PLUGIN_SETTING_KEY;
}

export const BUILT_IN_PLUGINS: readonly BuiltInPluginDefinition[] = [
  {
    id: COMPUTER_USE_PLUGIN_ID,
    name: 'Computer Use',
    description: 'Use Windows UI Automation to inspect and operate desktop applications.',
    bundled: true,
    defaultEnabled: false,
    settingKey: COMPUTER_USE_PLUGIN_SETTING_KEY,
  },
];

export function normalizeComputerUsePluginSetting(value: unknown): ComputerUsePluginSetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { enabled: false };
  return { enabled: (value as { enabled?: unknown }).enabled === true };
}

export function isComputerUsePluginEnabled(value: unknown): boolean {
  return normalizeComputerUsePluginSetting(value).enabled;
}
