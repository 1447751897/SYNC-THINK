import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportAutomationArtifact, AUTOMATION_EXPORT_ARTIFACT_TOOL_NAME } from './index.js';
import type { AutomationArtifactExportArgs, AutomationArtifactExportContext } from './index.js';
import { createOfficeZip, officeZipCrc32 } from './office-zip.js';

const roots: string[] = [];
const aliases: string[] = [];
afterEach(async () => {
  for (const alias of aliases.splice(0)) await unlink(alias);
  const temporaryRoot = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    const canonical = await realpath(root);
    const child = relative(temporaryRoot, canonical);
    if (
      !child.startsWith('sync-think-office-export-') ||
      child.includes(sep) ||
      child.includes('..')
    )
      throw new Error('Unexpected fixture cleanup path');
    await rm(canonical, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
  }
});
async function context(
  patch: Partial<AutomationArtifactExportContext> = {},
): Promise<AutomationArtifactExportContext> {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-office-export-'));
  roots.push(root);
  const workspaceRoot = join(root, 'workspace');
  const workingDirectory = join(workspaceRoot, 'runs', 'current');
  await mkdir(workingDirectory, { recursive: true });
  return { workspaceRoot, workingDirectory, runId: 'run-1', ...patch };
}
function workbook(patch: Partial<AutomationArtifactExportArgs> = {}): AutomationArtifactExportArgs {
  return {
    format: 'spreadsheet',
    fileName: 'report.xlsx',
    title: '真实表格',
    columns: ['名称', '数量'],
    rows: [
      ['中文 & <data>', 42],
      ['=HYPERLINK("https://example.invalid")', -0.5],
    ],
    ...patch,
  };
}
function deck(patch: Partial<AutomationArtifactExportArgs> = {}): AutomationArtifactExportArgs {
  return {
    format: 'presentation',
    fileName: 'report.pptx',
    title: '真实演示',
    slides: [
      { title: '第一页', bullets: ['证据 & <文本>', '第二项 😀'] },
      { title: '第二页', bullets: ['结论'] },
    ],
    ...patch,
  };
}
/** Independent central-directory reader; fixtures are actual files, not mocked receipts. */
function zipEntries(bytes: Buffer): Map<string, string> {
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  expect(bytes.readUInt16LE(end + 20)).toBe(0);
  const count = bytes.readUInt16LE(end + 10);
  expect(bytes.readUInt16LE(end + 8)).toBe(count);
  const centralStart = bytes.readUInt32LE(end + 16);
  let cursor = centralStart;
  const entries = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
    expect(bytes.readUInt16LE(cursor + 10)).toBe(0);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    expect(bytes.readUInt32LE(local + 22)).toBe(size);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    expect(bytes.subarray(local + 30, local + 30 + nameLength).toString('utf8')).toBe(name);
    expect(entries.has(name)).toBe(false);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    entries.set(name, bytes.subarray(start, start + size).toString('utf8'));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  expect(cursor).toBe(end);
  expect(cursor - centralStart).toBe(bytes.readUInt32LE(end + 12));
  return entries;
}
async function rejects(
  args: unknown,
  code: string,
  patch: Partial<AutomationArtifactExportContext> = {},
): Promise<void> {
  const host = await context(patch);
  await expect(exportAutomationArtifact(args, host)).rejects.toMatchObject({ code });
  expect(await readdir(host.workingDirectory)).toEqual([]);
}

