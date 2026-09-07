import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export function escapeNsisPath(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('installer.extraction_path_invalid');
  return value.replaceAll('$', () => '$$').replaceAll('"', () => '$\\"');
}

function replaceExactlyOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) {
    throw new Error('installer.extraction_template_changed:' + needle);
  }
  return source.replace(needle, () => replacement);
}

export function createDirectExtractionScript(options) {
  const signature = '!macro extractUsing7za FILE';
  if (options.extractionTemplate.split(signature).length !== 2) {
    throw new Error('installer.extraction_template_changed:macro');
  }
  const start = options.extractionTemplate.indexOf(signature);
  const end = options.extractionTemplate.indexOf('!macroend', start);
  if (end < 0) throw new Error('installer.extraction_template_changed:macroend');
  const original = options.extractionTemplate.slice(start, end + '!macroend'.length);
  if (!original.includes('CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR')) {
    throw new Error('installer.extraction_template_changed:copy');
  }
  return replaceExactlyOnce(
    options.extractionTemplate,
    original,
    '!include "' + escapeNsisPath(options.extractionInclude) + '"',
  );
}

export async function resolveInstallerExtractionTools(workspaceRoot) {
  const workspaceRequire = createRequire(join(workspaceRoot, 'package.json'));
  const builderRequire = createRequire(workspaceRequire.resolve('electron-builder/package.json'));
  const libraryRoot = dirname(builderRequire.resolve('app-builder-lib/package.json'));
  const metadata = JSON.parse(await readFile(join(libraryRoot, 'package.json'), 'utf8'));
  if (metadata.version !== '26.15.3') {
    throw new Error('installer.extraction_builder_version_unverified:' + metadata.version);
  }
  const { getPath7za } = builderRequire(join(libraryRoot, 'out/toolsets/7zip.js'));
  const sevenZip = await getPath7za();
  const toolRoot = dirname(dirname(sevenZip));
  const license = join(toolRoot, 'LICENSE.txt');
  const copying = join(toolRoot, 'COPYING');
  await Promise.all([access(sevenZip), access(license), access(copying)]);
  return { sevenZip, license, copying, templateRoot: join(libraryRoot, 'templates/nsis') };
}

export async function prepareDirectExtractionScript(workspaceRoot, outputDir, customInclude) {
  const tools = await resolveInstallerExtractionTools(workspaceRoot);
  const includeRoot = join(outputDir, 'nsis-templates');
  await mkdir(includeRoot, { recursive: true });
  for (const source of [tools.templateRoot, join(tools.templateRoot, 'include')]) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.nsh')) {
        await copyFile(join(source, entry.name), join(includeRoot, entry.name));
      }
    }
  }
  const script = createDirectExtractionScript({
    ...tools,
    extractionTemplate: await readFile(
      join(tools.templateRoot, 'include/extractAppPackage.nsh'),
      'utf8',
    ),
    extractionInclude: join(workspaceRoot, 'apps/desktop/build/extract-direct.nsh'),
  });
  await writeFile(join(includeRoot, 'extractAppPackage.nsh'), script);
  const scriptPath = join(outputDir, 'installer-direct.nsh');
  await writeFile(
    scriptPath,
    [
      '!cd "' + escapeNsisPath(includeRoot) + '"',
      '!define SYNC_THINK_7ZA "' + escapeNsisPath(tools.sevenZip) + '"',
      '!define SYNC_THINK_7ZA_LICENSE "' + escapeNsisPath(tools.license) + '"',
      '!define SYNC_THINK_7ZA_COPYING "' + escapeNsisPath(tools.copying) + '"',
      '!include "' + escapeNsisPath(customInclude) + '"',
    ].join('\n'),
  );
  return scriptPath;
}
