export type SyncThinkPlatform = 'win32' | 'darwin' | 'linux' | 'other';

export interface PlatformCapabilities {
  desktopAutomation: boolean;
  ocr: boolean;
  daemonAutostart: boolean;
  autoUpdate: boolean;
}

export interface PlatformContext {
  platform: SyncThinkPlatform;
  arch: 'arm64' | 'x64' | 'other';
  capabilities: PlatformCapabilities;
}

export function createPlatformContext(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): PlatformContext {
  const normalized = platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : 'other';
  return {
    platform: normalized,
    arch: arch === 'arm64' || arch === 'x64' ? arch : 'other',
    capabilities: {
      desktopAutomation: normalized === 'win32',
      ocr: normalized === 'win32',
      daemonAutostart: normalized === 'win32' || normalized === 'darwin',
      autoUpdate: normalized === 'win32' || normalized === 'darwin',
    },
  };
}
