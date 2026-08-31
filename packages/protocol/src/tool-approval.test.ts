import { describe, expect, it } from 'vitest';
import {
  COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY,
  normalizeComputerUseApprovalPolicySetting,
  removePersistentComputerUseApp,
} from './tool-approval.js';

describe('Computer Use approval policy setting', () => {
  it('normalizes the persisted always-allowed app list', () => {
    expect(COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY).toBe('computer-use.approval-policy');
    expect(
      normalizeComputerUseApprovalPolicySetting({
        version: 8,
        alwaysAllowedApps: [
          { field: 'app_id', value: ' calculator.exe ' },
          { field: 'app_id', value: 'calculator.exe' },
          { field: 'app', value: ' com.apple.Safari ' },
          { field: 'path', value: 'C:\\unsafe.exe' },
          { field: 'app_id', value: '' },
          null,
        ],
      }),
    ).toEqual({
      version: 1,
      alwaysAllowedApps: [
        { field: 'app_id', value: 'calculator.exe' },
        { field: 'app', value: 'com.apple.Safari' },
      ],
    });
  });

  it('removes one app authorization while preserving the others', () => {
    expect(
      removePersistentComputerUseApp(
        {
          version: 1,
          alwaysAllowedApps: [
            { field: 'app_id', value: 'calculator.exe' },
            { field: 'app_id', value: 'notepad.exe' },
            { field: 'app', value: 'com.apple.Safari' },
          ],
        },
        { field: 'app_id', value: 'notepad.exe' },
      ),
    ).toEqual({
      version: 1,
      alwaysAllowedApps: [
        { field: 'app_id', value: 'calculator.exe' },
        { field: 'app', value: 'com.apple.Safari' },
      ],
    });
  });
});
