import type { AutomationAcceptanceChecks } from '@sync-think/shared';
import type { AutomationArtifactExportArgs } from './automation/artifact-exporter.js';

/** Compatible with the actual exporter arguments, not a provider's completion prose. */
export type AutomationBusinessAcceptanceInput = Pick<
  AutomationArtifactExportArgs,
  'format' | 'columns' | 'rows' | 'slides'
>;

export type AutomationBusinessAcceptanceCode =
  | 'automation_acceptance.passed'
  | 'automation_acceptance.minimum_rows_unmet'
  | 'automation_acceptance.rows_missing'
  | 'automation_acceptance.rows_invalid'
  | 'automation_acceptance.rows_limit'
  | 'automation_acceptance.columns_missing'
  | 'automation_acceptance.columns_invalid'
  | 'automation_acceptance.columns_limit'
  | 'automation_acceptance.required_columns_missing'
  | 'automation_acceptance.rows_empty'
  | 'automation_acceptance.date_column_missing'
  | 'automation_acceptance.date_mismatch'
  | 'automation_acceptance.expected_local_date_invalid'
  | 'automation_acceptance.source_url_column_missing'
  | 'automation_acceptance.source_url_invalid'
  | 'automation_acceptance.slides_missing'
  | 'automation_acceptance.slides_invalid'
  | 'automation_acceptance.slides_limit'
  | 'automation_acceptance.minimum_slides_unmet'
  | 'automation_acceptance.not_applicable'
  | 'automation_acceptance.input_invalid'
  | 'automation_acceptance.format_invalid';

export interface AutomationBusinessAcceptanceCheckResult {
  readonly check: keyof AutomationAcceptanceChecks | 'contract' | 'format';
  readonly status: 'passed' | 'failed' | 'not-applicable';
  readonly code: AutomationBusinessAcceptanceCode;
  readonly expected?: number;
  /** minimumRows counts only rows with finite numeric or non-whitespace string cells. */
  readonly actual?: number;
  readonly missingColumns?: readonly string[];
  /** Zero-based index in the actual exported rows. */
  readonly rowIndex?: number;
}

export interface AutomationBusinessAcceptanceResult {
  readonly passed: boolean;
  readonly checks: readonly AutomationBusinessAcceptanceCheckResult[];
}

/**
 * Receives the shared parser's contract and actual export arguments, never model assertions.
 * expectedLocalDate is frozen by the host from firedAt/timeZone, not read from a clock.
 * passed means every applicable check passed; unrelated formats are not-applicable.
 * The host still verifies export success, file receipts/hashes and every requested format.
 */
