import { fileURLToPath, pathToFileURL } from 'node:url';

export type TrustedRendererLocation =
  | { kind: 'origin'; value: string }
  | { kind: 'file'; value: string };

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEV_SERVER_URL_ERROR =
  'VITE_DEV_SERVER_URL must use an explicit loopback origin';

export function parseLoopbackDevServerUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(DEV_SERVER_URL_ERROR);
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !LOOPBACK_HOSTNAMES.has(url.hostname) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(DEV_SERVER_URL_ERROR);
  }

  return url;
}

export function trustedFileLocation(filePath: string): TrustedRendererLocation {
  return { kind: 'file', value: pathToFileURL(filePath).href };
}

function isSameTrustedFileUrl(value: string, trustedHref: string): boolean {
  try {
    const candidate = new URL(value);
    const trusted = new URL(trustedHref);
    if (candidate.protocol !== 'file:' || trusted.protocol !== 'file:') return false;
    // Packaged renderer must remain the exact document; query/hash never trusted.
    if (candidate.search !== '' || candidate.hash !== '') return false;
    if (trusted.search !== '' || trusted.hash !== '') return false;
    // pathToFileURL encodes "~" as %7E; Chromium getURL() often leaves "~" literal.
    return fileURLToPath(candidate) === fileURLToPath(trusted);
  } catch {
    return false;
  }
}

export function isTrustedRendererUrl(
  value: string,
  trustedLocation: TrustedRendererLocation,
): boolean {
  if (trustedLocation.kind === 'file') {
    return isSameTrustedFileUrl(value, trustedLocation.value);
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.origin === trustedLocation.value
    );
  } catch {
    return false;
  }
}

export function assertTrustedRendererIpcSource(
  sender: unknown,
  expectedSender: unknown,
  senderUrl: string,
  trustedLocation: TrustedRendererLocation,
): void {
  if (
    sender !== expectedSender ||
    !isTrustedRendererUrl(senderUrl, trustedLocation)
  ) {
    throw new Error('Untrusted renderer IPC source');
  }
}

interface NavigationGuardTarget {
  on(
    event: 'will-navigate' | 'will-redirect',
    listener: (event: { preventDefault(): void }, url: string) => void,
  ): unknown;
  setWindowOpenHandler(
    handler: (...args: unknown[]) => { action: 'deny' },
  ): unknown;
}

export function installNavigationGuards(
  target: NavigationGuardTarget,
  trustedLocation: TrustedRendererLocation,
): void {
  const denyUnlessTrusted = (
    event: { preventDefault(): void },
    url: string,
  ): void => {
    // location.reload() / Playwright page.reload() emit will-navigate for the
    // current document. Allow only the trusted renderer location; deny the rest.
    if (!isTrustedRendererUrl(url, trustedLocation)) {
      event.preventDefault();
    }
  };
  target.on('will-navigate', denyUnlessTrusted);
  target.on('will-redirect', denyUnlessTrusted);
  target.setWindowOpenHandler(() => ({ action: 'deny' }));
}
