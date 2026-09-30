import { memo, useEffect, useRef } from 'react';
import { useKeepAliveActive } from './KeepAliveLayer.js';
import { AgentAvatarView, isImageAvatar } from './AgentAvatarView.js';
import { parseBotAvatar } from './bot-avatar.js';
import { parseWorkspaceAvatar, resolveWorkspaceAvatar, type WorkspaceAvatarState } from './workspace-avatar-profile.js';
import { AVATAR_STATES, type AvatarState } from './avatar-gen.js';
export type { WorkspaceAvatarState } from './workspace-avatar-profile.js';

// Original folded silhouettes for the agent workspace. Stored identities remain
// bot:v1 / gen:v1; uploaded images and explicitly chosen text are never replaced.
const outlines: Record<string, string> = {
  heart: 'M50 89 C34 77 6 53 7 31 C8 8 38 6 50 26 C61 4 92 10 94 31 C96 53 67 78 50 89Z',
  diamond: 'M45 7 Q50 2 56 9 L91 44 Q97 50 90 58 L56 92 Q50 98 44 91 L8 57 Q2 50 9 44Z',
  cat: 'M16 43 L18 9 L39 23 Q50 18 64 24 L84 8 L87 44 Q96 86 52 91 Q8 90 16 43Z',
  ghost: 'M12 48 Q10 5 49 7 Q91 8 90 50 L88 88 Q75 76 65 88 Q53 77 42 89 Q31 78 14 91Z',
  blob: 'M19 15 C34 0 48 21 63 10 C91 0 101 33 87 48 C106 70 82 102 62 86 C42 109 5 90 14 65 C-1 48 2 26 19 15Z',
  pebble: 'M14 38 C26 19 48 4 62 13 C81 28 92 52 87 68 C80 91 39 97 18 80 C4 65 5 53 14 38Z',
  puddle: 'M16 55 C25 30 34 56 48 28 C64 8 75 40 86 51 C113 87 1 111 8 74Z',
  droid: 'M23 20 L77 20 Q89 22 89 38 L87 77 Q85 89 72 89 L27 89 Q13 85 13 72 L13 36 Q13 20 23 20Z',
  mech: 'M27 11 L75 11 L93 32 L84 80 L67 92 L30 90 L11 73 L8 33Z',
  alien: 'M50 8 C102 4 99 50 75 80 Q50 111 27 80 C0 51 -1 12 50 8Z',
  square: 'M24 12 Q50 7 77 14 Q88 17 88 32 L85 76 Q83 88 69 89 L28 86 Q14 84 13 69 L12 29 Q12 17 24 12Z',
  pill: 'M28 11 Q51 5 74 13 Q86 18 86 34 L83 75 Q81 91 63 92 L32 87 Q16 84 16 67 L16 32 Q16 17 28 11Z',
  hexagon: 'M50 7 Q66 22 85 23 L87 57 Q86 76 53 93 Q23 83 15 65 L14 24 Q35 21 50 7Z',
  star: 'M45 10 Q50 0 56 12 L63 31 L85 32 Q99 32 88 44 L73 58 L81 81 Q84 94 71 87 L51 75 L30 88 Q17 95 22 81 L29 59 L12 45 Q1 34 16 33 L38 30Z',
  cloud: 'M21 78 Q3 75 9 58 Q11 47 24 46 Q16 22 34 19 Q47 14 55 32 Q61 16 74 24 Q90 27 82 47 Q101 47 94 65 Q91 80 75 79Z',
  flower: 'M50 15 C64 -2 84 14 75 31 C100 28 105 52 83 58 C101 73 86 98 66 82 C58 105 31 97 34 79 C12 98 -2 71 19 60 C-6 49 5 27 27 32 C13 8 38 -1 50 15Z',
  clover: 'M50 22 C76 -7 105 27 76 49 C105 71 77 107 51 80 C25 106 -6 74 22 50 C-5 24 28 -7 50 22Z',
  drop: 'M50 9 C66 32 89 43 88 65 C87 96 16 101 12 67 C9 47 32 25 50 9Z',
  circle: 'M50 7 C80 7 92 30 90 55 C90 81 69 94 44 91 C18 89 8 72 9 45 C10 20 27 7 50 7Z',
  triangle: 'M44 13 Q51 3 58 14 L91 73 Q96 87 79 89 L23 88 Q4 87 12 70Z',
};
const fallbackOutline = 'M30 12 C52 3 86 14 88 39 L87 67 Q85 92 61 90 L30 87 Q9 84 12 63 L13 32 Q14 17 30 12Z';


const IDLE_GAZE = [[-.82, -.58], [.76, -.38], [.68, .48], [-.72, .38], [0, 0]] as const;
const WORKING_GAZE = [[-.9, -.62], [.9, -.5], [.78, .6], [-.82, .52], [0, -.25]] as const;

function smoothStep(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * bounded * (3 - 2 * bounded);
}

