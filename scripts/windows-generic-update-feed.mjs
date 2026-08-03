import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

export const WINDOWS_GENERIC_UPDATE_CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const SEMVER_CORE_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CHANNEL_AUDIENCES = new Set(['private', 'internal', 'public']);
const gunzipAsync = promisify(gunzip);
const MAX_WINDOWS_BLOCKMAP_JSON_BYTES = 64 * 1024 * 1024;

function requireWindowsDifferentialBlockmap(options = {}) {
  if (options.allowLegacyFullDownload === true) {
    if (options.requireBlockmap === true) {
      throw new Error('update-feed.blockmap_policy_conflict');
    }
    return false;
  }
  if (options.requireBlockmap === false) {
    throw new Error('update-feed.legacy_full_download_mode_required');
  }
  return true;
}

function unique(values) {
  return [...new Set(values)];
}

export function normalizeWindowsUpdateChannel(value) {
  const channel = String(value ?? '').trim();
  if (!WINDOWS_GENERIC_UPDATE_CHANNEL_PATTERN.test(channel)) {
    throw new Error('update-feed.channel_invalid');
  }
  return channel;
}

export function normalizeWindowsUpdateVersion(value) {
  const version = String(value ?? '').trim();
  const match = SEMVER_CORE_PATTERN.exec(version);
  if (!match) throw new Error('update-feed.version_invalid');
  const prerelease = match[4];
  if (
    prerelease
      ?.split('.')
      .some((identifier) => /^\d+$/.test(identifier) && /^0\d+/.test(identifier))
  ) {
    throw new Error('update-feed.version_invalid');
  }
  return version;
}

