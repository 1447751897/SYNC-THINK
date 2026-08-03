import { describe, expect, it } from 'vitest';
import {
  UnavailableDesktopUserInputMonitor,
  WindowsDesktopUserInputMonitor,
} from './desktop-user-input-monitor.js';

describe('desktop user input monitor', () => {
  it('returns the Windows last-input tick from the narrow reader', () => {
    const monitor = new WindowsDesktopUserInputMonitor(() => 1234);
    expect(monitor.sample()).toBe(1234);
  });

  it('rejects invalid native samples', () => {
    const monitor = new WindowsDesktopUserInputMonitor(() => Number.NaN);
    expect(() => monitor.sample()).toThrow('desktop.input-monitor-unavailable');
  });

  it('fails closed when the monitor is unavailable', () => {
    expect(() => new UnavailableDesktopUserInputMonitor().sample()).toThrow(
      'desktop.input-monitor-unavailable',
    );
  });
});
