/**
 * 计划任务自启（spec T3 + Q6/Q8）：守护进程随登录自动拉起。
 *
 * Windows 方案：schtasks 注册「登录时启动」计划任务（零提权，
 * /RL LIMITED——普通用户权限即可，不引入 Windows 服务）。
 * 默认注册，设置页可关（unregister）。
 *
 * 命令构造为纯函数（可测）；执行走 spawnSync（schtasks 是系统命令）。
 */

import { spawnSync } from 'node:child_process';

export const TASK_NAME = 'SYNC-THINK Daemon';

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

/** 注册登录自启（schtasks 执行）。返回是否成功。 */
export function registerAutostart(nodeBin: string, daemonEntry: string): boolean {
  try {
    const result = spawnSync(buildRegisterCommand(nodeBin, daemonEntry), {
      shell: true,
      windowsHide: true,
      encoding: 'utf8',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** 移除登录自启。返回是否成功（任务不存在也算成功）。 */
export function unregisterAutostart(): boolean {
  try {
    const result = spawnSync(buildUnregisterCommand(), {
      shell: true,
      windowsHide: true,
      encoding: 'utf8',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** 查询自启是否已注册。 */
export function isAutostartRegistered(): boolean {
  try {
    const result = spawnSync(buildStatusQueryCommand(), {
      shell: true,
      windowsHide: true,
      encoding: 'utf8',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}
