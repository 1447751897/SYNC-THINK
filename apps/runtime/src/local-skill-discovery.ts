/**
 * NewMax-compatible local Skill discovery and installation.
 *
 * A Skill is a directory whose root contains SKILL.md. Importing copies the
 * complete directory so scripts, assets, references, and templates stay intact.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  watch,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import extractZip from 'extract-zip';
import type {
  LocalSkillCandidate,
  LocalSkillSourceSummary,
  LocalSkillSourceType,
  SkillLocalInspectItem,
} from '@sync-think/protocol';
import { parseSkillFrontmatter } from '@sync-think/core';

/** SYNC-THINK's managed global Skill library. */
export function localSkillsDirectory(): string {
  return join(homedir(), '.sync-think', 'skills');
}

/** User-level Claude skills are recognized in the same way as NewMax. */
export function userClaudeSkillsDirectory(): string {
  return join(homedir(), '.claude', 'skills');
}

/** Workspace installs use <workspace>/.claude/skills. */
export function workspaceSkillsDirectory(workspaceFolder: string): string {
  return join(workspaceFolder, '.claude', 'skills');
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonObject(path: string): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isJsonObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function mergeEnabledPlugins(target: Map<string, boolean>, settingsPath: string): void {
  const enabledPlugins = readJsonObject(settingsPath)?.enabledPlugins;
  if (!isJsonObject(enabledPlugins)) return;
  for (const [pluginId, enabled] of Object.entries(enabledPlugins)) {
    if (typeof enabled === 'boolean') target.set(pluginId, enabled);
  }
}

interface ClaudePluginRoot {
  root: string;
  pluginName: string;
  marketplaceName: string;
  modifiedAt: number;
}

function discoverClaudePluginRoots(cacheRoot: string): ClaudePluginRoot[] {
  if (!existsSync(cacheRoot)) return [];
  const roots: ClaudePluginRoot[] = [];
  const seen = new Set<string>();

  const walk = (directory: string, depth: number): void => {
    if (depth > 4) return;
    const relativePath = relative(cacheRoot, directory);
    const parts = relativePath && relativePath !== '.' ? relativePath.split(/[\\/]/) : [];
    const skillsDirectory = join(directory, 'skills');
    if (parts.length >= 2 && existsSync(skillsDirectory)) {
      const manifest = readJsonObject(join(directory, '.claude-plugin', 'plugin.json'));
      const manifestName = typeof manifest?.name === 'string' ? manifest.name.trim() : '';
      const canonical = canonicalSourcePath(directory);
      if (!seen.has(canonical)) {
        seen.add(canonical);
        roots.push({
          root: directory,
          pluginName: manifestName || parts[1]!,
          marketplaceName: parts[0]!,
          modifiedAt: statSync(directory).mtimeMs,
        });
      }
      return;
    }
    for (const entry of safeDirectoryEntries(directory)) {
      const child = join(directory, entry);
      try {
        if (statSync(child).isDirectory()) walk(child, depth + 1);
      } catch {
        // Ignore cache entries removed during discovery.
      }
    }
  };

  walk(cacheRoot, 0);
  return roots;
}

export interface EnabledClaudePluginSkillSourceOptions {
  claudeDirectory?: string;
  workspaceFolder?: string;
  workspaceId?: string;
  includeUserSettings?: boolean;
}

/** Resolve explicitly enabled Claude plugins to their cached skills directories. */
export function enabledClaudePluginSkillSources(
  options: EnabledClaudePluginSkillSourceOptions = {},
): LocalSkillSourceInput[] {
  const claudeDirectory = options.claudeDirectory ?? join(homedir(), '.claude');
  const enabled = new Map<string, boolean>();
  if (options.includeUserSettings !== false) {
    mergeEnabledPlugins(enabled, join(claudeDirectory, 'settings.json'));
  }
  if (options.workspaceFolder) {
    const workspaceClaude = join(options.workspaceFolder, '.claude');
    mergeEnabledPlugins(enabled, join(workspaceClaude, 'settings.json'));
    mergeEnabledPlugins(enabled, join(workspaceClaude, 'settings.local.json'));
  }

  const enabledIds = [...enabled.entries()]
    .filter(([, active]) => active)
    .map(([pluginId]) => pluginId);
  if (enabledIds.length === 0) return [];

  const roots = discoverClaudePluginRoots(join(claudeDirectory, 'plugins', 'cache'));
  const result: LocalSkillSourceInput[] = [];
  for (const pluginId of enabledIds) {
    const at = pluginId.lastIndexOf('@');
    const pluginName = at > 0 ? pluginId.slice(0, at) : pluginId;
    const marketplaceName = at > 0 ? pluginId.slice(at + 1) : '';
    const root = roots
      .filter(
        (candidate) =>
          candidate.pluginName === pluginName &&
          (!marketplaceName || candidate.marketplaceName === marketplaceName),
      )
      .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
    if (!root) continue;
    result.push({
      directory: join(root.root, 'skills'),
      type: 'plugin',
      label: `插件 · ${pluginName}`,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    });
  }
  return result;
}

const MAX_DEPTH = 4;
const MAX_FILES = 500;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.sync-think',
  'dist',
  'build',
  '.next',
  '_disabled',
]);

