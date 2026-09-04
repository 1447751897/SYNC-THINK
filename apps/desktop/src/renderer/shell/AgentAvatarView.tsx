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
 *
 * The file is read through FileReader into a `data:` URL first: the shell CSP
   * (`img-src 'self' data: https: http: sync-think-image:`) blocks `blob:` URLs, so loading
 * a createObjectURL blob into an Image would fire onerror and fail the import.
 */
export function readAvatarImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取该图片文件'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        reject(new Error('无法读取该图片文件'));
        return;
      }
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
          let out = canvas.toDataURL('image/webp', 0.85);
          if (!out.startsWith('data:image/webp')) {
            out = canvas.toDataURL('image/jpeg', 0.85);
          }
          resolve(out);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('头像处理失败'));
        }
      };
      img.onerror = () => reject(new Error('无法读取该图片文件'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
