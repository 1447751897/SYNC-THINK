/**
 * Map M1 exit-evidence chips to user actions (open doc / refresh).
 * Soft observability only — never auto-closes M1.
 */
export type M1ExitChipOpenDocId =
  | 'handtest'
  | 'dogfood'
  | 'dogfood-today'
  | 'dogfood-template';

export type M1ExitChipAction =
  | {
      kind: 'open-doc';
      openDoc: M1ExitChipOpenDocId;
      ctaLabel: string;
      hint: string;
    }
  | {
      kind: 'refresh';
      ctaLabel: string;
      hint: string;
    }
  | {
      kind: 'none';
      hint: string;
    };

export function resolveM1ExitChipAction(chipId: string): M1ExitChipAction {
  switch (chipId) {
    case 'handtest':
      return {
        kind: 'open-doc',
        openDoc: 'handtest',
        ctaLabel: '打开手测清单',
        hint: '系统编辑器打开 14-external-gateway-handtest.md；密钥勿入库',
      };
    case 'dogfood':
      return {
        kind: 'open-doc',
        openDoc: 'dogfood-today',
        ctaLabel: '打开今日 dogfood',
        hint: '打开或创建今日 dogfood 日记脚手架；真实使用后填写',
      };
    case 'dual-auto':
      return {
        kind: 'refresh',
        ctaLabel: '刷新 dual 状态',
        hint: '重新读取退出证据（本地 dual 绿不能替代外网手测）',
      };
    case 'soft-session':
      return {
        kind: 'refresh',
        ctaLabel: '刷新 soft 状态',
        hint: '重新读取退出证据计数；会话 soft 仍看上方就绪条',
      };
    default:
      return {
        kind: 'none',
        hint: '该芯片无可点行动',
      };
  }
}

export function isM1ExitChipActionable(chipId: string): boolean {
  return resolveM1ExitChipAction(chipId).kind !== 'none';
}

/** Format open-doc IPC result for UI observability strip. */
export function formatM1OpenDocFeedback(input: {
  id: string;
  ok: boolean;
  error?: string | null;
  path?: string | null;
  created?: boolean;
}): {
  level: 'ok' | 'warn' | 'error';
  message: string;
  dataOk: '1' | '0';
  dataCreated: '1' | '0';
  basename: string | null;
} {
  const basename =
    input.path && typeof input.path === 'string'
      ? input.path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? null
      : null;
  if (!input.ok) {
    const err = (input.error ?? 'open-failed').trim() || 'open-failed';
    const map: Record<string, string> = {
      'invalid-doc-id': '文档 id 非法',
      'invalid-date': '日期非法（需 YYYY-MM-DD）',
      'docs-not-found': '未找到 docs/development',
      'path-not-found': '目标文件不存在',
      'open-failed': '系统打开失败',
    };
    return {
      level: 'error',
      message: `打开失败：${map[err] ?? err}${basename ? ' · ' + basename : ''}`,
      dataOk: '0',
      dataCreated: '0',
      basename,
    };
  }
  if (input.created) {
    return {
      level: 'warn',
      message: `已创建并打开 ${basename ?? input.id}（脚手架 · 请真实填写）`,
      dataOk: '1',
      dataCreated: '1',
      basename,
    };
  }
  return {
    level: 'ok',
    message: `已打开 ${basename ?? input.id}`,
    dataOk: '1',
    dataCreated: '0',
    basename,
  };
}
