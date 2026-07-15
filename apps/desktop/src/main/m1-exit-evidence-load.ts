/**
 * Main-process M1 exit-evidence loader helpers.
 * Never writes handtest checkboxes; never includes secrets.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  scoreDogfoodDiary,
  type DogfoodDayKind,
} from '../m1-dogfood-score.js';

export type { DogfoodDayKind };

export interface DogfoodDayReport {
  /** YYYY-MM-DD from filename */
  date: string;
  kind: DogfoodDayKind;
  pendingCount: number;
  checkedCount: number;
  filledSignals: number;
  /** Basename only for UI */
  fileName: string;
  /** True when content looks like paste-assist draft. */
  isPasteAssist: boolean;
  /** Short reasons for observability. */
  reasons: string[];
  /** One-line status from scorer. */
  statusHint: string;
}

export {
  countMarkdownTaskBoxes,
  countDogfoodPendingMarkers,
  looksLikeDogfoodPasteAssist,
  scoreDogfoodDiary,
} from '../m1-dogfood-score.js';

export function listDogfoodDayReports(dogfoodDir: string): {
  dogfoodFileCount: number;
  dogfoodRealDays: number;
  days: DogfoodDayReport[];
} {
  const days: DogfoodDayReport[] = [];
  if (!fs.existsSync(dogfoodDir)) {
    return { dogfoodFileCount: 0, dogfoodRealDays: 0, days: [] };
  }
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(dogfoodDir)
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/i.test(n))
      .sort();
  } catch {
    return { dogfoodFileCount: 0, dogfoodRealDays: 0, days: [] };
  }

  let dogfoodRealDays = 0;
  for (const name of names) {
    const date = name.replace(/\.md$/i, '');
    let body = '';
    try {
      body = fs.readFileSync(path.join(dogfoodDir, name), 'utf8');
    } catch {
      days.push({
        date,
        kind: 'scaffold',
        pendingCount: 0,
        checkedCount: 0,
        filledSignals: 0,
        fileName: name,
        isPasteAssist: false,
        reasons: ['无法读取'],
        statusHint: '脚手架 · 读失败',
      });
      continue;
    }
    const scored = scoreDogfoodDiary(body);
    if (!scored.isScaffold) dogfoodRealDays += 1;
    days.push({
      date,
      kind: scored.isScaffold ? 'scaffold' : 'real',
      pendingCount: scored.pendingCount,
      checkedCount: scored.checkedCount,
      filledSignals: scored.filledSignals,
      fileName: name,
      isPasteAssist: scored.isPasteAssist,
      reasons: scored.reasons,
      statusHint: scored.statusHint,
    });
  }

  return {
    dogfoodFileCount: days.length,
    dogfoodRealDays,
    days,
  };
}
