import * as path from 'node:path';

export interface InitialWindowSizeInput {
  packaged: boolean;
  width?: string;
  height?: string;
}

export interface InitialWindowSize {
  width: number;
  height: number;
}

const DEFAULT_WINDOW_SIZE: InitialWindowSize = {
  width: 1440,
  height: 900,
};

function parseDevelopmentDimension(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (!value || !/^\d+$/.test(value)) return fallback;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function resolveInitialWindowSize(input: InitialWindowSizeInput): InitialWindowSize {
  if (input.packaged) return DEFAULT_WINDOW_SIZE;

  return {
    width: parseDevelopmentDimension(input.width, 1280, 3840, DEFAULT_WINDOW_SIZE.width),
    height: parseDevelopmentDimension(input.height, 720, 2160, DEFAULT_WINDOW_SIZE.height),
  };
}

export function resolveDevelopmentUserDataPath(
  packaged: boolean,
  candidate: string | undefined,
): string | null {
  if (packaged || !candidate || !path.isAbsolute(candidate)) return null;
  return path.normalize(candidate);
}

export function shouldDisableDevelopmentHardwareAcceleration(
  packaged: boolean,
  candidate: string | undefined,
): boolean {
  return !packaged && candidate === '1';
}
