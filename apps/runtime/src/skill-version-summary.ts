import { parseSkillMd } from '@sync-think/core';
import type { SkillVersionSummary } from '@sync-think/protocol';
import type { SkillVersionMetadataRecord, SkillVersionRecord } from '@sync-think/storage';

export type SkillSourceMdResolver = (
  skillVersionId: SkillVersionRecord['id'],
) => string | undefined;

export function toSkillVersionSummary(
  record: SkillVersionRecord | SkillVersionMetadataRecord,
  resolveSourceMd?: SkillSourceMdResolver,
): SkillVersionSummary {
  let description = record.description;
  if (/^[>|](?:[+-])?$/.test(description.trim())) {
    const sourceMd = 'sourceMd' in record ? record.sourceMd : resolveSourceMd?.(record.id);
    if (sourceMd) {
      try {
        description = parseSkillMd(sourceMd).description;
      } catch {
        // Preserve the stored description when a legacy source cannot be parsed.
      }
    }
  }
  return {
    skillVersionId: record.id,
    skillId: record.skillId,
    name: record.name,
    description,
    version: record.version,
    allowedTools: [...record.allowedTools],
    contentFingerprint: record.contentFingerprint,
    hasScripts: record.hasScripts,
    warnings: [...record.warnings],
    enabled: record.enabled,
    originType: record.originType,
    originRef: record.originRef,
    derivedFromSkillVersionId: record.derivedFromSkillVersionId,
    createdAt: record.createdAt,
  };
}
