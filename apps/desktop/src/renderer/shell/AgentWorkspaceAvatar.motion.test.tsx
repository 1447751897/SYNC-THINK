/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';
import { KeepAliveLayer } from './KeepAliveLayer.js';

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let observeVisibility: (entries: { isIntersecting: boolean }[]) => void;
const context = Object.fromEntries(['setTransform', 'clearRect', 'save', 'restore', 'translate', 'rotate', 'scale', 'fill', 'clip', 'fillRect', 'beginPath', 'moveTo', 'quadraticCurveTo', 'lineTo', 'closePath', 'stroke', 'ellipse'].map(name => [name, vi.fn()]));
beforeEach(() => {
  frames.clear(); frameId = 0; Object.values(context).forEach(fn => { if (vi.isMockFunction(fn)) fn.mockClear(); });
  vi.stubGlobal('Path2D', class {});
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof observeVisibility) { observeVisibility = callback; } observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  document.documentElement.removeAttribute('data-reduced-motion');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-reduced-motion'); Reflect.deleteProperty(document, 'hidden'); });
const face = <AgentWorkspaceAvatar name="小美" avatar="bot:v1:star:cyan" animate size={34} />;
function frame(time: number) { const [id, callback] = [...frames][0]; frames.delete(id); callback(time); }
it('animates an idle sidebar face and changes its drawn pose over time', () => {
  render(face);
  expect(frames.size).toBe(1);
  act(() => { frame(100); frame(240); });
  expect(context.rotate.mock.calls.at(-1)).not.toEqual(context.rotate.mock.calls.at(-2));
});
it('pauses offscreen avatars and resumes them when visible', () => {
  render(face); act(() => observeVisibility([{ isIntersecting: false }]));
  expect(frames.size).toBe(0);
  act(() => observeVisibility([{ isIntersecting: true }])); expect(frames.size).toBe(1);
});
it('stops idle animation when the workspace becomes inactive', () => {
  const view = render(<KeepAliveLayer active>{face}</KeepAliveLayer>);
  expect(frames.size).toBe(1); view.rerender(<KeepAliveLayer active={false}>{face}</KeepAliveLayer>);
  expect(frames.size).toBe(0);
});
it('honours reduced motion without hiding the avatar', async () => {
  const view = render(face);
  act(() => document.documentElement.setAttribute('data-reduced-motion', 'true'));
  await waitFor(() => expect(frames.size).toBe(0));
  expect(view.getByRole('img', { name: '小美' })).toBeTruthy();
});

it('labels execution motion separately from idle roaming', () => {
  const view = render(<AgentWorkspaceAvatar name="小美" avatar="aw:v1:drop:#55aadd:idle" animate size={34} />);
  expect(view.getByRole('img', { name: '小美' }).getAttribute('data-motion')).toBe('idle');
  view.rerender(<AgentWorkspaceAvatar name="小美" avatar="aw:v1:drop:#55aadd:idle" state="working" animate size={34} />);
  expect(view.getByRole('img', { name: '小美' }).getAttribute('data-motion')).toBe('working');
});

it('glances and breathes without a full-turn somersault', () => {
  render(face);
  for (let time = 40; time <= 9000; time += 80) {
    if (!frames.size) break;
    act(() => frame(time));
  }
  const turns = context.rotate.mock.calls.map(([angle]) => Math.abs(Number(angle)));
  expect(turns.length).toBeGreaterThan(8);
  expect(Math.max(...turns)).toBeLessThan(0.3);
});
