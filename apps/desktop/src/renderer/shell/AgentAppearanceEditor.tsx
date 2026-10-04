import avatarPalette from './assets/avatar-style-palette.json' with { type: 'json' };
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';
import { AVATAR_HEADWEAR, AVATAR_EYEWEAR, AVATAR_NECKWEAR, NO_AVATAR_ACCESSORIES, WORKSPACE_EXPRESSIONS, WORKSPACE_SHAPES, resolveWorkspaceAvatar, workspaceAvatarSeed, type WorkspaceAvatarProfile, type AvatarAccessories } from './workspace-avatar-profile.js';

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
const COLORS = avatarPalette.body;
const wrap = (index: number, length: number) => (index + length) % length;

export function AgentAppearanceEditor({ name, avatar, onChange }: { name: string; avatar: string; onChange(value: string): void }) {
  const profile = resolveWorkspaceAvatar(avatar, name);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const orbit = useRef<HTMLDivElement>(null);
  const shapes = useRef<HTMLDivElement>(null);
  const [turn, setTurn] = useState(0);
  const [allShapes, setAllShapes] = useState(false);
  const shapeIndex = Math.max(0, WORKSPACE_SHAPES.findIndex(([id]) => id === profile.shape));
  // Native wheel events can be batched before React renders the new controlled value.
  // Advance the pending profile immediately so no step or unrelated attribute is lost.
  const update = (patch: Partial<WorkspaceAvatarProfile>) => {
    const next = { ...profileRef.current, ...patch };
    profileRef.current = next;
    onChange(workspaceAvatarSeed(next));
  };
  const stepExpression = (step: number) => {
    const index = Math.max(0, WORKSPACE_EXPRESSIONS.findIndex(([id]) => id === profileRef.current.expression));
    setTurn(t => t + step);
    update({ expression: WORKSPACE_EXPRESSIONS[wrap(index + step, WORKSPACE_EXPRESSIONS.length)][0] });
  };
  const stepShape = (step: number) => {
    const index = Math.max(0, WORKSPACE_SHAPES.findIndex(([id]) => id === profileRef.current.shape));
    update({ shape: WORKSPACE_SHAPES[wrap(index + step, WORKSPACE_SHAPES.length)][0] });
  };
  useSelectorWheel(orbit, stepExpression); useSelectorWheel(shapes, stepShape);
  const accessories = profile.accessories ?? NO_AVATAR_ACCESSORIES;
  const setAccessory = (slot: keyof AvatarAccessories, value: string) => update({ accessories: { ...accessories, [slot]: value } });
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
    <button type="button" className="aw-appearance__all-shapes" aria-expanded={allShapes} onClick={() => setAllShapes(value => !value)}>{allShapes ? '收起造型' : '全部造型 · 24'}</button>
    {allShapes && <div className="aw-appearance__shape-grid" role="group" aria-label="全部头像造型">{WORKSPACE_SHAPES.map(([shape, label]) => <button key={shape} type="button" aria-label={`选择${label}造型`} aria-pressed={shape === profile.shape} onClick={() => { update({ shape }); setAllShapes(false); }}><AgentWorkspaceAvatar name={label} avatar={workspaceAvatarSeed({ ...profile, shape })} size={45} silhouette /><span>{label}</span></button>)}</div>}
    <div className="collab-editor__colors" role="group" aria-label="头像颜色">{COLORS.map(([color, label]) => <button key={color} type="button" aria-label={label} title={label} aria-pressed={profile.color.toLowerCase() === color} style={{ '--swatch-color': color } as CSSProperties} onClick={() => update({ color })} />)}<label className="aw-custom-color" title="自定义头像颜色"><input type="color" aria-label="自定义头像颜色" value={profile.color} onChange={event => update({ color: event.target.value })} /></label></div>
    <div className="collab-editor__preview-label">悬停滚轮切换 · 表情与工作状态沿用当前设置</div>
    <section className="aw-accessories" aria-label="头像配饰">
      <header><strong>配饰</strong><button type="button" disabled={Object.values(accessories).every(value => value === 'none')} onClick={() => update({ accessories: { ...NO_AVATAR_ACCESSORIES } })}>全部移除</button></header>
      {([['head', '头部', AVATAR_HEADWEAR], ['eyes', '眼镜', AVATAR_EYEWEAR], ['neck', '颈部', AVATAR_NECKWEAR]] as const).map(([slot, label, options]) => <div key={slot} className="aw-accessories__row">
        <span>{label}</span><div role="group" aria-label={`${label}配饰`}>{options.map(([id, title]) => <button key={id} type="button" title={title} aria-label={title} aria-pressed={accessories[slot] === id} onClick={() => setAccessory(slot, id)}>{title}</button>)}</div>
      </div>)}
      <p>可跨位置搭配；更换配饰不会改变表情。</p>
    </section>
  </div>;
}
