import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const levels = Object.freeze({ UN: 0, LW: 4096, ME: 8192, MP: 8448, HI: 12288, SI: 16384 });

export function parseWindowsIntegrityLabel(sddl) {
  if (typeof sddl !== 'string' || (sddl !== '' && !sddl.startsWith('S:'))) {
    throw new Error('installer.integrity_descriptor_invalid');
  }
  const labels = [...sddl.matchAll(/\(ML;([^;]*);[^;]*;[^;]*;[^;]*;([^)]*)\)/g)];
  if (sddl.includes('(ML;') && labels.length === 0) {
    throw new Error('installer.integrity_descriptor_invalid');
  }
  // Unlabelled Windows files have the normal, implicit Medium integrity level.
  const rids = labels.map(([, , sid]) => {
    if (Object.hasOwn(levels, sid)) return levels[sid];
    const match = /^S-1-16-(\d+)$/.exec(sid);
    if (!match || !Number.isSafeInteger(Number(match[1]))) {
      throw new Error('installer.integrity_sid_invalid:' + sid);
    }
    return Number(match[1]);
  });
  const rid = rids.length ? Math.min(...rids) : 8192;
  return { rid, normal: rid >= 8192, explicit: labels.length > 0, sddl };
}

export async function inspectWindowsFileIntegrity(path) {
  if (process.platform !== 'win32') throw new Error('installer.integrity_windows_only');
  const powershell = join(
    process.env.SystemRoot ?? 'C:/Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const result = await new Promise((accept, reject) => {
    const child = spawn(
      powershell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(scriptRoot, 'windows-file-integrity.ps1'),
        '-Path',
        resolve(path),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '',
      stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('installer.integrity_inspection_timeout'));
    }, 30000);
    child.stdout.on('data', (bytes) => {
      stdout += bytes;
    });
    child.stderr.on('data', (bytes) => {
      stderr += bytes;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0)
        return reject(new Error('installer.integrity_inspection_failed:' + stderr.trim()));
      try {
        accept(JSON.parse(stdout.replace(/^\uFEFF/, '').trim()));
      } catch {
        reject(new Error('installer.integrity_inspection_invalid'));
      }
    });
  });
  return { path: result.path, ...parseWindowsIntegrityLabel(result.sddl) };
}

export async function assertNormalWindowsIntegrity(path, inspect = inspectWindowsFileIntegrity) {
  const result = await inspect(path);
  if (!result.normal) throw new Error('installer.low_integrity_artifact:' + resolve(path));
  return result;
}

/** Export bytes into a newly created, normal-integrity directory. File copy APIs
 * may carry NTFS security metadata; stream creation deliberately does not. Never
 * relabel the workspace, request elevation, or alter global TEMP/security policy.
 */
export async function exportWindowsInstallerDistribution(source, destination, options = {}) {
  const inspect = options.inspect ?? inspectWindowsFileIntegrity;
  const sourceRoot = await realpath(source);
  const target = resolve(destination);
  if (!isAbsolute(destination) || target === parse(target).root || target === sourceRoot) {
    throw new Error('installer.export_path_invalid');
  }
  const parent = await realpath(dirname(target));
  await assertNormalWindowsIntegrity(parent, inspect);
  // Non-recursive creation plus wx file creation: never replace existing releases.
  await mkdir(target);
  const actualTarget = await realpath(target);
  if (dirname(actualTarget).toLowerCase() !== parent.toLowerCase()) {
    throw new Error('installer.export_path_redirected');
  }
  await assertNormalWindowsIntegrity(actualTarget, inspect);
  const allowed = (await readdir(sourceRoot)).filter((name) =>
    /^(?:SYNC-THINK-Setup-[^/\\]+-x64\.exe(?:\.blockmap)?|installer-manifest\.json|Run-Installer\.cmd)$/.test(
      name,
    ),
  );
  if (allowed.filter((name) => name.endsWith('.exe')).length !== 1) {
    throw new Error('installer.export_artifact_count_invalid');
  }
  for (const name of allowed) {
    const input = join(sourceRoot, name);
    if (!(await stat(input)).isFile() || (await realpath(input)) !== input)
      throw new Error('installer.export_file_invalid:' + name);
    await pipeline(
      createReadStream(input),
      createWriteStream(join(actualTarget, name), { flags: 'wx' }),
    );
  }
  const artifact = join(
    actualTarget,
    allowed.find((name) => name.endsWith('.exe')),
  );
  const integrity = await assertNormalWindowsIntegrity(artifact, inspect);
  return { installerDir: actualTarget, integrity };
}

export async function prepareWindowsInstallerDistribution(source, options = {}) {
  const inspect = options.inspect ?? inspectWindowsFileIntegrity;
  const executables = (await readdir(source)).filter((name) =>
    /^SYNC-THINK-Setup-.*-x64\.exe$/.test(name),
  );
  if (executables.length !== 1) throw new Error('installer.export_artifact_count_invalid');
  const integrity = await inspect(join(source, executables[0]));
  if (integrity.normal && !options.exportDir) return { installerDir: resolve(source), integrity };
  let destination = options.exportDir;
  if (!destination) {
    const local = process.env.LOCALAPPDATA;
    if (!local || !isAbsolute(local)) throw new Error('installer.export_normal_directory_required');
    await assertNormalWindowsIntegrity(local, inspect);
    const parent = join(local, 'SYNC-THINK-Releases');
    await mkdir(parent, { recursive: true });
    await assertNormalWindowsIntegrity(parent, inspect);
    // Reserve a unique name without replacing a previous manual release.
    const container = await mkdtemp(join(parent, 'release-'));
    destination = join(container, basename(resolve(source)));
  }
  return exportWindowsInstallerDistribution(source, destination, { inspect });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [command, source, destination] = process.argv.slice(2);
  try {
    if (command === 'inspect')
      console.log(JSON.stringify(await assertNormalWindowsIntegrity(source), null, 2));
    else if (command === 'export')
      console.log(
        JSON.stringify(
          await prepareWindowsInstallerDistribution(source, { exportDir: destination }),
          null,
          2,
        ),
      );
    else throw new Error('installer.distribution_command_unknown');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
