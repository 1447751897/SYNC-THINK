import { describe, expect, it } from 'vitest';
import {
  evaluateAutomationBusinessAcceptance,
  type AutomationBusinessAcceptanceInput,
} from './automation-business-acceptance.js';

const runDate = '2026-10-02';

// Only the host-facing evaluator is called; no tasks, exporter I/O or credentials.
describe('evaluateAutomationBusinessAcceptance', () => {
  it('counts actual data rows rather than a header or a model success claim', () => {
    expect(
      evaluateAutomationBusinessAcceptance(
        { minimumRows: 2 },
        { format: 'spreadsheet', columns: ['Name'], rows: [['a'], ['b']] },
        runDate,
      ),
    ).toEqual({
      passed: true,
      checks: [
        {
          check: 'minimumRows',
          status: 'passed',
          code: 'automation_acceptance.passed',
          expected: 2,
          actual: 2,
        },
      ],
    });
  });
});

it.each([
  [undefined, 'automation_acceptance.rows_missing'],
  [null, 'automation_acceptance.rows_invalid'],
  [true, 'automation_acceptance.rows_invalid'],
  [{ length: 20, passed: true }, 'automation_acceptance.rows_invalid'],
  [[['a']], 'automation_acceptance.minimum_rows_unmet'],
  [[], 'automation_acceptance.minimum_rows_unmet'],
  [[null, ['a']], 'automation_acceptance.rows_invalid'],
  [[['a'], [Number.NaN]], 'automation_acceptance.rows_invalid'],
  [[['a'], [Infinity]], 'automation_acceptance.rows_invalid'],
  [[['a'], [true]], 'automation_acceptance.rows_invalid'],
  [[['a'], [{}]], 'automation_acceptance.rows_invalid'],
  [[['a'], []], 'automation_acceptance.minimum_rows_unmet'],
  [[['a'], ['  ']], 'automation_acceptance.minimum_rows_unmet'],
  [new Array(2), 'automation_acceptance.rows_invalid'],
  [[['a'], new Array(1)], 'automation_acceptance.rows_invalid'],
  [Array.from({ length: 10_001 }, () => ['a']), 'automation_acceptance.rows_limit'],
  [[Array.from({ length: 129 }, () => 'a'), ['a']], 'automation_acceptance.rows_limit'],
  [[['x'.repeat(32_768)], ['a']], 'automation_acceptance.rows_invalid'],
])(
  'fails closed on missing, malformed, insufficient or oversized actual rows #%#',
  (rows, code) => {
    const result = evaluateAutomationBusinessAcceptance(
      { minimumRows: 2 },
      { format: 'spreadsheet', rows, passed: true } as unknown as AutomationBusinessAcceptanceInput,
      runDate,
    );
    expect(result).toMatchObject({
      passed: false,
      checks: [{ check: 'minimumRows', status: 'failed', code }],
    });
  },
);

it('counts finite numeric zero as actual data without requiring declared headers', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { minimumRows: 1 },
      { format: 'spreadsheet', rows: [[0]] },
      runDate,
    ),
  ).toMatchObject({ passed: true, checks: [{ actual: 1 }] });
});

it('checks normalized, case-sensitive required headers alongside the row count', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { minimumRows: 1, requiredColumns: ['Name', '来源'] },
      {
        format: 'spreadsheet',
        columns: [' Name ', '来源', 'Extra'],
        rows: [['a', 'https://source.example/item', 1]],
      },
      runDate,
    ),
  ).toEqual({
    passed: true,
    checks: [
      {
        check: 'minimumRows',
        status: 'passed',
        code: 'automation_acceptance.passed',
        expected: 1,
        actual: 1,
      },
      { check: 'requiredColumns', status: 'passed', code: 'automation_acceptance.passed' },
    ],
  });
});

