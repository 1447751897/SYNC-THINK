import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopUpdateSnapshot } from '../desktop-update-contract.js';

const FILE_NAME = 'desktop-update-preferences.json';

export interface DesktopUpdatePreferences {
  autoCheck: boolean;
}

export const DEFAULT_DESKTOP_UPDATE_PREFERENCES: DesktopUpdatePreferences = {
  autoCheck: true,
};

export function readDesktopUpdatePreferences(root: string): DesktopUpdatePreferences {
  try {
    const parsed = JSON.parse(readFileSync(join(root, FILE_NAME), 'utf8')) as {
      autoCheck?: unknown;
    };
    return {
      autoCheck:
        typeof parsed.autoCheck === 'boolean'
          ? parsed.autoCheck
          : DEFAULT_DESKTOP_UPDATE_PREFERENCES.autoCheck,
    };
  } catch {
    return { ...DEFAULT_DESKTOP_UPDATE_PREFERENCES };
  }
}

export function writeDesktopUpdatePreferences(
  root: string,
  preferences: DesktopUpdatePreferences,
): void {
  mkdirSync(root, { recursive: true });
  const destination = join(root, FILE_NAME);
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(preferences)}\n`, 'utf8');
  renameSync(temporary, destination);
}

export function shouldAutoCheckDesktopUpdates(
  preferences: DesktopUpdatePreferences,
  snapshot: DesktopUpdateSnapshot,
): boolean {
  return preferences.autoCheck && snapshot.configured && snapshot.phase === 'idle';
}
