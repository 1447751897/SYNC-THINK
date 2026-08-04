import { readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { DesktopUpdateController } from './desktop-updater.js';

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 15 * 60_000;
const HANDOFF_GRACE_MS = 2 * 60_000;
export const DESKTOP_UPDATE_INSTALL_PROBE_HANDOFF_NAME = 'update-install-e2e-handoff.json';

const HANDOFF_ENVIRONMENT_KEYS = [
  'LOCALAPPDATA',
  'SYNC_THINK_DB_PATH',
  'SYNC_THINK_RUNTIME_FORCE_RESTART',
  'SYNC_THINK_UPDATE_ROLLBACK_ALLOW_UNSIGNED_FIXTURE',
  'SYNC_THINK_UPDATE_ROLLBACK_HEALTH_TIMEOUT_MS',
] as const;

type DesktopUpdateInstallProbeEnvironmentKey = (typeof HANDOFF_ENVIRONMENT_KEYS)[number];
export type DesktopUpdateInstallProbeEnvironment = Partial<
  Record<DesktopUpdateInstallProbeEnvironmentKey, string>
>;

export interface DesktopUpdateInstallProbeConfiguration {
  resultPath: string;
  userDataPath: string;
  targetVersion: string;
  markerName: string;
  timeoutMs: number;
  trustedCertificateData: string | null;
}

interface DesktopUpdateInstallProbeEvent {
  type: string;
  version: string;
  at: string;
  detail?: string;
}

export interface DesktopUpdateInstallProbeState {
  schemaVersion: 1;
  targetVersion: string;
  markerName: string;
  markerId: string | null;
  installRequestCount: number;
  completed: boolean;
  errorCode: string | null;
  events: DesktopUpdateInstallProbeEvent[];
}

export interface DesktopUpdateInstallProbeOptions {
  configuration: DesktopUpdateInstallProbeConfiguration;
  currentVersion: string;
  controller: DesktopUpdateController;
  ensureRuntimeReady(): Promise<void>;
  createMarker(name: string): Promise<string>;
  markerExists(name: string, markerId: string | null): Promise<boolean>;
  prepareInstallRelaunch?(): Promise<void>;
  waitBeforeCheckRetry?(): Promise<void>;
  now?: () => Date;
}

interface DesktopUpdateInstallProbeHandoff {
  schemaVersion: 1;
  executablePath: string;
  expiresAt: string;
  configuration: DesktopUpdateInstallProbeConfiguration;
  environment: DesktopUpdateInstallProbeEnvironment;
}

export interface DesktopUpdateInstallProbeBootstrap {
  configuration: DesktopUpdateInstallProbeConfiguration;
  environment: DesktopUpdateInstallProbeEnvironment;
  source: 'environment' | 'handoff';
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(code);
  return value.trim();
}

export function resolveDesktopUpdateInstallProbeConfiguration(
  raw: string | undefined,
): DesktopUpdateInstallProbeConfiguration | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('desktop.update.probe-config-invalid');
  }
  const resultPath = requiredString(parsed.resultPath, 'desktop.update.probe-result-path-invalid');
  const userDataPath = requiredString(
    parsed.userDataPath,
    'desktop.update.probe-user-data-path-invalid',
  );
  if (!isAbsolute(resultPath) || !isAbsolute(userDataPath)) {
    throw new Error('desktop.update.probe-path-not-absolute');
  }
  const targetVersion = requiredString(
    parsed.targetVersion,
    'desktop.update.probe-target-version-invalid',
  );
  const markerName = requiredString(parsed.markerName, 'desktop.update.probe-marker-invalid');
  const timeoutValue =
    parsed.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(parsed.timeoutMs);
  if (!Number.isInteger(timeoutValue) || timeoutValue < 1_000 || timeoutValue > MAX_TIMEOUT_MS) {
    throw new Error('desktop.update.probe-timeout-invalid');
  }
  const trustedCertificateData =
    parsed.trustedCertificateData === undefined || parsed.trustedCertificateData === null
      ? null
      : requiredString(parsed.trustedCertificateData, 'desktop.update.probe-certificate-invalid');
  return {
    resultPath,
    userDataPath,
    targetVersion,
    markerName,
    timeoutMs: timeoutValue,
    trustedCertificateData,
  };
}

