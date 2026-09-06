export interface BrowserClickLocator {
  css?: string;
  text?: string;
}

const HAS_TEXT_LOCATOR =
  /^(?:([A-Za-z][\w-]*)?)?:has-text\(\s*(['"])([\s\S]*?)\2\s*\)$/;
const TEXT_EQUALS_LOCATOR = /^text\s*=\s*(?:(['"])([\s\S]*?)\1|(.+))$/;

/** Turn Playwright-style click locators into CSS + visible text the guest page can use. */
export function parseBrowserClickLocator(selector: string): BrowserClickLocator {
  const trimmed = selector.trim();
  if (!trimmed) return {};

  const hasText = HAS_TEXT_LOCATOR.exec(trimmed);
  if (hasText) {
    return {
      ...(hasText[1] ? { css: hasText[1] } : {}),
      text: hasText[3],
    };
  }

  const textEquals = TEXT_EQUALS_LOCATOR.exec(trimmed);
  if (textEquals) {
    return { text: (textEquals[2] ?? textEquals[3] ?? '').trim() };
  }

  return { css: trimmed };
}

export function resolveBrowserClickTarget(input: {
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
}): { css?: string; text?: string; x?: number; y?: number } {
  const parsed =
    typeof input.selector === 'string' ? parseBrowserClickLocator(input.selector) : {};
  const text = (typeof input.text === 'string' ? input.text.trim() : '') || parsed.text || '';
  const css = parsed.text !== undefined ? parsed.css : parsed.css || input.selector?.trim();
  return {
    ...(css ? { css } : {}),
    ...(text ? { text } : {}),
    ...(typeof input.x === 'number' && Number.isFinite(input.x) ? { x: input.x } : {}),
    ...(typeof input.y === 'number' && Number.isFinite(input.y) ? { y: input.y } : {}),
  };
}
