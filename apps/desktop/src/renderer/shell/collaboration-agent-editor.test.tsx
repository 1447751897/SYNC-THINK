/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CollaborationMember, GlobalAgent } from '@sync-think/shared';
import { AgentEditorPanel, personaLanguage, readAgentPrefs, withPersonaLanguage } from './collaboration-agent-editor.js';
import { REASONING_OPTIONS } from './reasoning-options.js';

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
  it.each(REASONING_OPTIONS)('saves $value directly from the full reasoning selector without losing bindings', async ({ value }) => {
    const configured = {
      ...agent,
      defaultKernelId: 'codex' as GlobalAgent['defaultKernelId'],
      reasoningEffort: value === 'auto' ? 'high' : 'auto',
      fallbackModelIds: ['backup'] as GlobalAgent['fallbackModelIds'],
      skillIds: ['skill'] as GlobalAgent['skillIds'],
      mcpServerIds: ['server'] as GlobalAgent['mcpServerIds'],
    };
    const updateGlobalAgent = vi.fn().mockResolvedValue({});
    const onSaved = vi.fn();
    Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { updateGlobalAgent } } });
    render(<AgentEditorPanel workspace member={member} agent={configured} onSaved={onSaved} />);
    const selector = screen.getByLabelText('推理强度') as HTMLSelectElement;
    expect([...selector.options].map(option => [option.value, option.textContent])).toEqual(REASONING_OPTIONS.map(option => [option.value, option.title]));
    expect(selector.value).toBe(configured.reasoningEffort);
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(selector, { target: { value } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(updateGlobalAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'a', reasoningEffort: value, defaultKernelId: 'codex',
      defaultModelId: 'm', fallbackModelIds: ['backup'], skillIds: ['skill'], mcpServerIds: ['server'],
    })));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: value }));
  });

  it.each(['minimal', 'xhigh', 'max'])('creates an agent with the selected %s effort rather than overriding it with auto', async value => {
    const created = { ...agent, reasoningEffort: value };
    const createGlobalAgent = vi.fn().mockResolvedValue({ agent: created });
    const onCreated = vi.fn();
    Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { createGlobalAgent } } });
    render(<AgentEditorPanel workspace creating member={member} models={[{ modelId: 'm', displayName: '模型', providerName: '供应商' }]} onCreated={onCreated} />);
    expect((screen.getByLabelText('推理强度') as HTMLSelectElement).value).toBe('auto');
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '新智能体' } });
    fireEvent.change(screen.getByLabelText('推理强度'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '创建智能体' }));
    await waitFor(() => expect(createGlobalAgent).toHaveBeenCalledWith(expect.objectContaining({ name: '新智能体', reasoningEffort: value })));
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('reconciles reasoning changes without overwriting an unsaved selection', () => {
    const view = render(<AgentEditorPanel workspace member={member} agent={agent} />);
    const selector = screen.getByLabelText('推理强度') as HTMLSelectElement;
    view.rerender(<AgentEditorPanel workspace member={member} agent={{ ...agent, reasoningEffort: 'high' }} />);
    expect(selector.value).toBe('high');
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(selector, { target: { value: 'max' } });
    view.rerender(<AgentEditorPanel workspace member={member} agent={{ ...agent, reasoningEffort: 'low', description: '服务端新描述' }} />);
    expect(selector.value).toBe('max');
    expect((screen.getByLabelText('描述') as HTMLTextAreaElement).value).toBe('服务端新描述');
    view.rerender(<AgentEditorPanel workspace member={{ ...member, id: 'agent:b', agentId: 'b' }} agent={{ ...agent, id: 'b' as GlobalAgent['id'], reasoningEffort: 'minimal' }} />);
    expect(selector.value).toBe('minimal');
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a provider-specific saved effort visible and preserves it when editing another field', async () => {
    const updateGlobalAgent = vi.fn().mockResolvedValue({});
    Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { updateGlobalAgent } } });
    render(<AgentEditorPanel workspace member={member} agent={{ ...agent, reasoningEffort: 'ultra' }} />);
    expect((screen.getByLabelText('推理强度') as HTMLSelectElement).value).toBe('ultra');
    expect(screen.getByRole('option', { name: 'ultra（当前设置）' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '改名' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateGlobalAgent).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: 'ultra' })));
  });

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

  it('preserves edited fields during a definition refresh while accepting untouched fields', () => {
    const view = render(<AgentEditorPanel workspace member={member} agent={agent} />);
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '未保存的新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '选择眨眼表情' }));
    view.rerender(<AgentEditorPanel workspace member={member} agent={{ ...agent, description: '服务端新描述', defaultModelId: 'new-model' as GlobalAgent['defaultModelId'] }} />);
    expect((screen.getByLabelText('名字') as HTMLInputElement).value).toBe('未保存的新名字');
    expect(screen.getByRole('button', { name: '选择眨眼表情' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('描述') as HTMLTextAreaElement).value).toBe('服务端新描述');
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps edits made during an in-flight save and uses the latest definition on the next save', async () => {
    let resolveSave!: (value: { agent: GlobalAgent }) => void;
    const updateGlobalAgent = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; })).mockResolvedValue({});
    Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { updateGlobalAgent } } });
    const onSaved = vi.fn();
    const view = render(<AgentEditorPanel workspace member={member} agent={agent} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '第一次提交' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '保存期间继续修改' } });
    fireEvent.click(screen.getByRole('button', { name: '选择眨眼表情' }));
    const persisted = { ...agent, name: '第一次提交', description: '服务器确认的描述' };
    await act(async () => { resolveSave({ agent: persisted }); });
    view.rerender(<AgentEditorPanel workspace member={member} agent={persisted} onSaved={onSaved} />);
    expect((screen.getByLabelText('名字') as HTMLInputElement).value).toBe('保存期间继续修改');
    expect(screen.getByRole('button', { name: '选择眨眼表情' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('描述') as HTMLTextAreaElement).value).toBe('服务器确认的描述');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateGlobalAgent).toHaveBeenCalledTimes(2));
    expect(updateGlobalAgent.mock.calls[1][0]).toMatchObject({ name: '保存期间继续修改', description: '服务器确认的描述', avatar: expect.stringContaining(':wink') });
  });

  it('resets the draft only when switching to a different agent', () => {
    const view = render(<AgentEditorPanel workspace member={member} agent={agent} />);
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '第一个智能体的草稿' } });
    view.rerender(<AgentEditorPanel workspace member={{ ...member, id: 'agent:b', agentId: 'b', name: '编辑员' }} agent={{ ...agent, id: 'b' as GlobalAgent['id'], name: '编辑员' }} />);
    expect((screen.getByLabelText('名字') as HTMLInputElement).value).toBe('编辑员');
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('retains reasoning edits made while a save is in flight', async () => {
    let resolveSave!: (value: { agent: GlobalAgent }) => void;
    const updateGlobalAgent = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; })).mockResolvedValue({});
    Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { updateGlobalAgent } } });
    const view = render(<AgentEditorPanel workspace member={member} agent={agent} />);
    fireEvent.change(screen.getByLabelText('推理强度'), { target: { value: 'xhigh' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.change(screen.getByLabelText('推理强度'), { target: { value: 'max' } });
    const persisted = { ...agent, reasoningEffort: 'xhigh' };
    await act(async () => { resolveSave({ agent: persisted }); });
    view.rerender(<AgentEditorPanel workspace member={member} agent={persisted} />);
    expect((screen.getByLabelText('推理强度') as HTMLSelectElement).value).toBe('max');
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateGlobalAgent).toHaveBeenCalledTimes(2));
    expect(updateGlobalAgent.mock.calls[0][0]).toMatchObject({ reasoningEffort: 'xhigh' });
    expect(updateGlobalAgent.mock.calls[1][0]).toMatchObject({ reasoningEffort: 'max' });
  });

  it('keeps notification and voice prefs on this device', () => {
    render(<AgentEditorPanel member={member} agent={agent} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /回复完成时通知/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /朗读回复/ }));
    fireEvent.change(screen.getByLabelText(/语速/), { target: { value: '1.5' } });
    expect(readAgentPrefs('a')).toEqual({ notify: true, voice: true, rate: 1.5 });
  });
});