export function evaluateAutomationBusinessAcceptance(
  acceptanceChecks: AutomationAcceptanceChecks | undefined,
  input: AutomationBusinessAcceptanceInput,
  expectedLocalDate: string,
): AutomationBusinessAcceptanceResult {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return {
      passed: false,
      checks: [{ check: 'format', status: 'failed', code: 'automation_acceptance.input_invalid' }],
    };
  if (input.format !== 'spreadsheet' && input.format !== 'presentation')
    return {
      passed: false,
      checks: [{ check: 'format', status: 'failed', code: 'automation_acceptance.format_invalid' }],
    };
  const checks: AutomationBusinessAcceptanceCheckResult[] = [];
  const notApplicable = (
    check: keyof AutomationAcceptanceChecks,
  ): AutomationBusinessAcceptanceCheckResult => ({
    check,
    status: 'not-applicable',
    code: 'automation_acceptance.not_applicable',
  });
  if (acceptanceChecks?.minimumRows !== undefined && input.format !== 'spreadsheet')
    checks.push(notApplicable('minimumRows'));
  else if (acceptanceChecks?.minimumRows !== undefined) {
    const error = rowsError(input.rows, { allowBlankRows: true });
    if (error) checks.push({ check: 'minimumRows', status: 'failed', code: error });
    else {
      // Export padding and empty strings do not establish business data; numeric 0 does.
      const actual = input.rows!.reduce(
        (count, row) =>
          row.some((cell) => typeof cell === 'number' || cell.trim().length > 0)
            ? count + 1
            : count,
        0,
      );
      const passed = actual >= acceptanceChecks.minimumRows;
      checks.push({
        check: 'minimumRows',
        status: passed ? 'passed' : 'failed',
        code: passed ? 'automation_acceptance.passed' : 'automation_acceptance.minimum_rows_unmet',
        expected: acceptanceChecks.minimumRows,
        actual,
      });
    }
  }
  if (acceptanceChecks?.requiredColumns !== undefined && input.format !== 'spreadsheet')
    checks.push(notApplicable('requiredColumns'));
  else if (acceptanceChecks?.requiredColumns !== undefined) {
    const error = columnsError(input.columns);
    if (error) checks.push({ check: 'requiredColumns', status: 'failed', code: error });
    else {
      const columns = new Set(input.columns!.map((name) => name.trim()));
      const missingColumns = acceptanceChecks.requiredColumns.filter((name) => !columns.has(name));
      checks.push(
        missingColumns.length
          ? {
              check: 'requiredColumns',
              status: 'failed',
              code: 'automation_acceptance.required_columns_missing',
              missingColumns,
            }
          : { check: 'requiredColumns', status: 'passed', code: 'automation_acceptance.passed' },
      );
    }
  }
  if (acceptanceChecks?.dateColumn !== undefined)
    checks.push(
      input.format === 'spreadsheet'
        ? checkDateColumn(acceptanceChecks.dateColumn, input, expectedLocalDate)
        : notApplicable('dateColumn'),
    );
  if (acceptanceChecks?.sourceUrlColumn !== undefined)
    checks.push(
      input.format === 'spreadsheet'
        ? checkSourceUrlColumn(acceptanceChecks.sourceUrlColumn, input)
        : notApplicable('sourceUrlColumn'),
    );
  if (acceptanceChecks?.minimumSlides !== undefined && input.format !== 'presentation')
    checks.push(notApplicable('minimumSlides'));
  else if (acceptanceChecks?.minimumSlides !== undefined) {
    const error = slidesError(input.slides);
    if (error) checks.push({ check: 'minimumSlides', status: 'failed', code: error });
    else {
      const actual = input.slides!.length;
      const passed = actual >= acceptanceChecks.minimumSlides;
      checks.push({
        check: 'minimumSlides',
        status: passed ? 'passed' : 'failed',
        code: passed
          ? 'automation_acceptance.passed'
          : 'automation_acceptance.minimum_slides_unmet',
        expected: acceptanceChecks.minimumSlides,
        actual,
      });
    }
  }
  return { passed: checks.every((check) => check.status !== 'failed'), checks };
}

function rowsError(
  value: unknown,
  options: { allowBlankRows?: boolean } = {},
): AutomationBusinessAcceptanceCode | undefined {
  if (value === undefined) return 'automation_acceptance.rows_missing';
  if (!Array.isArray(value)) return 'automation_acceptance.rows_invalid';
  if (value.length > 10_000) return 'automation_acceptance.rows_limit';
  let cells = 0;
  for (const row of value) {
    if (!Array.isArray(row)) return 'automation_acceptance.rows_invalid';
    cells += row.length;
    if (row.length > 128 || cells > 200_000) return 'automation_acceptance.rows_limit';
    let populated = false;
    for (const cell of row) {
      if (typeof cell === 'number' && Number.isFinite(cell)) populated = true;
      else if (typeof cell === 'string' && cell.length <= 32_767) populated ||= !!cell.trim();
      else return 'automation_acceptance.rows_invalid';
    }
    if (!populated && !options.allowBlankRows) return 'automation_acceptance.rows_invalid';
  }
  return undefined;
}

