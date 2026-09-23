import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPABILITY_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/capability-governance-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Capability Governance IPC wiring', () => {
  it('registers governance commands through the typed boundary', () => {
    for (const command of [
      'capability.workspace.list',
      'capability.workspace.setActive',
      'capability.governance.list',
      'capability.publishDraft.save',
      'capability.publishDraft.list',
      'capability.publishDraft.get',
      'capability.publishDraft.submit',
      'capability.organize.preview',
      'capability.organize.getLatest',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('CAPABILITY_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(CAPABILITY_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`CAPABILITY_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerCapabilityGovernanceHandlers({');
    expect(mainSource).toContain('requestCapabilityGovernance:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    expect(globalSource).toContain('listCapabilityWorkspaceActivations(');
    expect(globalSource).toContain('setCapabilityWorkspaceActive(');
    expect(globalSource).toContain('listCapabilityGovernance(');
    expect(globalSource).toContain('saveSkillPublishDraft(');
    expect(globalSource).toContain('listSkillPublishDrafts(');
    expect(globalSource).toContain('getSkillPublishDraft(');
    expect(globalSource).toContain('submitSkillPublishDraft(');
    expect(globalSource).toContain('previewCapabilityOrganize(');
    expect(globalSource).toContain('getLatestCapabilityOrganize(');
  });
});
