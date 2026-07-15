/**
 * M1 soft regression matrix — auto suite vs handtest hard gates.
 * Soft assist only: never auto-checks handtest docs, never closes M1, never includes secrets.
 */
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

export type M1RegressionCell = 'pass' | 'fail' | 'pending' | 'external' | 'na' | 'soft';

export type M1RegressionArea =
  | 'runtime'
  | 'providers'
  | 'conversation'
  | 'fallback'
  | 'security'
  | 'handtest-doc'
  | 'dogfood'
  | 'suite';

export interface M1SoftRegressionRow {
  id: string;
  area: M1RegressionArea;
  /** Short Chinese label. */
  label: string;
  /** Automated / local soft evidence status. */
  auto: M1RegressionCell;
  /** Human / external handtest status. */
  hand: M1RegressionCell;
  /** One-line note (no secrets). */
  note: string;
}

export interface M1SoftRegressionSuiteResult {
  id: string;
  label: string;
  ok: boolean;
  detail?: string | null;
}

export interface M1SoftRegressionMatrixInput {
  generatedAt?: string;
  connectionState?: string;
  dualAutomatedOk: boolean;
  /** Optional per-suite results from local runner / known pack. */
  suiteResults?: readonly M1SoftRegressionSuiteResult[];
  handtestLivePass: number;
  handtestLiveTotal: number;
  handtestSoftLiveAllPass: boolean;
  handtestExternalPending: number;
  handtestDocChecked: number;
  handtestDocTotal: number;
  dogfoodRealDays: number;
  dogfoodRequired?: number;
  dogfoodFileCount: number;
  dogfoodDraftDays?: number;
  providersReadySoft: boolean;
  providerCount: number;
  modelCount: number;
  secretCount: number;
  agentDefaultSet: boolean;
  agentFallbackCount: number;
  sessionLevel: string;
  exitLevel: string;
  hardGatesMet: boolean;
  distinctMessageModelCount?: number;
  hasTraceEvents?: boolean;
  manifestCount?: number;
  streamFailureRecoveryReady?: boolean;
  softCraftRound?: number;
}

export interface M1SoftRegressionMatrix {
  rows: M1SoftRegressionRow[];
  markdown: string;
  summary: string;
  charCount: number;
  autoPass: number;
  autoTotal: number;
  handGaps: number;
  externalGaps: number;
  /** Always false — matrix is assist only. */
  claimsM1Closed: false;
  claimsDocChecked: false;
}

function ynCell(ok: boolean): M1RegressionCell {
  return ok ? 'pass' : 'fail';
}

function cellMark(c: M1RegressionCell): string {
  switch (c) {
    case 'pass':
      return '\u2705';
    case 'fail':
      return '\u274c';
    case 'soft':
      return '\ud83d\udfe2 soft';
    case 'external':
      return '\ud83c\udf10 \u5f85\u5916\u7f51';
    case 'pending':
      return '\u23f3 \u5f85\u8bc1';
    case 'na':
    default:
      return '\u2014';
  }
}

function cellText(c: M1RegressionCell): string {
  switch (c) {
    case 'pass':
      return '\u901a\u8fc7';
    case 'fail':
      return '\u672a\u8fc7';
    case 'soft':
      return 'soft \u7eff';
    case 'external':
      return '\u5916\u7f51\u5f85\u8bc1';
    case 'pending':
      return '\u5f85\u8bc1';
    case 'na':
    default:
      return '\u4e0d\u9002\u7528';
  }
}

/**
 * Pure: build auto-vs-handtest regression rows from soft state + optional suite results.
 */
