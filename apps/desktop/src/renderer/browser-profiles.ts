// 浏览器 Profile（多账号登录态隔离）。
// 每个 Profile 对应一个独立的 Electron webview partition —— 独立 Cookie /
// localStorage / 登录态。列表本身持久化在 renderer localStorage（同
// ui-preferences.ts 的模式：可注入 storage 便于单测，运行时兜底 window.localStorage）。

export interface BrowserProfile {
  id: string;
  name: string;
  createdAt: number;
}

export const BROWSER_PROFILES_KEY = 'sync-think.browserProfiles';

/** 右栏 BrowserPanel 沿用的默认 partition（「默认浏览器」与其共享登录态）。 */
export const DEFAULT_BROWSER_PARTITION = 'persist:browser-panel';

/**
 * Profile → webview partition。
 * null 表示「默认浏览器」——返回与右栏浏览器面板相同的 partition，
 * 因此默认 Profile 与应用内嵌浏览器共享 Cookie / 登录态。
 */
export function profilePartition(id: string | null): string {
  if (id === null || id.trim() === '') return DEFAULT_BROWSER_PARTITION;
  return `persist:browser-profile-${id}`;
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

function safeGet(key: string, storage?: ReadableStorage): string | null {
  try {
    if (storage) return storage.getItem(key);
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string, storage?: WritableStorage): void {
  try {
    if (storage) {
      storage.setItem(key, value);
      return;
    }
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

function parseProfile(raw: unknown): BrowserProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!id || !name) return null;
  const createdAt =
    typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
      ? record.createdAt
      : 0;
  return { id, name, createdAt };
}

export function readBrowserProfiles(storage?: ReadableStorage): BrowserProfile[] {
  const raw = safeGet(BROWSER_PROFILES_KEY, storage);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const result: BrowserProfile[] = [];
  for (const item of parsed) {
    const profile = parseProfile(item);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    result.push(profile);
  }
  return result;
}

export function writeBrowserProfiles(
  list: readonly BrowserProfile[],
  storage?: WritableStorage,
): void {
  safeSet(BROWSER_PROFILES_KEY, JSON.stringify(list), storage);
}

function generateProfileId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 创建 Profile 并写回持久化列表。
 * 返回新 Profile；名称为空时返回 null（不写入）。
 */
export function createBrowserProfile(
  name: string,
  storage?: ReadableStorage & WritableStorage,
): BrowserProfile | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const profile: BrowserProfile = {
    id: generateProfileId(),
    name: trimmed,
    createdAt: Date.now(),
  };
  writeBrowserProfiles([...readBrowserProfiles(storage), profile], storage);
  return profile;
}

/** 重命名 Profile。空名称或未知 id 时不修改。返回更新后的列表。 */
export function renameBrowserProfile(
  id: string,
  name: string,
  storage?: ReadableStorage & WritableStorage,
): BrowserProfile[] {
  const trimmed = name.trim();
  const current = readBrowserProfiles(storage);
  if (!trimmed || !current.some((p) => p.id === id)) return current;
  const next = current.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
  writeBrowserProfiles(next, storage);
  return next;
}

/**
 * 删除 Profile（仅从列表移除；其 partition 数据由 Electron 保留在磁盘上，
 * 不在 renderer 侧清理）。返回更新后的列表。
 */
export function deleteBrowserProfile(
  id: string,
  storage?: ReadableStorage & WritableStorage,
): BrowserProfile[] {
  const current = readBrowserProfiles(storage);
  const next = current.filter((p) => p.id !== id);
  if (next.length !== current.length) writeBrowserProfiles(next, storage);
  return next;
}
