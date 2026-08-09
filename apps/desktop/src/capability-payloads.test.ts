import { describe, expect, it } from 'vitest';
import {
  parseCapabilityGovernanceListPayload,
  parseCapabilityWorkspaceListPayload,
  parseCapabilityWorkspaceSetActivePayload,
  parseGetLatestCapabilityOrganizePayload,
  parseGetSkillPublishDraftPayload,
  parseListSkillPublishDraftsPayload,
  parsePreviewCapabilityOrganizePayload,
  parseSaveSkillPublishDraftPayload,
  parseSubmitSkillPublishDraftPayload,
} from './capability-payloads.js';

describe('capability payload parsing', () => {
  it('normalizes workspace governance payloads', () => {
    expect(
      parseCapabilityWorkspaceListPayload({
        workspaceId: ' workspace-1 ',
        capabilityType: 'skill',
      }),
    ).toEqual({ workspaceId: 'workspace-1', capabilityType: 'skill' });
    expect(
      parseCapabilityWorkspaceSetActivePayload({
        workspaceId: ' workspace-1 ',
        capabilityType: 'mcp',
        capabilityId: ' mcp-1 ',
        active: true,
      }),
    ).toEqual({
      workspaceId: 'workspace-1',
      capabilityType: 'mcp',
      capabilityId: 'mcp-1',
      active: true,
    });
    expect(
      parseCapabilityGovernanceListPayload({
        workspaceId: ' workspace-1 ',
        now: '2026-08-09T00:00:00.000Z',
      }),
    ).toEqual({
      workspaceId: 'workspace-1',
      now: '2026-08-09T00:00:00.000Z',
    });
  });

  it('rejects unknown fields and invalid capability values', () => {
    expect(() =>
      parseCapabilityWorkspaceListPayload({ workspaceId: 'ws', capabilityType: 'tool' }),
    ).toThrow();
    expect(() =>
      parseCapabilityWorkspaceSetActivePayload({
        workspaceId: 'ws',
        capabilityType: 'skill',
        capabilityId: 'sv-1',
        active: true,
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      parseCapabilityGovernanceListPayload({ workspaceId: '', now: 'not-a-date' }),
    ).toThrow();
  });

  it('parses local publish drafts and bounded attachments', () => {
    expect(
      parseSaveSkillPublishDraftPayload({
        skillVersionId: ' sv-1 ',
        skillId: ' skill-1 ',
        displayName: ' Review ',
        description: 'Review changes.',
        skillMd: '---\nname: review\n---\nReview changes.',
        category: '开发工具',
        version: '1.0.0',
        icon: 'sparkles',
        attachments: [{ name: ' references/checklist.md ', size: 123 }],
      }),
    ).toMatchObject({
      skillVersionId: 'sv-1',
      skillId: 'skill-1',
      displayName: 'Review',
      attachments: [{ name: 'references/checklist.md', size: 123 }],
    });

    expect(parseListSkillPublishDraftsPayload(undefined)).toEqual({});
    expect(parseGetSkillPublishDraftPayload({ id: ' draft-1 ' })).toEqual({ id: 'draft-1' });
    expect(parseSubmitSkillPublishDraftPayload({ id: ' draft-1 ' })).toEqual({ id: 'draft-1' });
  });

  it('parses read-only organize report requests', () => {
    expect(
      parsePreviewCapabilityOrganizePayload({
        workspaceId: ' ws-1 ',
        contextBudgetTokens: 15_000,
      }),
    ).toEqual({ workspaceId: 'ws-1', contextBudgetTokens: 15_000 });
    expect(parseGetLatestCapabilityOrganizePayload({ workspaceId: ' ws-1 ' })).toEqual({
      workspaceId: 'ws-1',
    });
  });
});