export function projectM1SoftRegressionMatrix(
  input: M1SoftRegressionMatrixInput,
): M1SoftRegressionRow[] {
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const docTotal = Math.max(0, input.handtestDocTotal | 0 || 18);
  const docChecked = Math.max(0, input.handtestDocChecked | 0);
  const liveTotal = Math.max(0, input.handtestLiveTotal | 0);
  const livePass = Math.max(0, input.handtestLivePass | 0);
  const externalPending = Math.max(0, input.handtestExternalPending | 0);
  const dogfoodReal = Math.max(0, input.dogfoodRealDays | 0);
  const draftDays = Math.max(0, input.dogfoodDraftDays ?? 0);
  const models = Math.max(0, input.distinctMessageModelCount ?? 0);
  const suite = Array.isArray(input.suiteResults) ? input.suiteResults : [];

  const rows: M1SoftRegressionRow[] = [
    {
      id: 'suite-dual',
      area: 'suite',
      label: '\u672c\u5730 dual \u7f51\u5173\u81ea\u52a8\u5316',
      auto: ynCell(Boolean(input.dualAutomatedOk)),
      hand: 'external',
      note: input.dualAutomatedOk
        ? '\u672c\u673a\u5047\u7f51\u5173\u7eff \u00b7 \u4e0d\u80fd\u66ff\u4ee3\u5916\u7f51\u624b\u6d4b'
        : 'dual \u81ea\u52a8\u5316\u672a\u7eff \u00b7 \u5148\u4fee\u672c\u5730\u518d\u8c08\u5916\u7f51',
    },
    {
      id: 'runtime-online',
      area: 'runtime',
      label: 'Runtime \u8fde\u63a5',
      auto:
        input.connectionState === 'online' ? 'pass' : input.connectionState ? 'fail' : 'pending',
      hand: input.connectionState === 'online' ? 'soft' : 'pending',
      note: '\u8fde\u63a5\u6001 ' + (input.connectionState || '\u2014'),
    },
    {
      id: 'providers-soft',
      area: 'providers',
      label:
        '\u591a\u6a21\u578b soft \u95e8\u69db\uff08\u22652 \u7aef\u70b9 \u00b7 \u22653 \u6a21\u578b\uff09',
      auto: ynCell(
        Boolean(input.providersReadySoft) && input.providerCount >= 2 && input.modelCount >= 3,
      ),
      hand: input.providersReadySoft ? 'soft' : 'pending',
      note:
        'P' +
        input.providerCount +
        ' \u00b7 M' +
        input.modelCount +
        ' \u00b7 \u5bc6\u94a5\u8ba1\u6570 ' +
        input.secretCount,
    },
    {
      id: 'agent-bind',
      area: 'fallback',
      label: 'Agent \u9ed8\u8ba4 + Fallback \u914d\u7f6e',
      auto: ynCell(Boolean(input.agentDefaultSet)),
      hand: input.agentFallbackCount > 0 ? 'soft' : 'pending',
      note: input.agentDefaultSet
        ? '\u9ed8\u8ba4\u5df2\u8bbe \u00b7 Fallback ' + (input.agentFallbackCount | 0)
        : '\u5c1a\u672a\u8bbe\u5b9a\u9ed8\u8ba4\u6a21\u578b',
    },
    {
      id: 'conversation-soft',
      area: 'conversation',
      label: '\u540c\u4efb\u52a1\u591a\u6a21\u578b\u6d88\u606f / Trace / Manifest',
      auto:
        models >= 3 && input.hasTraceEvents && (input.manifestCount ?? 0) > 0
          ? 'pass'
          : models > 0 || input.hasTraceEvents
            ? 'soft'
            : 'pending',
      hand: models >= 3 ? 'soft' : 'external',
      note:
        '\u6d88\u606f\u6a21\u578b\u79cd ' +
        models +
        ' \u00b7 \u8f68\u8ff9 ' +
        (input.hasTraceEvents ? '\u6709' : '\u65e0') +
        ' \u00b7 Manifest ' +
        (input.manifestCount ?? 0),
    },
    {
      id: 'fallback-external',
      area: 'fallback',
      label: '\u4e3b\u6a21\u578b\u5931\u8d25\u8d70 Fallback\uff08\u5916\u7f51\uff09',
      auto: 'na',
      hand: 'external',
      note: '\u9700\u6545\u610f\u9650\u6d41/\u9519\u5bc6\u94a5 \u00b7 \u672c\u673a dual \u4e0d\u80fd\u7b97\u8fc7',
    },
    {
      id: 'stream-failure-cta',
      area: 'conversation',
      label: '\u751f\u6210\u5931\u8d25\u6062\u590d CTA\uff08soft\uff09',
      auto:
        input.streamFailureRecoveryReady === false
          ? 'fail'
          : input.streamFailureRecoveryReady === true
            ? 'pass'
            : 'soft',
      hand: 'na',
      note: '\u5206\u7c7b + \u6253\u7801 + \u6062\u590d\u6309\u94ae \u00b7 \u4e0d\u81ea\u52a8\u91cd\u53d1',
    },
    {
      id: 'security-scrub',
      area: 'security',
      label: '\u5bc6\u94a5\u4e0d\u8fdb\u5feb\u7167/\u526a\u8d34\u677f\u683c\u5f0f',
      auto: 'soft',
      hand: 'external',
      note: 'soft \u6709 scrub \u5355\u6d4b\uff1b\u5916\u7f51\u4ecd\u9700\u76ee\u89c6\u65e5\u5fd7',
    },
    {
      id: 'handtest-live',
      area: 'handtest-doc',
      label: '\u624b\u6d4b\u5bf9\u7167 \u00b7 \u672c\u673a\u53ef\u6838\u9879',
      auto: liveTotal > 0 && livePass === liveTotal ? 'pass' : livePass > 0 ? 'soft' : 'pending',
      hand: liveTotal > 0 && livePass === liveTotal ? 'soft' : 'pending',
      note:
        livePass +
        '/' +
        liveTotal +
        ' \u00b7 soft \u5168\u6ee1 ' +
        (input.handtestSoftLiveAllPass ? '\u662f' : '\u5426'),
    },
    {
      id: 'handtest-external',
      area: 'handtest-doc',
      label: '\u624b\u6d4b\u5bf9\u7167 \u00b7 \u5916\u7f51\u5f85\u8bc1\u9879',
      auto: 'na',
      hand: externalPending > 0 ? 'external' : docChecked >= docTotal ? 'pass' : 'pending',
      note:
        '\u5916\u7f51\u5f85\u8bc1 ' +
        externalPending +
        ' \u00b7 \u6587\u6863\u52fe\u9009 ' +
        docChecked +
        '/' +
        (docTotal || 18),
    },
    {
      id: 'handtest-doc',
      area: 'handtest-doc',
      label: '\u624b\u6d4b\u6587\u6863 14-\u2026handtest.md \u52fe\u9009',
      auto: 'na',
      hand:
        docChecked >= docTotal && docTotal > 0 ? 'pass' : docChecked > 0 ? 'pending' : 'external',
      note:
        docChecked +
        '/' +
        (docTotal || 18) +
        ' \u00b7 \u771f\u6e90\u5728\u6587\u6863\uff0cUI \u4e0d\u81ea\u52a8\u52fe',
    },
    {
      id: 'dogfood',
      area: 'dogfood',
      label: `dogfood \u771f\u5b9e\u65e5\u8bb0 \u2265${dogfoodRequired} \u5929`,
      auto: 'na',
      hand: dogfoodReal >= dogfoodRequired ? 'pass' : dogfoodReal > 0 ? 'pending' : 'external',
      note:
        '\u6709\u6548 ' +
        dogfoodReal +
        '/' +
        dogfoodRequired +
        ' \u00b7 \u6587\u4ef6 ' +
        (input.dogfoodFileCount | 0) +
        (draftDays ? ' \u00b7 \u8349\u7a3f ' + draftDays : ''),
    },
    {
      id: 'exit-level',
      area: 'handtest-doc',
      label: '\u9000\u51fa\u8bc1\u636e level / \u786c\u95e8\u69db',
      auto:
        input.sessionLevel === 'ready' ||
        input.exitLevel === 'soft-only' ||
        input.exitLevel === 'evidence-ready'
          ? 'soft'
          : 'pending',
      hand: input.hardGatesMet ? 'pass' : 'external',
      note:
        'session ' +
        input.sessionLevel +
        ' \u00b7 exit ' +
        input.exitLevel +
        ' \u00b7 \u786c\u95e8\u69db ' +
        (input.hardGatesMet
          ? '\u9f50\uff08\u4ecd\u987b\u4eba\u5de5\u5173 M1\uff09'
          : '\u672a\u9f50'),
    },
  ];

  for (const s of suite) {
    rows.push({
      id: 'suite-' + s.id,
      area: 'suite',
      label: s.label,
      auto: s.ok ? 'pass' : 'fail',
      hand: 'na',
      note:
        (s.detail && String(s.detail).slice(0, 120)) ||
        (s.ok ? '\u672c\u5730\u5957\u4ef6\u7eff' : '\u672c\u5730\u5957\u4ef6\u7ea2'),
    });
  }

  return rows;
}

