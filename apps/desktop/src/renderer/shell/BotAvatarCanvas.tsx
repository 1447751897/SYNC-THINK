import { BotAvatar } from 'bot-avatars';
import type { AvatarState } from './avatar-gen.js';
import { botAvatarColor, botAvatarState, type BotAvatarFace } from './bot-avatar.js';
import { useAvatarEnvironment } from './use-avatar-environment.js';
import { useKeepAliveActive } from './KeepAliveLayer.js';

const STATE_LABELS: Record<AvatarState, string> = {
  idle: '空闲',
  thinking: '思考中',
  working: '工作中',
  waiting: '等待审批',
  happy: '已完成',
  error: '出错',
  looking: '有新消息',
  sleeping: '休眠',
  inactive: '已停用',
};

export default function BotAvatarCanvas({
  name,
  face,
  size,
  title,
  state,
  animate,
}: {
  name: string;
  face: BotAvatarFace;
  size: number;
  title?: string;
  state: AvatarState;
  animate?: boolean;
}) {
  const { theme, reducedMotion } = useAvatarEnvironment();
  const active = useKeepAliveActive();
  const moving = animate ?? ['thinking', 'working', 'sleeping', 'happy', 'looking'].includes(state);
  const paused = !moving || reducedMotion || !active;
  const pose = botAvatarState(state);
  const badge = ['waiting', 'happy', 'error', 'looking', 'inactive'].includes(state);
  return (
    <span
      className="agent-bot-avatar shrink-0 select-none"
      style={{ width: size, height: size }}
      title={title ?? (state === 'idle' ? name : `${name} · ${STATE_LABELS[state]}`)}
      data-avatar-state={state}
      data-animated={!paused}
    >
      <BotAvatar
        // A paused library instance retains its old pose when state changes.
        // Remount frozen states so approval/completion never shows a busy face.
        key={paused ? `${face.shape}:${pose}:still` : `${face.shape}:moving`}
        type={face.shape}
        color={botAvatarColor(face)}
        size={size}
        state={pose}
        shading="plastic"
        theme={theme}
        paused={paused}
        interactive={!paused}
        jumpEvery={0}
        aria-label={name}
        aria-description={STATE_LABELS[state]}
      />

      {badge ? (
        <span className="agent-bot-avatar__status" aria-hidden="true">
          {state === 'error'
            ? '!'
            : state === 'waiting'
              ? 'Ⅱ'
              : state === 'happy'
                ? '✓'
                : state === 'inactive'
                  ? '−'
                  : '•'}
        </span>
      ) : null}
    </span>
  );
}
