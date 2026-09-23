import { describe, expect, it, vi } from 'vitest';
import { LocalSkillWatchRegistry } from './local-skill-watch-registry.js';

describe('LocalSkillWatchRegistry', () => {
  it('registers and reports active watched directories', () => {
    const registry = new LocalSkillWatchRegistry();

    expect(registry.add('D:/workspace/.agents/skills', vi.fn())).toBe(true);

    expect(registry.isActive()).toBe(true);
    expect(registry.isWatching('D:/workspace/.agents/skills')).toBe(true);
    expect(registry.count()).toBe(1);
  });

  it('normalizes directory case when deduplicating watchers', () => {
    const registry = new LocalSkillWatchRegistry();

    expect(registry.add('D:/Workspace/Skills', vi.fn())).toBe(true);
    expect(registry.add('d:/workspace/skills', vi.fn())).toBe(false);
    expect(registry.isWatching('D:/WORKSPACE/SKILLS')).toBe(true);
    expect(registry.count()).toBe(1);
  });

  it('rejects empty directory registrations', () => {
    const registry = new LocalSkillWatchRegistry();

    expect(registry.add('   ', vi.fn())).toBe(false);
    expect(registry.isActive()).toBe(false);
  });

  it('stops each watcher exactly once and clears ownership first', () => {
    const registry = new LocalSkillWatchRegistry();
    const first = vi.fn(() => expect(registry.isActive()).toBe(false));
    const second = vi.fn();
    registry.add('D:/first', first);
    registry.add('D:/second', second);

    registry.stopAll();
    registry.stopAll();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(registry.count()).toBe(0);
  });

  it('continues cleanup after an earlier watcher throws', () => {
    const registry = new LocalSkillWatchRegistry();
    const failure = new Error('watch cleanup failed');
    const second = vi.fn();
    registry.add('D:/first', () => {
      throw failure;
    });
    registry.add('D:/second', second);

    expect(() => registry.stopAll()).toThrow(failure);
    expect(second).toHaveBeenCalledTimes(1);
    expect(registry.isActive()).toBe(false);
  });
});