/**
 * Format markdown table for clipboard / dogfood notes.
 */
export function formatM1SoftRegressionMatrix(
  input: M1SoftRegressionMatrixInput,
): M1SoftRegressionMatrix {
  const at = input.generatedAt?.trim() || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rows = projectM1SoftRegressionMatrix(input);
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);

  const autoRows = rows.filter((r) => r.auto === 'pass' || r.auto === 'fail' || r.auto === 'soft');
  const autoPass = rows.filter((r) => r.auto === 'pass' || r.auto === 'soft').length;
  const autoTotal = autoRows.length;
  const handGaps = rows.filter(
    (r) => r.hand === 'pending' || r.hand === 'external' || r.hand === 'fail',
  ).length;
  const externalGaps = rows.filter((r) => r.hand === 'external').length;

  const md: string[] = [
    '# SYNC-THINK M1 soft \u56de\u5f52\u77e9\u9635\uff08\u81ea\u52a8 vs \u624b\u6d4b \u00b7 \u975e\u9000\u51fa\u8bc1\u636e\uff09',
    '',
    '> \u5bf9\u7167\u300c\u672c\u673a\u81ea\u52a8\u5316 / soft\u300d\u4e0e\u300c\u5916\u7f51\u624b\u6d4b / dogfood\u300d\u3002**\u4e0d\u80fd**\u66ff\u4ee3 `14-external-gateway-handtest.md` \u52fe\u9009\u3002',
    `> **\u4e0d\u542b** API Key\u3002\u5173 M1 \u4ecd\u9700\uff1a\u6587\u6863 18/18 + dogfood \u2265${dogfoodRequired} \u5929 + \u4eba\u5de5\u51b3\u7b56\u3002`,
    '',
    '- \u751f\u6210\u65f6\u95f4\uff1a' + at,
    '- soft craft \u8f6e\u6b21\uff1a' + (input.softCraftRound ?? '\u2014'),
    '- \u672c\u673a\u53ef\u6838\u624b\u6d4b\uff1a' +
      input.handtestLivePass +
      '/' +
      input.handtestLiveTotal +
      ' \u00b7 \u6587\u6863\u52fe\u9009\uff1a' +
      input.handtestDocChecked +
      '/' +
      (input.handtestDocTotal || 18),
    '- dogfood\uff1a\u6709\u6548 ' +
      input.dogfoodRealDays +
      '/' +
      dogfoodRequired +
      ' \u00b7 \u6587\u4ef6 ' +
      (input.dogfoodFileCount | 0),
    '- dual \u81ea\u52a8\u5316\uff1a' +
      (input.dualAutomatedOk ? '\u7eff' : '\u672a\u7eff') +
      ' \u00b7 \u9000\u51fa level\uff1a' +
      input.exitLevel,
    '- \u77e9\u9635\u7edf\u8ba1\uff1aauto \u7eff ' +
      autoPass +
      '/' +
      autoTotal +
      ' \u00b7 \u624b\u6d4b/\u5916\u7f51\u7f3a\u53e3\u884c ' +
      handGaps +
      ' \u00b7 \u5916\u7f51\u884c ' +
      externalGaps,
    '',
    '| \u533a\u57df | \u9879 | \u81ea\u52a8/soft | \u624b\u6d4b/\u5916\u7f51 | \u8bf4\u660e |',
    '|---|---|---|---|---|',
  ];

  for (const r of rows) {
    md.push(
      '| ' +
        r.area +
        ' | ' +
        r.label +
        ' | ' +
        cellMark(r.auto) +
        ' ' +
        cellText(r.auto) +
        ' | ' +
        cellMark(r.hand) +
        ' ' +
        cellText(r.hand) +
        ' | ' +
        r.note.replace(/\|/g, '/') +
        ' |',
    );
  }

  md.push(
    '',
    '## \u600e\u4e48\u8bfb',
    '- **\u81ea\u52a8/soft \u7eff** \u53ea\u8bf4\u660e\u672c\u673a\u53ef\u89c2\u6d4b\u6216\u5355\u6d4b\u7eff\uff0c**\u4e0d\u7b49\u4e8e** \u5916\u7f51\u624b\u6d4b\u5df2\u52fe\u3002',
    '- **\u5916\u7f51\u5f85\u8bc1** \u5fc5\u987b\u4f60\u5728\u771f\u5b9e\u7f51\u5173\u4e0a\u5b8c\u6210\u5e76\u52fe `14-\u2026handtest.md`\u3002',
    `- **dogfood** \u8349\u7a3f/\u811a\u624b\u67b6\u4e0d\u8ba1\u6709\u6548\u65e5\uff1b\u2265${dogfoodRequired} \u5929\u771f\u5b9e\u65e5\u8bb0\u624d\u591f\u8c08\u5173 M1\u3002`,
    '',
    '## \u5efa\u8bae\u4e0b\u4e00\u6b65',
    '1. \u5916\u7f51\u624b\u6d4b\u7f3a\u53e3\uff1a\u6253\u5f00\u624b\u6d4b\u6587\u6863\uff0c\u7528\u771f\u5b9e\u5bc6\u94a5\u5b8c\u6210\u672a\u52fe\u9879\uff08\u5bc6\u94a5\u52ff\u5165\u5e93\uff09',
    `2. dogfood\uff1a\u590d\u5236\u8349\u7a3f \u2192 \u6539\u6389\u300c\u5f85\u4f60\u786e\u8ba4\u300d\u2192 \u5199\u6ee1 \u2265${dogfoodRequired} \u5929`,
    '3. \u672c\u5730 auto \u7ea2\u9879\uff1a\u5148\u8dd1 `node scripts/selftest-m1-soft-regression.mjs` \u4fee soft',
    '',
    '## M1',
    '\u4ecd\u5e94\u89c6\u4e3a **open**\uff0c\u9664\u975e\u4f60\u4eba\u5de5\u5173\u95ed\u3002\u672c\u77e9\u9635 `claimsM1Closed=false`\u3002',
    '',
  );

  const markdown = md.join('\n');
  const summary =
    '\u5df2\u590d\u5236 soft \u56de\u5f52\u77e9\u9635 ' +
    markdown.length +
    ' \u5b57 \u00b7 auto ' +
    autoPass +
    '/' +
    autoTotal +
    ' \u00b7 \u624b\u6d4b\u7f3a\u53e3\u884c ' +
    handGaps +
    ' \u00b7 \u5916\u7f51 ' +
    externalGaps;

  return {
    rows,
    markdown,
    summary,
    charCount: markdown.length,
    autoPass,
    autoTotal,
    handGaps,
    externalGaps,
    claimsM1Closed: false,
    claimsDocChecked: false,
  };
}

