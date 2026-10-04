/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyTerminalBridge } from '../../terminal-pty-contract.js';
import { KeepAliveLayer } from './KeepAliveLayer.js';
import { TerminalPane } from './TerminalPane.js';

const state = {
  size: { cols: 100, rows: 30 },
  area: { width: 800, height: 400 },
  observers: [] as Array<() => void>,
};
class FakeTerminal {
  static instances: FakeTerminal[] = [];
  open = vi.fn(); write = vi.fn(); writeln = vi.fn(); focus = vi.fn();
  dispose = vi.fn(); clear = vi.fn(); reset = vi.fn(); resize = vi.fn();
  loadAddon = vi.fn(); onData = vi.fn(() => ({ dispose: vi.fn() }));
  constructor() { FakeTerminal.instances.push(this); }
}
class FakeFitAddon {
  static instances: FakeFitAddon[] = [];
  fit = vi.fn();
  proposeDimensions = vi.fn(() => ({ ...state.size }));
  constructor() { FakeFitAddon.instances.push(this); }
}
vi.mock('./xterm-vendor-loader.js', () => ({
  loadXtermVendor: vi.fn(async () => ({ Terminal: FakeTerminal, FitAddon: FakeFitAddon })),
}));

let bridge: PtyTerminalBridge;
const flush = async (ms = 200) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const observe = () => { for (const callback of state.observers) callback(); };

beforeEach(() => {
  state.size = { cols: 100, rows: 30 }; state.area = { width: 800, height: 400 }; state.observers = [];
  FakeTerminal.instances = []; FakeFitAddon.instances = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => state.area.width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => state.area.height);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { state.observers.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
  bridge = {
    create: vi.fn(async () => ({ success: true, sessionId: 'resize-pane', created: true })),
    exists: vi.fn(async () => false), getBuffer: vi.fn(async () => ''),
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(async () => undefined), list: vi.fn(async () => []),
    onData: vi.fn(() => () => undefined), onExit: vi.fn(() => () => undefined),
  };
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { terminal: bridge } });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('TerminalPane resize lifecycle', () => {
  it.each([0, -1, NaN, Infinity, 1.5, 32768])('creates with defaults rather than invalid FitAddon dimension %s', async value => {
    state.size = { cols: value, rows: value };
    render(<TerminalPane terminalId="resize-pane" cwd="/" />);
    await flush();
    expect(bridge.create).toHaveBeenCalledWith(expect.objectContaining({ cols: 80, rows: 24 }));
    expect(bridge.resize).not.toHaveBeenCalled();
    expect(FakeFitAddon.instances[0]?.fit).not.toHaveBeenCalled();
  });

  it('does not fit or report sizes while the terminal has zero layout area', async () => {
    render(<TerminalPane terminalId="resize-pane" cwd="/" />); await flush();
    vi.mocked(bridge.resize).mockClear(); const fit = FakeFitAddon.instances[0]!.fit; fit.mockClear();
    state.area = { width: 0, height: 0 }; state.size = { cols: NaN, rows: NaN };
    observe(); await flush();
    expect(fit).not.toHaveBeenCalled(); expect(bridge.resize).not.toHaveBeenCalled();
    state.area = { width: 800, height: 400 }; state.size = { cols: 120, rows: 32 };
    observe(); await flush();
    expect(bridge.resize).toHaveBeenCalledWith('resize-pane', 120, 32);
  });

  it('cancels queued resize on tab deactivation and refits on activation without recreating the PTY', async () => {
    const view = render(<TerminalPane terminalId="resize-pane" cwd="/" active />); await flush();
    vi.mocked(bridge.resize).mockClear(); const terminal = FakeTerminal.instances[0]!; const focusCount = terminal.focus.mock.calls.length;
    state.size = { cols: 120, rows: 32 }; observe();
    view.rerender(<TerminalPane terminalId="resize-pane" cwd="/" active={false} />); await flush();
    expect(bridge.resize).not.toHaveBeenCalled(); expect(terminal.focus).toHaveBeenCalledTimes(focusCount);
    view.rerender(<TerminalPane terminalId="resize-pane" cwd="/" active />); await flush();
    expect(bridge.resize).toHaveBeenCalledWith('resize-pane', 120, 32);
    expect(bridge.create).toHaveBeenCalledTimes(1); expect(FakeTerminal.instances).toHaveLength(1);
  });

  it.each([false, true])('respects live KeepAlive activity even with frozen child props (preserveLayout=%s)', async preserveLayout => {
    const frame = (active: boolean) => <KeepAliveLayer active={active} preserveLayout={preserveLayout}><TerminalPane terminalId="resize-pane" cwd="/" active /></KeepAliveLayer>;
    const view = render(frame(true)); await flush(); vi.mocked(bridge.resize).mockClear();
    const fit = FakeFitAddon.instances[0]!.fit; fit.mockClear();
    view.rerender(frame(false)); state.size = { cols: 120, rows: 32 }; observe(); await flush();
    expect(fit).not.toHaveBeenCalled(); expect(bridge.resize).not.toHaveBeenCalled();
    view.rerender(frame(true)); await flush();
    expect(bridge.resize).toHaveBeenCalledWith('resize-pane', 120, 32);
    expect(bridge.create).toHaveBeenCalledTimes(1);
  });

  it('does not cache a resize discarded after its container was hidden', async () => {
    render(<TerminalPane terminalId="resize-pane" cwd="/" />); await flush(); vi.mocked(bridge.resize).mockClear();
    state.size = { cols: 120, rows: 32 }; observe(); state.area = { width: 0, height: 0 }; await flush();
    expect(bridge.resize).not.toHaveBeenCalled();
    state.area = { width: 800, height: 400 }; observe(); await flush();
    expect(bridge.resize).toHaveBeenCalledTimes(1);
    expect(bridge.resize).toHaveBeenCalledWith('resize-pane', 120, 32);
  });

  it('waits for PTY creation and measures the restored container instead of sending a stale deferred size', async () => {
    let complete: (result: { success: true; sessionId: string; created: boolean }) => void = () => undefined;
    vi.mocked(bridge.create).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    render(<TerminalPane terminalId="resize-pane" cwd="/" />); await flush();
    state.size = { cols: 120, rows: 32 }; observe(); await flush();
    expect(bridge.resize).not.toHaveBeenCalled();
    state.area = { width: 0, height: 0 };
    await act(async () => { complete({ success: true, sessionId: 'resize-pane', created: true }); }); await flush();
    expect(bridge.resize).not.toHaveBeenCalled();
    state.area = { width: 800, height: 400 }; state.size = { cols: 140, rows: 40 }; observe(); await flush();
    expect(bridge.resize).toHaveBeenCalledWith('resize-pane', 140, 40);
  });

  it('disposes pending resize callbacks on unmount', async () => {
    const view = render(<TerminalPane terminalId="resize-pane" cwd="/" />); await flush(); vi.mocked(bridge.resize).mockClear();
    state.size = { cols: 120, rows: 32 }; observe(); view.unmount(); await flush();
    expect(bridge.resize).not.toHaveBeenCalled(); expect(FakeTerminal.instances[0]?.dispose).toHaveBeenCalledOnce();
  });
});
