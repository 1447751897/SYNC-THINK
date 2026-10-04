import { memo } from 'react';
import { avatarColor } from './avatar-color.js';

export function isImageAvatar(avatar: string | undefined): boolean {
  return Boolean(avatar?.trim().startsWith('data:image/'));
}

/** Render user-provided image or text identities without depending on generated avatars. */
export const AgentAvatarFallback = memo(function AgentAvatarFallback({
  name,
  avatar,
  size = 40,
  title,
}: {
  name: string;
  avatar?: string;
  size?: number;
  title?: string;
}) {
  const trimmed = avatar?.trim() ?? '';
  if (isImageAvatar(trimmed)) {
    return (
      <img
        src={trimmed}
        alt={name}
        title={title ?? name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }}
        className="shrink-0 select-none"
        draggable={false}
      />
    );
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        borderRadius: '50%',
        fontSize: size * 0.45,
      }}
      className="inline-flex shrink-0 items-center justify-center text-[var(--color-avatar-fg)] select-none"
      title={title ?? name}
    >
      {trimmed.slice(0, 2)}
    </span>
  );
});