/** Guardrail: clipboard text must not look like secrets. */
export function softRegressionLooksSecretFree(text: string): boolean {
  if (!text) return true;
  if (/\bsk-[A-Za-z0-9_\-]{16,}\b/.test(text)) return false;
  if (/\bBearer\s+[A-Za-z0-9_\-\.]{20,}\b/i.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{12,}/i.test(text)) return false;
  return true;
}

/**
 * Default suite catalog labels for runner + UI when results not yet injected.
 * IDs are stable for data-testid / matrix row ids.
 */
export const M1_SOFT_REGRESSION_SUITE_CATALOG: readonly {
  id: string;
  label: string;
  package: 'desktop' | 'runtime';
  testFile: string;
}[] = [
  {
    id: 'dual-http',
    label: 'runtime dual-http-gateway',
    package: 'runtime',
    testFile: 'tests/dual-http-gateway.test.ts',
  },
  {
    id: 'dual-protocol',
    label: 'runtime dual-protocol-gateway',
    package: 'runtime',
    testFile: 'tests/dual-protocol-gateway.test.ts',
  },
  {
    id: 'stream-readiness',
    label: 'desktop conversation-stream-readiness',
    package: 'desktop',
    testFile: 'tests/conversation-stream-readiness.test.ts',
  },
  {
    id: 'exit-evidence',
    label: 'desktop m1-exit-evidence',
    package: 'desktop',
    testFile: 'tests/m1-exit-evidence.test.ts',
  },
  {
    id: 'handtest-checklist',
    label: 'desktop m1-handtest-checklist',
    package: 'desktop',
    testFile: 'tests/m1-handtest-checklist.test.ts',
  },
  {
    id: 'dogfood-score',
    label: 'desktop m1-dogfood-score',
    package: 'desktop',
    testFile: 'tests/m1-dogfood-score.test.ts',
  },
  {
    id: 'next-action',
    label: 'desktop m1-next-action',
    package: 'desktop',
    testFile: 'tests/m1-next-action.test.ts',
  },
  {
    id: 'soft-snapshot',
    label: 'desktop m1-soft-snapshot',
    package: 'desktop',
    testFile: 'tests/m1-soft-snapshot.test.ts',
  },
  {
    id: 'soft-regression',
    label: 'desktop m1-soft-regression',
    package: 'desktop',
    testFile: 'tests/m1-soft-regression.test.ts',
  },
  {
    id: 'evidence-bundle',
    label: 'desktop m1-evidence-bundle',
    package: 'desktop',
    testFile: 'tests/m1-evidence-bundle.test.ts',
  },
  {
    id: 'exit-path',
    label: 'desktop m1-exit-path',
    package: 'desktop',
    testFile: 'tests/m1-exit-path.test.ts',
  },
  {
    id: 'handtest-doc-parse',
    label: 'desktop m1-handtest-doc-parse',
    package: 'desktop',
    testFile: 'tests/m1-handtest-doc-parse.test.ts',
  },
  {
    id: 'handtest-doc-diff',
    label: 'desktop m1-handtest-doc-diff',
    package: 'desktop',
    testFile: 'tests/m1-handtest-doc-diff.test.ts',
  },
] as const;

