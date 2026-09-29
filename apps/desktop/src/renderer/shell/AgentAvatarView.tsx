// One renderer for the library, roster, tasks and chat. Old gen:v1 seeds are
// projected into bot-avatars without rewriting records; uploaded images and
// explicit emoji/text continue to render as before.
import { lazy, memo, Suspense } from 'react';
import { avatarColor } from './avatar-color.js';
import type { AvatarState } from './avatar-gen.js';
import { botAvatarColor, parseBotAvatar } from './bot-avatar.js';

import { parseWorkspaceAvatar } from './workspace-avatar-profile.js';
const WorkspaceAvatar = lazy(() => import('./AgentWorkspaceAvatar.js').then(module => ({ default: module.AgentWorkspaceAvatar })));

const BotAvatarCanvas = lazy(() => import('./BotAvatarCanvas.js'));

export function isImageAvatar(avatar: string | undefined): boolean {
  return Boolean(avatar?.trim().startsWith('data:image/'));
}

export function isGeneratedAvatar(avatar: string | undefined): boolean {
  return parseBotAvatar(avatar) !== null || parseWorkspaceAvatar(avatar) !== null;
}

export const AgentAvatarView = memo(function AgentAvatarView({
  name,
  avatar,
  size = 40,
  title,
  state = 'idle',
  animate,
}: {
  name: string;
  avatar?: string;
  size?: number;
  title?: string;
  state?: AvatarState;
  /** Opt into idle motion for an editor preview; dense lists stay still. */
  animate?: boolean;
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
  const workspaceFace = parseWorkspaceAvatar(trimmed);
  if (workspaceFace) return <Suspense fallback={<span role="img" aria-label={name} style={{ display: 'inline-block', width: size, height: size, background: workspaceFace.color, borderRadius: '35%' }} />}><WorkspaceAvatar name={name} avatar={avatar} size={size} title={title} state={state} animate={animate} /></Suspense>;
  const face = parseBotAvatar(trimmed);
  if (face) {
    return (
      <Suspense
        fallback={
          <span
            role="img"
            aria-label={name}
            title={title ?? name}
            className="agent-bot-avatar shrink-0 select-none"
            style={{ width: size, height: size }}
          >
            <span
              className="agent-bot-avatar__placeholder"
              style={{ width: size * 0.8, height: size * 0.8, background: botAvatarColor(face) }}
            />
          </span>
        }
      >
        <BotAvatarCanvas
          name={name}
          face={face}
          size={size}
          title={title}
          state={state}
          animate={animate}
        />
      </Suspense>
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
});

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
