// 浏览器 Profile 持久化（localStorage）单元测试。
import { describe, expect, it } from 'vitest';
import {
  BROWSER_PROFILES_KEY,
  createBrowserProfile,
  DEFAULT_BROWSER_PARTITION,
  deleteBrowserProfile,
  profilePartition,
  readBrowserProfiles,
  renameBrowserProfile,
  writeBrowserProfiles,
  type BrowserProfile,
} from '../src/renderer/browser-profiles.js';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  } as Storage;
}

describe('browser-profiles persistence', () => {
  it('returns empty list when nothing stored or JSON is corrupt', () => {
    expect(readBrowserProfiles(memoryStorage())).toEqual([]);
    expect(
      readBrowserProfiles(memoryStorage({ [BROWSER_PROFILES_KEY]: '{not json' })),
    ).toEqual([]);
    expect(
      readBrowserProfiles(memoryStorage({ [BROWSER_PROFILES_KEY]: '{"a":1}' })),
    ).toEqual([]);
  });

  it('round-trips profiles through write/read and drops malformed entries', () => {
    const s = memoryStorage();
    const list: BrowserProfile[] = [
      { id: 'a', name: '工作号', createdAt: 100 },
      { id: 'b', name: '小号', createdAt: 200 },
    ];
    writeBrowserProfiles(list, s);
    expect(readBrowserProfiles(s)).toEqual(list);

    // 混入脏数据：缺 id / 缺 name / 重复 id 都被丢弃。
    s.setItem(
      BROWSER_PROFILES_KEY,
      JSON.stringify([
        { id: 'a', name: '工作号', createdAt: 100 },
        { id: '', name: 'bad', createdAt: 1 },
        { id: 'c', name: '', createdAt: 1 },
        { id: 'a', name: '重复', createdAt: 1 },
        'not-an-object',
      ]),
    );
    expect(readBrowserProfiles(s)).toEqual([{ id: 'a', name: '工作号', createdAt: 100 }]);
  });

  it('createBrowserProfile trims, persists, and rejects empty names', () => {
    const s = memoryStorage();
    expect(createBrowserProfile('   ', s)).toBeNull();
    expect(readBrowserProfiles(s)).toEqual([]);

    const created = createBrowserProfile('  测试号  ', s);
    expect(created).not.toBeNull();
    expect(created!.name).toBe('测试号');
    expect(created!.id).toBeTruthy();
    expect(readBrowserProfiles(s)).toEqual([created]);

    const second = createBrowserProfile('第二个', s);
    expect(second!.id).not.toBe(created!.id);
    expect(readBrowserProfiles(s)).toHaveLength(2);
  });

  it('renameBrowserProfile updates only the target and ignores empty / unknown', () => {
    const s = memoryStorage();
    const a = createBrowserProfile('A', s)!;
    const b = createBrowserProfile('B', s)!;

    const renamed = renameBrowserProfile(a.id, ' A2 ', s);
    expect(renamed.find((p) => p.id === a.id)!.name).toBe('A2');
    expect(renamed.find((p) => p.id === b.id)!.name).toBe('B');
    expect(readBrowserProfiles(s).find((p) => p.id === a.id)!.name).toBe('A2');

    // 空名 / 未知 id：列表原样返回。
    expect(renameBrowserProfile(a.id, '   ', s).find((p) => p.id === a.id)!.name).toBe('A2');
    expect(renameBrowserProfile('nope', 'X', s)).toHaveLength(2);
  });

  it('deleteBrowserProfile removes the target and persists', () => {
    const s = memoryStorage();
    const a = createBrowserProfile('A', s)!;
    const b = createBrowserProfile('B', s)!;

    const next = deleteBrowserProfile(a.id, s);
    expect(next).toEqual([b]);
    expect(readBrowserProfiles(s)).toEqual([b]);

    // 未知 id：无副作用。
    expect(deleteBrowserProfile('nope', s)).toEqual([b]);
  });

  it('profilePartition maps default to the shared right-dock partition', () => {
    expect(profilePartition(null)).toBe(DEFAULT_BROWSER_PARTITION);
    expect(profilePartition(null)).toBe('persist:browser-panel');
    expect(profilePartition('')).toBe('persist:browser-panel');
    expect(profilePartition('abc')).toBe('persist:browser-profile-abc');
  });
});