export function normalizeWindowsUpdateArtifactName(value) {
  const name = String(value ?? '').trim();
  if (
    name.length === 0 ||
    name !== basename(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    extname(name).toLowerCase() !== '.exe'
  ) {
    throw new Error('update-feed.artifact_name_invalid');
  }
  return name;
}

export function normalizeWindowsUpdateBlockmapName(value) {
  const name = String(value ?? '').trim();
  if (
    name.length === 0 ||
    name !== basename(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    !name.toLowerCase().endsWith('.exe.blockmap')
  ) {
    throw new Error('update-feed.blockmap_name_invalid');
  }
  return name;
}

export function normalizeWindowsUpdateChannelPolicy(value = {}, context = {}) {
  const channel = normalizeWindowsUpdateChannel(value.channel ?? context.channel ?? 'latest');
  const audience = String(value.audience ?? 'private').trim().toLowerCase();
  if (!CHANNEL_AUDIENCES.has(audience)) throw new Error('update-feed.audience_invalid');
  const requiresAuthorization = value.requiresAuthorization ?? audience !== 'public';
  if (typeof requiresAuthorization !== 'boolean') {
    throw new Error('update-feed.authorization_policy_invalid');
  }
  if (audience === 'private' && requiresAuthorization !== true) {
    throw new Error('update-feed.private_channel_auth_required');
  }
  const withdrawnVersions = unique(
    (value.withdrawnVersions ?? []).map(normalizeWindowsUpdateVersion),
  ).sort();
  const allowedVersions =
    value.allowedVersions === undefined || value.allowedVersions === null
      ? null
      : unique(value.allowedVersions.map(normalizeWindowsUpdateVersion)).sort();
  const minimumSupportedVersion =
    value.minimumSupportedVersion === undefined || value.minimumSupportedVersion === null
      ? null
      : normalizeWindowsUpdateVersion(value.minimumSupportedVersion);
  const rolloutPercent = Number(value.rolloutPercent ?? 100);
  if (!Number.isInteger(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
    throw new Error('update-feed.rollout_percent_invalid');
  }
  const activeVersion = context.version ? normalizeWindowsUpdateVersion(context.version) : null;
  if (activeVersion && withdrawnVersions.includes(activeVersion)) {
    throw new Error('update-feed.version_withdrawn');
  }
  if (activeVersion && allowedVersions && !allowedVersions.includes(activeVersion)) {
    throw new Error('update-feed.version_not_allowed');
  }
  return {
    schemaVersion: 1,
    channel,
    audience,
    requiresAuthorization,
    rolloutPercent,
    minimumSupportedVersion,
    allowedVersions,
    withdrawnVersions,
  };
}

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertWindowsDifferentialBlockmapSchema(value) {
  if (
    !isPlainRecord(value) ||
    (value.version !== '1' && value.version !== '2') ||
    !Array.isArray(value.files) ||
    value.files.length === 0
  ) {
    throw new Error('update-feed.blockmap_schema_invalid');
  }

  let previousEnd = 0;
  for (const file of value.files) {
    if (
      !isPlainRecord(file) ||
      typeof file.name !== 'string' ||
      file.name.length === 0 ||
      file.name.length > 4096 ||
      /[\u0000-\u001f]/.test(file.name) ||
      !Number.isSafeInteger(file.offset) ||
      file.offset < 0 ||
      file.offset < previousEnd ||
      !Array.isArray(file.checksums) ||
      !Array.isArray(file.sizes) ||
      file.checksums.length === 0 ||
      file.checksums.length !== file.sizes.length
    ) {
      throw new Error('update-feed.blockmap_schema_invalid');
    }

    let fileBytes = 0;
    for (let index = 0; index < file.checksums.length; index += 1) {
      const checksum = file.checksums[index];
      const size = file.sizes[index];
      if (
        typeof checksum !== 'string' ||
        checksum.length === 0 ||
        checksum.length > 1024 ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        !Number.isSafeInteger(fileBytes + size)
      ) {
        throw new Error('update-feed.blockmap_schema_invalid');
      }
      fileBytes += size;
    }

    const fileEnd = file.offset + fileBytes;
    if (!Number.isSafeInteger(fileEnd)) {
      throw new Error('update-feed.blockmap_schema_invalid');
    }
    previousEnd = fileEnd;
  }

  return value;
}

export async function parseWindowsDifferentialBlockmap(bytes) {
  let jsonBytes;
  try {
    jsonBytes = await gunzipAsync(bytes, {
      maxOutputLength: MAX_WINDOWS_BLOCKMAP_JSON_BYTES,
    });
  } catch {
    throw new Error('update-feed.blockmap_gzip_invalid');
  }

  let value;
  try {
    value = JSON.parse(jsonBytes.toString('utf8'));
  } catch {
    throw new Error('update-feed.blockmap_json_invalid');
  }
  return assertWindowsDifferentialBlockmapSchema(value);
}

async function validateWindowsDifferentialBlockmapFile(path) {
  let value;
  try {
    value = await stat(path);
  } catch {
    throw new Error('update-feed.blockmap_missing');
  }
  if (!value.isFile() || value.size <= 0) {
    throw new Error('update-feed.blockmap_invalid');
  }

  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error('update-feed.blockmap_missing');
  }
  return await parseWindowsDifferentialBlockmap(bytes);
}

function isMissingWindowsDifferentialBlockmap(error) {
  return error instanceof Error && error.message === 'update-feed.blockmap_missing';
}

async function digest(path, algorithm, encoding) {
  const hash = createHash(algorithm);
  hash.update(await readFile(path));
  return hash.digest(encoding);
}

export async function sha512Base64(path) {
  return await digest(path, 'sha512', 'base64');
}

export async function sha256Hex(path) {
  return await digest(path, 'sha256', 'hex');
}

async function fileProjection(path, url, errorPrefix) {
  let value;
  try {
    value = await stat(path);
  } catch {
    throw new Error(errorPrefix + '_missing');
  }
  if (!value.isFile() || value.size <= 0) throw new Error(errorPrefix + '_invalid');
  return {
    url,
    size: value.size,
    sha256: await sha256Hex(path),
    sha512: await sha512Base64(path),
  };
}

export async function createWindowsGenericUpdateMetadata(artifactPath, options) {
  const requireBlockmap = requireWindowsDifferentialBlockmap(options);
  const version = normalizeWindowsUpdateVersion(options?.version);
  const channel = normalizeWindowsUpdateChannel(options?.channel ?? 'latest');
  const artifactName = normalizeWindowsUpdateArtifactName(
    options?.artifactName ?? basename(artifactPath),
  );
  const blockmapPath = resolve(options?.blockmapPath ?? artifactPath + '.blockmap');
  const blockmapName = normalizeWindowsUpdateBlockmapName(
    options?.blockmapName ?? basename(blockmapPath),
  );
  if (blockmapName !== artifactName + '.blockmap') {
    throw new Error('update-feed.blockmap_pair_invalid');
  }
  const artifact = await fileProjection(artifactPath, artifactName, 'update-feed.artifact');
  let blockmap = null;
  try {
    await validateWindowsDifferentialBlockmapFile(blockmapPath);
    blockmap = await fileProjection(blockmapPath, blockmapName, 'update-feed.blockmap');
  } catch (error) {
    if (requireBlockmap || !isMissingWindowsDifferentialBlockmap(error)) throw error;
  }
  const releaseDate = new Date(options?.releaseDate ?? Date.now());
  if (Number.isNaN(releaseDate.getTime())) throw new Error('update-feed.release_date_invalid');
  const channelPolicy = normalizeWindowsUpdateChannelPolicy(options?.channelPolicy, {
    channel,
    version,
  });

  return {
    version,
    files: [{ url: artifact.url, sha512: artifact.sha512, size: artifact.size }],
    path: artifact.url,
    sha512: artifact.sha512,
    releaseDate: releaseDate.toISOString(),
    syncThink: {
      schemaVersion: 1,
      channel,
      channelPolicy,
      artifact: { sha256: artifact.sha256 },
      differentialPackage: blockmap !== null,
      blockmap,
    },
  };
}

export async function writeWindowsGenericUpdateFeed(options) {
  const sourceArtifact = resolve(options.artifactPath);
  const sourceBlockmap = resolve(options.blockmapPath ?? sourceArtifact + '.blockmap');
  const outputDir = resolve(options.outputDir);
  const channel = normalizeWindowsUpdateChannel(options.channel ?? 'latest');
  const artifactName = normalizeWindowsUpdateArtifactName(
    options.artifactName ?? basename(sourceArtifact),
  );
  const blockmapName = normalizeWindowsUpdateBlockmapName(
    options.blockmapName ?? artifactName + '.blockmap',
  );
  const outputArtifact = join(outputDir, artifactName);
  const outputBlockmap = join(outputDir, blockmapName);
  const requireBlockmap = requireWindowsDifferentialBlockmap(options);
  const channelFile = join(outputDir, channel + '.yml');

  await mkdir(outputDir, { recursive: true });
  if (sourceArtifact.toLowerCase() !== outputArtifact.toLowerCase()) {
    await copyFile(sourceArtifact, outputArtifact);
  }
  let copiedBlockmap = false;
  try {
    await validateWindowsDifferentialBlockmapFile(sourceBlockmap);
    if (sourceBlockmap.toLowerCase() !== outputBlockmap.toLowerCase()) {
      await copyFile(sourceBlockmap, outputBlockmap);
    }
    copiedBlockmap = true;
  } catch (error) {
    if (requireBlockmap || !isMissingWindowsDifferentialBlockmap(error)) throw error;
  }
  const metadata = await createWindowsGenericUpdateMetadata(outputArtifact, {
    version: options.version,
    channel,
    channelPolicy: options.channelPolicy,
    artifactName,
    blockmapPath: copiedBlockmap ? outputBlockmap : sourceBlockmap,
    blockmapName,
    requireBlockmap,
    allowLegacyFullDownload: options.allowLegacyFullDownload === true,
    releaseDate: options.releaseDate,
  });
  await writeFile(channelFile, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  return {
    channel,
    channelFile,
    artifactPath: outputArtifact,
    blockmapPath: copiedBlockmap ? outputBlockmap : null,
    metadata,
  };
}

function safeFeedPath(feedDir, name, normalize) {
  let normalizedName;
  try {
    normalizedName = normalize(name);
  } catch {
    return null;
  }
  const root = resolve(feedDir);
  const candidate = resolve(root, normalizedName);
  const relative = candidate.slice(root.length);
  if (relative.length === 0 || (!relative.startsWith(sep) && root !== candidate)) return null;
  return candidate;
}

async function verifyProjection(root, projection, normalizeName, prefix, errors) {
  const path = safeFeedPath(root, projection?.url, normalizeName);
  if (path === null) {
    errors.push(prefix + '_path_unsafe');
    return null;
  }
  let value;
  try {
    value = await stat(path);
  } catch {
    errors.push(prefix + '_missing');
    return null;
  }
  if (!value.isFile() || value.size <= 0) {
    errors.push(prefix + '_invalid');
    return null;
  }
  if (projection.size !== value.size) errors.push(prefix + '_size_mismatch');
  if (projection.sha512 !== (await sha512Base64(path))) errors.push(prefix + '_sha512_mismatch');
  if (projection.sha256 !== undefined && projection.sha256 !== (await sha256Hex(path))) {
    errors.push(prefix + '_sha256_mismatch');
  }
  return path;
}

export async function verifyWindowsGenericUpdateFeed(feedDir, options = {}) {
  const requireBlockmap = requireWindowsDifferentialBlockmap(options);
  const channel = normalizeWindowsUpdateChannel(options.channel ?? 'latest');
  const root = resolve(feedDir);
  const errors = [];
  let metadata = null;
  try {
    metadata = JSON.parse(await readFile(join(root, channel + '.yml'), 'utf8'));
  } catch {
    errors.push('update-feed.metadata_missing_or_invalid');
  }

  if (metadata) {
    try {
      normalizeWindowsUpdateVersion(metadata.version);
    } catch {
      errors.push('update-feed.version_invalid');
    }
    if (options.expectedVersion !== undefined && metadata.version !== options.expectedVersion) {
      errors.push('update-feed.version_unexpected');
    }
    if (!Array.isArray(metadata.files) || metadata.files.length !== 1) {
      errors.push('update-feed.files_invalid');
    } else {
      const file = metadata.files[0];
      await verifyProjection(
        root,
        file,
        normalizeWindowsUpdateArtifactName,
        'update-feed.artifact',
        errors,
      );
      if (metadata.path !== file?.url) errors.push('update-feed.legacy_path_mismatch');
      if (metadata.sha512 !== file?.sha512) errors.push('update-feed.legacy_sha512_mismatch');
      if (metadata.syncThink?.artifact?.sha256 === undefined) {
        errors.push('update-feed.artifact_sha256_missing');
      } else {
        const artifactPath = safeFeedPath(root, file?.url, normalizeWindowsUpdateArtifactName);
        if (artifactPath && metadata.syncThink.artifact.sha256 !== (await sha256Hex(artifactPath))) {
          errors.push('update-feed.artifact_sha256_mismatch');
        }
      }
    }
    const blockmap = metadata.syncThink?.blockmap;
    if (!blockmap) {
      if (metadata.syncThink?.differentialPackage !== false || requireBlockmap) {
        errors.push('update-feed.blockmap_projection_missing');
      }
    } else {
      if (metadata.syncThink?.differentialPackage !== true) {
        errors.push('update-feed.differential_projection_invalid');
      }
      const blockmapPath = await verifyProjection(
        root,
        blockmap,
        normalizeWindowsUpdateBlockmapName,
        'update-feed.blockmap',
        errors,
      );
      if (blockmapPath !== null) {
        try {
          await validateWindowsDifferentialBlockmapFile(blockmapPath);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : 'update-feed.blockmap_invalid');
        }
      }
      if (metadata.files?.[0]?.url && blockmap.url !== metadata.files[0].url + '.blockmap') {
        errors.push('update-feed.blockmap_pair_invalid');
      }
    }
    try {
      const policy = normalizeWindowsUpdateChannelPolicy(metadata.syncThink?.channelPolicy, {
        channel,
        version: metadata.version,
      });
      if (metadata.syncThink?.schemaVersion !== 1 || metadata.syncThink?.channel !== channel) {
        errors.push('update-feed.channel_projection_invalid');
      }
      if (JSON.stringify(policy) !== JSON.stringify(metadata.syncThink?.channelPolicy)) {
        errors.push('update-feed.channel_policy_not_normalized');
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'update-feed.channel_policy_invalid');
    }
    if (
      typeof metadata.releaseDate !== 'string' ||
      Number.isNaN(Date.parse(metadata.releaseDate))
    ) {
      errors.push('update-feed.release_date_invalid');
    }
  }

  return { ok: errors.length === 0, errors: unique(errors), metadata };
}