it.each([
  [undefined, 'automation_acceptance.columns_missing'],
  [true, 'automation_acceptance.columns_invalid'],
  [['Name', 1], 'automation_acceptance.columns_invalid'],
  [['Name', ' Name '], 'automation_acceptance.columns_invalid'],
  [['Name', ''], 'automation_acceptance.columns_invalid'],
  [new Array(2), 'automation_acceptance.columns_invalid'],
  [Array.from({ length: 129 }, (_, index) => `c${index}`), 'automation_acceptance.columns_limit'],
])('fails required headers on missing or malformed actual columns #%#', (columns, code) => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { requiredColumns: ['Name'] },
      { format: 'spreadsheet', columns } as unknown as AutomationBusinessAcceptanceInput,
      runDate,
    ),
  ).toMatchObject({
    passed: false,
    checks: [{ check: 'requiredColumns', status: 'failed', code }],
  });
});

it('reports exactly the missing required columns, not a model boolean', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { requiredColumns: ['Name', 'Date', 'Source'] },
      {
        format: 'spreadsheet',
        columns: ['name', 'Source'],
        requiredColumns: true,
      } as unknown as AutomationBusinessAcceptanceInput,
      runDate,
    ),
  ).toEqual({
    passed: false,
    checks: [
      {
        check: 'requiredColumns',
        status: 'failed',
        code: 'automation_acceptance.required_columns_missing',
        missingColumns: ['Name', 'Date'],
      },
    ],
  });
});

it('requires every date cell to equal the host-frozen run-local date', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { dateColumn: 'Date' },
      {
        format: 'spreadsheet',
        columns: ['Name', 'Date'],
        rows: [
          ['a', runDate],
          ['b', runDate],
        ],
      },
      runDate,
    ),
  ).toEqual({
    passed: true,
    checks: [{ check: 'dateColumn', status: 'passed', code: 'automation_acceptance.passed' }],
  });
});

it.each([
  '2026-10-01',
  '2026-10-03',
  '2026-10-02T00:00:00Z',
  '2026/10/02',
  '2026-1-2',
  ' 2026-10-02',
  '2026-10-02 ',
  '',
  20261002,
])('fails stale, future, loosely formatted or non-string date cell #%#', (date) => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { dateColumn: 'Date' },
      {
        format: 'spreadsheet',
        columns: ['Name', 'Date'],
        rows: [
          ['a', runDate],
          ['b', date],
        ],
      },
      runDate,
    ),
  ).toMatchObject({
    passed: false,
    checks: [
      {
        check: 'dateColumn',
        status: 'failed',
        code: 'automation_acceptance.date_mismatch',
        rowIndex: 1,
      },
    ],
  });
});

it.each([
  '',
  '2026-10-02T00:00:00Z',
  '2026-02-29',
  '2026-13-02',
  '2026-00-02',
  '2026-04-31',
  '0000-01-01',
  '2026-10-00',
])('rejects malformed or impossible host dates #%#', (expectedLocalDate) => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { dateColumn: 'Date' },
      { format: 'spreadsheet', columns: ['Date'], rows: [[expectedLocalDate || '2026-10-02']] },
      expectedLocalDate,
    ),
  ).toMatchObject({
    passed: false,
    checks: [
      {
        check: 'dateColumn',
        status: 'failed',
        code: 'automation_acceptance.expected_local_date_invalid',
      },
    ],
  });
});

it('accepts a valid leap-day supplied by the host without consulting wall-clock time', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { dateColumn: 'Date' },
      { format: 'spreadsheet', columns: ['Date'], rows: [['2028-02-29']] },
      '2028-02-29',
    ).passed,
  ).toBe(true);
});

