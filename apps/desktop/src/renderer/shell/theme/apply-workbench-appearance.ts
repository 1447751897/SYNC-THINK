/** Desktop-only agent visual family. Public demo CSS stays opt-in. */
const COLOR_ROLES: Record<string, string> = {
  page: 'page', 'page-gutter': 'page', surface: 'page', overlay: 'page',
  sidebar: 'panel', panel: 'panel', chat: 'panel', recent: 'panel', elevated: 'panel',
  'stage-tabs': 'page', workbench: 'panel', 'workbench-content': 'panel', 'tab-strip': 'panel',
  'tab-active-fill': 'page', 'tab-active-border': 'border',
  text: 'text', 'text-secondary': 'secondary', 'text-faint': 'muted', 'text-inverse': 'on-primary',
  border: 'border', 'border-strong': 'border', hover: 'hover', active: 'bubble',
  control: 'page', 'control-hover': 'hover', accent: 'primary', 'accent-text': 'link',
  'accent-fg': 'on-primary', 'settings-action': 'primary', 'settings-action-fg': 'on-primary',
  'selection-border': 'primary', 'focus-ring': 'focus',
};

/** Clear only our mappings before applying another palette. */
export function clearWorkbenchAppearance(root: HTMLElement): void {
  for (const name of [...Object.keys(COLOR_ROLES), 'accent-soft', 'selection']) {
    const property = '--color-' + name;
    if (root.style.getPropertyValue(property).includes('--wb-default-')) root.style.removeProperty(property);
  }
}

export function applyWorkbenchAppearance(root: HTMLElement, preferences: { colorTheme: string; imageThemeId?: string | null }): void {
  root.dataset.shellDesign = 'agent';
  // Custom/named/image palettes keep their authoritative user-selected values.
  if (preferences.colorTheme !== 'default' || preferences.imageThemeId) return;
  for (const [name, role] of Object.entries(COLOR_ROLES)) {
    root.style.setProperty('--color-' + name, 'var(--wb-default-' + role + ')');
  }
  root.style.setProperty('--color-accent-soft', 'color-mix(in srgb, var(--wb-default-primary) 10%, transparent)');
  root.style.setProperty('--color-selection', 'color-mix(in srgb, var(--wb-default-primary) 12%, var(--wb-default-page))');
}