function columnsError(value: unknown): AutomationBusinessAcceptanceCode | undefined {
  if (value === undefined) return 'automation_acceptance.columns_missing';
  if (!Array.isArray(value)) return 'automation_acceptance.columns_invalid';
  if (value.length > 128) return 'automation_acceptance.columns_limit';
  const seen = new Set<string>();
  for (const column of value) {
    if (
      typeof column !== 'string' ||
      column.length > 32_767 ||
      !column.trim() ||
      seen.has(column.trim())
    )
      return 'automation_acceptance.columns_invalid';
    seen.add(column.trim());
  }
  return undefined;
}

function checkDateColumn(
  column: string,
  input: AutomationBusinessAcceptanceInput,
  expectedLocalDate: string,
): AutomationBusinessAcceptanceCheckResult {
  const fail = (
    code: AutomationBusinessAcceptanceCode,
    rowIndex?: number,
  ): AutomationBusinessAcceptanceCheckResult => ({
    check: 'dateColumn',
    status: 'failed',
    code,
    ...(rowIndex === undefined ? {} : { rowIndex }),
  });
  if (!isLocalDate(expectedLocalDate))
    return fail('automation_acceptance.expected_local_date_invalid');
  const columnError = columnsError(input.columns);
  if (columnError) return fail(columnError);
  const columnIndex = input.columns!.findIndex((name) => name.trim() === column);
  if (columnIndex < 0) return fail('automation_acceptance.date_column_missing');
  const rowError = rowsError(input.rows);
  if (rowError) return fail(rowError);
  if (!input.rows!.length) return fail('automation_acceptance.rows_empty');
  for (let index = 0; index < input.rows!.length; index++) {
    if (input.rows![index][columnIndex] !== expectedLocalDate)
      return fail('automation_acceptance.date_mismatch', index);
  }
  return { check: 'dateColumn', status: 'passed', code: 'automation_acceptance.passed' };
}

function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function checkSourceUrlColumn(
  column: string,
  input: AutomationBusinessAcceptanceInput,
): AutomationBusinessAcceptanceCheckResult {
  const fail = (
    code: AutomationBusinessAcceptanceCode,
    rowIndex?: number,
  ): AutomationBusinessAcceptanceCheckResult => ({
    check: 'sourceUrlColumn',
    status: 'failed',
    code,
    ...(rowIndex === undefined ? {} : { rowIndex }),
  });
  const columnError = columnsError(input.columns);
  if (columnError) return fail(columnError);
  const columnIndex = input.columns!.findIndex((name) => name.trim() === column);
  if (columnIndex < 0) return fail('automation_acceptance.source_url_column_missing');
  const rowError = rowsError(input.rows);
  if (rowError) return fail(rowError);
  if (!input.rows!.length) return fail('automation_acceptance.rows_empty');
  for (let index = 0; index < input.rows!.length; index++) {
    if (!isHttpUrl(input.rows![index][columnIndex]))
      return fail('automation_acceptance.source_url_invalid', index);
  }
  return { check: 'sourceUrlColumn', status: 'passed', code: 'automation_acceptance.passed' };
}

/** Syntax only: no network access, provenance, freshness or content-quality claim. */
function isHttpUrl(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    /[\s\\]/u.test(value) ||
    [...value].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !/^https?:\/\/[^/]/i.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

function slidesError(value: unknown): AutomationBusinessAcceptanceCode | undefined {
  if (value === undefined) return 'automation_acceptance.slides_missing';
  if (!Array.isArray(value)) return 'automation_acceptance.slides_invalid';
  if (value.length > 100) return 'automation_acceptance.slides_limit';
  for (const slide of value) {
    if (
      !slide ||
      typeof slide !== 'object' ||
      Array.isArray(slide) ||
      Object.keys(slide).some((key) => key !== 'title' && key !== 'bullets') ||
      typeof slide.title !== 'string' ||
      slide.title.length > 32_767 ||
      !slide.title.trim() ||
      !Array.isArray(slide.bullets) ||
      slide.bullets.length > 30
    )
      return 'automation_acceptance.slides_invalid';
    for (const bullet of slide.bullets) {
      if (typeof bullet !== 'string' || bullet.length > 32_767)
        return 'automation_acceptance.slides_invalid';
    }
  }
  return undefined;
}
