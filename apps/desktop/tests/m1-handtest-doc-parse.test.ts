import { describe, expect, it } from 'vitest';
import {
  parseHandtestDocMarkdown,
  mapHandtestDocBoxesToItems,
  handtestDocParseLooksSecretFree,
} from '../src/m1-handtest-doc-parse.js';

const sample = `# 外网真实网关 UI 手测清单（M1 退出证据）

## 前置
- [x] 桌面端已启动，Runtime「已连接」
- [ ] 已打开一个任务（会话就绪条任务芯片绿）
- [ ] 准备至少 **2 个** 可访问的 Provider 端点
- [x] 准备至少 **3 个** 模型 id

## A. Providers 导入与发现
- [ ] Provider A：填写 baseURL + 协议 + 密钥
- [x] 发现模型：列表出现 ≥1 模型
- [ ] Provider B：同上
- [ ] Providers 顶部「多模型就绪」

## B. 同任务多模型对话（核心）
- [ ] 不重述上下文，用 Compose chips 切换 ≥3 个模型各发一轮
- [ ] 「发送就绪」条
- [ ] Trace 有中文类别
- [ ] 每轮后 Manifest 可打开

## C. 绑定与 Fallback（若配置）
- [ ] Agent 默认模型 + fallback 链保存
- [ ] 故意让主模型失败
- [ ] 无 fallback 且 pauseOnFailure

## D. 安全与恢复
- [x] 日志 / Diagnostics / 导出中 **无** 明文 API Key
- [ ] 重启应用
- [ ] 已知限制文案可读

## E. 记录
- 手测日期：
`;

const ids = [
  { id: 'pre-runtime', label: 'Runtime 已连接', section: 'pre' },
  { id: 'pre-task', label: '已打开任务', section: 'pre' },
  { id: 'pre-providers', label: '≥2 Provider', section: 'pre' },
  { id: 'pre-models', label: '≥3 模型', section: 'pre' },
  { id: 'a-provider-a', label: 'Provider A', section: 'A' },
  { id: 'a-discover', label: '发现模型', section: 'A' },
  { id: 'a-provider-b', label: 'Provider B', section: 'A' },
  { id: 'a-readiness', label: '就绪条', section: 'A' },
  { id: 'b-multi-model', label: '多模型', section: 'B' },
  { id: 'b-send-ready', label: '发送就绪', section: 'B' },
  { id: 'b-trace', label: 'Trace', section: 'B' },
  { id: 'b-manifest', label: 'Manifest', section: 'B' },
  { id: 'c-agent-bind', label: 'Agent', section: 'C' },
  { id: 'c-fallback-fail', label: 'Fallback', section: 'C' },
  { id: 'c-pause-policy', label: 'pause', section: 'C' },
  { id: 'd-no-secret', label: '无密钥', section: 'D' },
  { id: 'd-restart', label: '重启', section: 'D' },
  { id: 'd-limits', label: '限制', section: 'D' },
];

describe('parseHandtestDocMarkdown', () => {
  it('counts boxes with section and never claims M1 closed', () => {
    const r = parseHandtestDocMarkdown(sample);
    expect(r.claimsM1Closed).toBe(false);
    expect(r.claimsDocAuthoritative).toBe(true);
    expect(r.total).toBe(18);
    expect(r.checked).toBe(4);
    expect(r.boxes[0]?.section).toBe('pre');
    expect(r.boxes[0]?.checked).toBe(true);
    expect(r.boxes[1]?.checked).toBe(false);
    expect(r.boxes[4]?.section).toBe('A');
    expect(r.boxes[15]?.section).toBe('D');
    expect(r.boxes[15]?.checked).toBe(true);
  });

  it('handles empty / no boxes', () => {
    const r = parseHandtestDocMarkdown('# empty\n\nno boxes');
    expect(r.total).toBe(0);
    expect(r.checked).toBe(0);
    expect(r.boxes).toEqual([]);
  });
});

describe('mapHandtestDocBoxesToItems', () => {
  it('maps by order onto canonical ids', () => {
    const r = parseHandtestDocMarkdown(sample);
    const map = mapHandtestDocBoxesToItems(r.boxes, ids);
    expect(map).toHaveLength(18);
    expect(map[0]?.itemId).toBe('pre-runtime');
    expect(map[0]?.docChecked).toBe(true);
    expect(map[1]?.docChecked).toBe(false);
    expect(map[5]?.itemId).toBe('a-discover');
    expect(map[5]?.docChecked).toBe(true);
    expect(map[15]?.docChecked).toBe(true);
  });

  it('nulls remaining when doc shorter', () => {
    const r = parseHandtestDocMarkdown('## 前置\n- [x] only one\n');
    const map = mapHandtestDocBoxesToItems(r.boxes, ids);
    expect(map[0]?.docChecked).toBe(true);
    expect(map[1]?.docChecked).toBe(null);
  });
});

describe('handtestDocParseLooksSecretFree', () => {
  it('rejects key-like strings', () => {
    expect(handtestDocParseLooksSecretFree('ok')).toBe(true);
    expect(
      handtestDocParseLooksSecretFree('sk-abcdefghijklmnopqrstuvwxyz1234'),
    ).toBe(false);
  });
});
