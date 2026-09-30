/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CollaborationMember, GlobalAgent } from '@sync-think/shared';
import { AgentEditorPanel, personaLanguage, readAgentPrefs, withPersonaLanguage } from './collaboration-agent-editor.js';

afterEach(() => { cleanup(); localStorage.clear(); Object.defineProperty(window, 'syncThink', { configurable: true, value: undefined }); });

const member: CollaborationMember = { id: 'agent:a', kind: 'agent', agentId: 'a', name: '研究员', avatar: '', role: '调研', active: true };
const agent = { id: 'a', name: '研究员', avatar: '', description: '查资料', persona: '你是研究员。', defaultModelId: 'm', fallbackModelIds: [], skillIds: [], mcpServerIds: [], reasoningEffort: 'auto', archived: false, createdAt: '', updatedAt: '' } as unknown as GlobalAgent;

describe('persona language marker', () => {
  it('round-trips and replaces the language line', () => {
    const zh = withPersonaLanguage('你是研究员。', 'en');
    expect(personaLanguage(zh)).toBe('en');
    const back = withPersonaLanguage(zh, 'ja');
    expect(personaLanguage(back)).toBe('ja');
    expect(back.match(/回复语言/g)).toHaveLength(1);
    expect(withPersonaLanguage(back, 'auto')).toBe('你是研究员。');
  });
});

describe('AgentEditorPanel', () => {
  it('saves name, description and language through updateGlobalAgent', async () => {
    const updateGlobalAgent = vi.fn().mockResolvedValue({});
    Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { updateGlobalAgent, detectKernels: vi.fn().mockResolvedValue({ kernels: [] }) } } });
    const onSaved = vi.fn();
    render(<AgentEditorPanel member={member} agent={agent} onSaved={onSaved} />);
    const save = screen.getByRole('button', { name: '保存' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '资深研究员' } });
    fireEvent.change(screen.getByLabelText('回复语言'), { target: { value: 'en' } });
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateGlobalAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a', name: '资深研究员', description: '查资料', persona: expect.stringContaining('[回复语言：English]') }));
  });

  it('lets the user pick a kernel in the same editor as the default model', async () => {
    const updateGlobalAgent = vi.fn().mockResolvedValue({});
    const detectKernels = vi.fn().mockResolvedValue({
      kernels: [
        { kernelId: 'native', name: '原生内核', icon: 'native', installed: true, capabilities: {} },
        { kernelId: 'codex', name: 'Codex', icon: 'codex', installed: true, version: '1.0', capabilities: {} },
      ],
    });
    Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { updateGlobalAgent, detectKernels } } });
    render(<AgentEditorPanel workspace member={member} agent={agent} models={[{ modelId: 'm', displayName: '模型', providerName: '供应商' }]} />);
    await waitFor(() => {
      expect(detectKernels).toHaveBeenCalled();
      expect([...(screen.getByLabelText('内核') as HTMLSelectElement).options].map((option) => option.value)).toContain('codex');
    });
    fireEvent.change(screen.getByLabelText('内核'), { target: { value: 'codex' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateGlobalAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a', defaultKernelId: 'codex', defaultModelId: 'm' })));
  });

  it('keeps notification and voice prefs on this device', () => {
    render(<AgentEditorPanel member={member} agent={agent} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /回复完成时通知/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /朗读回复/ }));
    fireEvent.change(screen.getByLabelText(/语速/), { target: { value: '1.5' } });
    expect(readAgentPrefs('a')).toEqual({ notify: true, voice: true, rate: 1.5 });
  });
});
