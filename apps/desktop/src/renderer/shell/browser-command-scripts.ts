import { resolveBrowserClickTarget } from '@sync-think/shared';
const BROWSER_READ_TEXT_MAX_CHARS = 8_192;

function isVisibleGuestElementSource(): string {
  return `function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || (style.opacity !== '' && Number(style.opacity) === 0)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    }
    function labelOf(el) {
      return String(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || (['submit', 'button'].includes(el.type) ? el.value : '') || '').replace(/\\s+/g, ' ').trim();
    }
    function clickableNodes() {
      return Array.from(document.querySelectorAll('a[href], button, [role="button"], [role="link"], input[type="submit"], input[type="button"], [onclick]'));
    }`;
}

/** 解析目标：可见 CSS / 可见文本；坐标回传给主进程做可信点击。 */
export function buildResolveClickScript(args: Record<string, unknown>): string {
  const target = resolveBrowserClickTarget({
    selector: typeof args.selector === 'string' ? args.selector : undefined,
    text: typeof args.text === 'string' ? args.text : undefined,
    x: typeof args.x === 'number' ? args.x : undefined,
    y: typeof args.y === 'number' ? args.y : undefined,
  });
  const css = target.css ?? '';
  const text = target.text ?? '';
  const x = target.x ?? -1;
  const y = target.y ?? -1;
  return `(() => {
    ${isVisibleGuestElementSource()}
    const css = ${JSON.stringify(css)};
    const text = ${JSON.stringify(text)};
    const needle = text.toLowerCase();
    let matches = [];
    let reason = '';
    if (css) {
      try { matches = Array.from(document.querySelectorAll(css)).filter(isVisible); }
      catch { reason = 'invalid-selector'; }
    } else if (needle) matches = clickableNodes().filter(isVisible);
    else {
      const node = document.elementFromPoint(${x}, ${y});
      if (node) matches = [node];
    }
    if (needle) {
      const exact = matches.filter(node => labelOf(node).toLowerCase() === needle);
      matches = exact.length || ${target.exact === true}
        ? exact : matches.filter(node => labelOf(node).toLowerCase().includes(needle));
    }
    const available = matches.filter(node => !node.closest(':disabled, [aria-disabled="true"]'));
    const el = available.length === 1 ? available[0] : null;
    if (!el) {
      reason ||= available.length > 1 ? 'ambiguous-target' : matches.length ? 'disabled-target' : 'target-not-found';
      return { found: false, clicked: false, reason, candidates: matches.slice(0, 12).map(labelOf), url: location.href };
    }
    const suppliedPoint = !css && !needle;
    if (!suppliedPoint) { try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {} }
    const rect = el.getBoundingClientRect();
    const cx = suppliedPoint ? ${x} : Math.round(rect.left + rect.width / 2);
    const cy = suppliedPoint ? ${y} : Math.round(rect.top + rect.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || (hit !== el && !el.contains(hit))) return { found: false, clicked: false, reason: 'occluded-target', url: location.href };
    return {
      found: true,
      x: cx,
      y: cy,
      tag: el.tagName.toLowerCase(),
      text: labelOf(el).slice(0, 120),
      href: el instanceof HTMLAnchorElement ? el.href : undefined,
      url: location.href,
    };
  })()`;
}

export function buildSyntheticClickScript(x: number, y: number): string {
  return `(() => {
    const el = document.elementFromPoint(${x}, ${y});
    if (!el) return { clicked: false, reason: 'no element at coordinates', url: location.href };
    const opts = { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y} };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', opts));
    return { clicked: true, tag: el.tagName.toLowerCase(), url: location.href };
  })()`;
}

/** 输入脚本：native value setter + input/change 事件，兼容 React 受控输入。 */
export function buildTypeScript(args: Record<string, unknown>): string {
  const selector = typeof args.selector === 'string' ? args.selector : '';
  const text = typeof args.text === 'string' ? args.text : '';
  return `(() => {
    const sel = ${JSON.stringify(selector)};
    const text = ${JSON.stringify(text)};
    ${isVisibleGuestElementSource()}
    let matches;
    try { matches = Array.from(document.querySelectorAll(sel)).filter(isVisible); }
    catch { return { typed: false, reason: 'invalid-selector', url: location.href }; }
    if (matches.length !== 1) return { typed: false, reason: matches.length ? 'ambiguous-target' : 'target-not-found', url: location.href };
    const el = matches[0];
    if (el.matches(':disabled') || el.readOnly || el.getAttribute('aria-disabled') === 'true') return { typed: false, reason: 'disabled-target', url: location.href };
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: true, tag: el.tagName.toLowerCase(), valueLength: el.value.length, url: location.href };
    }
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return { typed: true, tag: 'contenteditable', valueLength: text.length, url: location.href };
    }
    return { typed: false, reason: 'element is not an input / textarea / contentEditable', url: location.href };
  })()`;
}

/** 读取脚本：标题 / URL / 可见文本（截断）+ 链接与按钮概要，供 AI 理解页面。 */
/** Read every matched root and emit stable locators; never echo input values. */
export function buildReadScript(args: Record<string, unknown>): string {
  const selector = typeof args.selector === 'string' ? args.selector : '';
  return `(() => {
    ${isVisibleGuestElementSource()}
    const sel = ${JSON.stringify(selector)};
    let roots;
    try { roots = sel ? Array.from(document.querySelectorAll(sel)) : [document.body]; }
    catch { return { found: false, reason: 'invalid-selector', title: document.title, url: location.href }; }
    if (!roots.length) return { found: false, reason: 'target-not-found', title: document.title, url: location.href };
    const controls = [], seen = new Set();
    const query = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[onclick],[tabindex]:not([tabindex="-1"])';
    function selectorOf(node) {
      if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) return '#' + CSS.escape(node.id);
      const path = [];
      let current = node;
      while (current && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase();
        const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(child => child.tagName === current.tagName) : [current];
        path.unshift(tag + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')');
        const selector = path.join(' > ');
        if (document.querySelectorAll(selector).length === 1) return selector;
        current = current.parentElement;
      }
      return path.join(' > ');
    }
    for (const root of roots) {
      const nodes = [...(root.matches?.(query) ? [root] : []), ...root.querySelectorAll(query)];
      for (const node of nodes) {
        if (seen.has(node) || !isVisible(node)) continue;
        seen.add(node);
        const rect = node.getBoundingClientRect();
        const inViewport = rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
        controls.push({ name: labelOf(node).slice(0, 120), tag: node.tagName.toLowerCase(), role: node.getAttribute('role') || (node.tagName === 'A' ? 'link' : ['INPUT','TEXTAREA','SELECT'].includes(node.tagName) ? 'input' : 'button'), selector: selectorOf(node), href: node instanceof HTMLAnchorElement ? node.href : undefined, disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true', x: Math.round(rect.left+rect.width/2), y: Math.round(rect.top+rect.height/2), inViewport });
      }
    }
    const text = roots.map(root => String(root.innerText || root.textContent || '')).join('\\n').trim();
    return { ok: true, found: true, projection: 'browser_read.v1', title: document.title, url: location.href,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      text: text.slice(0, ${BROWSER_READ_TEXT_MAX_CHARS}), textTruncated: text.length > ${BROWSER_READ_TEXT_MAX_CHARS},
      controlCount: controls.length, controls: controls.slice(0, 64), controlsTruncated: controls.length > 64,
      links: controls.filter(c => c.role === 'link').slice(0, 40).map(c => ({ text: c.name, href: c.href, selector: c.selector })),
      buttons: controls.filter(c => c.role === 'button').slice(0, 40).map(c => c.name) };
  })()`;
}
