export const BROWSER_RECORDING_MAX_STEPS = 200;
export const BROWSER_RECORDING_MAX_STEP_BYTES = 16 * 1024;
export const BROWSER_RECORDING_MAX_TEXT_CHARS = 2_000;
export const BROWSER_RECORDING_MAX_URL_CHARS = 2_048;
export const BROWSER_RECORDING_MAX_LOCATOR_CHARS = 512;

export type BrowserRecordingStatus =
  'starting' | 'recording' | 'stopping' | 'stopped' | 'failed' | 'interrupted';

export type BrowserRecordingStopReason =
  | 'user'
  | 'step_limit'
  | 'page_closed'
  | 'browser_closed'
  | 'runtime_restarted'
  | 'start_failed'
  | 'capture_failed';

export type BrowserRecordingLocator =
  | { strategy: 'test-id'; value: string }
  | { strategy: 'role'; role: string; name?: string }
  | { strategy: 'label' | 'placeholder' | 'id' | 'name' | 'css'; value: string };

export type BrowserRecordingInputValue =
  | { kind: 'literal'; value: string }
  | { kind: 'variable'; name: string }
  | { kind: 'secret' };

export type BrowserRecordingStepInput =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; locator: BrowserRecordingLocator; resultUrl?: string }
  | { kind: 'fill'; locator: BrowserRecordingLocator; value: BrowserRecordingInputValue }
  | { kind: 'select'; locator: BrowserRecordingLocator; value: BrowserRecordingInputValue }
  | { kind: 'check'; locator: BrowserRecordingLocator; checked: boolean }
  | { kind: 'press'; locator: BrowserRecordingLocator; key: 'Enter'; resultUrl?: string };

export interface BrowserRecordingStepRecord {
  recordingId: string;
  sequence: number;
  step: BrowserRecordingStepInput;
  recordedAt: string;
  updatedAt: string;
}