export interface LocalSkillSourceInput {
  directory: string;
  type: LocalSkillSourceType;
  label: string;
  workspaceId?: string;
}

export interface ResolvedLocalSkillPackage {
  sourcePath: string;
  sourceType: 'folder' | 'file' | 'zip';
  skills: SkillLocalInspectItem[];
  cleanup(): void;
}

export interface InstalledLocalSkillFolder extends SkillLocalInspectItem {
  installedDirectory: string;
  installedSkillMdPath: string;
}

export interface InstallLocalSkillFoldersResult {
  installed: InstalledLocalSkillFolder[];
  conflictNames: string[];
}

export function frontmatterOf(content: string): {
  name?: string;
  description?: string;
  summary?: string;
} {
  const normalizedContent = String(content ?? '').replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(normalizedContent);
  const meta = match ? parseSkillFrontmatter(normalizedContent) : {};
  const body = match ? normalizedContent.slice(match[0].length) : normalizedContent;
  const firstLine =
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#')) ?? '';
  return {
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(firstLine ? { summary: firstLine.slice(0, 120) } : {}),
  };
}

function safeDirectoryEntries(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function findSkillMarkdown(directory: string): string | undefined {
  const fileName = safeDirectoryEntries(directory).find(
    (entry) => entry.toLocaleLowerCase() === 'skill.md',
  );
  if (!fileName) return undefined;
  const candidate = join(directory, fileName);
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function inspectSkillDirectory(directory: string, skillMdPath: string): SkillLocalInspectItem {
  const content = readFileSync(skillMdPath, 'utf8');
  const metadata = frontmatterOf(content);
  const folderName = basename(directory);
  return {
    folderName,
    name: metadata.name ?? folderName,
    description: metadata.description ?? metadata.summary ?? '',
    skillDirectory: directory,
    skillMdPath,
    hasScripts: existsSync(join(directory, 'scripts')),
  };
}

/**
 * Discover one Skill root or a bundle containing multiple Skill folders.
 * A directory that already contains SKILL.md is terminal and is never searched
 * recursively, matching NewMax's directory-oriented source enumeration.
 */
export function discoverSkillFolders(root: string): SkillLocalInspectItem[] {
  const found: SkillLocalInspectItem[] = [];
  const seen = new Set<string>();

  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    const skillMdPath = findSkillMarkdown(directory);
    if (skillMdPath) {
      const key = resolve(skillMdPath).toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        found.push(inspectSkillDirectory(directory, skillMdPath));
      }
      return;
    }
    for (const entry of safeDirectoryEntries(directory)) {
      if (SKIP_DIRS.has(entry)) continue;
      const child = join(directory, entry);
      try {
        if (statSync(child).isDirectory()) walk(child, depth + 1);
      } catch {
        // Ignore an entry that disappeared while scanning.
      }
    }
  };

  walk(resolve(root), 0);
  return found;
}

