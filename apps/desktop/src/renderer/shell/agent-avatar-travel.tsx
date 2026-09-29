import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CollaborationMember } from '@sync-think/shared';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';

export interface AvatarFlight { id: string; name: string; avatar?: string; from: { x: number; y: number; width: number }; to: { x: number; y: number; width: number } }
export function captureAvatarTravel(from: HTMLElement | null, to: HTMLElement | null, members: readonly CollaborationMember[]): AvatarFlight[] {
  if (!from || !to || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.hasAttribute('data-reduced-motion')) return [];
  const starts = [...from.querySelectorAll<HTMLElement>('[data-avatar-id]')];
  const ends = [...to.querySelectorAll<HTMLElement>('[data-avatar-id]')];
  return starts.flatMap(element => {
    const id = element.dataset.avatarId;
    const member = members.find(m => m.id === id);
    const end = ends.find(e => e.dataset.avatarId === id);
    if (!member || !end) return [];
    const a = element.getBoundingClientRect();
    const b = end.getBoundingClientRect();
    if (!a.width || !b.width) return [];
    return [{ id: member.id, name: member.name, avatar: member.avatar, from: { x: a.x, y: a.y, width: a.width }, to: { x: b.x, y: b.y, width: b.width } }];
  });
}

/** Layout-derived first-send travel. No page/text transforms or persistent blur. */
export function AvatarTravel({ flights, onComplete }: { flights: readonly AvatarFlight[]; onComplete(): void }) {
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(onComplete);
  done.current = onComplete;
  useLayoutEffect(() => {
    let disposed = false;
    const animations: Animation[] = [];
    for (const [index, element] of [...(root.current?.children ?? [])].entries()) {
      const flight = flights[index];
      if (!(element instanceof HTMLElement) || !flight || !element.animate) continue;
      const x = flight.to.x - flight.from.x;
      const y = flight.to.y - flight.from.y;
      const scale = flight.to.width / flight.from.width;
      animations.push(element.animate([
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(${x * .45 + 36 + index * 12}px, ${y * .6 - 24}px) scale(.75)`, opacity: 1, offset: .55 },
        { transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity: 1, offset: .92 },
        { transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity: 0, offset: 1 },
      ], { duration: 650, delay: index * 70, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' }));
    }
    void Promise.all(animations.map(a => a.finished.catch(() => undefined))).then(() => { if (!disposed) done.current(); });
    return () => { disposed = true; animations.forEach(a => a.cancel()); };
  }, [flights]);
  return createPortal(<div ref={root} aria-hidden="true">{flights.map(f => <div key={f.id} className="aw-avatar-flight" style={{ left: f.from.x, top: f.from.y, transformOrigin: 'top left' }}><AgentWorkspaceAvatar name={f.name} avatar={f.avatar} size={f.from.width} /></div>)}</div>, document.body);
}