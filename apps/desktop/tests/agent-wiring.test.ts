import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/agent-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Agent catalog IPC wiring', () => {
  it('registers reads and binding updates through the typed Agent boundary', () => {
    for (const [channel, command] of [
      ['runtime:agent-get', 'agent.get'],
      ['runtime:agent-update-binding', 'agent.updateBinding'],
      ['runtime:agent-list', 'agent.list'],
      ['runtime:agent-create', 'agent.create'],
      ['runtime:agent-list-versions', 'agent.listVersions'],
      ['runtime:agent-create-version', 'agent.createVersion'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`host.requestAgent('${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerAgentHandlers({');
    expect(mainSource).toContain('requestAgent:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:agent-get', payload)");
    expect(preloadSource).toContain("'runtime:agent-update-binding'");
    expect(preloadSource).toContain('as Promise<UpdateAgentBindingResponse>');
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:agent-list', payload)");
    expect(globalSource).toContain('getAgent(payload?: GetAgentPayload)');
    expect(globalSource).toContain('updateAgentBinding(');
    expect(globalSource).toContain('listAgents(payload?: ListAgentsPayload)');
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:agent-create', payload)");
    expect(preloadSource).toContain("'runtime:agent-list-versions'");
    expect(preloadSource).toContain("'runtime:agent-create-version'");
    expect(globalSource).toContain('createAgent(payload: CreateAgentPayload)');
    expect(globalSource).toContain('listAgentVersions(payload: ListAgentVersionsPayload)');
    expect(globalSource).toContain('createAgentVersion(payload: CreateAgentVersionPayload)');
  });
});
