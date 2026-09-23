import { describe, expect, it } from 'vitest';
import { resolveCcSwitchImportPath } from './cc-switch-import-path.js';

describe('CC Switch import path', () => {
  it('prefers and trims an explicit path', () => {
    expect(resolveCcSwitchImportPath('  D:\\profiles\\cc-switch.db  ', 'C:\\default.db')).toBe(
      'D:\\profiles\\cc-switch.db',
    );
  });

  it('uses the trimmed default for an omitted or blank explicit path', () => {
    expect(resolveCcSwitchImportPath(undefined, ' C:\\default.db ')).toBe('C:\\default.db');
    expect(resolveCcSwitchImportPath('   ', ' C:\\default.db ')).toBe('C:\\default.db');
  });

  it('reports the existing configuration error when neither path is available', () => {
    expect(() => resolveCcSwitchImportPath(' ', ' ')).toThrow(
      '无法解析 CC Switch 数据库路径（缺少用户主目录）',
    );
  });
});
