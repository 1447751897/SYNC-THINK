import { lazy, memo, Suspense, useCallback, useEffect, useId, useState } from 'react';
import type { AvatarState } from './avatar-gen.js';
import { useKeepAliveActive } from './KeepAliveLayer.js';
import portrait from './assets/plush/host-system.png';

export const HOST_SYSTEM_NAME = '宿主系统';
const loadTurn3D = () => import('./HostSystemTurn3D.js');
const HostSystemTurn3D = lazy(loadTurn3D);

function readHostMotionAllowed() {
  return !document.documentElement.hasAttribute('data-reduced-motion')
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function useHostMotionAllowed() {
  const [allowed, setAllowed] = useState(readHostMotionAllowed);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const refresh = () => setAllowed(readHostMotionAllowed());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    media?.addEventListener('change', refresh);
    return () => { observer.disconnect(); media?.removeEventListener('change', refresh); };
  }, []);
  return allowed;
}

const EYES = [
  { side: 'left', x: 160, y: 144 },
  { side: 'right', x: 217, y: 135 },
] as const;

/** Reuse the portrait's fur and bead eyes instead of changing its visual identity.
 * The patches sample fur just below the eyes; feathered masks hide the baked-in
 * eyes, while independent gaze/blink groups move the original beads over them.
 */
function HostSystemEyes({ id }: { id: string }) {
  return (
    <svg className="shell-host-eyes" viewBox="0 0 380 384" aria-hidden="true" focusable="false">
      <defs>
        <filter id={`${id}-fur-soften`}><feGaussianBlur stdDeviation="3" /></filter>
        <filter id={`${id}-eye-soften`}><feGaussianBlur stdDeviation="1" /></filter>
        <mask id={`${id}-fur`} maskUnits="userSpaceOnUse" x="0" y="0" width="380" height="384">
          {EYES.map(eye => <ellipse key={eye.side} cx={eye.x} cy={eye.y} rx="28" ry="31"
            fill="white" filter={`url(#${id}-fur-soften)`} />)}
        </mask>
        {EYES.map(eye => (
          <mask key={eye.side} id={`${id}-${eye.side}`} maskUnits="userSpaceOnUse" x="0" y="0" width="380" height="384">
            <ellipse cx={eye.x} cy={eye.y} rx="18" ry="23" fill="white" filter={`url(#${id}-eye-soften)`} />
          </mask>
        ))}
      </defs>
      <image href={portrait} width="380" height="384" y="-72" mask={`url(#${id}-fur)`} />
      <g className="shell-host-gaze">
        {EYES.map(eye => (
          <g key={eye.side} className="shell-host-blink" style={{ transformOrigin: `${eye.x}px ${eye.y}px` }}>
            <image href={portrait} width="380" height="384" mask={`url(#${id}-${eye.side})`} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** One product identity across model/provider changes; no avatar-generation loop.
 * Only standalone chat portraits opt into interaction, so picker buttons never
 * contain another button and passive composer identities keep their semantics.
 */
export const HostSystemAvatar = memo(function HostSystemAvatar({
  size = 38, state = 'idle', animate = false, interactive = false,
}: { size?: number; state?: AvatarState; animate?: boolean; interactive?: boolean }) {
  const active = useKeepAliveActive();
  const motionAllowed = useHostMotionAllowed();
  const id = `host-eyes-${useId().replace(/:/g, '')}`;
  const [spinSequence, setSpinSequence] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [turnReady, setTurnReady] = useState(false);
  const finishTurn = useCallback(() => { setSpinning(false); setTurnReady(false); }, []);
  const readyTurn = useCallback(() => setTurnReady(true), []);
  const moving = active && !['error', 'inactive', 'sleeping'].includes(state)
    && (animate || ['thinking', 'working', 'waiting', 'happy'].includes(state));

  useEffect(() => {
    if (!active || !motionAllowed) {
      finishTurn();
      return;
    }
    if (!spinning) return;
    // Bound loading/rendering time as well as the 1.2-second solid-model turn.
    const timer = window.setTimeout(finishTurn, 1700);
    return () => window.clearTimeout(timer);
  }, [active, motionAllowed, spinning, spinSequence, finishTurn]);

  const content = (
    <span className="shell-host-turn" data-spinning={active && motionAllowed && spinning ? 'true' : 'false'}
      data-renderer-ready={turnReady ? 'true' : 'false'}>
      <span className="shell-host-body">
        <img src={portrait} alt={HOST_SYSTEM_NAME} width={380} height={384} draggable={false} />
        {moving && <HostSystemEyes id={id} />}
      </span>
      {active && motionAllowed && spinning && <Suspense fallback={null}>
        <HostSystemTurn3D size={size} sequence={spinSequence} onReady={readyTurn} onComplete={finishTurn} />
      </Suspense>}
    </span>
  );
  const presentation = {
    className: 'shell-host-avatar',
    'data-state': state,
    'data-animated': moving ? 'true' : 'false',
    'data-spinning': active && motionAllowed && spinning ? 'true' : 'false',
    style: { width: size, height: size },
  };

  return interactive ? (
    <button {...presentation} onMouseEnter={() => { void loadTurn3D().catch(() => {}); }} onFocus={() => { void loadTurn3D().catch(() => {}); }} type="button" aria-label={`${HOST_SYSTEM_NAME}，点击转一圈`} title="点我转一圈"
      onClick={event => {
        event.stopPropagation();
        if (!active || !motionAllowed) return;
        setSpinSequence(sequence => sequence + 1);
        setSpinning(true);
      }}>
      {content}
    </button>
  ) : <span {...presentation} title={HOST_SYSTEM_NAME}>{content}</span>;
});
