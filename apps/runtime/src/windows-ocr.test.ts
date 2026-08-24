import { describe, expect, it, vi } from 'vitest';
import {
  parseWindowsOcrOutput,
  recognizeImageTextWithWindowsOcr,
  WINDOWS_OCR_INPUT_SCHEMA,
  type WindowsOcrCommandRunner,
} from './windows-ocr.js';

describe('Windows built-in OCR', () => {
  it('parses UTF-8 JSON output from the PowerShell WinRT bridge', () => {
    expect(parseWindowsOcrOutput('{"text":"设置 > 模型","language":"zh-Hans"}\r\n')).toEqual({
      text: '设置 > 模型',
      language: 'zh-Hans',
    });
  });

  it('passes the image path through the environment instead of shell text', async () => {
    const imagePath = 'D:\\workspace\\截图 01.png';
    const runner: WindowsOcrCommandRunner = vi.fn(async (request) => {
      expect(request.command).toBe('powershell.exe');
      expect(request.args).toEqual([
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        expect.any(String),
      ]);
      expect(request.args.join(' ')).not.toContain(imagePath);
      expect(request.env.SYNC_THINK_OCR_IMAGE_PATH).toBe(imagePath);
      const script = Buffer.from(request.args[3]!, 'base64').toString('utf16le');
      expect(script).toContain('$task.GetAwaiter().GetResult()');
      expect(script).not.toContain('$task.Wait(');
      return {
        exitCode: 0,
        stdout: '{"text":"Invalid request","language":"en-US"}',
        stderr: '',
      };
    });

    await expect(
      recognizeImageTextWithWindowsOcr(imagePath, { runner, platform: 'win32' }),
    ).resolves.toEqual({ text: 'Invalid request', language: 'en-US' });
    expect(runner).toHaveBeenCalledOnce();
  });

  it('declares a required workspace image path and rejects empty OCR output', () => {
    expect(WINDOWS_OCR_INPUT_SCHEMA).toMatchObject({ required: ['path'] });
    expect(() => parseWindowsOcrOutput('{"text":"","language":"zh-Hans"}')).toThrow(
      /没有识别到文字/,
    );
  });
});