it.each([
  [{ format: 'spreadsheet' }, 'automation_acceptance.columns_missing'],
  [
    { format: 'spreadsheet', columns: ['Name'], rows: [['a']] },
    'automation_acceptance.date_column_missing',
  ],
  [{ format: 'spreadsheet', columns: ['Date'] }, 'automation_acceptance.rows_missing'],
  [{ format: 'spreadsheet', columns: ['Date'], rows: [] }, 'automation_acceptance.rows_empty'],
  [
    { format: 'spreadsheet', columns: ['Name', 'Date'], rows: [['a']] },
    'automation_acceptance.date_mismatch',
  ],
  [
    { format: 'spreadsheet', columns: ['Date'], rows: true, dateColumn: true },
    'automation_acceptance.rows_invalid',
  ],
])('fails missing date evidence instead of vacuous success #%#', (raw, code) => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { dateColumn: 'Date' },
      raw as unknown as AutomationBusinessAcceptanceInput,
      runDate,
    ),
  ).toMatchObject({ passed: false, checks: [{ check: 'dateColumn', status: 'failed', code }] });
});

it.each([
  'https://source.example.invalid/article?q=1#part',
  'http://localhost:8080/source',
  'HTTPS://example.invalid/item',
])('accepts absolute HTTP(S) syntax without claiming reachability: %s', (url) => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { sourceUrlColumn: 'Source' },
      { format: 'spreadsheet', columns: ['Name', 'Source'], rows: [['a', url]] },
      runDate,
    ),
  ).toEqual({
    passed: true,
    checks: [{ check: 'sourceUrlColumn', status: 'passed', code: 'automation_acceptance.passed' }],
  });
});

it.each([
  '',
  'not a url',
  '/relative',
  '//example.invalid/item',
  'ftp://example.invalid/item',
  'file:///data',
  'javascript:alert(1)',
  'data:text/plain,source',
  'https://',
  'https:example.invalid',
  'http:\\example.invalid',
  'https:///example.invalid',
  'https://exa mple.invalid',
  ' https://example.invalid',
  'https://example.invalid\n',
  'https://example.invalid\\item',
  1,
])('rejects empty, unsafe-scheme, relative, ambiguous or non-string source cell #%#', (url) => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { sourceUrlColumn: 'Source' },
      {
        format: 'spreadsheet',
        columns: ['Name', 'Source'],
        rows: [
          ['a', 'https://example.invalid/a'],
          ['b', url],
        ],
      },
      runDate,
    ),
  ).toMatchObject({
    passed: false,
    checks: [
      {
        check: 'sourceUrlColumn',
        status: 'failed',
        code: 'automation_acceptance.source_url_invalid',
        rowIndex: 1,
      },
    ],
  });
});

it.each([
  [{ format: 'spreadsheet' }, 'automation_acceptance.columns_missing'],
  [
    { format: 'spreadsheet', columns: ['Name'], rows: [['a']] },
    'automation_acceptance.source_url_column_missing',
  ],
  [{ format: 'spreadsheet', columns: ['Source'] }, 'automation_acceptance.rows_missing'],
  [{ format: 'spreadsheet', columns: ['Source'], rows: [] }, 'automation_acceptance.rows_empty'],
  [
    { format: 'spreadsheet', columns: ['Name', 'Source'], rows: [['a']] },
    'automation_acceptance.source_url_invalid',
  ],
])('fails missing source evidence rather than treating absence as success #%#', (raw, code) => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { sourceUrlColumn: 'Source' },
      raw as unknown as AutomationBusinessAcceptanceInput,
      runDate,
    ),
  ).toMatchObject({
    passed: false,
    checks: [{ check: 'sourceUrlColumn', status: 'failed', code }],
  });
});

