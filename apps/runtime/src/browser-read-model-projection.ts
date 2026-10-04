/** Browser results have a dedicated structured budget: ordinary 2k head/tail
 * folding cannot retain 24 locators and would destroy JSON. Never persist DOM. */
export const BROWSER_READ_MODEL_MAX_CHARS = 8000;
const CONTROL_LIMIT = 24;
type Row = Record<string, unknown>;
function row(value: unknown): value is Row {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function isBrowserReadResult(value: unknown): value is Row & { url: string } {
  return (
    row(value) &&
    value.ok === true &&
    typeof value.url === 'string' &&
    (value.projection === 'browser_read.v1' ||
      (typeof value.commandId === 'string' &&
        typeof value.profileId === 'string' &&
        typeof value.text === 'string'))
  );
}

/** Keep real locators whole, prioritize visible icon-only controls, then body text. */
export function projectBrowserReadResultForModel(resultText: string): string {
  let source: unknown;
  try {
    source = JSON.parse(resultText);
  } catch {
    return resultText;
  }
  if (!isBrowserReadResult(source)) return resultText;
  if (source.projection === 'browser_read.v1' && resultText.length <= BROWSER_READ_MODEL_MAX_CHARS)
    return resultText;
  const controls = (Array.isArray(source.controls) ? source.controls : [])
    .filter(row)
    .filter(
      (control) =>
        typeof control.selector === 'string' &&
        control.selector.length > 0 &&
        JSON.stringify(control.selector).length <= 4096 &&
        typeof control.inViewport === 'boolean',
    )
    .sort((a, b) => {
      const priority = (control: Row) => {
        const glyph = control.role === 'icon' || control.tag === 'svg';
        const wordless = !control.name || (typeof control.name === 'string' && control.name.toLowerCase() === 'svg');
        return (control.inViewport ? 0 : 10) + (wordless ? 0 : glyph ? 1 : 2);
      };
      return priority(a) - priority(b);
    })
    .slice(0, CONTROL_LIMIT)
    .map((control) => ({
      name: typeof control.name === 'string' ? control.name.slice(0, 100) : '',
      ...(typeof control.tag === 'string' ? { tag: control.tag.slice(0, 40) } : {}),
      ...(typeof control.role === 'string' ? { role: control.role.slice(0, 40) } : {}),
      selector: control.selector,
      ...(control.inViewport && Number.isFinite(control.x) && Number.isFinite(control.y)
        ? { x: control.x, y: control.y }
        : {}),
      inViewport: control.inViewport,
      ...(typeof control.disabled === 'boolean' ? { disabled: control.disabled } : {}),
    }));
  const output: Row = { ok: true, projection: 'browser_read.v1' };
  for (const key of ['commandId', 'profileId', 'pageId', 'leaseId', 'ownerId'])
    if (typeof source[key] === 'string' && JSON.stringify(source[key]).length <= 512)
      output[key] = source[key];
  if (JSON.stringify(source.url).length <= 2048) output.url = source.url;
  else {
    try {
      output.url = new URL(source.url).origin;
      output.urlTruncated = true;
    } catch {
      output.urlTruncated = true;
    }
  }
  if (typeof source.title === 'string') output.title = source.title.slice(0, 200);
  if (
    row(source.viewport) &&
    typeof source.viewport.width === 'number' &&
    source.viewport.width > 0 &&
    Number.isFinite(source.viewport.width) &&
    typeof source.viewport.height === 'number' &&
    source.viewport.height > 0 &&
    Number.isFinite(source.viewport.height)
  ) {
    output.viewport = {
      width: source.viewport.width,
      height: source.viewport.height,
      ...(typeof source.viewport.devicePixelRatio === 'number' &&
      source.viewport.devicePixelRatio > 0 &&
      Number.isFinite(source.viewport.devicePixelRatio)
        ? { devicePixelRatio: source.viewport.devicePixelRatio }
        : {}),
    };
  }
  const originalCount = Array.isArray(source.controls) ? source.controls.length : 0;
  output.controlCount =
    Number.isSafeInteger(source.controlCount) && (source.controlCount as number) >= originalCount
      ? source.controlCount
      : originalCount;
  output.controls = controls;
  let text = typeof source.text === 'string' ? source.text.slice(0, 2800) : '';
  output.text = text;
  output.textTruncated =
    source.textTruncated === true ||
    (typeof source.text === 'string' && text.length < source.text.length);
  output.controlsTruncated = controls.length < (output.controlCount as number);
  let encoded = JSON.stringify(output);
  // Shrink actual text inside JSON, never the serialized JSON or a CSS locator.
  while (encoded.length > BROWSER_READ_MODEL_MAX_CHARS && text.length) {
    text = text.slice(
      0,
      Math.max(0, text.length - (encoded.length - BROWSER_READ_MODEL_MAX_CHARS)),
    );
    output.text = text;
    output.textTruncated = true;
    encoded = JSON.stringify(output);
  }
  while (encoded.length > BROWSER_READ_MODEL_MAX_CHARS && controls.length > 1) {
    controls.pop();
    output.controlsTruncated = true;
    encoded = JSON.stringify(output);
  }
  for (const key of ['title', 'ownerId', 'leaseId', 'pageId', 'url']) {
    if (encoded.length <= BROWSER_READ_MODEL_MAX_CHARS) break;
    delete output[key];
    encoded = JSON.stringify(output);
  }
  return encoded;
}
