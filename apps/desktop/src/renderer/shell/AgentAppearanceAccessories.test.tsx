/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { GlobalAgent, CollaborationMember } from '@sync-think/shared';
import { AgentAppearanceEditor } from './AgentAppearanceEditor.js';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';
import { AgentEditorPanel } from './collaboration-agent-editor.js';
import { AgentAvatarView } from './AgentAvatarView.js';
import { NO_AVATAR_ACCESSORIES, WORKSPACE_SHAPES, parseWorkspaceAvatar, workspaceAvatarSeed } from './workspace-avatar-profile.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const original = workspaceAvatarSeed({ shape: 'cloud', color: '#b8a0df', expression: 'wink' });
function Editor() { const [avatar, setAvatar] = useState(original); return <><AgentAppearanceEditor name="绒绒" avatar={avatar} onChange={setAvatar} /><output data-testid="value">{avatar}</output></>; }
const current = () => parseWorkspaceAvatar(screen.getByTestId('value').textContent ?? '');

describe('classic avatar identity + removable accessories', () => {
  it('retains v1 serialization and default expression, and supports 24 different contours', () => {
    expect(original).toBe('aw:v1:cloud:#b8a0df:wink');
    expect(workspaceAvatarSeed(parseWorkspaceAvatar(original)!)).toBe(original);
    expect(WORKSPACE_SHAPES).toHaveLength(24);
    for (const [shape] of WORKSPACE_SHAPES) expect(parseWorkspaceAvatar(workspaceAvatarSeed({ shape, color: '#abcdef', expression: 'happy' }))?.shape).toBe(shape);
  });
  it('opens all 24 silhouettes and chooses a new body without resetting expression or accessories', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: '贝雷帽' }));
    fireEvent.click(screen.getByRole('button', { name: '全部造型 · 24' }));
    const gallery = screen.getByRole('group', { name: '全部头像造型' });
    expect(gallery.querySelectorAll('button')).toHaveLength(24);
    fireEvent.click(screen.getByRole('button', { name: '选择长耳造型' }));
    expect(current()).toMatchObject({ shape: 'bunny', expression: 'wink', accessories: { head: 'beret' } });
    expect(screen.queryByRole('group', { name: '全部头像造型' })).toBeNull();
  });
  it('round-trips all appearance slots without changing expression or color', () => {
    const profile = { shape: 'bunny', color: '#85b2c5', expression: 'happy', material: 'plush', accessories: { head: 'beret', eyes: 'glasses', neck: 'bow' } } as const;
    expect(parseWorkspaceAvatar(workspaceAvatarSeed(profile))).toEqual({ ...profile, material: 'classic' });
    for (const bad of ['aw:v2:bunny:#85b2c5:happy:plush:arbitrary:glasses:bow', 'aw:v2:bunny:#85b2c5:happy:unknown:beret:glasses:bow', 'aw:v2:bunny:#85b2c5:happy:plush:beret:glasses:bow:extra', 'aw:v2:bunny:#85b2c5:happy:plush:beret:glasses']) expect(parseWorkspaceAvatar(bad)).toBeNull();
  });
  it('combines different accessory slots, replaces within a slot and removes only the chosen slot', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: '贝雷帽' }));
    fireEvent.click(screen.getByRole('button', { name: '圆框眼镜' }));
    fireEvent.click(screen.getByRole('button', { name: '领结' }));
    expect(current()).toMatchObject({ shape: 'cloud', expression: 'wink', color: '#b8a0df', accessories: { head: 'beret', eyes: 'glasses', neck: 'bow' } });
    fireEvent.click(screen.getByRole('button', { name: '耳机' }));
    expect(current()?.accessories?.head).toBe('headphones');
    fireEvent.click(screen.getByRole('button', { name: '无眼饰' }));
    expect(current()?.accessories).toEqual({ head: 'headphones', eyes: 'none', neck: 'bow' });
    fireEvent.click(screen.getByRole('button', { name: '全部移除' }));
    expect(current()?.accessories).toEqual(NO_AVATAR_ACCESSORIES);
    expect(current()?.expression).toBe('wink');
  });
  it('uses only classic material while keeping expression and runtime state overrides', () => {
    const { container } = render(<Editor />);
    expect(screen.queryByRole('group', { name: '头像材质' })).toBeNull();
    expect(screen.queryByRole('button', { name: '毛绒 3D' })).toBeNull();
    expect([...container.querySelectorAll('canvas')].every(face => face.dataset.material === 'classic')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '选择开心表情' }));
    expect(current()).toMatchObject({ expression: 'happy' });
    const avatar=workspaceAvatarSeed({ ...current()!, accessories: { head: 'beret', eyes: 'none', neck: 'scarf' } });
    cleanup();
    const view=render(<AgentWorkspaceAvatar name="绒绒" avatar={avatar} state="thinking" />);
    expect(screen.getByRole('img').dataset.expression).toBe('thinking');
    expect(screen.getByRole('img').dataset.accessories).toBe('beret:none:scarf');
    expect(screen.getByRole('img').dataset.motion).toBe('working');
    view.rerender(<AgentWorkspaceAvatar name="绒绒" avatar={avatar} state="idle" />);
    expect(screen.getByRole('img').dataset.expression).toBe('happy');
    expect(screen.getByRole('img').dataset.accessories).toBe('beret:none:scarf');
  });
  it('leaves uploaded images and explicit emoji avatars unchanged', () => {
    const view=render(<AgentWorkspaceAvatar name="本人" avatar="✨" />);
    expect(screen.getByText('✨').tagName).not.toBe('CANVAS');
    expect(screen.getByText('✨').textContent).toBe('✨');
    view.rerender(<AgentAvatarView name="本人" avatar="data:image/png;base64,AAAA" />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });
  it('persists accessories through the runtime agent update and restores them after remount', async () => {
    const agent={ id: 'a', name: '绒绒', avatar: original, description: '', persona: '', defaultModelId: 'm', skillIds: ['s'], mcpServerIds: ['m'], fallbackModelIds: [], reasoningEffort: 'auto', archived: false } as unknown as GlobalAgent;
    const member={ id: 'a', agentId: 'a', name: '绒绒', avatar: original, kind: 'agent', role: '成员', active: true } as CollaborationMember;
    let persisted=agent;
    const update=vi.fn(async (payload: Partial<GlobalAgent>) => { persisted={ ...agent, ...payload }; return { agent: persisted }; });
    Object.defineProperty(window,'syncThink',{configurable:true,value:{runtime:{updateGlobalAgent:update}}});
    const view=render(<AgentEditorPanel member={member} agent={agent} workspace />);
    fireEvent.click(screen.getByRole('button',{name:'贝雷帽'}));
    fireEvent.click(screen.getByRole('button',{name:'领结'}));
    fireEvent.click(screen.getByRole('button',{name:'保存'}));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(parseWorkspaceAvatar(persisted.avatar)).toMatchObject({expression:'wink', accessories:{head:'beret',neck:'bow'}});
    expect(persisted.skillIds).toEqual(['s']); expect(persisted.mcpServerIds).toEqual(['m']);
    view.unmount();
    render(<AgentEditorPanel member={member} agent={persisted} workspace />);
    expect(screen.getByRole('button',{name:'贝雷帽'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button',{name:'领结'}).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(true);
  });
});




describe('classic-only compatibility', () => {
  it.each([
    undefined, '', 'bot:v1:star:cyan', 'gen:v1:hex:green',
    'aw:v1:heart:#aabbcc:happy',
    'aw:v2:bunny:#85b2c5:happy:plush:beret:glasses:bow',
  ])('renders the stored %s appearance as classic', avatar => {
    render(<AgentWorkspaceAvatar name="伙伴" avatar={avatar} />);
    expect(screen.getByRole('img').dataset.material).toBe('classic');
    if (avatar?.includes(':plush:')) {
      expect(screen.getByRole('img').dataset.shape).toBe('bunny');
      expect(screen.getByRole('img').dataset.expression).toBe('happy');
      expect(screen.getByRole('img').dataset.accessories).toBe('beret:glasses:bow');
    }
  });
  it('saves edits to legacy plush appearances as classic without losing the shape or accessories', () => {
    const change = vi.fn();
    render(<AgentAppearanceEditor name="伙伴" avatar="aw:v2:bunny:#85b2c5:happy:plush:beret:glasses:bow" onChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: '选择眨眼表情' }));
    expect(parseWorkspaceAvatar(change.mock.calls[0][0])).toEqual({ shape: 'bunny', color: '#85b2c5', expression: 'wink', material: 'classic', accessories: { head: 'beret', eyes: 'glasses', neck: 'bow' } });
  });
});