it('reports the date and source failures independently in stable contract order', () => {
  const result = evaluateAutomationBusinessAcceptance(
    {
      sourceUrlColumn: 'Source',
      dateColumn: 'Date',
      minimumRows: 1,
      requiredColumns: ['Date', 'Source'],
    },
    { format: 'spreadsheet', columns: ['Date', 'Source'], rows: [['2026-10-01', 'no source']] },
    runDate,
  );
  expect(result.passed).toBe(false);
  expect(result.checks.map(({ check, code }) => ({ check, code }))).toEqual([
    { check: 'minimumRows', code: 'automation_acceptance.passed' },
    { check: 'requiredColumns', code: 'automation_acceptance.passed' },
    { check: 'dateColumn', code: 'automation_acceptance.date_mismatch' },
    { check: 'sourceUrlColumn', code: 'automation_acceptance.source_url_invalid' },
  ]);
});

it('counts real presentation slides with titles and bullet arrays', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { minimumSlides: 2 },
      {
        format: 'presentation',
        slides: [
          { title: 'Overview', bullets: ['Facts'] },
          { title: 'Summary', bullets: [] },
        ],
      },
      runDate,
    ),
  ).toEqual({
    passed: true,
    checks: [
      {
        check: 'minimumSlides',
        status: 'passed',
        code: 'automation_acceptance.passed',
        expected: 2,
        actual: 2,
      },
    ],
  });
});

it.each([
  [undefined, 'automation_acceptance.slides_missing'],
  [null, 'automation_acceptance.slides_invalid'],
  [true, 'automation_acceptance.slides_invalid'],
  [{ length: 2, passed: true }, 'automation_acceptance.slides_invalid'],
  [[], 'automation_acceptance.minimum_slides_unmet'],
  [[{ title: 'One', bullets: [] }], 'automation_acceptance.minimum_slides_unmet'],
  [[null, null], 'automation_acceptance.slides_invalid'],
  [[{}, {}], 'automation_acceptance.slides_invalid'],
  [new Array(2), 'automation_acceptance.slides_invalid'],
  [
    [
      { title: ' ', bullets: [] },
      { title: 'Two', bullets: [] },
    ],
    'automation_acceptance.slides_invalid',
  ],
  [
    [
      { title: 'One', bullets: true },
      { title: 'Two', bullets: [] },
    ],
    'automation_acceptance.slides_invalid',
  ],
  [
    [
      { title: 'One', bullets: [1] },
      { title: 'Two', bullets: [] },
    ],
    'automation_acceptance.slides_invalid',
  ],
  [
    [
      { title: 'One', bullets: new Array(1) },
      { title: 'Two', bullets: [] },
    ],
    'automation_acceptance.slides_invalid',
  ],
  [
    [
      { title: 'One', bullets: Array(31).fill('fact') },
      { title: 'Two', bullets: [] },
    ],
    'automation_acceptance.slides_invalid',
  ],
  [
    [
      { title: 'One', bullets: [], passed: true },
      { title: 'Two', bullets: [] },
    ],
    'automation_acceptance.slides_invalid',
  ],
  [
    [
      { title: 'x'.repeat(32_768), bullets: [] },
      { title: 'Two', bullets: [] },
    ],
    'automation_acceptance.slides_invalid',
  ],
  [
    Array.from({ length: 101 }, () => ({ title: 'Slide', bullets: [] })),
    'automation_acceptance.slides_limit',
  ],
])(
  'fails missing, spoofed, malformed, insufficient or oversized actual slides #%#',
  (slides, code) => {
    expect(
      evaluateAutomationBusinessAcceptance(
        { minimumSlides: 2 },
        {
          format: 'presentation',
          slides,
          minimumSlides: true,
        } as unknown as AutomationBusinessAcceptanceInput,
        runDate,
      ),
    ).toMatchObject({
      passed: false,
      checks: [{ check: 'minimumSlides', status: 'failed', code }],
    });
  },
);

