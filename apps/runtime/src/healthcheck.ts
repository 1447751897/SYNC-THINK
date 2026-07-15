import { PROTOCOL_VERSION, DEFAULT_FEATURES, type Feature } from '@sync-think/protocol';

export interface HealthcheckResult {
  ok: true;
  runtimePid: number;
  uptimeMs: number;
  protocolVersion: number;
  features: Feature[];
  inFlightRuns: number;
}

export interface HealthcheckError {
  ok: false;
  error: { code: string; message: string };
}

export interface HealthcheckOptions {
  inFlightRuns?: number;
  features?: Feature[];
  protocolVersion?: number;
}

export function makeHealthcheck(
  startTime: number,
  opts: HealthcheckOptions = {},
): HealthcheckResult {
  return {
    ok: true,
    runtimePid: process.pid,
    uptimeMs: Date.now() - startTime,
    protocolVersion: opts.protocolVersion ?? PROTOCOL_VERSION,
    features: opts.features ?? DEFAULT_FEATURES,
    inFlightRuns: opts.inFlightRuns ?? 0,
  };
}

export function healthcheck(
  startTime: number,
  opts: HealthcheckOptions = {},
): HealthcheckResult | HealthcheckError {
  if (typeof process === 'undefined' || process.pid == null) {
    return { ok: false, error: { code: 'runtime.no_pid', message: 'process pid unavailable' } };
  }
  return makeHealthcheck(startTime, opts);
}