export function desktopUpdateInstallProbeHandoffPath(defaultUserDataPath: string): string {
  if (!isAbsolute(defaultUserDataPath)) {
    throw new Error('desktop.update.probe-handoff-root-not-absolute');
  }
  return join(defaultUserDataPath, DESKTOP_UPDATE_INSTALL_PROBE_HANDOFF_NAME);
}

function normalizeExecutablePath(value: string): string {
  const normalized = resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function parseHandoffEnvironment(value: unknown): DesktopUpdateInstallProbeEnvironment {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const environment: DesktopUpdateInstallProbeEnvironment = {};
  for (const key of HANDOFF_ENVIRONMENT_KEYS) {
    const raw = source[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error('desktop.update.probe-handoff-environment-invalid');
    }
    environment[key] = raw;
  }
  return environment;
}

export function resolveDesktopUpdateInstallProbeBootstrap(options: {
  rawConfiguration: string | undefined;
  handoffPath: string;
  executablePath: string;
  now?: Date;
}): DesktopUpdateInstallProbeBootstrap | null {
  const environmentConfiguration = resolveDesktopUpdateInstallProbeConfiguration(
    options.rawConfiguration,
  );
  if (environmentConfiguration) {
    return { configuration: environmentConfiguration, environment: {}, source: 'environment' };
  }

  let rawHandoff: string;
  try {
    rawHandoff = readFileSync(options.handoffPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  try {
    const parsed = JSON.parse(rawHandoff) as Partial<DesktopUpdateInstallProbeHandoff>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.executablePath !== 'string' ||
      normalizeExecutablePath(parsed.executablePath) !==
        normalizeExecutablePath(options.executablePath) ||
      typeof parsed.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.expiresAt)) ||
      Date.parse(parsed.expiresAt) <= (options.now ?? new Date()).getTime()
    ) {
      return null;
    }
    const configuration = resolveDesktopUpdateInstallProbeConfiguration(
      JSON.stringify(parsed.configuration),
    );
    if (!configuration) return null;
    return {
      configuration,
      environment: parseHandoffEnvironment(parsed.environment),
      source: 'handoff',
    };
  } catch {
    return null;
  } finally {
    try {
      unlinkSync(options.handoffPath);
    } catch {}
  }
}

