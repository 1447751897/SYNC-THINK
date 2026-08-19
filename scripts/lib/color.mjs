/**
 * Color math for the shell's design-token pipeline.
 *
 * Exists because the token graph is not a flat list of hex strings: a semantic
 * token may be `var(--ramp-sand-2)`, an accent may be
 * `hsl(var(--accent-h) var(--accent-s) calc(var(--accent-l) - 12%))`, and a soft
 * tint may be `color-mix(in oklab, var(--color-accent) 12%, var(--color-surface))`.
 * To assert WCAG contrast on the *real* palette rather than on a hand-copied
 * table, we have to resolve that graph the way the browser does.
 *
 * Scope is deliberately narrow — only the CSS color forms the token spec is
 * allowed to use. Anything else throws, so an unsupported value fails loudly
 * in `check-contrast.mjs` instead of silently skipping the assertion.
 */

// ── Types ────────────────────────────────────────────────────────────────────
// A color is { r, g, b, a } with r/g/b in 0..255 (float, unclamped until format)
// and a in 0..1.

const NAMED = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
const round = (n) => Math.round(n * 1e6) / 1e6;

// ── Text helpers ─────────────────────────────────────────────────────────────

/** Split on a top-level separator, ignoring anything inside parentheses. */
export function splitTop(input, sep) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of input) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && ch === sep) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim());
}

/** Split on top-level whitespace (modern space-separated function syntax). */
function splitWs(input) {
  return splitTop(input.replace(/\s+/g, ' '), ' ').filter((s) => s !== '');
}

/** `fn(args)` → ['fn', 'args'] when `input` is exactly one function call. */
function asCall(input) {
  const m = /^([a-z-]+)\((.*)\)$/is.exec(input.trim());
  if (!m) return null;
  // Guard against `hsl(1 2 3) hsl(4 5 6)` parsing as one call.
  let depth = 0;
  const body = m[2];
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return null;
    }
  }
  return [m[1].toLowerCase(), body];
}

// ── var() substitution ───────────────────────────────────────────────────────

/**
 * Textually inline every `var(--x)` / `var(--x, fallback)` using `lookup`.
 * Textual (rather than structural) substitution is what lets a token be built
 * from fragments — `calc(var(--accent-l) - 12%)` only becomes evaluable once
 * `--accent-l` has been pasted in.
 */
