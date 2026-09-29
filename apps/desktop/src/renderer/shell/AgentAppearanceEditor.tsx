import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';
import { WORKSPACE_EXPRESSIONS, WORKSPACE_SHAPES, resolveWorkspaceAvatar, workspaceAvatarSeed, type WorkspaceAvatarProfile } from './workspace-avatar-profile.js';

// Wheel is captured only over the two selectors, not over the whole editor.
function useSelectorWheel(ref: RefObject<HTMLDivElement | null>, change: (step: number) => void) {
  const changeRef = useRef(change); changeRef.current = change;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let accumulated = 0;
    let last = 0;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      const now = performance.now();
      if (now - last > 180) accumulated = 0;
      last = now;
      accumulated += (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
      if (Math.abs(accumulated) >= 32) { changeRef.current(Math.sign(accumulated)); accumulated = 0; }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [ref]);
}
const COLORS = [['#3589ff', '蓝色'], ['#39aaa5', '青色'], ['#9a76e8', '紫色'], ['#ee639d', '粉色'], ['#ef5960', '红色'], ['#ed9260', '橙色'], ['#55bed6', '天蓝色'], ['#a7cc59', '青柠色'], ['#60c77a', '绿色']] as const;
const wrap = (index: number, length: number) => (index + length) % length;

export function AgentAppearanceEditor({ name, avatar, onChange }: { name: string; avatar: string; onChange(value: string): void }) {
  const profile = resolveWorkspaceAvatar(avatar, name);
  const orbit = useRef<HTMLDivElement>(null);
  const shapes = useRef<HTMLDivElement>(null);
  const [turn, setTurn] = useState(0);
  const expressionIndex = Math.max(0, WORKSPACE_EXPRESSIONS.findIndex(([id]) => id === profile.expression));
  const shapeIndex = Math.max(0, WORKSPACE_SHAPES.findIndex(([id]) => id === profile.shape));
  const update = (patch: Partial<WorkspaceAvatarProfile>) => onChange(workspaceAvatarSeed({ ...profile, ...patch }));
  const stepExpression = (step: number) => { setTurn(t => t + step); update({ expression: WORKSPACE_EXPRESSIONS[wrap(expressionIndex + step, WORKSPACE_EXPRESSIONS.length)][0] }); };
  const stepShape = (step: number) => update({ shape: WORKSPACE_SHAPES[wrap(shapeIndex + step, WORKSPACE_SHAPES.length)][0] });
  useSelectorWheel(orbit, stepExpression); useSelectorWheel(shapes, stepShape);
  return <div className="aw-appearance">
    <div ref={orbit} className="collab-avatar-orbit" role="group" aria-label="头像表情，悬停滚轮切换" onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); stepExpression(event.key === 'ArrowRight' ? 1 : -1); } }}>
      <AgentWorkspaceAvatar name={name} avatar={avatar} size={148} animate />
      {WORKSPACE_EXPRESSIONS.map(([expression, label], index) => {
        const angle = (index - turn) / WORKSPACE_EXPRESSIONS.length * Math.PI * 2 - Math.PI / 2;
        return <button key={expression} type="button" aria-label={`选择${label}表情`} title={label} aria-pressed={profile.expression === expression} style={{ '--orbit-x': (134 + Math.cos(angle) * 111) + 'px', '--orbit-y': (134 + Math.sin(angle) * 111) + 'px' } as CSSProperties} onClick={() => update({ expression })}><AgentWorkspaceAvatar name={label} avatar={workspaceAvatarSeed({ ...profile, shape: 'circle', expression })} size={30} /></button>;
      })}
    </div>
    <div ref={shapes} className="collab-editor__shapes aw-shape-carousel" role="group" aria-label="头像形状，悬停滚轮切换" onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); stepShape(event.key === 'ArrowRight' ? 1 : -1); } }}>
      {WORKSPACE_SHAPES.map(([shape, label], index) => {
        let offset = wrap(index - shapeIndex, WORKSPACE_SHAPES.length); if (offset > WORKSPACE_SHAPES.length / 2) offset -= WORKSPACE_SHAPES.length;
        const angle = offset * .43;
        return <button key={shape} type="button" className="collab-editor__shape" aria-label={label} aria-pressed={shape === profile.shape} title={label} hidden={Math.abs(offset) > 3} style={{ '--shape-x': (Math.sin(angle) * 171) + 'px', '--shape-y': ((Math.cos(angle) - 1) * 125) + 'px' } as CSSProperties} onClick={() => update({ shape })}><AgentWorkspaceAvatar name={label} avatar={workspaceAvatarSeed({ ...profile, shape })} size={46} silhouette /></button>;
      })}
    </div>
    <div className="collab-editor__colors" role="group" aria-label="头像颜色">{COLORS.map(([color, label]) => <button key={color} type="button" aria-label={label} title={label} aria-pressed={profile.color.toLowerCase() === color} style={{ '--swatch-color': color } as CSSProperties} onClick={() => update({ color })} />)}<label className="aw-custom-color" title="自定义头像颜色"><input type="color" aria-label="自定义头像颜色" value={profile.color} onChange={event => update({ color: event.target.value })} /></label></div>
    <div className="collab-editor__preview-label">悬停滚轮切换 · 保存后作为默认表情</div>
  </div>;
}
