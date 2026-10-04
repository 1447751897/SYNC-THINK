export interface BrowserClickLocator {
  css?: string;
  text?: string;
  exact?: boolean;
}

const HAS_TEXT_LOCATOR = /^(.*?):(has-text|text-is)\(\s*(['"])([\s\S]*?)\3\s*\)$/;
const TEXT_EQUALS_LOCATOR = /^text\s*=\s*(?:(['"])([\s\S]*?)\1|(.+))$/;

/** Turn Playwright-style click locators into CSS + visible text the guest page can use. */
export function parseBrowserClickLocator(selector: string): BrowserClickLocator {
  const trimmed = selector.trim();
  if (!trimmed) return {};

  const textEquals = TEXT_EQUALS_LOCATOR.exec(trimmed);
  if (textEquals) return { text: (textEquals[2] ?? textEquals[3] ?? '').trim() };

  // Only split selector lists at top level, not commas inside text/attributes.
  const parts: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (ch === '\\') { i += 1; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(trimmed.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(trimmed.slice(start).trim());
  if (parts.length > 1) {
    const targets = parts.map(parseBrowserClickLocator);
    const first = targets[0]!;
    if (first.text !== undefined && targets.every(part => part.text === first.text && part.exact === first.exact)) {
      return { ...(targets.every(part => part.css) ? { css: targets.map(part => part.css).join(', ') } : {}), text: first.text, ...(first.exact ? { exact: true } : {}) };
    }
    return { css: trimmed };
  }
  const hasText = HAS_TEXT_LOCATOR.exec(trimmed);
  if (hasText) {
    return {
      ...(hasText[1]?.trim() ? { css: hasText[1].trim() } : {}),
      text: hasText[4],
      ...(hasText[2] === 'text-is' ? { exact: true } : {}),
    };
  }

  return { css: trimmed };
}

export function resolveBrowserClickTarget(input: {
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
}): BrowserClickLocator & { x?: number; y?: number } {
  const parsed =
    typeof input.selector === 'string' ? parseBrowserClickLocator(input.selector) : {};
  const text = (typeof input.text === 'string' ? input.text.trim() : '') || parsed.text || '';
  const css = parsed.text !== undefined ? parsed.css : parsed.css || input.selector?.trim();
  return {
    ...(css ? { css } : {}),
    ...(text ? { text } : {}),
    ...(parsed.exact ? { exact: true } : {}),
    ...(typeof input.x === 'number' && Number.isFinite(input.x) ? { x: input.x } : {}),
    ...(typeof input.y === 'number' && Number.isFinite(input.y) ? { y: input.y } : {}),
  };
}
