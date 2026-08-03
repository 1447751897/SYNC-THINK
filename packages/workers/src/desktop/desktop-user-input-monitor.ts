import koffi from 'koffi';

export interface DesktopUserInputMonitor {
  sample(): number;
}

type LastInputTickReader = () => number;
let nativeReader: LastInputTickReader | undefined;

export class WindowsDesktopUserInputMonitor implements DesktopUserInputMonitor {
  constructor(private readonly readLastInputTick: LastInputTickReader = getNativeReader()) {}

  sample(): number {
    let value: number;
    try {
      value = Number(this.readLastInputTick());
    } catch {
      throw new Error('desktop.input-monitor-unavailable');
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new Error('desktop.input-monitor-unavailable');
    }
    return value;
  }
}

export class UnavailableDesktopUserInputMonitor implements DesktopUserInputMonitor {
  sample(): number {
    throw new Error('desktop.input-monitor-unavailable');
  }
}

export function createDesktopUserInputMonitor(
  platform: NodeJS.Platform = process.platform,
): DesktopUserInputMonitor {
  return platform === 'win32'
    ? new WindowsDesktopUserInputMonitor()
    : new UnavailableDesktopUserInputMonitor();
}

function getNativeReader(): LastInputTickReader {
  nativeReader ??= createNativeReader();
  return nativeReader;
}

function createNativeReader(): LastInputTickReader {
  if (process.platform !== 'win32') {
    return () => {
      throw new Error('desktop.input-monitor-unavailable');
    };
  }
  koffi.struct('SYNC_THINK_LASTINPUTINFO', {
    cbSize: 'uint32_t',
    dwTime: 'uint32_t',
  });
  const user32 = koffi.load('user32.dll');
  const getLastInputInfo = user32.func(
    'int __stdcall GetLastInputInfo(_Inout_ SYNC_THINK_LASTINPUTINFO *info)',
  );
  return () => {
    const info = {
      cbSize: koffi.sizeof('SYNC_THINK_LASTINPUTINFO'),
      dwTime: 0,
    };
    if (!Number(getLastInputInfo(info))) {
      throw new Error('desktop.input-monitor-unavailable');
    }
    return Number(info.dwTime);
  };
}