it('isolates presentation-only rules from spreadsheet data, including irrelevant malformed fields', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      {
        minimumRows: 1,
        requiredColumns: ['Date', 'Source'],
        dateColumn: 'Date',
        sourceUrlColumn: 'Source',
        minimumSlides: 2,
      },
      {
        format: 'spreadsheet',
        columns: ['Date', 'Source'],
        rows: [[runDate, 'https://example.invalid/a']],
        slides: true,
      } as unknown as AutomationBusinessAcceptanceInput,
      runDate,
    ),
  ).toEqual({
    passed: true,
    checks: [
      {
        check: 'minimumRows',
        status: 'passed',
        code: 'automation_acceptance.passed',
        expected: 1,
        actual: 1,
      },
      { check: 'requiredColumns', status: 'passed', code: 'automation_acceptance.passed' },
      { check: 'dateColumn', status: 'passed', code: 'automation_acceptance.passed' },
      { check: 'sourceUrlColumn', status: 'passed', code: 'automation_acceptance.passed' },
      {
        check: 'minimumSlides',
        status: 'not-applicable',
        code: 'automation_acceptance.not_applicable',
      },
    ],
  });
});

it('isolates all spreadsheet rules and the frozen date from a real presentation', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      {
        minimumRows: 10,
        requiredColumns: ['Date'],
        dateColumn: 'Date',
        sourceUrlColumn: 'Source',
        minimumSlides: 1,
      },
      {
        format: 'presentation',
        rows: true,
        columns: true,
        slides: [{ title: 'Facts', bullets: [] }],
      } as unknown as AutomationBusinessAcceptanceInput,
      'irrelevant-date',
    ),
  ).toEqual({
    passed: true,
    checks: [
      {
        check: 'minimumRows',
        status: 'not-applicable',
        code: 'automation_acceptance.not_applicable',
      },
      {
        check: 'requiredColumns',
        status: 'not-applicable',
        code: 'automation_acceptance.not_applicable',
      },
      {
        check: 'dateColumn',
        status: 'not-applicable',
        code: 'automation_acceptance.not_applicable',
      },
      {
        check: 'sourceUrlColumn',
        status: 'not-applicable',
        code: 'automation_acceptance.not_applicable',
      },
      {
        check: 'minimumSlides',
        status: 'passed',
        code: 'automation_acceptance.passed',
        expected: 1,
        actual: 1,
      },
    ],
  });
});

it('marks an entirely unrelated contract not-applicable instead of claiming requested output delivery', () => {
  expect(
    evaluateAutomationBusinessAcceptance({ minimumRows: 1 }, { format: 'presentation' }, runDate),
  ).toEqual({
    passed: true,
    checks: [
      {
        check: 'minimumRows',
        status: 'not-applicable',
        code: 'automation_acceptance.not_applicable',
      },
    ],
  });
});

it('keeps an absent optional contract compatible without inventing business checks', () => {
  expect(
    evaluateAutomationBusinessAcceptance(undefined, { format: 'spreadsheet' }, runDate),
  ).toEqual({ passed: true, checks: [] });
});

it.each([undefined, null, true, [], 'presentation'])(
  'rejects non-structured export input #%#',
  (raw) => {
    expect(
      evaluateAutomationBusinessAcceptance(
        { minimumRows: 1 },
        raw as unknown as AutomationBusinessAcceptanceInput,
        runDate,
      ),
    ).toEqual({
      passed: false,
      checks: [{ check: 'format', status: 'failed', code: 'automation_acceptance.input_invalid' }],
    });
  },
);

it.each([
  {},
  { format: 'pdf' },
  { format: 'SPREADSHEET' },
  { format: true },
  { format: 'presentation ', passed: true },
])('rejects unknown or asserted formats even without an optional contract #%#', (raw) => {
  expect(
    evaluateAutomationBusinessAcceptance(
      undefined,
      raw as unknown as AutomationBusinessAcceptanceInput,
      runDate,
    ),
  ).toEqual({
    passed: false,
    checks: [{ check: 'format', status: 'failed', code: 'automation_acceptance.format_invalid' }],
  });
});

