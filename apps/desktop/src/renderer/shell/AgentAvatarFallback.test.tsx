/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AgentAvatarFallback } from './AgentAvatarFallback.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('renders an inline text avatar legally inside a markdown paragraph', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { container } = render(<p>成员 <span><AgentAvatarFallback name="成员" avatar="✨" size={14} /></span> 已回复</p>);
  expect(container.querySelector('p div')).toBeNull();
  const avatar = container.querySelector('span[title="成员"]')!;
  expect(avatar.classList.contains('inline-flex')).toBe(true); expect(avatar.getAttribute('style')).toContain('width: 14px');
  expect(error.mock.calls.some(args => args.join(' ').includes('validateDOMNesting'))).toBe(false);
});
it('preserves image avatars and explicit names', () => {
  render(<AgentAvatarFallback name="成员" avatar="data:image/png;base64,AAAA" size={24} />);
  expect(screen.getByRole('img', { name: '成员' }).getAttribute('style')).toContain('width: 24px');
});
