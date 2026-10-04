/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPasswordCaptureScript, browserPasswordFillScript } from './browser-data-service.js';
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });
function form() {
  document.body.innerHTML = '<form><input type="email" name="username"><input type="password" name="password"><button type="submit">Sign in</button></form>';
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  return { username: document.querySelector('input[type=email]') as HTMLInputElement, password: document.querySelector('input[type=password]') as HTMLInputElement };
}
describe('browser password form scripts', () => {
  it('captures only an unambiguous visible login on the exact origin', () => {
    const f = form(); f.username.value = 'fixture-user'; f.password.value = 'fixture-secret';
    expect(window.eval(browserPasswordCaptureScript(location.origin))).toMatchObject({ ok: true, username: 'fixture-user', password: 'fixture-secret' });
    expect(window.eval(browserPasswordCaptureScript('https://other.test'))).toEqual({ ok: false });
  });
  it('fills using native input events and never submits a form', () => {
    const f = form(); const input = vi.fn(); const submit = vi.fn();
    f.username.addEventListener('input', input); document.querySelector('form')!.addEventListener('submit', submit);
    expect(window.eval(browserPasswordFillScript({ origin: location.origin, username: 'fixture-user', password: 'p"ass' }))).toEqual({ ok: true });
    expect(f.username.value).toBe('fixture-user'); expect(f.password.value).toBe('p"ass'); expect(input).toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });
  it('rejects ambiguous password forms and new-password signup fields', () => {
    form(); document.body.insertAdjacentHTML('beforeend', '<input type="password">');
    expect(window.eval(browserPasswordCaptureScript(location.origin))).toEqual({ ok: false });
    const f = form(); f.password.autocomplete = 'new-password';
    expect(window.eval(browserPasswordCaptureScript(location.origin))).toEqual({ ok: false });
  });
  it('supports username-first and password-only login steps without pressing Continue', () => {
    const f = form(); f.password.remove();
    const entry = { origin: location.origin, username: 'fixture-user', password: 'fixture-secret' };
    expect(window.eval(browserPasswordFillScript(entry))).toEqual({ ok: true });
    expect(f.username.value).toBe('fixture-user');
    expect(window.eval(browserPasswordCaptureScript(location.origin))).toEqual({ ok: false });
    const next = form(); next.username.remove();
    expect(window.eval(browserPasswordFillScript(entry))).toEqual({ ok: true });
    expect(next.password.value).toBe('fixture-secret');
  });
});
