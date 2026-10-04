import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { buildOfficeDocument } from './office-document.js';
import type { AutomationArtifactExportArgs, AutomationOutput } from './types.js';
export type { AutomationArtifactExportArgs } from './types.js';

export const AUTOMATION_EXPORT_ARTIFACT_TOOL_NAME = 'automation_export_artifact';
export interface AutomationArtifactExportLimits {
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCells: number;
  readonly maxSlides: number;
  readonly maxBulletsPerSlide: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxTextLength: number;
}
export const AUTOMATION_ARTIFACT_EXPORT_LIMITS: Readonly<AutomationArtifactExportLimits> =
  Object.freeze({
    maxRows: 10_000,
    maxColumns: 128,
    maxCells: 200_000,
    maxSlides: 100,
    maxBulletsPerSlide: 30,
    maxInputBytes: 8_000_000,
    maxOutputBytes: 16_000_000,
    maxTextLength: 32_767,
  });
export interface AutomationArtifactExportContext {
  /** Host-owned absolute paths; never accepted from tool JSON. Both must already exist. */
  readonly workspaceRoot: string;
  readonly workingDirectory: string;
  readonly runId?: string;
  /** Host policy. False by default; never implicitly overwrite a previous result. */
  readonly overwrite?: boolean;
  /** Overrides can only lower the production ceilings. */
  readonly limits?: Partial<AutomationArtifactExportLimits>;
}
export interface AutomationArtifactExportResult {
  readonly format: AutomationOutput;
  readonly fileName: string;
  readonly title: string;
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly overwritten: boolean;
  readonly runId?: string;
}
export class AutomationArtifactExportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AutomationArtifactExportError';
  }
}
function fail(code: string, message: string): never {
  throw new AutomationArtifactExportError(code, message);
}
// Unified tool schemas may include empty placeholders for the unselected format.
// Ignore only absence/null/empty arrays; meaningful cross-format data stays invalid.
function isEmptyFormatPayload(value: unknown): boolean {
  return value == null || (Array.isArray(value) && value.length === 0);
}
function inventoryLimits(
  overrides?: Partial<AutomationArtifactExportLimits>,
): AutomationArtifactExportLimits {
  const limits = { ...AUTOMATION_ARTIFACT_EXPORT_LIMITS };
  for (const key of Object.keys(overrides ?? {}) as Array<keyof AutomationArtifactExportLimits>) {
    const value = overrides?.[key];
    if (
      !(key in limits) ||
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > limits[key]
    )
      fail('artifact.limit_invalid', '导出配额必须为正整数且不超过生产上限。');
    limits[key] = value;
  }
  return limits;
}
function hasInvalidXmlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13) continue;
    if (
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
    )
      continue;
    return true;
  }
  return false;
}
function validFileName(value: unknown, format: AutomationOutput): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.startsWith('.') ||
    value.includes('..') ||
    /[<>:"/\\|?*]/.test(value) ||
    [...value].some((character) => character.codePointAt(0)! < 32) ||
    hasInvalidXmlCharacters(value) ||
    /[. ]$/.test(value) ||
    Buffer.byteLength(value) > 180 ||
    win32.isAbsolute(value) ||
    isAbsolute(value)
  )
    fail('artifact.file_name_invalid', '文件名须为当前工作路径内的普通叶子名称。');
  const extension = format === 'spreadsheet' ? '.xlsx' : '.pptx';
  const name = extname(value) ? value : value + extension;
  if (
    Buffer.byteLength(name) > 180 ||
    extname(name).toLowerCase() !== extension ||
    /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)
  )
    fail('artifact.file_name_invalid', '文件扩展名或保留文件名无效。');
  return name;
}
function validateArgs(
  raw: unknown,
  limits: AutomationArtifactExportLimits,
): AutomationArtifactExportArgs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    fail('artifact.args_invalid', '导出参数须为 JSON object。');
  const input = raw as Record<string, unknown>;
  const allowedKeys = new Set(['format', 'fileName', 'title', 'columns', 'rows', 'slides']);
  if (Object.keys(input).some((key) => !allowedKeys.has(key)))
    fail('artifact.args_invalid', '导出参数包含未定义字段。');
  if (input.format !== 'spreadsheet' && input.format !== 'presentation')
    fail('artifact.format_invalid', '导出格式须为 spreadsheet 或 presentation。');
  const format = input.format;
  const fileName = validFileName(input.fileName, format);
  let inputBytes = Buffer.byteLength(fileName);
  const text = (value: unknown, label: string): string => {
    if (
      typeof value !== 'string' ||
      value.length > limits.maxTextLength ||
      hasInvalidXmlCharacters(value)
    )
      fail('artifact.text_invalid', `${label} 包含无效文本或超过长度上限。`);
    inputBytes += Buffer.byteLength(value, 'utf8');
    if (inputBytes > limits.maxInputBytes)
      fail('artifact.input_too_large', '导出输入超过字节配额。');
    return value;
  };
  const title = text(input.title, 'title');
  if (!title.trim()) fail('artifact.title_required', '导出标题须为非空文本。');
  if (format === 'spreadsheet') {
    if (!isEmptyFormatPayload(input.slides))
      fail('artifact.args_invalid', 'spreadsheet 仅使用 columns/rows；slides 请省略、设为 null 或 []。');
    if (input.columns !== undefined && !Array.isArray(input.columns))
      fail('artifact.columns_invalid', 'columns 须为字符串数组。');
    if (input.rows !== undefined && !Array.isArray(input.rows))
      fail('artifact.rows_invalid', 'rows 须为二维字符串或数字数组。');
    const rawColumns = (input.columns ?? []) as unknown[];
    const rawRows = (input.rows ?? []) as unknown[];
    if (rawColumns.length > limits.maxColumns) fail('artifact.columns_limit', '表格列数超过配额。');
    if (rawRows.length > limits.maxRows) fail('artifact.rows_limit', '表格行数超过配额。');
    let cellCount = rawColumns.length;
    if (cellCount > limits.maxCells) fail('artifact.cells_limit', '表格单元格数超过配额。');
    const columns = rawColumns.map((value) => text(value, 'column'));
    const rows = rawRows.map((value) => {
      if (!Array.isArray(value)) fail('artifact.rows_invalid', '每行须为数组。');
      if (value.length > limits.maxColumns || (columns.length > 0 && value.length > columns.length))
        fail('artifact.columns_limit', '数据行列数超过配额或已声明的 columns。');
      cellCount += value.length;
      if (cellCount > limits.maxCells) fail('artifact.cells_limit', '表格单元格数超过配额。');
      return value.map((cell) => {
        if (typeof cell === 'number') {
          if (!Number.isFinite(cell)) fail('artifact.cell_invalid', '数字单元格须为有限数值。');
          inputBytes += 8;
          if (inputBytes > limits.maxInputBytes)
            fail('artifact.input_too_large', '导出输入超过字节配额。');
          return cell;
        }
        return text(cell, 'cell');
      });
    });
    if (columns.length === 0 && rows.every((row) => row.length === 0))
      fail('artifact.data_required', '表格须包含列标题或实际数据。');
    return { format, fileName, title, columns, rows };
  }
  if (!isEmptyFormatPayload(input.columns) || !isEmptyFormatPayload(input.rows))
    fail('artifact.args_invalid', 'presentation 仅使用 slides；columns/rows 请省略、设为 null 或 []。');
  if (!Array.isArray(input.slides) || input.slides.length === 0)
    fail('artifact.slides_required', '演示文稿须包含至少一页 slides。');
  if (input.slides.length > limits.maxSlides) fail('artifact.slides_limit', '演示页数超过配额。');
  const slides = input.slides.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fail('artifact.slide_invalid', '每页须为 title/bullets object。');
    const slide = value as Record<string, unknown>;
    if (
      Object.keys(slide).some((key) => key !== 'title' && key !== 'bullets') ||
      !Array.isArray(slide.bullets)
    )
      fail('artifact.slide_invalid', '每页只接收 title 与 bullets 字符串数组。');
    if (slide.bullets.length > limits.maxBulletsPerSlide)
      fail('artifact.bullets_limit', '每页 bullet 数量超过配额。');
    const slideTitle = text(slide.title, 'slide title');
    if (!slideTitle.trim()) fail('artifact.slide_invalid', '每页标题须为非空文本。');
    return {
      title: slideTitle,
      bullets: slide.bullets.map((value: unknown) => text(value, 'bullet')),
    };
  });
  return { format, fileName, title, slides };
}
function within(root: string, target: string, allowRoot = false): boolean {
  const rel = relative(root, target);
  return (
    (allowRoot || rel !== '') && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  );
}
async function checkedDirectory(context: AutomationArtifactExportContext): Promise<string> {
  if (!isAbsolute(context.workspaceRoot) || !isAbsolute(context.workingDirectory))
    fail('artifact.workspace_invalid', '宿主须提供绝对 workspaceRoot 与 workingDirectory。');
  const root = resolve(context.workspaceRoot);
  const directory = resolve(context.workingDirectory);
  if (!within(root, directory, true))
    fail('artifact.outside_workspace', '本轮工作路径位于工作区之外。');
  try {
    const rootStat = await lstat(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
      fail('artifact.workspace_invalid', '工作区须为真实目录。');
    let current = root;
    const segments = relative(root, directory).split(sep).filter(Boolean);
    for (const segment of segments) {
      current = resolve(current, segment);
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        fail('artifact.directory_alias', '本轮工作路径包含目录别名或非目录节点。');
    }
    const canonicalRoot = await realpath(root);
    const canonicalDirectory = await realpath(directory);
    if (!within(canonicalRoot, canonicalDirectory, true))
      fail('artifact.outside_workspace', '本轮真实工作路径位于工作区之外。');
    return canonicalDirectory;
  } catch (error) {
    if (error instanceof AutomationArtifactExportError) throw error;
    fail('artifact.workspace_invalid', '工作区或本轮工作目录不存在或不可访问。');
  }
}
async function targetExists(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile())
      fail('artifact.target_invalid', '目标须为普通文件；目录与文件别名不接受写入。');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Real file export; caller binds this receipt to the actual run, independently of mail. */
export async function exportAutomationArtifact(
  rawArgs: unknown,
  context: AutomationArtifactExportContext,
): Promise<AutomationArtifactExportResult> {
  const policy: AutomationArtifactExportContext = {
    ...context,
    limits: context.limits ? { ...context.limits } : undefined,
  };
  const limits = inventoryLimits(policy.limits);
  const args = validateArgs(rawArgs, limits);
  const directory = await checkedDirectory(policy);
  const path = resolve(directory, args.fileName);
  if (!within(directory, path))
    fail('artifact.outside_working_directory', '产物路径须位于本轮工作目录中。');
  const existed = await targetExists(path);
  if (existed && policy.overwrite !== true)
    fail('artifact.already_exists', '同名产物已存在；宿主未启用覆盖机制。');
  const bytes = buildOfficeDocument(args, limits.maxOutputBytes);
  const temporaryPath = resolve(directory, `.automation-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let temporaryCreated = false;
  try {
    handle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    temporaryCreated = true;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Verify the host-owned path again before publication. Host keeps run directories stable.
    if ((await checkedDirectory(policy)) !== directory)
      fail('artifact.directory_changed', '写入期间本轮工作目录发生变化。');
    await targetExists(path);
    if (policy.overwrite === true) await rename(temporaryPath, path);
    else await link(temporaryPath, path); // Atomic no-clobber publication, including concurrent callers.
    return Object.freeze({
      format: args.format,
      fileName: args.fileName,
      title: args.title,
      path,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      overwritten: existed,
      ...(policy.runId ? { runId: policy.runId } : {}),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      fail('artifact.already_exists', '同名产物已被另一轮生成；本轮没有覆盖。');
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
    if (temporaryCreated)
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }
}
