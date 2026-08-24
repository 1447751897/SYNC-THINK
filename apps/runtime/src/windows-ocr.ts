import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export const WINDOWS_OCR_SERVER_NAME = 'windows-ocr';
export const WINDOWS_OCR_TOOL_NAME = 'ocr_image';

export const WINDOWS_OCR_TOOL_DESCRIPTION =
  '使用 Windows 内置 OCR 提取工作区图片中的文字（PNG / JPEG / GIF / WebP）。' +
  '适合读取截图、报错信息和界面文字；无需视觉模型或网络。';

export const WINDOWS_OCR_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      description: '工作区内的图片文件路径（相对或绝对）。',
    },
    language: {
      type: 'string',
      description: '可选 BCP-47 语言标签（例如 zh-Hans、en-US）；省略时使用 Windows 用户语言配置。',
    },
  },
};

export interface WindowsOcrResult {
  text: string;
  language: string;
}

interface WindowsOcrCommandRequest {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}

interface WindowsOcrCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type WindowsOcrCommandRunner = (
  request: WindowsOcrCommandRequest,
) => Promise<WindowsOcrCommandResult>;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;

// Windows PowerShell 5 bridges WinRT async operations through AsTask. The
// script emits one compact UTF-8 JSON object and receives dynamic values only
// through environment variables.
const WINDOWS_OCR_POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.IsGenericMethodDefinition -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation')
  } |
  Select-Object -First 1

if ($null -eq $asTaskGeneric) {
  throw 'Windows Runtime AsTask bridge is unavailable.'
}

function Await-WinRt($operation, [Type]$resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
  return $task.GetAwaiter().GetResult()
}

$imagePath = $env:SYNC_THINK_OCR_IMAGE_PATH
if ([string]::IsNullOrWhiteSpace($imagePath)) {
  throw 'Missing OCR image path.'
}

$stream = $null
$bitmap = $null
try {
  $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $languageTag = $env:SYNC_THINK_OCR_LANGUAGE
  if ([string]::IsNullOrWhiteSpace($languageTag)) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  } else {
    $language = [Windows.Globalization.Language]::new($languageTag)
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
  }
  if ($null -eq $engine) {
    throw 'No Windows OCR language is installed for the requested language.'
  }

  $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  [ordered]@{
    text = [string]$result.Text
    language = [string]$engine.RecognizerLanguage.LanguageTag
  } | ConvertTo-Json -Compress
} finally {
  if ($null -ne $bitmap) { $bitmap.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
}
`.trim();

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

const runWindowsOcrCommand: WindowsOcrCommandRunner = (request) =>
  new Promise((resolve, reject) => {
    if (request.signal?.aborted) {
      reject(abortError('Windows OCR 已取消'));
      return;
    }

    const child = spawn(request.command, request.args, {
      env: request.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const append = (target: Buffer[], currentBytes: number, chunk: Buffer): number => {
      if (currentBytes + chunk.length > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill();
        fail(new Error('Windows OCR 输出超过 4MB 限制'));
        return currentBytes;
      }
      target.push(chunk);
      return currentBytes + chunk.length;
    };
    const onAbort = (): void => {
      child.kill();
      fail(abortError('Windows OCR 已取消'));
    };
    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error(`Windows OCR 超时（${request.timeoutMs}ms）`));
    }, request.timeoutMs);

    request.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes = append(stdout, stdoutBytes, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes = append(stderr, stderrBytes, chunk);
    });
    child.once('error', fail);
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });

export function parseWindowsOcrOutput(stdout: string): WindowsOcrResult {
  const lines = stdout
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  let value: unknown;
  for (const line of lines) {
    try {
      value = JSON.parse(line);
      break;
    } catch {
      // PowerShell diagnostics can precede the final JSON line.
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Windows OCR 未返回有效结果');
  }
  const record = value as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (!text) throw new Error('Windows OCR 没有识别到文字');
  const language =
    typeof record.language === 'string' && record.language.trim() ? record.language.trim() : 'und';
  return { text, language };
}

export async function recognizeImageTextWithWindowsOcr(
  imagePath: string,
  options: {
    language?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    platform?: NodeJS.Platform;
    runner?: WindowsOcrCommandRunner;
  } = {},
): Promise<WindowsOcrResult> {
  if ((options.platform ?? process.platform) !== 'win32') {
    throw new Error('Windows OCR 仅支持 Windows');
  }
  if (!imagePath.trim()) throw new Error('Windows OCR 缺少图片路径');
  const absoluteImagePath = resolve(imagePath);
  const language = options.language?.trim() ?? '';
  if (language && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) {
    throw new Error(`Windows OCR 语言标签无效: ${language}`);
  }
  const encodedCommand = Buffer.from(WINDOWS_OCR_POWERSHELL, 'utf16le').toString('base64');
  const result = await (options.runner ?? runWindowsOcrCommand)({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
    env: {
      ...process.env,
      SYNC_THINK_OCR_IMAGE_PATH: absoluteImagePath,
      ...(language ? { SYNC_THINK_OCR_LANGUAGE: language } : {}),
    },
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
    throw new Error(`Windows OCR 执行失败: ${detail}`);
  }
  return parseWindowsOcrOutput(result.stdout);
}