/** Deterministic glances let a whole roster look alive without moving in sync. */
function gazeAt(time: number, working: boolean): { x: number; y: number } {
  const stops = working ? WORKING_GAZE : IDLE_GAZE;
  const duration = working ? 520 : 1750;
  const position = time / duration;
  const index = Math.floor(position) % stops.length;
  const next = (index + 1) % stops.length;
  const segment = position - Math.floor(position);
  // Hold the look, then travel smoothly to the next direction.
  const mix = smoothStep(Math.max(0, (segment - .58) / .42));
  return {
    x: stops[index][0] + (stops[next][0] - stops[index][0]) * mix,
    y: stops[index][1] + (stops[next][1] - stops[index][1]) * mix,
  };
}

export const AgentWorkspaceAvatar = memo(function AgentWorkspaceAvatar({ name, avatar, size = 32, state: requestedState, animate = false, title, silhouette = false }: {
  name: string; avatar?: string; size?: number; state?: WorkspaceAvatarState; animate?: boolean; title?: string; silhouette?: boolean;
}) {
  const layerActive = useKeepAliveActive();
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0, over: false });
  const storedFace = parseWorkspaceAvatar(avatar) ?? parseBotAvatar(avatar);
  const custom = Boolean(avatar?.trim()) && !storedFace;
  const face = resolveWorkspaceAvatar(avatar, name);
  const state = !requestedState || requestedState === 'idle' ? face.expression : requestedState;
  const color = face.color;
  useEffect(() => {
    const el = canvas.current;
    if (!el || custom || typeof Path2D === 'undefined') return;
    const ctx = el.getContext('2d');
    if (!ctx || typeof Path2D === 'undefined') return;
    const path = new Path2D(outlines[face.shape] ?? fallbackOutline);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const phase = [...name].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 4600, 0);
    let visible = true;
    let frame = 0;
    let start = 0;
    let last = -Infinity;
    const paint = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const pixels = Math.round(size * dpr);
      if (el.width !== pixels || el.height !== pixels) { el.width = pixels; el.height = pixels; }
      ctx.setTransform(pixels / 100, 0, 0, pixels / 100, 0, 0);
      ctx.clearRect(0, 0, 100, 100);
      const motion = layerActive && visible && !document.documentElement.hasAttribute('data-reduced-motion') && !reduced?.matches && !document.hidden && (animate || state === 'thinking' || state === 'working');
      const working = state === 'thinking' || state === 'working';
      const clock = time + phase;
      const gaze = motion ? gazeAt(clock, working) : { x: 0, y: 0 };
      let lift = 0;
      let stretchX = 1;
      let stretchY = 1;
      if (motion) {
        // BoardUI-style: the folded face breathes and glances. A hop that
        // rotates a full turn reads as a somersault on these silhouettes.
        const bob = Math.sin(clock / (working ? 280 : 650));
        lift = bob * (working ? 1.6 : 2);
        stretchX = 1 + Math.sin(clock / (working ? 310 : 1250)) * (working ? .016 : .01);
        stretchY = 1 - Math.sin(clock / (working ? 310 : 1250)) * (working ? .024 : .012);
      }
      ctx.save();
      ctx.translate(50, 50 + lift);
      ctx.rotate((motion ? Math.sin(clock / (working ? 520 : 1100)) * (working ? .05 : .045) : 0) + pointer.current.x * .025);
      ctx.scale(.92 * stretchX, .92 * stretchY); ctx.translate(-50, -50);
      ctx.save();
      ctx.translate(4, 0);
      ctx.fillStyle = color;
      ctx.fill(path);
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fill(path);
      ctx.restore();
      ctx.save();
      ctx.clip(path);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 100, 100);
      ctx.fillStyle = 'rgba(255,255,255,.48)';
      ctx.fillRect(0, 0, 100, 100);
      // A narrow side fold, not a shadow on a circular badge.
      ctx.beginPath(); ctx.moveTo(79, 0); ctx.quadraticCurveTo(92, 57, 69, 100); ctx.lineTo(110, 100); ctx.lineTo(110, 0); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.fill();
      ctx.restore();
      if (silhouette) { ctx.restore(); return; }
      const blinkWindow = working ? 3100 : 4600;
      const blink = motion && clock % blinkWindow > blinkWindow - 150;
      const dx = motion ? (pointer.current.over ? pointer.current.x * 6 : gaze.x * (working ? 5.5 : 4.2)) : 0;
      const dy = motion ? (pointer.current.over ? pointer.current.y * 3 : gaze.y * (working ? 4 : 3)) : 0;
      ctx.save(); ctx.translate(dx, dy); ctx.strokeStyle = 'rgb(25,34,38)'; ctx.fillStyle = 'rgb(25,34,38)'; ctx.lineCap = 'round'; ctx.lineWidth = 7;
      for (const [eye, x] of [37, 60].entries()) {
        ctx.beginPath();
        if (blink || state === 'sleeping' || state === 'inactive' || state === 'calm' || (state === 'wink' && eye === 1) || (state === 'skeptical' && eye === 0)) { ctx.moveTo(x - 4, 51); ctx.lineTo(x + 4, 51); ctx.stroke(); }
        else if (state === 'shook' || state === 'excited') { ctx.ellipse(x, 51, state === 'excited' ? 6 : 7, 10, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (state === 'sad') { ctx.moveTo(x - 5, 50); ctx.quadraticCurveTo(x, 58, x + 5, 50); ctx.stroke(); }
        else if (state === 'looking') { ctx.ellipse(x + (eye ? 2 : 0), 50, eye ? 7 : 4, eye ? 9 : 6, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (state === 'happy' || state === 'shy') { ctx.moveTo(x - 5, 54); ctx.quadraticCurveTo(x, 43, x + 5, 54); ctx.stroke(); }
        else { const top = state === 'thinking' ? 44 : state === 'working' ? 47 : 42; ctx.moveTo(x, top); ctx.lineTo(x + 1, state === 'thinking' || state === 'working' ? 54 : 59); ctx.stroke(); }
      }
      if (state === 'thinking' || state === 'skeptical' || state === 'working') { ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(30, state === 'thinking' ? 33 : 37); ctx.lineTo(43, 35); ctx.moveTo(55, 35); ctx.lineTo(68, state === 'skeptical' ? 30 : 37); ctx.stroke(); }
      if (state === 'excited') { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(30, 33); ctx.quadraticCurveTo(37, 27, 44, 33); ctx.moveTo(54, 33); ctx.quadraticCurveTo(61, 27, 68, 33); ctx.stroke(); }
      if (state === 'error') { ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(30, 33); ctx.lineTo(43, 38); ctx.moveTo(55, 38); ctx.lineTo(68, 33); ctx.stroke(); }
      if (state === 'worried' || state === 'sad' || state === 'confused') { ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(31, 36); ctx.lineTo(43, 32); ctx.moveTo(56, state === 'confused' ? 34 : 32); ctx.lineTo(68, state === 'confused' ? 34 : 36); ctx.stroke(); }
      if (state === 'calm') { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(32, 39); ctx.lineTo(43, 39); ctx.moveTo(55, 39); ctx.lineTo(66, 39); ctx.stroke(); }
      if (state === 'sleeping') { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(32, 57); ctx.quadraticCurveTo(37, 60, 42, 57); ctx.moveTo(55, 57); ctx.quadraticCurveTo(60, 60, 65, 57); ctx.stroke(); }
      if (state === 'shy') { ctx.fillStyle = 'rgba(226,74,93,.24)'; ctx.beginPath(); ctx.ellipse(24, 62, 7, 4, 0, 0, Math.PI * 2); ctx.ellipse(73, 62, 7, 4, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      ctx.restore();
    };
    const tick = (now: number) => {
      if (!start) start = now;
      if (now - last >= 40) { paint(now - start); last = now; }
      frame = requestAnimationFrame(tick);
    };
    const update = () => {
      cancelAnimationFrame(frame); frame = 0;
      paint(0);
      if (layerActive && visible && !document.documentElement.hasAttribute('data-reduced-motion') && !document.hidden && !reduced?.matches && (animate || state === 'thinking' || state === 'working')) frame = requestAnimationFrame(tick);
    };
    update();
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true; update();
    });
    observer?.observe(el);
    window.addEventListener('resize', update);
    document.addEventListener('visibilitychange', update);
    const preferenceObserver = new MutationObserver(update);
    preferenceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    reduced?.addEventListener?.('change', update);
    return () => { observer?.disconnect(); preferenceObserver.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', update); document.removeEventListener('visibilitychange', update); reduced?.removeEventListener?.('change', update); };
  }, [size, state, animate, face.shape, color, custom, layerActive, name, silhouette]);
  if (custom || isImageAvatar(avatar)) return <AgentAvatarView name={name} avatar={avatar} size={size} animate={animate} state={AVATAR_STATES.includes(state as AvatarState) ? state as AvatarState : 'idle'} title={title} />;
  const motionKind = animate || state === 'thinking' || state === 'working' ? (state === 'thinking' || state === 'working' ? 'working' : 'idle') : 'still';
  return <canvas ref={canvas} data-motion={motionKind} data-expression={state} data-shape={face.shape} onPointerMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); pointer.current = { x: (event.clientX - bounds.x) / bounds.width * 2 - 1, y: (event.clientY - bounds.y) / bounds.height * 2 - 1, over: true }; }} onPointerLeave={() => { pointer.current = { x: 0, y: 0, over: false }; }} className="agent-workspace-avatar" role="img" aria-label={name} title={title ?? name} style={{ width: size, height: size, flexShrink: 0 }} />;
});
