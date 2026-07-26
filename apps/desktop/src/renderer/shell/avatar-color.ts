/** Deterministic avatar color from a name, resolved through theme tokens. */
const AVATAR_TOKENS = [
  'var(--color-avatar-1)',
  'var(--color-avatar-2)',
  'var(--color-avatar-3)',
  'var(--color-avatar-4)',
  'var(--color-avatar-5)',
  'var(--color-avatar-6)',
  'var(--color-avatar-7)',
  'var(--color-avatar-8)',
] as const;

export function avatarColor(name: string): string {
  return AVATAR_TOKENS[(name.charCodeAt(0) || 0) % AVATAR_TOKENS.length];
}
