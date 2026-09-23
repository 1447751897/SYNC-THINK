import type {
  DesktopWindowIdentity,
  DesktopElementSnapshot,
  DesktopProbeResult,
  DesktopWindowListResult,
  DesktopAppLaunchResult,
  DesktopTreeLimits,
} from './desktop-contract.js';

export interface WindowsUiaInspection {
  window: DesktopWindowIdentity;
  elements: DesktopElementSnapshot[];
  truncated: boolean;
}

export interface WindowsUiaElementLease {
  inspection: WindowsUiaInspection;
  element: DesktopElementSnapshot;
  readValue(): string;
  focus(): void;
  invoke(): void;
  setValue(value: string): void;
  dispose(): void;
}

export interface WindowsUiaBackend {
  probe(): DesktopProbeResult | Promise<DesktopProbeResult>;
  listWindows(): DesktopWindowListResult | Promise<DesktopWindowListResult>;
  launchApp(application: string): DesktopAppLaunchResult | Promise<DesktopAppLaunchResult>;
  inspectWindow(
    window: DesktopWindowIdentity,
    limits: DesktopTreeLimits,
  ): WindowsUiaInspection | Promise<WindowsUiaInspection>;
  acquireElement(
    window: DesktopWindowIdentity,
    limits: DesktopTreeLimits,
    elementIndex: number,
  ): WindowsUiaElementLease | Promise<WindowsUiaElementLease>;
}
