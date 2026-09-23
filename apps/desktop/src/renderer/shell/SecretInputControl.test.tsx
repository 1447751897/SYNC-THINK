/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretInputControl } from './SecretInputControl.js';

afterEach(cleanup);

describe('SecretInputControl', () => {
  it('renders a password input and exposes the reveal command', () => {
    const onToggle = vi.fn();
    render(
      <SecretInputControl
        containerClassName="secret-shell"
        visible={false}
        aria-label="API 密钥"
        value="secret"
        onChange={() => undefined}
        onToggle={onToggle}
      />,
    );

    expect((screen.getByLabelText('API 密钥') as HTMLInputElement).type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders plaintext with host labels and respects the host disabled policy', () => {
    render(
      <SecretInputControl
        containerClassName="secret-shell"
        visible
        toggleDisabled
        revealLabel="显示 Token"
        concealLabel="隐藏 Token"
        aria-label="Bot Token"
        value="secret"
        onChange={() => undefined}
        onToggle={() => undefined}
      />,
    );

    expect((screen.getByLabelText('Bot Token') as HTMLInputElement).type).toBe('text');
    expect((screen.getByRole('button', { name: '隐藏 Token' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
