// Shared agent avatar renderer — single source of truth for the library grid,
// team roster, and chat messages so the face you designed is the face you talk to.
//
// `avatar` accepts three shapes, checked in this order:
//   1. `gen:v1:<shape>:<color>` — a procedural seed rendered as inline SVG
//   2. a `data:image/…` URL     — an imported image
//   3. anything else            — legacy emoji / short text on a hashed color
//
// Branches 2 and 3 are untouched by the procedural work: existing agents keep
// rendering exactly as before until their seed is written.
import { avatarColor } from './avatar-color.js';
import { avatarDataUrl, parseAvatarSeed, type AvatarState } from './avatar-gen.js';

export function isImageAvatar(avatar: string | undefined): boolean {
  return Boolean(avatar && avatar.startsWith('data:image/'));
}

/** True when `avatar` carries a procedural seed rather than an image or text. */
export function isGeneratedAvatar(avatar: string | undefined): boolean {
  return parseAvatarSeed(avatar) !== null;
}

export function AgentAvatarView({
  name,
  avatar,
  size = 40,
  title,
  state = 'idle',
}: {
  name: string;
  avatar?: string;
  size?: number;
  title?: string;
  /**
   * Expression layer for procedural avatars. Ignored by the image and text
   * branches — only a generated face has states to change.
   */
  state?: AvatarState;
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

  const seed = parseAvatarSeed(trimmed);
  if (seed) {
    // No circular clip here: the shape itself is the silhouette. Clipping to a
    // circle (as the imported-image branch does) would cut the outline away.
    return (
      <img
        src={avatarDataUrl(seed.shape, seed.color, state, size)}
        alt={name}
        title={title ?? name}
        style={{ width: size, height: size }}
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
