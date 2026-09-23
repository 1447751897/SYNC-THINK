/**
 * 计划任务自启（spec T3 + Q6/Q8）：守护进程随登录自动拉起。
 *
 * Windows 方案：查询 schtasks「登录时启动」计划任务，并兼容
 * Desktop supervisor 在计划任务创建被系统拒绝时写入的 HKCU Run 登录启动项。
 *
 * 命令构造为纯函数（可测）；执行走 spawnSync（schtasks 是系统命令）。
 */

import { spawnSync } from 'node:child_process';

export const TASK_NAME = 'SYNC-THINK Daemon';
const WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/** 构造注册命令（纯函数）。 */
export function buildRegisterCommand(nodeBin: string, daemonEntry: string): string {
  // /TR 里的引号转义：外层双引号包整个命令，内层命令与参数各自双引号。
  return [
    'schtasks',
    '/Create',
    `/TN "${TASK_NAME}"`,
    `/TR "\\"${nodeBin}\\" \\"${daemonEntry}\\""`,
    '/SC ONLOGON',
    '/RL LIMITED',
    '/F',
  ].join(' ');
}

/** 构造删除命令（纯函数）。 */
export function buildUnregisterCommand(): string {
  return ['schtasks', '/Delete', `/TN "${TASK_NAME}"`, '/F'].join(' ');
}

/** 构造状态查询命令（纯函数）。 */
export function buildStatusQueryCommand(): string {
  return ['schtasks', '/Query', `/TN "${TASK_NAME}"`].join(' ');
}

/** 查询计划任务或当前用户 Run 登录启动项是否已注册。 */
export function isAutostartRegistered(): boolean {
  try {
    const scheduled = spawnSync(buildStatusQueryCommand(), {
      shell: true,
      windowsHide: true,
      encoding: 'utf8',
    });
    if (scheduled.status === 0) return true;
    const registry = spawnSync('reg.exe', ['QUERY', WINDOWS_RUN_KEY, '/v', TASK_NAME], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
    });
    return registry.status === 0;
  } catch {
    return false;
  }
}