/** Resolve a selected folder, SKILL.md, or ZIP into Skill directory roots. */
export async function resolveLocalSkillPackage(
  sourcePath: string,
): Promise<ResolvedLocalSkillPackage> {
  const absolutePath = resolve(sourcePath);
  if (!existsSync(absolutePath)) throw new Error('选择的 Skill 文件或文件夹不存在');
  const sourceStat = statSync(absolutePath);
  let packageRoot = absolutePath;
  let sourceType: ResolvedLocalSkillPackage['sourceType'];
  let temporaryDirectory: string | undefined;

  if (sourceStat.isDirectory()) {
    sourceType = 'folder';
  } else if (sourceStat.isFile() && extname(absolutePath).toLocaleLowerCase() === '.zip') {
    sourceType = 'zip';
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'sync-think-skill-import-'));
    try {
      await extractZip(absolutePath, { dir: temporaryDirectory });
    } catch (error) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
      throw new Error(`ZIP 解压失败：${error instanceof Error ? error.message : String(error)}`);
    }
    packageRoot = temporaryDirectory;
  } else if (sourceStat.isFile() && basename(absolutePath).toLocaleLowerCase() === 'skill.md') {
    sourceType = 'file';
    packageRoot = dirname(absolutePath);
  } else {
    throw new Error('请选择包含 SKILL.md 的文件夹、SKILL.md 文件或 ZIP 文件');
  }

  try {
    let skills = discoverSkillFolders(packageRoot);
    if (skills.length === 0) throw new Error('所选内容中没有找到 SKILL.md');
    if (
      sourceType === 'zip' &&
      skills.length === 1 &&
      resolve(skills[0]!.skillDirectory) === resolve(packageRoot)
    ) {
      const zipFolderName = basename(absolutePath, extname(absolutePath));
      skills = [{ ...skills[0]!, folderName: zipFolderName }];
    }
    return {
      sourcePath: absolutePath,
      sourceType,
      skills,
      cleanup: () => {
        if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

function safeSkillFolderName(folderName: string): string {
  const normalized = folderName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error(`Skill 文件夹名称无效：${folderName}`);
  }
  return normalized.slice(0, 120);
}

/** Copy complete Skill directories into a managed global/workspace library. */
export function installLocalSkillFolders(
  skills: readonly SkillLocalInspectItem[],
  destinationRoot: string,
  overwrite: boolean,
): InstallLocalSkillFoldersResult {
  const targetRoot = resolve(destinationRoot);
  const targets = skills.map((skill) => ({
    skill,
    folderName: safeSkillFolderName(skill.folderName),
  }));
  const duplicate = targets.find(
    (target, index) =>
      targets.findIndex(
        (other) => other.folderName.toLocaleLowerCase() === target.folderName.toLocaleLowerCase(),
      ) !== index,
  );
  if (duplicate) throw new Error(`导入包内存在重复 Skill 文件夹：${duplicate.folderName}`);

  const conflictNames = targets
    .filter(({ folderName }) => existsSync(join(targetRoot, folderName)))
    .map(({ skill }) => skill.name);
  if (conflictNames.length > 0 && !overwrite) return { installed: [], conflictNames };

  mkdirSync(targetRoot, { recursive: true });
  const installed: InstalledLocalSkillFolder[] = [];
  for (const { skill, folderName } of targets) {
    const destination = join(targetRoot, folderName);
    const rel = relative(targetRoot, destination);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
      throw new Error(`Skill 安装路径无效：${destination}`);
    }
    const stagingRoot = mkdtempSync(join(targetRoot, '.skill-import-'));
    const stagedDirectory = join(stagingRoot, folderName);
    try {
      cpSync(skill.skillDirectory, stagedDirectory, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
      renameSync(stagedDirectory, destination);
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
    const installedSkillMdPath = findSkillMarkdown(destination);
    if (!installedSkillMdPath) {
      throw new Error(`安装后的 Skill 缺少 SKILL.md：${destination}`);
    }
    installed.push({
      ...skill,
      skillDirectory: destination,
      skillMdPath: installedSkillMdPath,
      installedDirectory: destination,
      installedSkillMdPath,
    });
  }
  return { installed, conflictNames: [] };
}

/** Recursively scan a single Skill source directory. */
export function scanLocalSkills(directory: string): LocalSkillCandidate[] {
  const candidates: LocalSkillCandidate[] = [];
  if (!existsSync(directory)) return candidates;
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || candidates.length >= MAX_FILES) return;
    for (const name of safeDirectoryEntries(dir)) {
      if (candidates.length >= MAX_FILES) return;
      const full = join(dir, name);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        if (!SKIP_DIRS.has(name)) walk(full, depth + 1);
        continue;
      }
      if (name.toLocaleLowerCase() !== 'skill.md') continue;
      try {
        const content = readFileSync(full, 'utf8');
        const meta = frontmatterOf(content);
        const stat = statSync(full);
        candidates.push({
          path: full,
          skillDirectory: dir,
          folderName: basename(dir) || 'skill',
          ...(meta.name ? { name: meta.name } : {}),
          ...(meta.description ? { description: meta.description } : {}),
          ...(meta.summary ? { summary: meta.summary } : {}),
          imported: false,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // A malformed or transient file does not invalidate the other sources.
      }
    }
  };
  walk(resolve(directory), 0);
  return candidates;
}

function canonicalSourcePath(path: string): string {
  try {
    return realpathSync.native(path).toLocaleLowerCase();
  } catch {
    return resolve(path).toLocaleLowerCase();
  }
}

/** Scan sources in precedence order and de-duplicate junctions/overlapping roots. */
export function scanLocalSkillSources(
  sources: readonly LocalSkillSourceInput[],
): LocalSkillCandidate[] {
  const seenFiles = new Map<string, number>();
  const result: LocalSkillCandidate[] = [];
  for (const source of sources) {
    for (const candidate of scanLocalSkills(source.directory)) {
      const key = canonicalSourcePath(candidate.path);
      const existingIndex = seenFiles.get(key);
      if (existingIndex !== undefined) {
        if (source.workspaceId) {
          const existing = result[existingIndex]!;
          const workspaceIds = new Set([
            ...(existing.workspaceIds ?? []),
            ...(existing.workspaceId ? [existing.workspaceId] : []),
            source.workspaceId,
          ]);
          existing.workspaceIds = [...workspaceIds];
        }
        continue;
      }
      seenFiles.set(key, result.length);
      result.push({
        ...candidate,
        sourceType: source.type,
        sourceLabel: source.label,
        ...(source.workspaceId ? { workspaceId: source.workspaceId } : {}),
        ...(source.workspaceId ? { workspaceIds: [source.workspaceId] } : {}),
      });
    }
  }
  return result;
}

export type LocalSkillChangeListener = () => void;

/** Watch one source directory recursively with a 300 ms debounce. */
export function watchLocalSkills(
  directory: string,
  onChange: LocalSkillChangeListener,
): () => void {
  if (!existsSync(directory)) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(directory, { recursive: true }, () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!stopped) onChange();
      }, 300);
    });
  } catch {
    return () => undefined;
  }
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      watcher?.close();
    } catch {
      // Ignore a watcher that was already closed by the platform.
    }
  };
}

export function summarizeLocalSkillSource(
  source: LocalSkillSourceInput,
  watching: boolean,
): LocalSkillSourceSummary {
  return {
    ...source,
    exists: existsSync(source.directory),
    watching,
  };
}