it('accepts production row and slide ceilings through the public evaluator', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { minimumRows: 10_000 },
      { format: 'spreadsheet', rows: Array.from({ length: 10_000 }, () => [0]) },
      runDate,
    ),
  ).toMatchObject({ passed: true, checks: [{ actual: 10_000 }] });
  expect(
    evaluateAutomationBusinessAcceptance(
      { minimumSlides: 100 },
      {
        format: 'presentation',
        slides: Array.from({ length: 100 }, () => ({ title: 'Facts', bullets: [] })),
      },
      runDate,
    ),
  ).toMatchObject({ passed: true, checks: [{ actual: 100 }] });
});

it('rejects over-budget cell inventories without accepting a claimed row count', () => {
  expect(
    evaluateAutomationBusinessAcceptance(
      { minimumRows: 1 },
      { format: 'spreadsheet', rows: Array.from({ length: 2_000 }, () => Array(128).fill(0)) },
      runDate,
    ),
  ).toMatchObject({ passed: false, checks: [{ code: 'automation_acceptance.rows_limit' }] });
});

it('does not mutate frozen actual export data or the accepted rule contract', () => {
  const contract = Object.freeze({
    minimumRows: 1,
    dateColumn: 'Date',
    sourceUrlColumn: 'Source',
    minimumSlides: 1,
  });
  const input = Object.freeze({
    format: 'spreadsheet' as const,
    columns: Object.freeze(['Date', 'Source']),
    rows: Object.freeze([Object.freeze([runDate, 'https://example.invalid/item'])]),
  });
  const before = JSON.stringify({ contract, input });
  expect(evaluateAutomationBusinessAcceptance(contract, input, runDate).passed).toBe(true);
  expect(JSON.stringify({ contract, input })).toBe(before);
});

it('ignores empty and whitespace-only padded rows for minimumRows while counting numeric zero', () => {
  const blankRows = [[], [''], [' ', '\t'], ['\r\n', '\u3000'], ['\u00a0']];
  const blankInput: AutomationBusinessAcceptanceInput = {
    format: 'spreadsheet',
    columns: ['Value', 'Padding'],
    rows: blankRows,
  };
  expect(evaluateAutomationBusinessAcceptance({ minimumRows: 5 }, blankInput, runDate)).toEqual({
    passed: false,
    checks: [
      {
        check: 'minimumRows',
        status: 'failed',
        code: 'automation_acceptance.minimum_rows_unmet',
        expected: 5,
        actual: 0,
      },
    ],
  });

  const mixedInput: AutomationBusinessAcceptanceInput = {
    ...blankInput,
    rows: [...blankRows, [0, ' '], [' actual data ', '']],
  };
  expect(evaluateAutomationBusinessAcceptance({ minimumRows: 5 }, mixedInput, runDate)).toEqual({
    passed: false,
    checks: [
      {
        check: 'minimumRows',
        status: 'failed',
        code: 'automation_acceptance.minimum_rows_unmet',
        expected: 5,
        actual: 2,
      },
    ],
  });
  expect(evaluateAutomationBusinessAcceptance({ minimumRows: 2 }, mixedInput, runDate)).toEqual({
    passed: true,
    checks: [
      {
        check: 'minimumRows',
        status: 'passed',
        code: 'automation_acceptance.passed',
        expected: 2,
        actual: 2,
      },
    ],
  });
  expect(
    evaluateAutomationBusinessAcceptance({ requiredColumns: ['Value'] }, blankInput, runDate),
  ).toEqual({
    passed: true,
    checks: [{ check: 'requiredColumns', status: 'passed', code: 'automation_acceptance.passed' }],
  });
  expect(
    evaluateAutomationBusinessAcceptance(
      { minimumRows: 5 },
      {
        format: 'presentation',
        slides: [{ title: 'Summary', bullets: [] }],
      },
      runDate,
    ),
  ).toEqual({
    passed: true,
    checks: [
      {
        check: 'minimumRows',
        status: 'not-applicable',
        code: 'automation_acceptance.not_applicable',
      },
    ],
  });
});