export function inlineVars(expr, lookup, { max = 32 } = {}) {
  let out = String(expr);
  for (let pass = 0; pass < max; pass += 1) {
    const idx = out.indexOf('var(');
    if (idx < 0) return out;
    // Find the matching close paren for this var(.
    let depth = 0;
    let end = -1;
    for (let i = idx + 3; i < out.length; i += 1) {
      if (out[i] === '(') depth += 1;
      else if (out[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) throw new Error(`unbalanced var() in: ${expr}`);
    const inner = out.slice(idx + 4, end);
    const parts = splitTop(inner, ',');
    const name = parts[0];
    const fallback = parts.length > 1 ? parts.slice(1).join(',').trim() : null;
    const value = lookup(name);
    if (value === undefined || value === null) {
      if (fallback === null) throw new Error(`undefined variable ${name} in: ${expr}`);
      out = out.slice(0, idx) + fallback + out.slice(end + 1);
    } else {
      out = out.slice(0, idx) + value + out.slice(end + 1);
    }
  }
  throw new Error(`var() substitution did not settle (cycle?) in: ${expr}`);
}

// ── calc() ───────────────────────────────────────────────────────────────────

/**
 * Evaluate every top-level `calc()` in `expr` down to a `<number><unit>` literal.
 * Only what the token spec needs: + - * / on same-unit or unitless operands.
 */
export function reduceCalc(expr) {
  let out = String(expr);
  for (let guard = 0; guard < 64; guard += 1) {
    const idx = out.toLowerCase().indexOf('calc(');
    if (idx < 0) return out;
    let depth = 0;
    let end = -1;
    for (let i = idx + 4; i < out.length; i += 1) {
      if (out[i] === '(') depth += 1;
      else if (out[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) throw new Error(`unbalanced calc() in: ${expr}`);
    const body = out.slice(idx + 5, end);
    const { value, unit } = evalCalc(body);
    out = out.slice(0, idx) + `${round(value)}${unit}` + out.slice(end + 1);
  }
  throw new Error(`calc() reduction did not settle in: ${expr}`);
}

function evalCalc(src) {
  const tokens = String(src)
    .match(/[0-9.]+[a-z%]*|[-+*/()]|\s+/gi)
    ?.filter((t) => !/^\s+$/.test(t));
  if (!tokens) throw new Error(`cannot tokenize calc(): ${src}`);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const unify = (a, b, op) => {
    if (op === '*' || op === '/') {
      if (b.unit && a.unit) throw new Error(`calc(): cannot ${op} two dimensions in ${src}`);
      return a.unit || b.unit;
    }
    if (a.unit && b.unit && a.unit !== b.unit) {
      throw new Error(`calc(): mismatched units ${a.unit} ${op} ${b.unit} in ${src}`);
    }
    return a.unit || b.unit;
  };

  function primary() {
    const t = next();
    if (t === undefined) throw new Error(`calc(): unexpected end of ${src}`);
    if (t === '(') {
      const v = sum();
      if (next() !== ')') throw new Error(`calc(): expected ) in ${src}`);
      return v;
    }
    if (t === '-') {
      const v = primary();
      return { value: -v.value, unit: v.unit };
    }
    if (t === '+') return primary();
    const m = /^([0-9.]+)([a-z%]*)$/i.exec(t);
    if (!m) throw new Error(`calc(): unexpected token "${t}" in ${src}`);
    return { value: Number(m[1]), unit: m[2] };
  }

  function product() {
    let left = primary();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const right = primary();
      const unit = unify(left, right, op);
      left = { value: op === '*' ? left.value * right.value : left.value / right.value, unit };
    }
    return left;
  }

  function sum() {
    let left = product();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const right = product();
      const unit = unify(left, right, op);
      left = { value: op === '+' ? left.value + right.value : left.value - right.value, unit };
    }
    return left;
  }

  const result = sum();
  if (pos !== tokens.length) throw new Error(`calc(): trailing input in ${src}`);
  return result;
}

// ── Number / percentage parsing ──────────────────────────────────────────────

function num(token, { scale = 1, of = null } = {}) {
  const t = String(token).trim();
  const m = /^([-+]?[0-9.]+)(%|deg|grad|rad|turn)?$/i.exec(t);
  if (!m) throw new Error(`expected a number, got "${token}"`);
  const value = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === '%') return of === null ? (value / 100) * scale : (value / 100) * of;
  if (unit === 'deg' || unit === '') return value;
  if (unit === 'grad') return value * 0.9;
  if (unit === 'rad') return (value * 180) / Math.PI;
  if (unit === 'turn') return value * 360;
  throw new Error(`unsupported unit "${unit}"`);
}

function alphaOf(token) {
  if (token === undefined) return 1;
  return clamp(num(token, { of: 1 }), 0, 1);
}

// ── hsl() ────────────────────────────────────────────────────────────────────

export function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const lig = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = lig - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === rn) h = 60 * (((gn - bn) / d) % 6);
  else if (max === gn) h = 60 * ((bn - rn) / d + 2);
  else h = 60 * ((rn - gn) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

// ── oklab ────────────────────────────────────────────────────────────────────

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function srgbToOklab({ r, g, b }) {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabToSrgb({ L, a, b }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return {
    r: clamp(fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), 0, 1) * 255,
    g: clamp(fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), 0, 1) * 255,
    b: clamp(fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), 0, 1) * 255,
  };
}

// ── color-mix() ──────────────────────────────────────────────────────────────

/**
 * CSS Color 5 `color-mix()` for the two spaces the shell uses. Alpha is
 * premultiplied per spec, which is why mixing 12% of an opaque accent into
 * `transparent` yields a 12%-alpha accent rather than a washed-out gray.
 */
export function mix(space, a, wa, b, wb) {
  let p1 = wa;
  let p2 = wb;
  if (p1 === null && p2 === null) {
    p1 = 0.5;
    p2 = 0.5;
  } else if (p1 === null) p1 = 1 - p2;
  else if (p2 === null) p2 = 1 - p1;
  const total = p1 + p2;
  if (total === 0) throw new Error('color-mix(): percentages sum to zero');
  // Per spec: normalize, and if they summed to <100% the result is not scaled up.
  const n1 = p1 / total;
  const n2 = p2 / total;
  const alpha = a.a * n1 + b.a * n2;

  // Premultiply, interpolate, un-premultiply.
  const pre = (c, w, chan) => chan * c.a * w;
  if (space === 'srgb') {
    const r = pre(a, n1, a.r) + pre(b, n2, b.r);
    const g = pre(a, n1, a.g) + pre(b, n2, b.g);
    const bl = pre(a, n1, a.b) + pre(b, n2, b.b);
    return alpha === 0
      ? { r: 0, g: 0, b: 0, a: 0 }
      : { r: r / alpha, g: g / alpha, b: bl / alpha, a: alpha };
  }
  if (space === 'oklab') {
    const oa = srgbToOklab(a);
    const ob = srgbToOklab(b);
    const L = oa.L * a.a * n1 + ob.L * b.a * n2;
    const A = oa.a * a.a * n1 + ob.a * b.a * n2;
    const B = oa.b * a.a * n1 + ob.b * b.a * n2;
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const rgb = oklabToSrgb({ L: L / alpha, a: A / alpha, b: B / alpha });
    return { ...rgb, a: alpha };
  }
  throw new Error(`unsupported color-mix() space "${space}" (only srgb and oklab)`);
}

// ── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parse a fully-resolved CSS color (no `var()`, no `calc()` — run those first,
 * or use `resolve()` which does it for you).
 */
export function parse(input) {
  const s = String(input).trim();
  const named = NAMED[s.toLowerCase()];
  if (named) return { ...named };

  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    const h = hex[1];
    const dup = (c) => parseInt(c + c, 16);
    if (h.length === 3) return { r: dup(h[0]), g: dup(h[1]), b: dup(h[2]), a: 1 };
    if (h.length === 4)
      return { r: dup(h[0]), g: dup(h[1]), b: dup(h[2]), a: dup(h[3]) / 255 };
    if (h.length === 6)
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: 1,
      };
    if (h.length === 8)
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: parseInt(h.slice(6, 8), 16) / 255,
      };
    throw new Error(`bad hex color "${s}"`);
  }

  const call = asCall(s);
  if (!call) throw new Error(`unrecognized color "${s}"`);
  const [fn, body] = call;

  if (fn === 'rgb' || fn === 'rgba') {
    const [head, alphaPart] = splitTop(body, '/');
    let args = splitTop(head, ',');
    let alpha = alphaPart;
    if (args.length === 1) args = splitWs(head);
    else if (args.length === 4) {
      alpha = args[3];
      args = args.slice(0, 3);
    }
    if (args.length !== 3) throw new Error(`bad rgb() "${s}"`);
    return {
      r: clamp(num(args[0], { of: 255 }), 0, 255),
      g: clamp(num(args[1], { of: 255 }), 0, 255),
      b: clamp(num(args[2], { of: 255 }), 0, 255),
      a: alphaOf(alpha),
    };
  }

  if (fn === 'hsl' || fn === 'hsla') {
    const [head, alphaPart] = splitTop(body, '/');
    let args = splitTop(head, ',');
    let alpha = alphaPart;
    if (args.length === 1) args = splitWs(head);
    else if (args.length === 4) {
      alpha = args[3];
      args = args.slice(0, 3);
    }
    if (args.length !== 3) throw new Error(`bad hsl() "${s}"`);
    const rgb = hslToRgb(num(args[0]), num(args[1], { of: 1 }), num(args[2], { of: 1 }));
    return { ...rgb, a: alphaOf(alpha) };
  }

  if (fn === 'color-mix') {
    const args = splitTop(body, ',');
    if (args.length !== 3) throw new Error(`color-mix() needs 3 arguments: "${s}"`);
    const spaceMatch = /^in\s+([a-z-]+)$/i.exec(args[0].trim());
    if (!spaceMatch) throw new Error(`color-mix() missing "in <space>": "${s}"`);
    const one = splitOperand(args[1], s);
    const two = splitOperand(args[2], s);
    return mix(spaceMatch[1].toLowerCase(), parse(one.color), one.pct, parse(two.color), two.pct);
  }

  throw new Error(`unsupported color function "${fn}()" in "${s}"`);
}

/** `<color> [<percentage>]` in either order, as color-mix() allows. */
function splitOperand(part, whole) {
  const parts = splitWs(part);
  if (parts.length === 1) return { color: parts[0], pct: null };
  if (parts.length !== 2) throw new Error(`bad color-mix() operand "${part}" in "${whole}"`);
  const pctIdx = parts.findIndex((p) => /%$/.test(p));
  if (pctIdx < 0) throw new Error(`bad color-mix() operand "${part}" in "${whole}"`);
  return { color: parts[1 - pctIdx], pct: num(parts[pctIdx], { of: 1 }) };
}

// ── Resolve ──────────────────────────────────────────────────────────────────

/**
 * Full pipeline: inline `var()`, reduce `calc()`, then parse.
 * `lookup` maps a custom-property name (`--color-surface`) to its raw value.
 */
export function resolve(expr, lookup) {
  return parse(reduceCalc(inlineVars(expr, lookup)));
}

// ── Output / metrics ─────────────────────────────────────────────────────────

export function toHex({ r, g, b, a = 1 }) {
  const h = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return a >= 1 ? `#${h(r)}${h(g)}${h(b)}` : `#${h(r)}${h(g)}${h(b)}${h(a * 255)}`;
}

/** Composite a possibly-translucent color over an opaque backdrop. */
export function over(fg, bg) {
  if (fg.a >= 1) return { ...fg, a: 1 };
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/**
 * WCAG 2.x relative luminance. Uses the 0.03928 threshold as published in the
 * WCAG 2.1 definition — not the 0.04045 from the sRGB spec — so the numbers
 * here match what contrast checkers report.
 */
export function luminance({ r, g, b }) {
  const ch = (v) => {
    const c = clamp(v, 0, 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG 2.x contrast ratio, 1..21. Both colors must be opaque. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast of `fg` (possibly translucent) against opaque `bg`. */
export function contrastOver(fg, bg) {
  return contrast(over(fg, bg), bg);
}
