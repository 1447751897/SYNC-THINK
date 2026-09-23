import { describe, expect, it, vi } from 'vitest';
import type { SkillId, SkillVersionId } from '@sync-think/shared';
import type { SkillVersionMetadataRecord, SkillVersionRecord } from '@sync-think/storage';
import { toSkillVersionSummary } from './skill-version-summary.js';

const record: SkillVersionRecord = {
  id: 'skill-version-fixture' as SkillVersionId,
  skillId: 'skill-fixture' as SkillId,
  name: 'Review',
  description: 'Review changes',
  version: '1.0.0',
  sourceMd: '---\nname: Review\ndescription: Review changes\nversion: 1.0.0\n---\nBody',
  body: 'Body',
  allowedTools: ['read-file'],
  contentFingerprint: 'fingerprint',
  hasScripts: false,
  warnings: ['fixture warning'],
  enabled: true,
  originType: 'local',
  createdAt: '2026-09-20T00:00:00.000Z',
};

describe('skill version summary', () => {
  it('projects public fields without sharing mutable arrays', () => {
    const summary = toSkillVersionSummary(record);

    summary.allowedTools.push('write-file');
    summary.warnings.length = 0;
    expect(record.allowedTools).toEqual(['read-file']);
    expect(record.warnings).toEqual(['fixture warning']);
    expect(summary).toMatchObject({
      skillVersionId: record.id,
      skillId: record.skillId,
      description: 'Review changes',
      enabled: true,
    });
  });

  it('repairs a legacy block-scalar marker from metadata through a narrow source resolver', () => {
    const metadata: SkillVersionMetadataRecord = { ...record, description: '>' };
    delete (metadata as Partial<SkillVersionRecord>).sourceMd;
    delete (metadata as Partial<SkillVersionRecord>).body;
    const resolveSourceMd = vi.fn(
      () => `---
name: Review
description: >
  Review changes
  before release.
version: 1.0.0
---
Body`,
    );

    expect(toSkillVersionSummary(metadata, resolveSourceMd).description).toBe(
      'Review changes before release.',
    );
    expect(resolveSourceMd).toHaveBeenCalledOnce();
    expect(resolveSourceMd).toHaveBeenCalledWith(record.id);
  });

  it('keeps the stored value when a legacy source is unavailable or invalid', () => {
    const metadata: SkillVersionMetadataRecord = {
      id: record.id,
      skillId: record.skillId,
      name: record.name,
      description: '|-',
      version: record.version,
      allowedTools: [],
      contentFingerprint: record.contentFingerprint,
      hasScripts: false,
      warnings: [],
      enabled: true,
      originType: 'local',
      createdAt: record.createdAt,
    };

    expect(toSkillVersionSummary(metadata).description).toBe('|-');
    expect(toSkillVersionSummary(metadata, () => 'invalid').description).toBe('|-');
  });
});
