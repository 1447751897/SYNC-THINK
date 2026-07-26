export type ConfirmDiscard = (message: string) => boolean;

export const SETTINGS_SECTION_DISCARD_MESSAGE =
  '当前有未提交的模型配置草稿，确认放弃并继续吗？';
export const SETTINGS_CLOSE_DISCARD_MESSAGE =
  '当前有未提交的模型配置草稿，确认放弃并关闭设置吗？';

export type SettingsPageAction =
  | { kind: 'done' }
  | { kind: 'select-section'; currentSection: string; nextSection: string };

export type SettingsPageDecision =
  | { kind: 'request-close' }
  | { kind: 'stay' }
  | { kind: 'select-section'; section: string; discardChanges: boolean };

/**
 * Resolves page-level actions. The page guards category switches, while a
 * completion action is deliberately delegated to the modal so closing has one
 * confirmation owner.
 */
export function decideSettingsPageAction(
  action: SettingsPageAction,
  dirty: boolean,
  confirmDiscard: ConfirmDiscard,
): SettingsPageDecision {
  if (action.kind === 'done') return { kind: 'request-close' };
  if (action.currentSection === action.nextSection) return { kind: 'stay' };
  if (dirty && !confirmDiscard(SETTINGS_SECTION_DISCARD_MESSAGE)) {
    return { kind: 'stay' };
  }
  return {
    kind: 'select-section',
    section: action.nextSection,
    discardChanges: dirty,
  };
}

/** The single confirmation gate shared by every settings-modal close path. */
export function canCloseSettings(
  dirty: boolean,
  confirmDiscard: ConfirmDiscard,
): boolean {
  return !dirty || confirmDiscard(SETTINGS_CLOSE_DISCARD_MESSAGE);
}
