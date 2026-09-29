/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { GlobalAgent, CollaborationMember } from '@sync-think/shared';
import { AgentAppearanceEditor } from './AgentAppearanceEditor.js';
import { AgentEditorPanel } from './collaboration-agent-editor.js';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';
import { parseWorkspaceAvatar, resolveWorkspaceAvatar, workspaceAvatarSeed } from './workspace-avatar-profile.js';
afterEach(() => { cleanup(); localStorage.clear(); });
const initial = 'bot:v1:triangle:violet';
function Editor() { const [avatar, setAvatar] = useState(initial); return <><AgentAppearanceEditor name="小美" avatar={avatar} onChange={setAvatar} /><output data-testid="saved-avatar">{avatar}</output></>; }
const saved = () => parseWorkspaceAvatar(screen.getByTestId('saved-avatar').textContent ?? '');

describe('persisted appearance', () => {
  it('round-trips expression, new silhouette and custom color without schema changes', () => {
    const face = { shape: 'diamond', color: '#aabbcc', expression: 'wink' } as const;
    expect(parseWorkspaceAvatar(workspaceAvatarSeed(face))).toEqual(face);
    expect(parseWorkspaceAvatar('aw:v1:diamond:javascript(alert):wink')).toBeNull();
    expect(parseWorkspaceAvatar('aw:v1:diamond:#aabbcc:not-a-pose')).toBeNull();
    expect(resolveWorkspaceAvatar(initial, '小美')).toMatchObject({ shape: 'triangle', expression: 'idle' });
  });
  it('changes only the hovered selector with wheel, preserves the other attributes', () => {
    render(<Editor />);
    const expression = screen.getByRole('group', { name: '头像表情，悬停滚轮切换' });
    const shape = screen.getByRole('group', { name: '头像形状，悬停滚轮切换' });
    fireEvent.wheel(expression, { deltaY: 60 });
    expect(saved()).toMatchObject({ expression: 'happy', shape: 'triangle' });
    fireEvent.wheel(shape, { deltaY: 60 });
    expect(saved()).toMatchObject({ expression: 'happy', shape: 'circle' });
    fireEvent.wheel(shape, { deltaY: -60 });
    expect(saved()).toMatchObject({ expression: 'happy', shape: 'triangle' });
    fireEvent.wheel(expression, { deltaY: -60 });
    expect(saved()?.expression).toBe('idle');
  });
  it('captures selector scroll only, ignores pinch zoom, supports keyboard and custom colors', () => {
    render(<Editor />);
    const expression = screen.getByRole('group', { name: '头像表情，悬停滚轮切换' });
    expect(fireEvent.wheel(expression, { deltaY: 60, cancelable: true })).toBe(false);
    const before = screen.getByTestId('saved-avatar').textContent;
    fireEvent.wheel(expression, { deltaY: 60, ctrlKey: true });
    expect(screen.getByTestId('saved-avatar').textContent).toBe(before);
    fireEvent.keyDown(expression, { key: 'ArrowRight' });
    expect(saved()?.expression).toBe('error');
    fireEvent.change(screen.getByLabelText('自定义头像颜色'), { target: { value: '#123456' } });
    expect(saved()).toMatchObject({ color: '#123456', expression: 'error' });
  });
  it('makes expression-only changes dirty, saves via runtime and restores after unmount', async () => {
    const agent = { id: 'a', name: '小美', avatar: initial, description: '', persona: '', defaultModelId: 'm', skillIds: ['skill'], mcpServerIds: ['mcp'], fallbackModelIds: [], reasoningEffort: 'auto', archived: false } as unknown as GlobalAgent;
    const member = { id: 'a', agentId: 'a', name: '小美', avatar: initial, kind: 'agent', role: '成员', active: true } as CollaborationMember;
    let persisted = agent;
    const update = vi.fn(async (payload: Partial<GlobalAgent>) => { persisted = { ...agent, ...payload }; return { agent: persisted }; });
    Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { updateGlobalAgent: update } } });
    const view = render(<AgentEditorPanel member={member} agent={agent} workspace />);
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '选择眨眼表情' }));
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(parseWorkspaceAvatar(persisted.avatar)?.expression).toBe('wink');
    expect(persisted.skillIds).toEqual(['skill']); expect(persisted.mcpServerIds).toEqual(['mcp']);
    view.unmount();
    render(<AgentEditorPanel member={member} agent={persisted} workspace />);
    expect(screen.getByRole('button', { name: '选择眨眼表情' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('uses saved idle expression and temporarily overrides it for real execution', () => {
    const avatar = workspaceAvatarSeed({ shape: 'heart', color: '#aabbcc', expression: 'happy' });
    const view = render(<AgentWorkspaceAvatar name="小美" avatar={avatar} />);
    expect(screen.getByRole('img').getAttribute('data-expression')).toBe('happy');
    view.rerender(<AgentWorkspaceAvatar name="小美" avatar={avatar} state="working" />);
    expect(screen.getByRole('img').getAttribute('data-expression')).toBe('working');
    view.rerender(<AgentWorkspaceAvatar name="小美" avatar={avatar} state="idle" />);
    expect(screen.getByRole('img').getAttribute('data-expression')).toBe('happy');
  });
});
