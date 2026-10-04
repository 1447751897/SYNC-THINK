// Component CSS emitted by esbuild is replaced by the canonical Tailwind
// stylesheet. Validate the file linked by index.html, not esbuild's CSS output.
export function assertShellStylesheet(css) {
  for (const selector of [
    '.shell-browser-profile__trigger',
    '.shell-browser-profile__card',
    '.browser-data__dialog',
    '.browser-data__settings',
    '.shell-browser__submenu',
    '.shell-browser__switch-row',
    '.task-run-target__menu',
    '.sidebar-chat-actions',
    '.shell-sidebar-actions .sidebar-chat-action',
    '.sidebar-chat-action--search',
    '.sidebar-chat-action--new',
    '.sidebar-chat-search',
    // New file-row markup needs its own layout rules, not the legacy card CSS.
    '.shell-changes-card__summary',
    '.shell-changes-card__count',
    '.shell-changes-card__identity',
    '.shell-changes-card__file-type',
    '.shell-changes-card__name-stem',
    '.shell-changes-card__name-extension',
    '.shell-changes-card__file-meta',
    '.shell-changes-card__open-file',
    '.shell-changes-card__review',    '.conversation-attention-trigger',
    '.conversation-attention-dialog',
    '.shell-activity-dot--attention',
  ]) {
    if (!css.includes(selector)) {
      throw new Error(`shell.build.missing_stylesheet_selector:${selector}`);
    }
  }
}
