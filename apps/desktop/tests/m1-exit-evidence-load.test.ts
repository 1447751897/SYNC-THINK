import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  listDogfoodDayReports,
  scoreDogfoodDiary,
} from '../src/main/m1-exit-evidence-load.js';

function tmpDogfood(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-dogfood-'));
  return root;
}

describe('listDogfoodDayReports', () => {
  it('classifies scaffold vs real diaries', () => {
    const dir = tmpDogfood();
    fs.writeFileSync(
      path.join(dir, '2026-07-12.md'),
      '# Dogfood · 2026-07-12（脚手架）\n待填\n待填\n待填\n待填\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, '2026-07-13.md'),
      '# Dogfood · 2026-07-13\n- [x] 启动桌面端\n- [x] 发送一轮\nProvider A：openai 已连接\n是否愿意继续：是\n',
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'README.md'), 'ignore me', 'utf8');
    const r = listDogfoodDayReports(dir);
    expect(r.dogfoodFileCount).toBe(2);
    expect(r.dogfoodRealDays).toBe(1);
    expect(r.days.map((d) => d.kind)).toEqual(['scaffold', 'real']);
    expect(r.days[0]!.date).toBe('2026-07-12');
    expect(r.days[0]!.isPasteAssist).toBe(false);
    expect(r.days[0]!.reasons.length).toBeGreaterThan(0);
    expect(r.days[1]!.statusHint).toMatch(/有效/);
  });

  it('returns zeros for missing dir', () => {
    const r = listDogfoodDayReports(path.join(os.tmpdir(), 'no-such-dogfood-dir-xyz'));
    expect(r).toEqual({ dogfoodFileCount: 0, dogfoodRealDays: 0, days: [] });
  });
});

describe('scoreDogfoodDiary (main)', () => {
  it('flags scaffold banners', () => {
    const r = scoreDogfoodDiary('脚手架\n待填\n待填\n待填\n待填');
    expect(r.isScaffold).toBe(true);
  });

  it('flags paste-assist copy draft', () => {
    const r = scoreDogfoodDiary(
      '# Dogfood · 2026-07-12\n> 由桌面「复制 dogfood 草稿」生成 · **粘贴辅助**。\n- [x] Runtime\n- 待你确认\n- 待你确认\n- 待你确认\n- 待你确认\n',
    );
    expect(r.isScaffold).toBe(true);
    expect(r.isPasteAssist).toBe(true);
  });
});
