/** Resolve provider avatars from the effective Git email, never from the display name. */
export async function gitIdentityAvatarUrl(email: string): Promise<string | undefined> {
  const normalized = email.trim().toLowerCase();
  const github = /^(?:(\d+)\+)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)@users\.noreply\.github\.com$/.exec(
    normalized,
  );
  if (github) {
    return github[1]
      ? 'https://avatars.githubusercontent.com/u/' + github[1] + '?s=96&v=4'
      : 'https://github.com/' + github[2] + '.png?size=96';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  // A missing Gravatar returns 404 so the UI can use a neutral fallback.
  return 'https://www.gravatar.com/avatar/' + hash + '?s=96&d=404';
}
