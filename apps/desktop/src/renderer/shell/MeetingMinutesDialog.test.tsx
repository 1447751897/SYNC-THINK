/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingMinutesDialog } from './MeetingMinutesDialog.js';

interface RecognitionResultFixture {
  isFinal: boolean;
  0: { transcript: string };
  length: 1;
}

class SpeechRecognitionFixture {
  static instances: SpeechRecognitionFixture[] = [];

  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: { resultIndex: number; results: RecognitionResultFixture[] }) => void) | null =
    null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    SpeechRecognitionFixture.instances.push(this);
  }
}

beforeEach(() => {
  SpeechRecognitionFixture.instances = [];
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: SpeechRecognitionFixture,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'SpeechRecognition');
  Reflect.deleteProperty(window, 'webkitSpeechRecognition');
});

describe('MeetingMinutesDialog', () => {
  it('continuously transcribes speech, lets the user edit it, and returns a minutes prompt', () => {
    const onUseTranscript = vi.fn();
    render(
      <MeetingMinutesDialog
        open
        onOpenChange={vi.fn()}
        onUseTranscript={onUseTranscript}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '开始转写' }));
    const recognition = SpeechRecognitionFixture.instances[0];
    expect(recognition.lang).toBe('zh-CN');
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.start).toHaveBeenCalledTimes(1);

    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          { 0: { transcript: '讨论新版发布。' }, length: 1, isFinal: true },
          { 0: { transcript: '负责人是小林' }, length: 1, isFinal: false },
        ],
      });
    });

    expect((screen.getByLabelText('会议转写') as HTMLTextAreaElement).value).toBe(
      '讨论新版发布。',
    );
    expect(screen.getByText('负责人是小林')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '停止转写' }));
    expect(recognition.stop).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('会议转写'), {
      target: { value: '讨论新版发布，负责人是小林，周五完成。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成会议纪要' }));

    expect(onUseTranscript).toHaveBeenCalledWith(
      '请根据以下会议转写生成结构化会议纪要，包含议题、关键结论、待办事项、负责人和时间节点：\n\n讨论新版发布，负责人是小林，周五完成。',
    );
  });

  it('clearly disables recording when the browser has no speech recognition capability', () => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    const onUseTranscript = vi.fn();

    render(
      <MeetingMinutesDialog open onOpenChange={vi.fn()} onUseTranscript={onUseTranscript} />,
    );

    expect(screen.getByText('当前系统未提供语音识别能力')).toBeTruthy();
    expect((screen.getByRole('button', { name: '开始转写' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText('会议转写'), {
      target: { value: '手动粘贴的会议记录。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成会议纪要' }));

    expect(onUseTranscript).toHaveBeenCalledWith(
      '请根据以下会议转写生成结构化会议纪要，包含议题、关键结论、待办事项、负责人和时间节点：\n\n手动粘贴的会议记录。',
    );
  });
});
