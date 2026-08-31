import { describe, expect, it } from 'vitest';
import { persistentComputerUseAppOf } from './tool-approval.js';

describe('persistentComputerUseAppOf', () => {
  it('recognizes NewMax Windows Computer Use app ids', () => {
    expect(
      persistentComputerUseAppOf('mcp__computer-use__computer_click', {
        app_id: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
      }),
    ).toEqual({
      field: 'app_id',
      value: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
    });
  });

  it('recognizes macOS bundle identifiers but rejects generic app labels', () => {
    expect(
      persistentComputerUseAppOf('mcp__computer-use__click', { app: 'com.apple.Safari' }),
    ).toEqual({ field: 'app', value: 'com.apple.Safari' });
    expect(persistentComputerUseAppOf('mcp__computer-use__click', { app: 'Safari' })).toBeNull();
  });

  it('does not offer persistent app approval for unrelated tools', () => {
    expect(persistentComputerUseAppOf('write_file', { app_id: 'editor' })).toBeNull();
  });
});