export type M1SoftRegressionListFilter = 'all' | 'gaps' | 'external' | 'auto-fail';

/**
 * Pure: filter matrix rows for UI observability.
 * - all: everything
 * - gaps: hand is pending/external/fail OR auto is fail
 * - external: hand is external (hard-gate focus)
 * - auto-fail: auto is fail only
 */
export function filterM1SoftRegressionRows(
  rows: readonly M1SoftRegressionRow[],
  mode: M1SoftRegressionListFilter,
): M1SoftRegressionRow[] {
  const list = Array.isArray(rows) ? [...rows] : [];
  if (mode === 'all') return list;
  if (mode === 'external') return list.filter((r) => r.hand === 'external');
  if (mode === 'auto-fail') return list.filter((r) => r.auto === 'fail');
  // gaps
  return list.filter(
    (r) => r.hand === 'pending' || r.hand === 'external' || r.hand === 'fail' || r.auto === 'fail',
  );
}

export function countM1SoftRegressionFilter(
  rows: readonly M1SoftRegressionRow[],
  mode: M1SoftRegressionListFilter,
): number {
  return filterM1SoftRegressionRows(rows, mode).length;
}

export type M1SoftRegressionRowActionKind =
  | 'open-handtest'
  | 'open-dogfood'
  | 'jump-providers'
  | 'jump-agent'
  | 'jump-trace'
  | 'reconnect'
  | 'copy-matrix'
  | 'none';

