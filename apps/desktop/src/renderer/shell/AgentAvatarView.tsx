// Shared agent avatar renderer — single source of truth for the library grid,
// team roster, and chat messages so the face you designed is the face you talk to.
// `avatar` accepts: emoji / short text, or an imported image as a data URL.
import { avatarColor } from './avatar-color.js';

export function isImageAvatar(avatar: string | undefined): boolean {
  return Boolean(avatar && avatar.startsWith('data:image/'));
}

export function AgentAvatarView({
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
  const label = trimmed ? trimmed.slice(0, 2) : (name[0] ?? '?').toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        borderRadius: '50%',
        fontSize: size * 0.45,
      }}
      className="flex shrink-0 items-center justify-center text-[var(--color-avatar-fg)] select-none"
      title={title ?? name}
    >
      {label}
    </div>
  );
}

/**
 * Read a user-picked image file and downscale it to a compact square data URL
 * (96×96 webp ≈ a few KB) so avatars stay cheap to store and stream.
 */
export function readAvatarImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const SIZE = 96;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D unavailable');
        // Cover-fit crop to a centered square.
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
        let dataUrl = canvas.toDataURL('image/webp', 0.85);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        }
        resolve(dataUrl);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('头像处理失败'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取该图片文件'));
    };
    img.src = url;
  });
}
