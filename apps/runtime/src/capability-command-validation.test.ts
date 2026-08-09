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
} from './command-validation.js';

describe('capability command payload validation', () => {
  it('parses workspace activation and governance payloads strictly', () => {
    expect(
      parseCapabilityWorkspaceListPayload({
        workspaceId: ' workspace-alpha ',
        capabilityType: 'skill',
      }),
    ).toEqual({ workspaceId: 'workspace-alpha', capabilityType: 'skill' });
    expect(
      parseCapabilityWorkspaceSetActivePayload({
        workspaceId: 'workspace-alpha',
        capabilityType: 'mcp',
        capabilityId: 'mcp-alpha',
        active: true,
      }),
    ).toEqual({
      workspaceId: 'workspace-alpha',
      capabilityType: 'mcp',
      capabilityId: 'mcp-alpha',
      active: true,
    });
    expect(
      parseCapabilityGovernanceListPayload({
        workspaceId: 'workspace-alpha',
        now: '2026-08-09T00:00:00.000Z',
      }),
    ).toEqual({
      workspaceId: 'workspace-alpha',
      now: '2026-08-09T00:00:00.000Z',
    });

    expect(
      parseCapabilityWorkspaceListPayload({
        workspaceId: 'workspace-alpha',
        capabilityType: 'plugin',
      }),
    ).toBeUndefined();
    expect(
      parseCapabilityWorkspaceSetActivePayload({
        workspaceId: 'workspace-alpha',
        capabilityType: 'skill',
        capabilityId: 'skill-alpha',
        active: true,
        extra: true,
      }),
    ).toBeUndefined();
    expect(
      parseCapabilityGovernanceListPayload({
        workspaceId: 'workspace-alpha',
        now: 'not-a-date',
      }),
    ).toBeUndefined();
  });

  it('parses local Skill publish draft payloads without accepting hidden fields', () => {
    const payload = {
      skillVersionId: 'skill-version-alpha',
      skillId: 'skill-alpha',
      displayName: '测试 Skill',
      description: '用于测试发布草稿',
      skillMd: '# 测试 Skill',
      category: '开发工具',
      version: '1.0.0',
      icon: 'sparkles',
      attachments: [{ name: 'README.md', size: 128 }],
    };
    expect(parseSaveSkillPublishDraftPayload(payload)).toEqual(payload);
    expect(parseListSkillPublishDraftsPayload({ skillId: ' skill-alpha ', limit: 20 })).toEqual({
      skillId: 'skill-alpha',
      limit: 20,
    });
    expect(parseGetSkillPublishDraftPayload({ id: ' draft-alpha ' })).toEqual({
      id: 'draft-alpha',
    });
    expect(parseSubmitSkillPublishDraftPayload({ id: 'draft-alpha' })).toEqual({
      id: 'draft-alpha',
    });

    expect(parseSaveSkillPublishDraftPayload({ ...payload, extra: true })).toBeUndefined();
    expect(
      parseSaveSkillPublishDraftPayload({
        ...payload,
        attachments: [{ name: 'README.md', size: -1 }],
      }),
    ).toBeUndefined();
    expect(parseListSkillPublishDraftsPayload({ limit: 501 })).toBeUndefined();
    expect(parseGetSkillPublishDraftPayload({ id: '' })).toBeUndefined();
  });

  it('parses read-only organize report payloads', () => {
    expect(
      parsePreviewCapabilityOrganizePayload({
        workspaceId: ' workspace-alpha ',
        contextBudgetTokens: 128_000,
        now: '2026-08-09T00:00:00.000Z',
      }),
    ).toEqual({
      workspaceId: 'workspace-alpha',
      contextBudgetTokens: 128_000,
      now: '2026-08-09T00:00:00.000Z',
    });
    expect(
      parseGetLatestCapabilityOrganizePayload({ workspaceId: ' workspace-alpha ' }),
    ).toEqual({ workspaceId: 'workspace-alpha' });

    expect(
      parsePreviewCapabilityOrganizePayload({
        workspaceId: 'workspace-alpha',
        contextBudgetTokens: 0,
      }),
    ).toBeUndefined();
    expect(
      parseGetLatestCapabilityOrganizePayload({
        workspaceId: 'workspace-alpha',
        extra: true,
      }),
    ).toBeUndefined();
  });
});