describe('Real automation artifact export', () => {
  it('exposes the requested builtin tool name', () =>
    expect(AUTOMATION_EXPORT_ARTIFACT_TOOL_NAME).toBe('automation_export_artifact'));
  it('writes a real xlsx with exact size/hash and typed worksheet values', async () => {
    const host = await context();
    const receipt = await exportAutomationArtifact(workbook(), host);
    const bytes = await readFile(receipt.path);
    expect(receipt).toMatchObject({
      format: 'spreadsheet',
      path: join(await realpath(host.workingDirectory), 'report.xlsx'),
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      overwritten: false,
      runId: 'run-1',
    });
    expect((await stat(receipt.path)).size).toBe(receipt.size);
    const entries = zipEntries(bytes);
    expect(entries.get('xl/worksheets/sheet1.xml')).toContain('<v>42</v>');
    expect(entries.get('xl/worksheets/sheet1.xml')).toContain('中文 &amp; &lt;data&gt;');
    expect(entries.get('xl/worksheets/sheet1.xml')).toContain('t="inlineStr"');
    expect(entries.get('xl/worksheets/sheet1.xml')).not.toContain('<f>');
    expect(entries.get('xl/worksheets/sheet1.xml')).toContain(
      '=HYPERLINK(&quot;https://example.invalid&quot;)',
    );
    expect(entries.get('docProps/core.xml')).toContain('真实表格');
    expect(await readdir(host.workingDirectory)).toEqual(['report.xlsx']);
    expect('delivery' in receipt).toBe(false);
    expect('mailReceipt' in receipt).toBe(false);
  });
  it('writes a real pptx with slides, relationships, master, layout and theme', async () => {
    const host = await context();
    const receipt = await exportAutomationArtifact(deck(), host);
    const bytes = await readFile(receipt.path);
    const entries = zipEntries(bytes);
    expect(receipt.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(entries.get('ppt/slides/slide1.xml')).toContain('第一页');
    expect(entries.get('ppt/slides/slide1.xml')).toContain('证据 &amp; &lt;文本&gt;');
    expect(entries.get('ppt/slides/slide1.xml')).toContain('第二项 😀');
    expect(entries.get('ppt/slides/slide2.xml')).toContain('结论');
    expect(entries.get('ppt/_rels/presentation.xml.rels')).toContain('slides/slide2.xml');
    expect(entries.has('ppt/slideMasters/slideMaster1.xml')).toBe(true);
    expect(entries.has('ppt/slideLayouts/slideLayout1.xml')).toBe(true);
    expect(entries.has('ppt/theme/theme1.xml')).toBe(true);
    expect(entries.get('[Content_Types].xml')).toContain('presentation.main+xml');
    expect([...entries.keys()].every((name) => !name.includes('..') && !name.startsWith('/'))).toBe(
      true,
    );
  });
  it('supports a header-only workbook', async () => {
    const receipt = await exportAutomationArtifact(workbook({ rows: [] }), await context());
    expect(zipEntries(await readFile(receipt.path)).get('xl/worksheets/sheet1.xml')).toContain(
      '名称',
    );
  });
  it('supports rows without columns and multi-letter Excel coordinates', async () => {
    const args = workbook({ columns: [], rows: [Array.from({ length: 28 }, (_, index) => index)] });
    const receipt = await exportAutomationArtifact(args, await context());
    expect(zipEntries(await readFile(receipt.path)).get('xl/worksheets/sheet1.xml')).toContain(
      '<c r="AB1"><v>27</v></c>',
    );
  });
  it('adds the format extension when omitted', async () => {
    expect(
      (await exportAutomationArtifact(workbook({ fileName: 'report' }), await context())).fileName,
    ).toBe('report.xlsx');
  });
  it('treats code-looking slide text as escaped data', async () => {
    const receipt = await exportAutomationArtifact(
      deck({
        slides: [
          { title: '<script>alert(1)</script>', bullets: ['$(rm -rf /)', '<!DOCTYPE evil>'] },
        ],
      }),
      await context(),
    );
    const xml = zipEntries(await readFile(receipt.path)).get('ppt/slides/slide1.xml')!;
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).toContain('&lt;!DOCTYPE evil&gt;');
    expect(xml).not.toContain('<!DOCTYPE');
  });
  it('defaults to atomic no-overwrite and preserves the previous file', async () => {
    const host = await context();
    const first = await exportAutomationArtifact(workbook(), host);
    await expect(
      exportAutomationArtifact(workbook({ title: 'changed' }), host),
    ).rejects.toMatchObject({ code: 'artifact.already_exists' });
    expect(
      createHash('sha256')
        .update(await readFile(first.path))
        .digest('hex'),
    ).toBe(first.sha256);
    expect(await readdir(host.workingDirectory)).toEqual(['report.xlsx']);
  });
  it('atomically replaces a file only with explicit host overwrite policy', async () => {
    const host = await context({ overwrite: true });
    const first = await exportAutomationArtifact(workbook(), host);
    const second = await exportAutomationArtifact(
      workbook({ title: 'updated title', rows: [['new', 99]] }),
      host,
    );
    expect(second.overwritten).toBe(true);
    expect(second.sha256).not.toBe(first.sha256);
    expect(zipEntries(await readFile(second.path)).get('xl/worksheets/sheet1.xml')).toContain(
      '<v>99</v>',
    );
    expect(await readdir(host.workingDirectory)).toEqual(['report.xlsx']);
  });
  it('publishes exactly one complete file under concurrent no-overwrite calls', async () => {
    const host = await context();
    const results = await Promise.allSettled([
      exportAutomationArtifact(workbook(), host),
      exportAutomationArtifact(workbook({ rows: [['other', 11]] }), host),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('artifact.already_exists');
    zipEntries(await readFile(join(host.workingDirectory, 'report.xlsx')));
    expect(await readdir(host.workingDirectory)).toEqual(['report.xlsx']);
  });
  it('rejects existing directories as targets even with overwrite', async () => {
    const host = await context({ overwrite: true });
    await mkdir(join(host.workingDirectory, 'report.xlsx'));
    await expect(exportAutomationArtifact(workbook(), host)).rejects.toMatchObject({
      code: 'artifact.target_invalid',
    });
  });
  it('rejects an existing file target alias', async () => {
    const host = await context({ overwrite: true });
    const outside = join(roots[roots.length - 1]!, 'outside');
    await mkdir(outside);
    const alias = join(host.workingDirectory, 'report.xlsx');
    await symlink(outside, alias, 'junction');
    aliases.push(alias);
    await expect(exportAutomationArtifact(workbook(), host)).rejects.toMatchObject({
      code: 'artifact.target_invalid',
    });
  });
  it('rejects a working directory outside the actual workspace', async () => {
    const host = await context();
    const outside = join(roots[roots.length - 1]!, 'outside');
    await mkdir(outside);
    await expect(
      exportAutomationArtifact(workbook(), { ...host, workingDirectory: outside }),
    ).rejects.toMatchObject({ code: 'artifact.outside_workspace' });
    expect(await readdir(outside)).toEqual([]);
  });
  it('rejects path-prefix siblings rather than accepting workspace2', async () => {
    const host = await context();
    const sibling = host.workspaceRoot + '2';
    await mkdir(sibling);
    await expect(
      exportAutomationArtifact(workbook(), { ...host, workingDirectory: sibling }),
    ).rejects.toMatchObject({ code: 'artifact.outside_workspace' });
  });
  it('rejects directory aliases even when they point back inside the workspace', async () => {
    const host = await context();
    const alias = join(host.workspaceRoot, 'alias');
    await symlink(host.workingDirectory, alias, 'junction');
    aliases.push(alias);
    await expect(
      exportAutomationArtifact(workbook(), { ...host, workingDirectory: alias }),
    ).rejects.toMatchObject({ code: 'artifact.directory_alias' });
  });
  it('requires existing host-owned run directories and does not create paths', async () => {
    const host = await context();
    await expect(
      exportAutomationArtifact(workbook(), {
        ...host,
        workingDirectory: join(host.workspaceRoot, 'missing'),
      }),
    ).rejects.toMatchObject({ code: 'artifact.workspace_invalid' });
  });
  it('rejects relative host paths', async () => {
    await expect(
      exportAutomationArtifact(workbook(), { workspaceRoot: '.', workingDirectory: '.' }),
    ).rejects.toMatchObject({ code: 'artifact.workspace_invalid' });
  });
  it.each([
    '../outside.xlsx',
    '..\\outside.xlsx',
    '/absolute.xlsx',
    'C:\\outside.xlsx',
    'C:outside.xlsx',
    '\\\\server\\file.xlsx',
    'folder/report.xlsx',
    'file.xlsx:stream',
    'CON.xlsx',
    'aux.xlsx',
    'LPT1.xlsx',
    '.hidden.xlsx',
    'report.xlsx ',
    'report.exe',
    'nul.xlsx',
    'report\u0000.xlsx',
  ])('rejects path/filename %j', async (fileName) =>
    rejects(workbook({ fileName }), 'artifact.file_name_invalid'),
  );
  it.each([null, [], 'not-object', 1])('rejects invalid JSON argument %j', async (args) =>
    rejects(args, 'artifact.args_invalid'),
  );
  it('rejects unrecognized JSON fields including overwrite and workspace paths', async () =>
    rejects(
      { ...workbook(), overwrite: true, workspaceRoot: 'elsewhere' },
      'artifact.args_invalid',
    ));
  it('rejects unknown output formats', async () =>
    rejects({ ...workbook(), format: 'exe' }, 'artifact.format_invalid'));
  it('requires actual workbook content', async () =>
    rejects(workbook({ columns: [], rows: [] }), 'artifact.data_required'));
  it('requires a title', async () =>
    rejects(workbook({ title: '   ' }), 'artifact.title_required'));
  it('rejects boolean/object/formula-object cells', async () =>
    rejects({ ...workbook(), rows: [[{ formula: '=1+1' }]] }, 'artifact.text_invalid'));
  it.each([NaN, Infinity, -Infinity])('rejects non-finite numeric cells %j', async (number) =>
    rejects(workbook({ rows: [[number]] }), 'artifact.cell_invalid'),
  );
  it('rejects invalid XML control characters', async () =>
    rejects(workbook({ title: 'bad\u0001' }), 'artifact.text_invalid'));
  it('rejects unpaired UTF-16 surrogate text', async () =>
    rejects(workbook({ title: 'bad\ud800' }), 'artifact.text_invalid'));
  it('rejects an oversized individual text', async () =>
    rejects(workbook({ title: 'x'.repeat(32_768) }), 'artifact.text_invalid'));
  it('limits spreadsheet rows before file creation', async () =>
    rejects(
      workbook({
        rows: [
          ['a', 1],
          ['b', 2],
        ],
      }),
      'artifact.rows_limit',
      { limits: { maxRows: 1 } },
    ));
  it('limits spreadsheet columns', async () =>
    rejects(workbook(), 'artifact.columns_limit', { limits: { maxColumns: 1 } }));
  it('rejects data wider than declared columns', async () =>
    rejects(workbook({ rows: [['a', 1, 'unexpected']] }), 'artifact.columns_limit'));
  it('limits total cell count', async () =>
    rejects(workbook(), 'artifact.cells_limit', { limits: { maxCells: 2 } }));
  it('limits total input bytes', async () =>
    rejects(workbook(), 'artifact.input_too_large', { limits: { maxInputBytes: 20 } }));
  it('limits actual output ZIP bytes', async () =>
    rejects(workbook(), 'artifact.output_too_large', { limits: { maxOutputBytes: 100 } }));
  it('prevents host override from raising production ceilings', async () =>
    rejects(workbook(), 'artifact.limit_invalid', { limits: { maxRows: 10_001 } }));
  it.each([undefined, null, []])('exports a workbook with an empty unused slides placeholder %j', async (slides) => {
    const receipt = await exportAutomationArtifact({ ...workbook(), slides }, await context());
    const entries = zipEntries(await readFile(receipt.path));
    expect(entries.get('xl/worksheets/sheet1.xml')).toContain('<v>42</v>');
    expect([...entries.keys()].some(name => name.startsWith('ppt/'))).toBe(false);
  });
  it.each([undefined, null, []])('exports a presentation with empty unused table placeholders %j', async (placeholder) => {
    const receipt = await exportAutomationArtifact({ ...deck(), columns: placeholder, rows: placeholder }, await context());
    expect(zipEntries(await readFile(receipt.path)).get('ppt/slides/slide1.xml')).toContain('第一页');
  });
  it.each(['', {}, false, [{ title: 'PPT content', bullets: ['Not empty'] }]])('rejects populated or malformed slides in a spreadsheet %j', async (slides) => {
    await rejects({ ...workbook(), slides }, 'artifact.args_invalid');
  });
  it('rejects mixed-format data', async () =>
    rejects({ ...deck(), rows: [[1]] }, 'artifact.args_invalid'));
  it('requires at least one slide', async () =>
    rejects(deck({ slides: [] }), 'artifact.slides_required'));
  it('limits slides', async () =>
    rejects(deck(), 'artifact.slides_limit', { limits: { maxSlides: 1 } }));
  it('limits bullets per slide', async () =>
    rejects(deck(), 'artifact.bullets_limit', { limits: { maxBulletsPerSlide: 1 } }));
  it('rejects slide object paths or other extra fields', async () =>
    rejects(
      { ...deck(), slides: [{ title: 'x', bullets: [], entryName: '../evil' }] },
      'artifact.slide_invalid',
    ));
});

describe('Office ZIP entry boundary', () => {
  it('uses the known IEEE CRC32 test vector', () =>
    expect(officeZipCrc32(Buffer.from('123456789'))).toBe(0xcbf43926));
  it.each([
    '../evil.xml',
    '/absolute.xml',
    'C:/evil.xml',
    'folder\\evil.xml',
    'a/../../evil.xml',
    'a//evil.xml',
    'a/./evil.xml',
    'a/../evil.xml',
    'a\u0000.xml',
  ])('rejects malicious entry %j', (name) => {
    expect(() => createOfficeZip([{ name, data: 'fixture' }], 1000)).toThrow('ZIP entry');
  });
  it('rejects duplicate entries', () =>
    expect(() =>
      createOfficeZip(
        [
          { name: 'a.xml', data: 'a' },
          { name: 'a.xml', data: 'b' },
        ],
        1000,
      ),
    ).toThrow('ZIP entry'));
  it('rejects excessive entry counts and output bytes', () => {
    expect(() =>
      createOfficeZip(
        Array.from({ length: 513 }, (_, index) => ({ name: `a${index}.xml`, data: 'x' })),
        100_000,
      ),
    ).toThrow('条目数');
    expect(() => createOfficeZip([{ name: 'a.xml', data: 'x'.repeat(1000) }], 100)).toThrow(
      '输出字节',
    );
  });
});

const python = spawnSync('python', ['-c', 'import zipfile, xml.etree.ElementTree'], {
  encoding: 'utf8',
  windowsHide: true,
});
describe.skipIf(python.status !== 0)('Independent Python stdlib ZIP/XML reverse parser', () => {
  it.each(['spreadsheet', 'presentation'] as const)(
    'validates CRC, all XML and relationship targets for %s',
    async (format) => {
      const receipt = await exportAutomationArtifact(
        format === 'spreadsheet' ? workbook() : deck(),
        await context(),
      );
      const script = `import zipfile,sys,posixpath,xml.etree.ElementTree as E\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n names=set(z.namelist())\n for name in names:\n  root=E.fromstring(z.read(name))\n  if name.endswith('.rels'):\n   base=posixpath.dirname(posixpath.dirname(name)) if name!='_rels/.rels' else ''\n   for item in root:\n    target=posixpath.normpath(posixpath.join(base,item.attrib['Target']))\n    assert target in names,(name,target)\n print('validated')`;
      const parsed = spawnSync('python', ['-c', script, receipt.path], {
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(parsed.stderr).toBe('');
      expect(parsed.status).toBe(0);
      expect(parsed.stdout.trim()).toBe('validated');
    },
  );
});

const officeParserPython = process.env.SYNC_THINK_OFFICE_VERIFY_PYTHON;
describe.skipIf(!officeParserPython)('Optional independent Office application parsers', () => {
  it('round-trips actual values and literal formula-like text through openpyxl', async () => {
    const receipt = await exportAutomationArtifact(workbook(), await context());
    const script = `import sys,openpyxl\nw=openpyxl.load_workbook(sys.argv[1])\nassert list(w.active.values)==[('名称','数量'),('中文 & <data>',42),('=HYPERLINK("https://example.invalid")',-0.5)]\nassert w.active['A3'].data_type=='s'\nassert w.properties.title=='真实表格'\nprint('openpyxl verified')`;
    const result = spawnSync(officeParserPython!, ['-c', script, receipt.path], {
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('openpyxl verified');
  });
  it('round-trips real slide titles and bullets through python-pptx', async () => {
    const receipt = await exportAutomationArtifact(deck(), await context());
    const script = `import sys\nfrom pptx import Presentation\np=Presentation(sys.argv[1])\nassert len(p.slides)==2\nassert p.slides[0].shapes.title.text=='第一页'\nassert p.slides[1].shapes.title.text=='第二页'\ntext='|'.join(s.text for s in p.slides[0].shapes if s.has_text_frame)\nassert '证据 & <文本>' in text and '第二项 😀' in text\nassert len(p.slide_masters)==1 and len(p.slide_layouts)==1\nassert p.core_properties.title=='真实演示'\nprint('python-pptx verified')`;
    const result = spawnSync(officeParserPython!, ['-c', script, receipt.path], {
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('python-pptx verified');
  });
});

describe('Artifact run-policy capture', () => {
  it('captures host path, overwrite and run identity before any filesystem await', async () => {
    const host = { ...(await context()) };
    const original = host.workingDirectory;
    const alternate = join(host.workspaceRoot, 'runs', 'next');
    await mkdir(alternate);
    const pending = exportAutomationArtifact(workbook(), host);
    host.workingDirectory = alternate;
    host.runId = 'edited-after-export-start';
    host.overwrite = true;
    const result = await pending;
    expect(result.path).toBe(join(await realpath(original), 'report.xlsx'));
    expect(result.runId).toBe('run-1');
    expect(await readdir(alternate)).toEqual([]);
  });
  it('includes header-only cells in the cell quota', async () => {
    await rejects(workbook({ rows: [] }), 'artifact.cells_limit', { limits: { maxCells: 1 } });
  });
});
