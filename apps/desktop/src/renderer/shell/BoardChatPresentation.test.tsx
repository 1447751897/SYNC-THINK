/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewMaxComposerFrame } from '@sync-think/ui-kit';
import { ComposerActionSlot, ContextRing } from './compose-toolbar.js';

afterEach(cleanup);

describe('Board chat presentation preserves runtime controls', () => {
  it('places attach/input in the pill and context/permission outside it', () => {
    render(<NewMaxComposerFrame variant="empty" presentation="pill" leadingAction={<button>附件</button>} contextBar={<nav data-testid="repository">仓库</nav>} statusBar={<button>权限</button>} input={<textarea aria-label="消息" />} />);
    const frame = screen.getByTestId('newmax-composer-frame');
    const body = frame.querySelector('.shell-compose')!;
    const status = screen.getByTestId('composer-status-bar');
    expect(body.contains(screen.getByRole('button', { name: '附件' }))).toBe(true);
    expect(body.contains(screen.getByLabelText('消息'))).toBe(true);
    expect(body.contains(screen.getByRole('button', { name: '权限' }))).toBe(false);
    expect(status.contains(screen.getByTestId('repository'))).toBe(true);
    expect(frame.lastElementChild).toBe(status);
  });

  it('keeps the default composer geometry used by the agent workspace', () => {
    render(<NewMaxComposerFrame variant="conversation" contextBar={<nav data-testid="repository">仓库</nav>} input={<textarea aria-label="消息" />} />);
    const frame = screen.getByTestId('newmax-composer-frame');
    expect(frame.firstElementChild).toBe(screen.getByTestId('repository'));
    expect(screen.queryByTestId('composer-status-bar')).toBeNull();
    expect(frame.getAttribute('data-presentation')).toBe('default');
  });

  it('shows a real voice action and disabled empty send; content enables sending', () => {
    const onVoice = vi.fn(), onSend = vi.fn(), onStop = vi.fn();
    const props = { presentation: 'paired' as const, running: false, onVoice, onSend, onStop };
    const view = render(<ComposerActionSlot {...props} hasContent={false} />);
    expect(screen.getByTestId('compose-send').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('compose-voice'));
    expect(onVoice).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    view.rerender(<ComposerActionSlot {...props} hasContent />);
    fireEvent.click(screen.getByTestId('compose-send'));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('uses the original stop action while running and blocks starting voice', () => {
    const onVoice = vi.fn(), onSend = vi.fn(), onStop = vi.fn();
    render(<ComposerActionSlot presentation="paired" hasContent={false} running onVoice={onVoice} onSend={onSend} onStop={onStop} />);
    expect(screen.getByTestId('compose-voice').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('compose-stop'));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the original queued-send action when running with a non-empty draft', () => {
    const onSend = vi.fn(), onStop = vi.fn();
    render(<ComposerActionSlot presentation="paired" hasContent running onVoice={vi.fn()} onSend={onSend} onStop={onStop} />);
    fireEvent.click(screen.getByTestId('compose-send'));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('keeps send disabled while voice is active and lets voice stop', () => {
    const onVoice = vi.fn(), onSend = vi.fn();
    render(<ComposerActionSlot presentation="paired" hasContent running={false} voiceActive onVoice={onVoice} onSend={onSend} onStop={vi.fn()} />);
    expect(screen.getByTestId('compose-send').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('compose-voice'));
    expect(onVoice).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows authoritative context occupancy, not a decorative percentage', () => {
    render(<ContextRing used={50_000} limit={100_000} usageRatio={0.7} showUsageLabel />);
    expect(screen.getByTestId('context-ring').textContent).toBe('70%');
    expect(screen.getByTestId('context-ring').getAttribute('aria-label')).toContain('约 70%');
  });
});
