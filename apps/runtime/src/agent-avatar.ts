/** Default agent identity is a built-in classic face, never a generated image. */
export const DEFAULT_AGENT_AVATAR = 'bot:v1:clover:preset';

/** Shared by UI/API and chat-tool creation; explicit custom overrides remain intact. */
export function defaultAgentAvatar(avatar?: string): string {
  return avatar?.trim() || DEFAULT_AGENT_AVATAR;
}

/** Accept compact appearance seeds and explicit user customizations, not remote URLs. */
export const resolveAgentAvatar = (
  raw: unknown,
): { ok: true; avatar?: string } | { ok: false; error: string } => {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== 'string') return { ok: false, error: 'avatar must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, avatar: '' };
  if (
    [...trimmed].some((char) => {
      const code = char.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    return { ok: false, error: 'avatar contains control characters' };
  }
  if (trimmed.startsWith('data:image/')) {
    if (trimmed.length > 200_000) {
      return { ok: false, error: 'avatar data URL is too large (max ~200KB)' };
    }
    return { ok: true, avatar: trimmed };
  }
  // Procedural avatar seed written by the desktop avatar picker, e.g.
  // "gen:v1:blob:red". The picker owns the shape/color enums and degrades an
  // unrecognised value to a derived face, so this only bounds the value's
  // shape — compact, single-line, and never a remote URL.
  if (trimmed.startsWith('gen:v1:')) {
    if (!/^gen:v1:[a-z]+:[a-z]+$/.test(trimmed)) {
      return { ok: false, error: 'avatar seed must look like gen:v1:<shape>:<color>' };
    }
    return { ok: true, avatar: trimmed };
  }
  if (trimmed.startsWith('bot:v1:')) {
    if (!/^bot:v1:[a-z]{1,24}:[a-z]{1,16}$/.test(trimmed)) {
      return { ok: false, error: 'avatar seed must look like bot:v1:<shape>:<color>' };
    }
    return { ok: true, avatar: trimmed };
  }
  if (trimmed.startsWith('aw:v1:') || trimmed.startsWith('aw:v2:')) {
    const base = 'aw:v[12]:[a-z]{1,24}:#[0-9a-fA-F]{6}:[a-z]{1,24}';
    const accessories = ':(?:classic|plush):(?:none|beret|detective|cap|sprout|headphones):(?:none|glasses|monocle):(?:none|bow|scarf)';
    const pattern = new RegExp('^' + base + (trimmed.startsWith('aw:v2:') ? accessories : '') + '$');
    if (!pattern.test(trimmed)) return { ok: false, error: 'invalid workspace avatar seed' };
    return { ok: true, avatar: trimmed.replace(':plush:', ':classic:') };
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return {
      ok: false,
      error:
        'avatar must be an emoji, short text, or a data:image URL (remote URLs are not allowed)',
    };
  }
  if (trimmed.length > 8) {
    return { ok: false, error: 'avatar text must be at most 8 characters' };
  }
  return { ok: true, avatar: trimmed };
};
