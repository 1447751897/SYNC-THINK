import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARTIFACT_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(new URL('../src/main/artifact-handlers.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Artifact IPC wiring', () => {
  it('registers artifact commands through the typed boundary and an injected preview port', () => {
    for (const command of [
      'artifact.list',
      'artifact.getVersion',
      'artifact.compare',
      'artifact.selectVersion',
      'artifact.merge',
      'artifact.listConflicts',
      'artifact.resolveConflict',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('ARTIFACT_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(ARTIFACT_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`ARTIFACT_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerArtifactHandlers({');
    expect(mainSource).toContain('requestArtifact:');
    expect(mainSource).toContain('registerImagePreview:');
  });

  it('keeps the existing Renderer bridge methods', () => {
    for (const method of [
      'getArtifactImagePreview(',
      'listArtifacts(payload: ListArtifactsPayload)',
      'compareArtifactVersions(',
      'selectArtifactVersion(',
      'mergeArtifactVersions(',
      'listArtifactMergeConflicts(',
      'resolveArtifactMergeConflict(',
    ]) {
      expect(globalSource).toContain(method);
    }
  });
});
