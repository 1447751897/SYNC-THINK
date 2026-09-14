// Ported from NewMax detectProviderConnectionInput / sanitizeConfigInput / addDefaultScheme.
// Source: .tmp-newmax-panels/percentages-BXMCSKIN-CUsm43rF.js and ProviderOnboardingScreen-DlfAcF5w.js

const INVISIBLE_CHAR_PATTERN = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
const LOCAL_HOST_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i;
const HOSTNAME_PATTERN = /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d+)?(?:\/|$)/i;

const ANTHROPIC_HOSTS = new Set(['api.anthropic.com']);
const OPENAI_COMPATIBLE_HOSTS = new Set([
  'api.openai.com',
  'openrouter.ai',
  'api.deepseek.com',
  'api.moonshot.cn',
  'api.siliconflow.cn',
  'api.x.ai',
  'api.groq.com',
]);

export type DetectedApiFormat = 'openai' | 'anthropic';

export interface ProviderConnectionDetection {
  baseUrl: string;
  apiFormat: DetectedApiFormat | null;
  forceResponsesApi: boolean | null;
  normalized: boolean;
}

export function sanitizeConfigInput(input: string): string {
  if (!input) return '';
  return input.replace(INVISIBLE_CHAR_PATTERN, '').replace(/\s+/g, '');
}

export function addDefaultScheme(input: string): string {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return input;
  if (LOCAL_HOST_PATTERN.test(input)) return `http://${input}`;
  if (HOSTNAME_PATTERN.test(input)) return `https://${input}`;
  return input;
}

export function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0'
    );
  } catch {
    return false;
  }
}

function detectFormatFromPath(pathname: string): DetectedApiFormat | null {
  if (/\/(?:compatible-mode|openai)(?:\/v\d+(?:beta)?)?$/i.test(pathname)) {
    return 'openai';
  }
  if (/\/v\d+(?:beta)?\/openai$/i.test(pathname)) return 'openai';
  if (/\/anthropic(?:\/v\d+(?:beta)?)?$/i.test(pathname)) return 'anthropic';
  return null;
}

export function detectProviderConnectionInput(rawInput: string): ProviderConnectionDetection {
  const sanitized = sanitizeConfigInput(rawInput);
  const inputWithScheme = addDefaultScheme(sanitized);
  let url: URL;
  try {
    url = new URL(inputWithScheme);
  } catch {
    return {
      baseUrl: sanitized,
      apiFormat: null,
      forceResponsesApi: null,
      normalized: sanitized !== rawInput,
    };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      baseUrl: sanitized,
      apiFormat: null,
      forceResponsesApi: null,
      normalized: sanitized !== rawInput,
    };
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  let basePath = pathname;
  let apiFormat: DetectedApiFormat | null = null;
  let forceResponsesApi: boolean | null = null;
  if (/\/chat\/completions$/i.test(pathname)) {
    basePath = pathname.replace(/\/chat\/completions$/i, '');
    apiFormat = 'openai';
    forceResponsesApi = false;
  } else if (/\/responses$/i.test(pathname)) {
    basePath = pathname.replace(/\/responses$/i, '');
    apiFormat = 'openai';
    forceResponsesApi = true;
  } else if (/\/messages$/i.test(pathname)) {
    basePath = pathname.replace(/\/messages$/i, '');
    apiFormat = 'anthropic';
    forceResponsesApi = false;
  } else {
    apiFormat = detectFormatFromPath(pathname);
  }
  if (!apiFormat) {
    const hostname = url.hostname.toLowerCase();
    if (ANTHROPIC_HOSTS.has(hostname)) apiFormat = 'anthropic';
    if (OPENAI_COMPATIBLE_HOSTS.has(hostname)) apiFormat = 'openai';
  }
  const baseUrl = `${url.origin}${basePath}`;
  return {
    baseUrl,
    apiFormat,
    forceResponsesApi,
    normalized: baseUrl !== rawInput,
  };
}
