import { describe, expect, it } from 'vitest';
import { formatRunPauseTerminalMessage } from './events.js';

describe('formatRunPauseTerminalMessage', () => {
  it('explains that a hand-picked model was left out of the agent fallback chain', () => {
    const text = formatRunPauseTerminalMessage({
      reason: 'no_fallback_configured',
      failureClass: 'transient',
      providerModelId: 'deepseek-flash',
      errorMessage: 'terminated',
      resolutionSource: 'runOverride',
      fallbackModelCount: 1,
    });

    expect(text).toContain('本对话手选的模型不可用');
    expect(text).toContain('不在该智能体的备用模型链中');
    expect(text).toContain('请重新选择模型后重试，或把该模型加入智能体的备用模型链。');
    // The previous wording claimed no backup existed even though one was configured,
    // which told the user nothing about what to do next.
    expect(text).not.toContain('没有配置备用模型');
    expect(text).toContain('模型：deepseek-flash');
    expect(text).toContain('失败类型：transient');
    expect(text).toContain('详情：terminated');
  });

  it('keeps the original wording when the agent truly has no fallback model', () => {
    const text = formatRunPauseTerminalMessage({
      reason: 'no_fallback_configured',
      resolutionSource: 'runOverride',
      fallbackModelCount: 0,
    });

    expect(text).toContain('当前模型不可用，且没有配置备用模型。');
    expect(text).toContain('请切换 Provider、模型或检查连接后重试。');
  });

  it('leaves the default-model pause wording untouched', () => {
    const text = formatRunPauseTerminalMessage({
      reason: 'no_fallback_configured',
      resolutionSource: 'agentDefault',
      fallbackModelCount: 1,
    });

    expect(text).toContain('当前模型不可用，且没有配置备用模型。');
    expect(text).not.toContain('本对话手选的模型不可用');
  });

  it('still reports an exhausted fallback chain', () => {
    const text = formatRunPauseTerminalMessage({
      reason: 'fallback_exhausted',
      resolutionSource: 'runOverride',
      fallbackModelCount: 2,
    });

    expect(text).toContain('备用模型已全部尝试，任务已暂停。');
    expect(text).toContain('请切换 Provider、模型或检查连接后重试。');
  });

  it('still reports an expired recovery and names unknown reasons', () => {
    const recovery = formatRunPauseTerminalMessage({ reason: 'recovery_expired' });
    expect(recovery).toContain('历史请求已过期，未自动重新执行。');
    expect(recovery).toContain('请重新发送请求。');
    expect(formatRunPauseTerminalMessage({ reason: 'something_else' })).toBe(
      '任务已暂停（something_else）。',
    );
    expect(formatRunPauseTerminalMessage({})).toBe('任务已暂停（paused）。');
  });
});
