import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const IDENTITY_METADATA_FILE = 'runtime-identity.json';
const IDENTITY_LOCK_FILE = 'runtime-identity.lock';
const IDENTITY_VERSION = 1;
const INSTALL_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const STORE_HANDLE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_LOCK_MS = 30_000;
const LOCK_POLL_MS = 20;

export interface DesktopRuntimeIdentity {
  installId: string;
  pipeSecret?: string;
  allowNoToken: boolean;
  source: 'environment' | 'packaged-store' | 'development-default';
}

export interface IdentitySecretStore {
  storeSecret(plaintext: string): Promise<string>;
  retrieveSecret(handle: string): Promise<string>;
  removeSecret(handle: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export interface ResolveDesktopRuntimeIdentityOptions {
  isPackaged: boolean;
  userDataPath: string;
  environment?: Readonly<NodeJS.ProcessEnv>;
  secretStore?: IdentitySecretStore;
  generateInstallId?: () => string;
  generatePipeSecret?: () => string;
  lockTimeoutMs?: number;
  staleLockMs?: number;
}

interface PersistedRuntimeIdentity {
  version: 1;
  installId: string;
  pipeSecretHandle: string;
  createdAt: string;
}

export function runtimeIdentityMetadataPath(userDataPath: string): string {
  return join(userDataPath, IDENTITY_METADATA_FILE);
}

export function describeDesktopRuntimeIdentity(identity: DesktopRuntimeIdentity): {
  installId: string;
  allowNoToken: boolean;
  source: DesktopRuntimeIdentity['source'];
  pipeSecretConfigured: boolean;
} {
  return {
    installId: identity.installId,
    allowNoToken: identity.allowNoToken,
    source: identity.source,
    pipeSecretConfigured: Boolean(identity.pipeSecret),
  };
}

export async function resolveDesktopRuntimeIdentity(
  options: ResolveDesktopRuntimeIdentityOptions,
): Promise<DesktopRuntimeIdentity> {
  if (!options.isPackaged) return resolveDevelopmentIdentity(options.environment ?? process.env);
  const secretStore = options.secretStore;
  if (!secretStore) {
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_STORE_UNAVAILABLE',
      'Packaged Runtime identity requires an encrypted secret store',
    );
  }

  const metadataPath = runtimeIdentityMetadataPath(options.userDataPath);
  const lockPath = join(options.userDataPath, IDENTITY_LOCK_FILE);
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const deadline = Date.now() + lockTimeoutMs;
  await mkdir(options.userDataPath, { recursive: true });

  while (true) {
    const existing = await tryReadPersistedIdentity(metadataPath);
    if (existing) return loadPersistedIdentity(existing, secretStore);

    const releaseLock = await tryAcquireIdentityLock(lockPath);
    if (releaseLock) {
      try {
        const afterLock = await tryReadPersistedIdentity(metadataPath);
        if (afterLock) return loadPersistedIdentity(afterLock, secretStore);
        return await createPackagedIdentity({ ...options, secretStore }, metadataPath);
      } finally {
        await releaseLock();
      }
    }

    await removeStaleLock(lockPath, staleLockMs);
    if (Date.now() >= deadline) {
      throw desktopIdentityError(
        'DESKTOP_RUNTIME_IDENTITY_LOCK_TIMEOUT',
        'Timed out waiting for packaged Runtime identity initialization',
      );
    }
    await sleep(LOCK_POLL_MS);
  }
}

function resolveDevelopmentIdentity(environment: Readonly<NodeJS.ProcessEnv>): DesktopRuntimeIdentity {
  const environmentInstallId = normalizeEnvironmentValue(environment.SYNC_THINK_INSTALL_ID);
  const pipeSecret = normalizeEnvironmentValue(environment.SYNC_THINK_PIPE_SECRET);
  const hasOverride =
    environmentInstallId !== undefined ||
    pipeSecret !== undefined ||
    environment.SYNC_THINK_DEV_NO_TOKEN !== undefined;
  const installId = environmentInstallId ?? 'dev-0001';
  assertInstallId(installId);
  return {
    installId,
    pipeSecret,
    allowNoToken: environment.SYNC_THINK_DEV_NO_TOKEN === '1' || !pipeSecret,
    source: hasOverride ? 'environment' : 'development-default',
  };
}

async function createPackagedIdentity(
  options: ResolveDesktopRuntimeIdentityOptions & { secretStore: IdentitySecretStore },
  metadataPath: string,
): Promise<DesktopRuntimeIdentity> {
  if (!(await options.secretStore.isAvailable())) {
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_STORE_UNAVAILABLE',
      'Encrypted secret storage is unavailable for packaged Runtime identity',
    );
  }

