import type { AutomationArtifactExportArgs } from './types.js';
import { createOfficeZip } from './office-zip.js';
import type { OfficeZipEntry } from './office-zip.js';

const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const packageRels = 'http://schemas.openxmlformats.org/package/2006/relationships';
const documentRels = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function rels(items: readonly { id: string; type: string; target: string }[]): string {
  return `${declaration}<Relationships xmlns="${packageRels}">${items.map((item) => `<Relationship Id="${item.id}" Type="${item.type}" Target="${item.target}"/>`).join('')}</Relationships>`;
}
function contentTypes(overrides: readonly { part: string; type: string }[]): string {
  return `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map((item) => `<Override PartName="/${item.part}" ContentType="${item.type}"/>`).join('')}</Types>`;
}
function metadata(args: AutomationArtifactExportArgs, mainPart: string): OfficeZipEntry[] {
  return [
    {
      name: '_rels/.rels',
      data: rels([
        { id: 'rId1', type: documentRels + '/officeDocument', target: mainPart },
        {
          id: 'rId2',
          type: packageRels + '/metadata/core-properties',
          target: 'docProps/core.xml',
        },
        { id: 'rId3', type: documentRels + '/extended-properties', target: 'docProps/app.xml' },
      ]),
    },
    {
      name: 'docProps/core.xml',
      data: `${declaration}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(args.title)}</dc:title><dc:creator>SYNC-THINK</dc:creator><cp:lastModifiedBy>SYNC-THINK</cp:lastModifiedBy></cp:coreProperties>`,
    },
    {
      name: 'docProps/app.xml',
      data: `${declaration}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>SYNC-THINK</Application>${args.format === 'presentation' ? `<PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${args.slides!.length}</Slides>` : '<TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Data</vt:lpstr></vt:vector></TitlesOfParts>'}</Properties>`,
    },
  ];
}
function columnName(index: number): string {
  let name = '';
  while (index > 0) {
    index--;
    name = String.fromCharCode(65 + (index % 26)) + name;
    index = Math.floor(index / 26);
  }
  return name;
}
function worksheet(args: AutomationArtifactExportArgs): string {
  const columns = args.columns ?? [];
  const rows = args.rows ?? [];
  const width = Math.max(1, columns.length, ...rows.map((row) => row.length));
  const count = rows.length + (columns.length ? 1 : 0);
  const cell = (value: string | number, row: number, column: number, header: boolean): string => {
    const reference = columnName(column + 1) + row;
    // Every string, including =... and @..., stays an inline string: no formulas or code.
    return typeof value === 'number'
      ? `<c r="${reference}"><v>${String(value)}</v></c>`
      : `<c r="${reference}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  };
  const records: string[] = [];
  if (columns.length)
    records.push(
      `<row r="1">${columns.map((value, index) => cell(value, 1, index, true)).join('')}</row>`,
    );
  for (let index = 0; index < rows.length; index++) {
    const number = index + 1 + (columns.length ? 1 : 0);
    records.push(
      `<row r="${number}">${rows[index]!.map((value, column) => cell(value, number, column, false)).join('')}</row>`,
    );
  }
  return `${declaration}<worksheet xmlns="${spreadsheet}"><dimension ref="A1:${columnName(width)}${Math.max(1, count)}"/><sheetViews><sheetView workbookViewId="0">${columns.length ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="${width}" width="22" customWidth="1"/></cols><sheetData>${records.join('')}</sheetData>${columns.length ? `<autoFilter ref="A1:${columnName(width)}${count}"/>` : ''}</worksheet>`;
}
function spreadsheetEntries(args: AutomationArtifactExportArgs): OfficeZipEntry[] {
  const mainType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  return [
    ...metadata(args, 'xl/workbook.xml'),
    {
      name: '[Content_Types].xml',
      data: contentTypes([
        { part: 'xl/workbook.xml', type: mainType + 'sheet.main+xml' },
        { part: 'xl/worksheets/sheet1.xml', type: mainType + 'worksheet+xml' },
        { part: 'xl/styles.xml', type: mainType + 'styles+xml' },
        {
          part: 'docProps/core.xml',
          type: 'application/vnd.openxmlformats-package.core-properties+xml',
        },
        {
          part: 'docProps/app.xml',
          type: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
        },
      ]),
    },
    {
      name: 'xl/workbook.xml',
      data: `${declaration}<workbook xmlns="${spreadsheet}" xmlns:r="${documentRels}"><bookViews><workbookView/></bookViews><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: rels([
        { id: 'rId1', type: documentRels + '/worksheet', target: 'worksheets/sheet1.xml' },
        { id: 'rId2', type: documentRels + '/styles', target: 'styles.xml' },
      ]),
    },
    { name: 'xl/worksheets/sheet1.xml', data: worksheet(args) },
    {
      name: 'xl/styles.xml',
      data: `${declaration}<styleSheet xmlns="${spreadsheet}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5EEF9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
  ];
}
const groupTree =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const colorMap =
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
function paragraph(value: string, isTitle: boolean): string {
  return `<a:p><a:pPr${isTitle ? '' : ' marL="342900" indent="-285750"'}>${isTitle ? '<a:buNone/>' : '<a:buChar char="•"/>'}</a:pPr><a:r><a:rPr lang="zh-CN" sz="${isTitle ? 3200 : 2000}"${isTitle ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="243247"/></a:solidFill></a:rPr><a:t xml:space="preserve">${xml(value)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${isTitle ? 3200 : 2000}"/></a:p>`;
}
function shape(id: number, paragraphs: readonly string[], isTitle: boolean): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${isTitle ? 'Title' : 'Content'}"/><p:cNvSpPr/><p:nvPr><p:ph type="${isTitle ? 'title' : 'body'}"${isTitle ? '' : ' idx="1"'}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="594360" y="${isTitle ? 411480 : 1554480}"/><a:ext cx="11003280" cy="${isTitle ? 1005840 : 4709160}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs.length ? paragraphs.join('') : '<a:p/>'}</p:txBody></p:sp>`;
}
function slideXml(slide: { readonly title: string; readonly bullets: readonly string[] }): string {
  return `${declaration}<p:sld xmlns:a="${drawing}" xmlns:r="${documentRels}" xmlns:p="${presentation}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${groupTree}${shape(2, [paragraph(slide.title, true)], true)}${shape(
    3,
    slide.bullets.map((value) => paragraph(value, false)),
    false,
  )}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
function themeXml(): string {
  const colors = [
    ['dk1', '243247'],
    ['lt1', 'FFFFFF'],
    ['dk2', '526174'],
    ['lt2', 'F4F7FA'],
    ['accent1', '397AC7'],
    ['accent2', '00A18C'],
    ['accent3', 'F2A649'],
    ['accent4', '8464B6'],
    ['accent5', 'DC6A71'],
    ['accent6', '6B93AA'],
    ['hlink', '0563C1'],
    ['folHlink', '954F72'],
  ];
  const font =
    '<a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/>';
  const fills = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3);
  const lines = [6350, 12700, 19050]
    .map(
      (width) =>
        `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`,
    )
    .join('');
  return `${declaration}<a:theme xmlns:a="${drawing}" name="SYNC-THINK"><a:themeElements><a:clrScheme name="SYNC-THINK">${colors.map(([name, color]) => `<a:${name}><a:srgbClr val="${color}"/></a:${name}>`).join('')}</a:clrScheme><a:fontScheme name="Office"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>${fills}</a:fillStyleLst><a:lnStyleLst>${lines}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fills}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}
function presentationEntries(args: AutomationArtifactExportArgs): OfficeZipEntry[] {
  const slides = args.slides!;
  const mainType = 'application/vnd.openxmlformats-officedocument.presentationml.';
  const slideIds = slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
    .join('');
  const entries: OfficeZipEntry[] = [
    ...metadata(args, 'ppt/presentation.xml'),
    {
      name: '[Content_Types].xml',
      data: contentTypes([
        { part: 'ppt/presentation.xml', type: mainType + 'presentation.main+xml' },
        { part: 'ppt/slideMasters/slideMaster1.xml', type: mainType + 'slideMaster+xml' },
        { part: 'ppt/slideLayouts/slideLayout1.xml', type: mainType + 'slideLayout+xml' },
        {
          part: 'ppt/theme/theme1.xml',
          type: 'application/vnd.openxmlformats-officedocument.theme+xml',
        },
        ...slides.map((_, index) => ({
          part: `ppt/slides/slide${index + 1}.xml`,
          type: mainType + 'slide+xml',
        })),
        {
          part: 'docProps/core.xml',
          type: 'application/vnd.openxmlformats-package.core-properties+xml',
        },
        {
          part: 'docProps/app.xml',
          type: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
        },
      ]),
    },
    {
      name: 'ppt/presentation.xml',
      data: `${declaration}<p:presentation xmlns:a="${drawing}" xmlns:r="${documentRels}" xmlns:p="${presentation}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:defaultTextStyle></p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: rels([
        {
          id: 'rId1',
          type: documentRels + '/slideMaster',
          target: 'slideMasters/slideMaster1.xml',
        },
        ...slides.map((_, index) => ({
          id: `rId${index + 2}`,
          type: documentRels + '/slide',
          target: `slides/slide${index + 1}.xml`,
        })),
      ]),
    },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      data: `${declaration}<p:sldMaster xmlns:a="${drawing}" xmlns:r="${documentRels}" xmlns:p="${presentation}"><p:cSld><p:spTree>${groupTree}</p:spTree></p:cSld>${colorMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>`,
    },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: rels([
        {
          id: 'rId1',
          type: documentRels + '/slideLayout',
          target: '../slideLayouts/slideLayout1.xml',
        },
        { id: 'rId2', type: documentRels + '/theme', target: '../theme/theme1.xml' },
      ]),
    },
    {
      name: 'ppt/slideLayouts/slideLayout1.xml',
      data: `${declaration}<p:sldLayout xmlns:a="${drawing}" xmlns:r="${documentRels}" xmlns:p="${presentation}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${groupTree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: rels([
        {
          id: 'rId1',
          type: documentRels + '/slideMaster',
          target: '../slideMasters/slideMaster1.xml',
        },
      ]),
    },
    { name: 'ppt/theme/theme1.xml', data: themeXml() },
  ];
  for (let index = 0; index < slides.length; index++) {
    entries.push(
      { name: `ppt/slides/slide${index + 1}.xml`, data: slideXml(slides[index]!) },
      {
        name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
        data: rels([
          {
            id: 'rId1',
            type: documentRels + '/slideLayout',
            target: '../slideLayouts/slideLayout1.xml',
          },
        ]),
      },
    );
  }
  return entries;
}
/** Input has already been validated and copied by the exporter. Fixed entry names only. */
export function buildOfficeDocument(args: AutomationArtifactExportArgs, maxBytes: number): Buffer {
  return createOfficeZip(
    args.format === 'spreadsheet' ? spreadsheetEntries(args) : presentationEntries(args),
    maxBytes,
  );
}
