import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/index.tsx', import.meta.url), 'utf8');
const protocolSource = readFileSync(
  new URL('../../../packages/protocol/src/commands.ts', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const providersPanelSource = readFileSync(
  new URL('../../../packages/ui-kit/src/components/ProvidersPanel.tsx', import.meta.url),
  'utf8',
);
const providerPayloadSource = readFileSync(
  new URL('../src/provider-payloads.ts', import.meta.url),
  'utf8',
);

describe('M2 renderer wiring', () => {
  it('clears stale Agent binding immediately and validates the selected lineage before save', () => {
    expect(source).toMatch(/setAgentBinding\(null\)[\s\S]{0,500}loadAgent\(agentId\)/);
    expect(source).toContain('canSaveAgentBindingForSelection');
    expect(source).toContain('binding.agentId === selectedAgentId');
  });

  it('loads all exact AgentVersions in parallel for graph models and delegates', () => {
    expect(source).toContain('Promise.all');
    expect(source).toMatch(/listResult\.agents\.map[\s\S]{0,500}listAgentVersions/);
    expect(source).toContain('agentVersionById');
    expect(source).toContain('delegateAgentVersions=');
  });

  it('submits the exact delegate AgentVersion selected by the approval UI', () => {
    expect(source).toMatch(/delegateAgentVersionId:\s*input\.delegateAgentVersionId/);
  });

  it('has no plaintext credential reveal route into Renderer payloads or state', () => {
    expect(protocolSource).not.toContain("'provider.revealCredential'");
    expect(protocolSource).not.toContain('RevealCredentialResponse');
    expect(mainSource).not.toContain('runtime:provider-reveal-credential');
    expect(preloadSource).not.toContain('revealCredential');
    expect(globalSource).not.toContain('RevealCredential');
    expect(source).not.toContain('revealProviderCredential');
    expect(providersPanelSource).not.toContain('onRevealCredential');
  });

  it('keeps provider credentials out of Renderer, preload, and metadata parser surfaces', () => {
    for (const boundary of [
      source,
      preloadSource,
      globalSource,
      providersPanelSource,
      providerPayloadSource,
    ]) {
      expect(boundary).not.toContain('apiKey');
    }
    expect(mainSource).toContain('clipboard.readText()');
    expect(mainSource).toContain('createProviderPayloadFromClipboard');
    expect(mainSource).toContain('updateProviderPayloadFromClipboard');
  });

  it('debounces real orchestration event refreshes without a mount-stale callback', () => {
    expect(source).toContain('isM2RefreshEvent');
    expect(source).toMatch(/setTimeout\([\s\S]{0,240}(?:75|80|90|100)/);
    expect(source).toContain('m2RefreshNonce');
    expect(source).toMatch(/clearTimeout\(/);
  });

  it('keeps trace selection independent and deep-links exact Run and Step state', () => {
    expect(source).toContain('selectedTraceId');
    expect(source).toContain('setSelectedTraceId');
    expect(source).toContain('navigateToApprovalRunStep');
    expect(source).toContain('selectedStepId={selectedGraphStepId}');
    expect(source).toMatch(/getRunGraph\([\s\S]{0,400}input\.runId/);
  });

  it('renders actionable recovery controls for both automatic-mode blockers', () => {
    expect(source).toContain('automatic-plan-cta');
    expect(source).toContain('automatic-policy-cta');
    expect(source).toContain("setRightRailTab('approvals')");
    expect(source).toContain('document.querySelector(\'[data-testid="plan-editor"]\')');
    expect(source).not.toContain('document.querySelector(\'[data-testid="plan-revision-panel"]\')');
  });

  it('wires task-scoped automatic readiness and exact reviewer catalogs', () => {
    expect(source).toContain('approvedPlan={automaticModeReadiness.approvedPlan}');
    expect(source).toContain('applicablePolicy={automaticModeReadiness.applicablePolicy}');
    expect(source).not.toContain('approvalPolicies.length');
    expect(source).toContain('allAgentVersions={allAgentVersions.map');
    expect(source).toContain('reviewerCapable:');
  });

  it('bridges append-only merge conflict listing and resolution into the Artifact rail', () => {
    expect(mainSource).toContain("'artifact.listConflicts'");
    expect(mainSource).toContain("'artifact.resolveConflict'");
    expect(preloadSource).toContain('listArtifactMergeConflicts');
    expect(preloadSource).toContain('resolveArtifactMergeConflict');
    expect(globalSource).toContain('listArtifactMergeConflicts');
    expect(globalSource).toContain('resolveArtifactMergeConflict');
    expect(source).toContain('artifactConflicts');
    expect(source).toContain('resolveArtifactMergeConflict');
  });

  it('uses a ready explicit merge Step and keeps Automatic plans read-only', () => {
    expect(source).not.toContain('sourceStepId: right.sourceStepId');
    expect(source).toContain('sourceStepId: mergeStepId');
    expect(source).toContain("active.participationMode === 'collaboration'");
  });
});
