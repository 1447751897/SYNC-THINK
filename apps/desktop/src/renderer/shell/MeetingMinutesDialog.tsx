import * as Dialog from '@radix-ui/react-dialog';
import { Mic, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export interface MeetingMinutesDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onUseTranscript(prompt: string): void;
}

const MEETING_MINUTES_PROMPT =
  '请根据以下会议转写生成结构化会议纪要，包含议题、关键结论、待办事项、负责人和时间节点：';

function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function joinTranscript(left: string, right: string): string {
  const first = left.trim();
  const second = right.trim();
  if (!first) return second;
  if (!second) return first;
  return `${first}${/[。！？!?；;，,\s]$/.test(first) ? '' : ' '}${second}`;
}

function recognitionErrorMessage(error: string): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return '麦克风权限未开启，请在系统设置中允许应用使用麦克风。';
  }
  if (error === 'audio-capture') return '未检测到可用麦克风。';
  if (error === 'network') return '语音识别服务连接失败，请检查网络后重试。';
  return `语音转写已停止（${error || '未知错误'}）。`;
}

export function MeetingMinutesDialog({
  open,
  onOpenChange,
  onUseTranscript,
}: MeetingMinutesDialogProps) {
  const supported = Boolean(recognitionConstructor());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const transcriptRef = useRef('');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateTranscript = (value: string) => {
    transcriptRef.current = value;
    setTranscript(value);
  };

  const stopRecognition = (abort = false) => {
    shouldListenRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    if (!recognition) return;
    recognition.onend = null;
    if (abort) recognition.abort();
    else recognition.stop();
  };

  useEffect(() => {
    if (open) return;
    stopRecognition(true);
    updateTranscript('');
    setInterimTranscript('');
    setError(null);
  }, [open]);

  useEffect(
    () => () => {
      shouldListenRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  const startRecognition = () => {
    const Recognition = recognitionConstructor();
    if (!Recognition || listening) return;
    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalized = '';
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalized = joinTranscript(finalized, text);
        else interim = joinTranscript(interim, text);
      }
      if (finalized) updateTranscript(joinTranscript(transcriptRef.current, finalized));
      setInterimTranscript(interim);
    };
    recognition.onerror = (event) => {
      shouldListenRef.current = false;
      setListening(false);
      setError(recognitionErrorMessage(event.error));
    };
    recognition.onend = () => {
      if (!shouldListenRef.current) {
        setListening(false);
        return;
      }
      try {
        recognition.start();
      } catch {
        shouldListenRef.current = false;
        setListening(false);
        setError('语音转写意外结束，请重新开始。');
      }
    };
    recognitionRef.current = recognition;
    shouldListenRef.current = true;
    setError(null);
    setInterimTranscript('');
    setListening(true);
    try {
      recognition.start();
    } catch (startError) {
      shouldListenRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      setError(startError instanceof Error ? startError.message : '语音转写启动失败。');
    }
  };

  const stop = () => {
    if (interimTranscript) updateTranscript(joinTranscript(transcriptRef.current, interimTranscript));
    setInterimTranscript('');
    stopRecognition(false);
  };

  const close = () => {
    stopRecognition(true);
    onOpenChange(false);
  };

  const useTranscript = () => {
    const text = joinTranscript(transcriptRef.current, interimTranscript).trim();
    if (!text) return;
    onUseTranscript(`${MEETING_MINUTES_PROMPT}\n\n${text}`);
    close();
  };

  const canGenerate = Boolean(joinTranscript(transcript, interimTranscript).trim());

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="meeting-minutes-dialog__overlay" />
        <Dialog.Content className="meeting-minutes-dialog__content" data-testid="meeting-minutes-dialog">
          <header className="meeting-minutes-dialog__header">
            <div>
              <Dialog.Title className="meeting-minutes-dialog__title">会议纪要</Dialog.Title>
              <Dialog.Description className="meeting-minutes-dialog__description">
                连续记录会议语音，停止后可校对转写内容
              </Dialog.Description>
            </div>
            <button
              type="button"
              className="meeting-minutes-dialog__close"
              aria-label="关闭"
              onClick={close}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {!supported ? (
            <div className="meeting-minutes-dialog__unsupported" role="status">
              <strong>当前系统未提供语音识别能力</strong>
              <span>请使用支持 SpeechRecognition 的系统环境。</span>
            </div>
          ) : null}

          <div className="meeting-minutes-dialog__recording-row">
            <span className="meeting-minutes-dialog__status" role="status" data-active={listening ? '1' : '0'}>
              <span aria-hidden="true" />
              {listening ? '正在转写' : transcript ? '已停止' : '等待开始'}
            </span>
            <button
              type="button"
              className="meeting-minutes-dialog__record"
              disabled={!supported}
              onClick={listening ? stop : startRecognition}
            >
              {listening ? <Square size={15} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
              {listening ? '停止转写' : '开始转写'}
            </button>
          </div>

          <label className="meeting-minutes-dialog__field">
            <span>会议转写</span>
            <textarea
              aria-label="会议转写"
              value={transcript}
              placeholder="转写结果会显示在这里，也可以直接粘贴或编辑会议记录"
              onChange={(event) => updateTranscript(event.target.value)}
            />
          </label>
          {interimTranscript ? (
            <p className="meeting-minutes-dialog__interim" aria-live="polite">
              {interimTranscript}
            </p>
          ) : null}
          {error ? (
            <p className="meeting-minutes-dialog__error" role="alert">
              {error}
            </p>
          ) : null}

          <footer className="meeting-minutes-dialog__footer">
            <button type="button" className="meeting-minutes-dialog__cancel" onClick={close}>
              取消
            </button>
            <button
              type="button"
              className="meeting-minutes-dialog__submit"
              disabled={!canGenerate}
              onClick={useTranscript}
            >
              生成会议纪要
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
