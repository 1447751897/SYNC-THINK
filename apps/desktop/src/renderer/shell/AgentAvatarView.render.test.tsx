/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { AgentAvatarView, isGeneratedAvatar, isImageAvatar } from './AgentAvatarView.js';
import { KeepAliveLayer } from './KeepAliveLayer.js';

async function canvas() {
  await waitFor(() => expect(document.querySelector('canvas[data-bot-avatar]')).toBeTruthy());
  return document.querySelector('canvas[data-bot-avatar]') as HTMLCanvasElement;
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-reduced-motion');
  document.documentElement.classList.remove('dark');
  vi.unstubAllGlobals();
});

describe('AgentAvatarView bot library adapter', () => {
  it('recognizes both stored seed versions and trimmed imported images', () => {
    expect(isGeneratedAvatar('gen:v1:hex:green')).toBe(true);
    expect(isGeneratedAvatar('bot:v1:clover:preset')).toBe(true);
    expect(isGeneratedAvatar('bot:v1:unknown:preset')).toBe(false);
    expect(isGeneratedAvatar('🤖')).toBe(false);
    expect(isImageAvatar(' data:image/webp;base64,test ')).toBe(true);
  });

  it('renders the actual library canvas and keeps dense idle lists still', async () => {
    render(<AgentAvatarView name="研究员" avatar="bot:v1:clover:preset" size={28} />);
    const face = await canvas();
    expect(face.dataset.botAvatar).toBe('clover');
    expect(face.dataset.state).toBe('default');
    expect(face.getAttribute('aria-label')).toBe('研究员');
    expect(face.closest('[data-animated]')?.getAttribute('data-animated')).toBe('false');
    expect(face.closest('[data-animated]')?.getAttribute('style')).toContain('width: 28px');
  });

  it('renders old seeds as new library faces, with no persistence required', async () => {
    render(<AgentAvatarView name="旧智能体" avatar="gen:v1:squircle:green" />);
    expect((await canvas()).dataset.botAvatar).toBe('square');
  });

  it('preserves image, emoji and empty-name fallback branches', () => {
    const image = 'data:image/png;base64,fake';
    const view = render(<AgentAvatarView name="照片" avatar={image} state="working" />);
    expect(screen.getByRole('img', { name: '照片' }).getAttribute('src')).toBe(image);
    view.rerender(<AgentAvatarView name="机器人" avatar="🤖" />);
    expect(screen.getByText('🤖')).toBeTruthy();
    view.rerender(<AgentAvatarView name="" />);
    expect(screen.getByText('?')).toBeTruthy();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('animates work, then remounts into a frozen approval pose with a status cue', async () => {
    const view = render(
      <AgentAvatarView name="执行者" avatar="bot:v1:mech:preset" state="thinking" />,
    );
    const busy = await canvas();
    expect(busy.dataset.state).toBe('working');
    expect(busy.closest('[data-animated]')?.getAttribute('data-animated')).toBe('true');
    view.rerender(<AgentAvatarView name="执行者" avatar="bot:v1:mech:preset" state="waiting" />);
    const waiting = await canvas();
    expect(waiting).not.toBe(busy);
    expect(waiting.dataset.state).toBe('default');
    expect(waiting.getAttribute('aria-description')).toBe('等待审批');
    expect(
      document.querySelector('[data-avatar-state="waiting"] .agent-bot-avatar__status'),
    ).toBeTruthy();
  });

  it.each(['error', 'happy', 'looking', 'inactive'] as const)(
    'retains the %s business-state cue',
    async (state) => {
      render(<AgentAvatarView name="助手" avatar="bot:v1:star:preset" state={state} />);
      const face = await canvas();
      expect(face.closest('[data-avatar-state]')?.getAttribute('data-avatar-state')).toBe(state);
      expect(document.querySelector('.agent-bot-avatar__status')).toBeTruthy();
    },
  );

  it('responds to the in-app reduced-motion switch and live theme changes', async () => {
    const view = render(<AgentAvatarView name="预览" avatar="bot:v1:ghost:preset" animate />);
    await canvas();
    expect(document.querySelector('[data-animated="true"]')).toBeTruthy();
    await act(async () => {
      document.documentElement.setAttribute('data-reduced-motion', '');
    });
    expect(document.querySelector('[data-animated="false"]')).toBeTruthy();
    await act(async () => {
      document.documentElement.classList.add('dark');
    });
    expect(document.querySelector('canvas')).toBeTruthy();
    await act(async () => {
      document.documentElement.removeAttribute('data-reduced-motion');
    });
    expect(document.querySelector('[data-animated="true"]')).toBeTruthy();
    view.unmount();
  });

  it('respects OS reduced motion without hiding the avatar', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(<AgentAvatarView name="安静的助手" avatar="bot:v1:cat:preset" state="working" />);
    await canvas();
    expect(document.querySelector('[data-animated="false"]')).toBeTruthy();
  });

  it('pauses an animated preview while its retained shell surface is hidden', async () => {
    const view = render(
      <KeepAliveLayer active>
        <AgentAvatarView name="预览" avatar="bot:v1:flower:preset" animate />
      </KeepAliveLayer>,
    );
    await canvas();
    expect(document.querySelector('[data-animated="true"]')).toBeTruthy();
    view.rerender(
      <KeepAliveLayer active={false}>
        <AgentAvatarView name="预览" avatar="bot:v1:flower:preset" animate />
      </KeepAliveLayer>,
    );
    expect(document.querySelector('[data-animated="false"]')).toBeTruthy();
  });
});
