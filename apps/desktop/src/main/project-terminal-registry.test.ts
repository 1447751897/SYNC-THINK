import { describe, expect, it } from 'vitest';
import { ProjectTerminalRegistry } from './project-terminal-registry.js';

interface CommandFixture {
  commandId: string;
}

describe('ProjectTerminalRegistry', () => {
  it('atomically reserves one start per sender and terminal before async validation', () => {
    const registry = new ProjectTerminalRegistry<CommandFixture>();
    const first = registry.reserve(7, 'terminal-1');

    expect(first).toBeDefined();
    expect(registry.reserve(7, 'terminal-1')).toBeUndefined();
    expect(registry.reserve(8, 'terminal-1')).toBeDefined();
  });

  it('prevents activation after the sender is destroyed during validation', () => {
    const registry = new ProjectTerminalRegistry<CommandFixture>();
    const reservation = registry.reserve(7, 'terminal-1')!;

    registry.abortForSender(7);

    expect(reservation.controller.signal.aborted).toBe(true);
    expect(registry.activate(reservation, { commandId: 'command-1' })).toBe(false);
    registry.release(reservation);
    expect(registry.has(7, 'terminal-1')).toBe(false);
  });

  it('cancels only the active command identity and ignores stale release calls', () => {
    const registry = new ProjectTerminalRegistry<CommandFixture>();
    const first = registry.reserve(7, 'terminal-1')!;
    expect(registry.activate(first, { commandId: 'command-1' })).toBe(true);
    expect(registry.cancel(7, 'terminal-1', 'stale-command')).toBe(false);
    expect(registry.cancel(7, 'terminal-1', 'command-1')).toBe(true);

    registry.release(first);
    const second = registry.reserve(7, 'terminal-1')!;
    registry.release(first);
    expect(registry.has(7, 'terminal-1')).toBe(true);
    registry.release(second);
  });
});
