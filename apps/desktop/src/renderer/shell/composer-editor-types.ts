import type { SkillVersionSummary } from '@sync-think/protocol';

export type ComposerEditorSkill = Pick<
  SkillVersionSummary,
  'skillVersionId' | 'name' | 'version' | 'description'
>;

/** View data for an existing pasted-text attachment/reference. */
export interface ComposerEditorPastedReference {
  id: string;
  label: string;
  preview?: string;
}