export interface M1SoftRegressionRowAction {
  kind: M1SoftRegressionRowActionKind;
  /** Short Chinese CTA when actionable. */
  ctaLabel: string;
  hint: string;
}

/**
 * Map a matrix row to a soft assist action.
 * Never auto-checks docs / never closes M1.
 */
export function resolveM1SoftRegressionRowAction(rowId: string): M1SoftRegressionRowAction {
  switch (rowId) {
    case 'suite-dual':
    case 'stream-failure-cta':
    case 'security-scrub':
      return {
        kind: 'copy-matrix',
        ctaLabel: '复制矩阵',
        hint: '本地 soft/自动化项 · 可复制矩阵作对照，不能替代外网手测',
      };
    case 'runtime-online':
      return {
        kind: 'reconnect',
        ctaLabel: '重连 Runtime',
        hint: '离线时手动重连；在线则刷新 soft 状态即可',
      };
    case 'providers-soft':
      return {
        kind: 'jump-providers',
        ctaLabel: '打开 Providers',
        hint: '配置 ≥2 端点与 ≥3 模型（密钥勿入库）',
      };
    case 'agent-bind':
    case 'fallback-external':
      return {
        kind: 'jump-agent',
        ctaLabel: '打开 Agent',
        hint: '设定默认模型与 Fallback；失败走 Fallback 需外网故意验证',
      };
    case 'conversation-soft':
      return {
        kind: 'jump-trace',
        ctaLabel: '查看轨迹',
        hint: '同任务多模型消息 + Trace / Manifest 本机 soft 信号',
      };
    case 'handtest-live':
    case 'handtest-external':
    case 'handtest-doc':
    case 'exit-level':
      return {
        kind: 'open-handtest',
        ctaLabel: '打开手测文档',
        hint: '真源勾选在 14-external-gateway-handtest.md；UI 不自动勾',
      };
    case 'dogfood':
      return {
        kind: 'open-dogfood',
        ctaLabel: '打开今日 dogfood',
        hint: '写真实日记；粘贴草稿不计有效日',
      };
    default:
      if (rowId.startsWith('suite-')) {
        return {
          kind: 'copy-matrix',
          ctaLabel: '复制矩阵',
          hint: '本地套件结果行 · 详见 pnpm selftest:m1-soft',
        };
      }
      return {
        kind: 'none',
        ctaLabel: '',
        hint: '该行无可点行动',
      };
  }
}

export function isM1SoftRegressionRowActionable(rowId: string): boolean {
  return resolveM1SoftRegressionRowAction(rowId).kind !== 'none';
}
