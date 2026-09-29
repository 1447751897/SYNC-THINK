import { webcrypto, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gitIdentityAvatarUrl } from './git-identity-avatar.js';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
describe('Git author avatar lookup', () => {
  it('uses the stable account ID from a modern GitHub noreply email', async () => {
    expect(await gitIdentityAvatarUrl('113440707+1447751897@users.noreply.github.com')).toBe(
      'https://avatars.githubusercontent.com/u/113440707?s=96&v=4',
    );
  });
  it('supports legacy username-only GitHub addresses and normalizes whitespace', async () => {
    expect(await gitIdentityAvatarUrl('  Octocat@users.noreply.github.com  ')).toBe(
      'https://github.com/octocat.png?size=96',
    );
  });
  it('uses a SHA-256 Gravatar key for ordinary emails without sending the address', async () => {
    const hash = createHash('sha256').update('author@example.com').digest('hex');
    expect(await gitIdentityAvatarUrl(' Author@Example.com ')).toBe(
      'https://www.gravatar.com/avatar/' + hash + '?s=96&d=404',
    );
  });
  it('does not invent an account for an empty or invalid email', async () => {
    expect(await gitIdentityAvatarUrl('')).toBeUndefined();
    expect(await gitIdentityAvatarUrl('not an email')).toBeUndefined();
  });
});
