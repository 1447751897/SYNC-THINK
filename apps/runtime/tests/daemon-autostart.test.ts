import { describe, expect, it } from 'vitest';
import {
  buildRegisterCommand,
  buildUnregisterCommand,
  buildStatusQueryCommand,
  TASK_NAME,
} from '../src/daemon/autostart.js';

const NODE = 'C:\\node\\node.exe';
const ENTRY = 'C:\\runtime\\dist\\daemon\\index.js';

describe('autostart command builders (pure)', () => {
  it('builds a register command pointing at the daemon entry', () => {
    const cmd = buildRegisterCommand(NODE, ENTRY);
    expect(cmd).toContain('schtasks');
    expect(cmd).toContain('/Create');
    expect(cmd).toContain(`/TN "${TASK_NAME}"`);
    expect(cmd).toContain(`/TR "\\"${NODE}\\" \\"${ENTRY}\\""`);
    expect(cmd).toContain('/SC ONLOGON');
  });

  it('builds a delete command for the task', () => {
    const cmd = buildUnregisterCommand();
    expect(cmd).toContain('schtasks');
    expect(cmd).toContain('/Delete');
    expect(cmd).toContain(`/TN "${TASK_NAME}"`);
    expect(cmd).toContain('/F');
  });

  it('builds a status query command', () => {
    const cmd = buildStatusQueryCommand();
    expect(cmd).toContain('schtasks');
    expect(cmd).toContain('/Query');
    expect(cmd).toContain(`/TN "${TASK_NAME}"`);
  });
});