export async function writeDesktopUpdateInstallProbeHandoff(options: {
  handoffPath: string;
  executablePath: string;
  configuration: DesktopUpdateInstallProbeConfiguration;
  environment: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<void> {
  if (!isAbsolute(options.handoffPath) || !isAbsolute(options.executablePath)) {
    throw new Error('desktop.update.probe-handoff-path-not-absolute');
  }
  const environment: DesktopUpdateInstallProbeEnvironment = {};
  for (const key of HANDOFF_ENVIRONMENT_KEYS) {
    const value = options.environment[key];
    if (typeof value === 'string' && value.length > 0) environment[key] = value;
  }
  const now = options.now ?? new Date();
  const handoff: DesktopUpdateInstallProbeHandoff = {
    schemaVersion: 1,
    executablePath: resolve(options.executablePath),
    expiresAt: new Date(
      now.getTime() + options.configuration.timeoutMs + HANDOFF_GRACE_MS,
    ).toISOString(),
    configuration: options.configuration,
    environment,
  };
  await mkdir(dirname(options.handoffPath), { recursive: true });
  const temporaryPath = `${options.handoffPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, options.handoffPath);
}
function initialState(
  configuration: DesktopUpdateInstallProbeConfiguration,
): DesktopUpdateInstallProbeState {
  return {
    schemaVersion: 1,
    targetVersion: configuration.targetVersion,
    markerName: configuration.markerName,
    markerId: null,
    installRequestCount: 0,
    completed: false,
    errorCode: null,
    events: [],
  };
}

async function readState(
  configuration: DesktopUpdateInstallProbeConfiguration,
): Promise<DesktopUpdateInstallProbeState> {
  try {
    const value = JSON.parse(
      await readFile(configuration.resultPath, 'utf8'),
    ) as DesktopUpdateInstallProbeState;
    if (
      value.schemaVersion !== 1 ||
      value.targetVersion !== configuration.targetVersion ||
      value.markerName !== configuration.markerName ||
      !Array.isArray(value.events)
    ) {
      throw new Error('desktop.update.probe-state-invalid');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initialState(configuration);
    throw error;
  }
}

async function writeState(
  configuration: DesktopUpdateInstallProbeConfiguration,
  state: DesktopUpdateInstallProbeState,
): Promise<void> {
  await mkdir(dirname(configuration.resultPath), { recursive: true });
  const temporaryPath = `${configuration.resultPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, configuration.resultPath);
}

function appendEvent(
  state: DesktopUpdateInstallProbeState,
  now: () => Date,
  type: string,
  version: string,
  detail?: string,
): void {
  state.events.push({ type, version, at: now().toISOString(), ...(detail ? { detail } : {}) });
}

export async function runDesktopUpdateInstallProbe(
  options: DesktopUpdateInstallProbeOptions,
): Promise<DesktopUpdateInstallProbeState> {
  const { configuration, currentVersion, controller } = options;
  const now = options.now ?? (() => new Date());
  const state = await readState(configuration);
  await options.ensureRuntimeReady();

  try {
    if (currentVersion === configuration.targetVersion) {
      const markerPresent = await options.markerExists(configuration.markerName, state.markerId);
      if (!markerPresent) throw new Error('desktop.update.probe-marker-missing');
      appendEvent(state, now, 'upgrade-runtime-ready', currentVersion);
      state.completed = true;
      state.errorCode = null;
      await writeState(configuration, state);
      return state;
    }

    if (state.installRequestCount !== 0) {
      throw new Error('desktop.update.probe-install-already-requested');
    }
    state.markerId = await options.createMarker(configuration.markerName);
    appendEvent(state, now, 'base-runtime-ready', currentVersion);
    await writeState(configuration, state);

    let checkResult = await controller.checkForUpdates();
    if (!checkResult.ok && checkResult.errorCode === 'desktop.update.check-failed') {
      await (options.waitBeforeCheckRetry?.() ??
        new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 1_000)));
      checkResult = await controller.checkForUpdates();
    }
    if (!checkResult.ok || checkResult.state.phase !== 'available') {
      throw new Error(checkResult.errorCode ?? 'desktop.update.probe-check-incomplete');
    }
    appendEvent(
      state,
      now,
      'update-available',
      currentVersion,
      checkResult.state.availableVersion ?? '',
    );
    await writeState(configuration, state);

    const downloadResult = await controller.downloadUpdate();
    if (!downloadResult.ok || downloadResult.state.phase !== 'downloaded') {
      throw new Error(downloadResult.errorCode ?? 'desktop.update.probe-download-incomplete');
    }
    appendEvent(
      state,
      now,
      'update-downloaded',
      currentVersion,
      downloadResult.state.availableVersion ?? '',
    );
    await options.prepareInstallRelaunch?.();
    state.installRequestCount += 1;
    appendEvent(state, now, 'install-requested', currentVersion);
    await writeState(configuration, state);

    const installResult = await controller.installUpdate();
    if (!installResult.ok) {
      throw new Error(installResult.errorCode ?? 'desktop.update.install-failed');
    }
    return state;
  } catch (error) {
    state.errorCode = error instanceof Error ? error.message : 'desktop.update.probe-failed';
    appendEvent(state, now, 'error', currentVersion, state.errorCode);
    await writeState(configuration, state);
    throw error;
  }
}
