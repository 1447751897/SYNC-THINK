/**
 * Allowlisted M1 evidence docs opener — main process only.
 * Never accepts arbitrary paths from renderer.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type M1OpenDocId =
  | 'handtest'
  | 'dogfood'
  | 'dogfood-today'
  | 'dogfood-template'
  | 'dogfood-day';

function defaultDocsCandidates(): string[] {
  const list = [
    path.resolve(__dirname, '../../../../docs/development'),
    path.resolve(process.cwd(), 'docs/development'),
    path.resolve(process.cwd(), '../../docs/development'),
  ];
  try {
    // Lazy: vitest unit tests never call this path without candidates.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    list.push(
      path.resolve(app.getAppPath(), 'docs/development'),
      path.resolve(app.getAppPath(), '../../docs/development'),
    );
  } catch {
    /* electron unavailable in unit tests */
  }
  return list;
}

export function resolveDocsDevelopmentDir(
  candidates?: readonly string[],
): string | null {
  const list = candidates ?? defaultDocsCandidates();
  for (const c of list) {
    try {
      if (fs.existsSync(path.join(c, '14-external-gateway-handtest.md'))) {
        return c;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function todayIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Allowlist YYYY-MM-DD only (no path segments). */
export function isValidDogfoodDayDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [ys, ms, ds] = value.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject path-like / traversal leftovers
  if (value.includes('..') || value.includes('/') || value.includes('\\')) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Map allowlisted id → absolute path under docs/development.
 * Returns null if docs root missing or target not found (except dogfood-today may create from template).
 */
export function resolveM1OpenDocPath(
  docsDev: string,
  id: M1OpenDocId,
  opts?: { today?: string; ensureTodayFromTemplate?: boolean; date?: string },
): { path: string; created: boolean } | null {
  const root = path.resolve(docsDev);
  if (!fs.existsSync(root)) return null;

  if (id === 'handtest') {
    const p = path.join(root, '14-external-gateway-handtest.md');
    return fs.existsSync(p) ? { path: p, created: false } : null;
  }

  if (id === 'dogfood-template') {
    const p = path.join(root, 'dogfood-template.md');
    return fs.existsSync(p) ? { path: p, created: false } : null;
  }

  if (id === 'dogfood') {
    const p = path.join(root, 'dogfood');
    return fs.existsSync(p) ? { path: p, created: false } : null;
  }

  if (id === 'dogfood-day') {
    const date = opts?.date ?? '';
    if (!isValidDogfoodDayDate(date)) return null;
    const dogfoodDir = path.join(root, 'dogfood');
    const target = path.join(dogfoodDir, `${date}.md`);
    // Must stay under dogfoodDir (defense in depth)
    const resolvedTarget = path.resolve(target);
    const resolvedDir = path.resolve(dogfoodDir) + path.sep;
    if (!resolvedTarget.startsWith(resolvedDir) && resolvedTarget !== path.resolve(dogfoodDir)) {
      return null;
    }
    return fs.existsSync(resolvedTarget)
      ? { path: resolvedTarget, created: false }
      : null;
  }

  if (id === 'dogfood-today') {
    const today = opts?.today ?? todayIsoDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
    const dogfoodDir = path.join(root, 'dogfood');
    const target = path.join(dogfoodDir, `${today}.md`);
    if (fs.existsSync(target)) return { path: target, created: false };
    if (!opts?.ensureTodayFromTemplate) {
      // Prefer existing latest diary or template
      if (fs.existsSync(dogfoodDir)) {
        try {
          const names = fs
            .readdirSync(dogfoodDir)
            .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/i.test(n))
            .sort();
          if (names.length > 0) {
            return {
              path: path.join(dogfoodDir, names[names.length - 1]!),
              created: false,
            };
          }
        } catch {
          /* fall through */
        }
      }
      const tmpl = path.join(root, 'dogfood-template.md');
      return fs.existsSync(tmpl) ? { path: tmpl, created: false } : null;
    }
    // Create today's file from template if missing
    try {
      if (!fs.existsSync(dogfoodDir)) fs.mkdirSync(dogfoodDir, { recursive: true });
      const tmpl = path.join(root, 'dogfood-template.md');
      let body = '';
      if (fs.existsSync(tmpl)) {
        body = fs.readFileSync(tmpl, 'utf8');
      } else {
        body =
          `# Dogfood · ${today}\n\n> 由桌面「下一步」创建的日记脚手架。请真实使用后填写；密钥勿入库。\n\n## 今天主要干了啥\n- [ ] 启动桌面端\n\n## Provider / 模型\n- Provider A：待填\n- Provider B：待填\n`;
      }
      // Light date stamp if template has placeholder title
      if (!body.includes(today)) {
        body = body.replace(/^#\s+Dogfood.*/m, `# Dogfood · ${today}`);
      }
      fs.writeFileSync(target, body, 'utf8');
      return { path: target, created: true };
    } catch {
      return null;
    }
  }

  return null;
}

export function isAllowedM1OpenDocId(value: unknown): value is M1OpenDocId {
  return (
    value === 'handtest' ||
    value === 'dogfood' ||
    value === 'dogfood-today' ||
    value === 'dogfood-template' ||
    value === 'dogfood-day'
  );
}