  const installId = (options.generateInstallId ?? defaultInstallId)();
  const pipeSecret = (options.generatePipeSecret ?? defaultPipeSecret)();
  assertInstallId(installId);
  assertPipeSecret(pipeSecret);

  const pipeSecretHandle = await options.secretStore.storeSecret(pipeSecret);
  if (!STORE_HANDLE_PATTERN.test(pipeSecretHandle)) {
    await options.secretStore.removeSecret(pipeSecretHandle).catch(() => undefined);
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_STORE_HANDLE_INVALID',
      'Encrypted secret store returned an invalid handle',
    );
  }

  const metadata: PersistedRuntimeIdentity = {
    version: IDENTITY_VERSION,
    installId,
    pipeSecretHandle,
    createdAt: new Date().toISOString(),
  };

  try {
    await writeJsonAtomic(metadataPath, metadata);
  } catch (error) {
    await options.secretStore.removeSecret(pipeSecretHandle).catch(() => undefined);
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_WRITE_FAILED',
      'Failed to persist packaged Runtime identity metadata',
      error,
    );
  }

  return {
    installId,
    pipeSecret,
    allowNoToken: false,
    source: 'packaged-store',
  };
}

async function loadPersistedIdentity(
  metadata: PersistedRuntimeIdentity,
  secretStore: IdentitySecretStore,
): Promise<DesktopRuntimeIdentity> {
  let pipeSecret: string;
  try {
    pipeSecret = await secretStore.retrieveSecret(metadata.pipeSecretHandle);
    assertPipeSecret(pipeSecret);
  } catch (error) {
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_DECRYPT_FAILED',
      'Failed to decrypt the packaged Runtime identity secret',
      error,
    );
  }
  return {
    installId: metadata.installId,
    pipeSecret,
    allowNoToken: false,
    source: 'packaged-store',
  };
}

async function tryReadPersistedIdentity(path: string): Promise<PersistedRuntimeIdentity | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_READ_FAILED',
      'Failed to read packaged Runtime identity metadata',
      error,
    );
  }

  try {
    const value = JSON.parse(raw) as Partial<PersistedRuntimeIdentity>;
    if (
      value.version !== IDENTITY_VERSION ||
      typeof value.installId !== 'string' ||
      !INSTALL_ID_PATTERN.test(value.installId) ||
      typeof value.pipeSecretHandle !== 'string' ||
      !STORE_HANDLE_PATTERN.test(value.pipeSecretHandle) ||
      typeof value.createdAt !== 'string' ||
      !value.createdAt
    ) {
      throw new Error('invalid identity metadata shape');
    }
    return value as PersistedRuntimeIdentity;
  } catch (error) {
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_CORRUPT',
      'Packaged Runtime identity metadata is invalid',
      error,
    );
  }
}

async function tryAcquireIdentityLock(lockPath: string): Promise<(() => Promise<void>) | null> {
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${process.pid}\n`, 'utf8');
    return async () => {
      await handle.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
    };
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) return null;
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_LOCK_FAILED',
      'Failed to acquire packaged Runtime identity initialization lock',
      error,
    );
  }
}

async function removeStaleLock(lockPath: string, staleLockMs: number): Promise<void> {
  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs > staleLockMs) {
      await rm(lockPath, { force: true });
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
}

async function writeJsonAtomic(path: string, value: PersistedRuntimeIdentity): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function defaultInstallId(): string {
  return `install-${randomUUID()}`;
}

function defaultPipeSecret(): string {
  return randomBytes(32).toString('base64url');
}

function assertInstallId(value: string): void {
  if (!INSTALL_ID_PATTERN.test(value)) {
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_INSTALL_ID_INVALID',
      'Runtime install id must be path-safe and no longer than 128 characters',
    );
  }
}

function assertPipeSecret(value: string): void {
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw desktopIdentityError(
      'DESKTOP_RUNTIME_IDENTITY_SECRET_INVALID',
      'Runtime pipe secret must contain at least 32 bytes',
    );
  }
}

function normalizeEnvironmentValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function desktopIdentityError(code: string, message: string, cause?: unknown): Error {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
