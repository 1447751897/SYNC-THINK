/*
 * legacy-svg-avatar.js — a browser copy of what SYNC-THINK renders TODAY.
 *
 * Ported verbatim (shape paths, palette, state markup, derivation hash) from
 * apps/desktop/src/renderer/shell/avatar-gen.ts so the preview can put the shipping
 * renderer next to the animated one at the same size, on the same colours, for the same
 * nine states. If avatar-gen.ts changes, this file has to be re-copied — it is a
 * comparison fixture, not a second source of truth, and nothing in the app imports it.
 *
 * The one difference from the app: avatar-gen.ts emits a `data:image/svg+xml` URL and the
 * shell renders it through <img>. Here the markup is injected inline instead, so the
 * preview can animate/highlight it — the shapes and faces are byte-identical.
 */
(function (global) {
  'use strict';

  var AVATAR_SHAPES = ['blob', 'pebble', 'squircle', 'tablet', 'wedge', 'hex', 'cloud', 'teardrop'];
  var AVATAR_COLORS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta', 'gray'];
  var AVATAR_DERIVE_COLORS = AVATAR_COLORS.filter(function (c) {
    return c !== 'black';
  });

  var COLOR_HEX = {
    black: '#000000', brown: '#936439', red: '#FF263C', orange: '#FF6700', yellow: '#FF9800',
    green: '#00C972', cyan: '#00BCA6', blue: '#1084FE', violet: '#9159FE', magenta: '#FF309B',
    gray: '#777777'
  };

  var SHAPE_PATH = {
    blob: 'M44 10 C68 6 90 22 90 45 C90 61 82 75 67 84 C52 93 29 92 17 79 C5 66 5 44 14 30 C22 17 30 13 44 10 Z',
    pebble: 'M50 23 C77 23 95 35 95 50 C95 65 77 77 50 77 C23 77 5 65 5 50 C5 35 23 23 50 23 Z',
    squircle: 'M50 9 C81 9 91 19 91 50 C91 81 81 91 50 91 C19 91 9 81 9 50 C9 19 19 9 50 9 Z',
    tablet: 'M50 8 H75 C83 8 89 14 89 22 V78 C89 86 83 92 75 92 H25 C17 92 11 86 11 78 V22 C11 14 17 8 25 8 Z',
    wedge: 'M50 7 C62 7 73 15 81 27 L92 46 C95 52 95 58 92 64 C84 82 68 92 50 92 C32 92 16 82 8 64 C5 58 5 52 8 46 L19 27 C27 15 38 7 50 7 Z',
    hex: 'M50 9 L86 29 V71 L50 91 L14 71 V29 Z',
    cloud: 'M28 71 C15 71 6 61 6 49 C6 38 15 28 27 28 C30 16 40 8 52 8 C66 8 77 18 79 31 C90 33 96 42 96 52 C96 62 89 71 79 71 Z',
    teardrop: 'M50 8 C50 8 88 44 88 62 C88 80 71 94 50 94 C29 94 12 80 12 62 C12 44 50 8 50 8 Z'
  };

  var GOLDEN = 2654435769;
  function fnv1a(input) {
    var hash = 2166136261;
    for (var i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function mulberry32(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 1831565813) | 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shapeHash(input) {
    var e = fnv1a(input) | 0;
    e = Math.imul(e ^ (e >>> 16), 73244475);
    e = Math.imul(e ^ (e >>> 13), 3266489909);
    return (e ^ (e >>> 16)) >>> 0;
  }
  function deriveAvatarFace(id) {
    var colorRandom = mulberry32((fnv1a(id) ^ Math.imul(1, GOLDEN)) >>> 0);
    var color = AVATAR_DERIVE_COLORS[Math.floor(colorRandom() * AVATAR_DERIVE_COLORS.length)] || 'blue';
    var shape = AVATAR_SHAPES[shapeHash(id) % AVATAR_SHAPES.length] || 'blob';
    return { shape: shape, color: color };
  }

  function isLightColor(hex) {
    var value = parseInt(hex.slice(1), 16);
    var r = (value >> 16) & 255;
    var g = (value >> 8) & 255;
    var b = value & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
  }

  var SYMBOL_FILL = '#f2f4f5';
  var SYMBOL_EDGE = '#0d0f11';
  var DIM_STATES = { inactive: 0.42 };

  function faceMarkup(state, eye) {
    var S = SYMBOL_FILL;
    var O = SYMBOL_EDGE;
    switch (state) {
      case 'thinking':
        return '<rect x="35.5" y="38" width="8.6" height="10" rx="3.4" fill="' + eye + '"/>' +
          '<rect x="55.9" y="38" width="8.6" height="10" rx="3.4" fill="' + eye + '"/>' +
          '<circle cx="37" cy="21" r="2.9" fill="' + S + '" stroke="' + O + '" stroke-width="1.3" opacity=".55"/>' +
          '<circle cx="50" cy="15.5" r="3.5" fill="' + S + '" stroke="' + O + '" stroke-width="1.3" opacity=".9"/>' +
          '<circle cx="63" cy="21" r="2.9" fill="' + S + '" stroke="' + O + '" stroke-width="1.3" opacity=".55"/>';
      case 'working':
        return '<path d="M30 32.5 L42.5 36.5" stroke="' + eye + '" stroke-width="2.6" stroke-linecap="round"/>' +
          '<path d="M70 32.5 L57.5 36.5" stroke="' + eye + '" stroke-width="2.6" stroke-linecap="round"/>' +
          '<rect x="35" y="43" width="9" height="10.5" rx="3.6" fill="' + eye + '"/>' +
          '<rect x="56" y="43" width="9" height="10.5" rx="3.6" fill="' + eye + '"/>' +
          '<path d="M84 14 A13 13 0 0 1 90 22" stroke="' + O + '" stroke-width="5.2" fill="none" stroke-linecap="round"/>' +
          '<path d="M84 14 A13 13 0 0 1 90 22" stroke="' + S + '" stroke-width="2.8" fill="none" stroke-linecap="round"/>';
      case 'waiting':
        return '<rect x="33.5" y="40.5" width="10.6" height="15" rx="4.8" fill="' + eye + '"/>' +
          '<rect x="55.9" y="40.5" width="10.6" height="15" rx="4.8" fill="' + eye + '"/>' +
          '<rect x="47.9" y="9.5" width="4.4" height="11.5" rx="2.2" fill="' + S + '" stroke="' + O + '" stroke-width="1.3"/>' +
          '<circle cx="50.1" cy="25.8" r="2.6" fill="' + S + '" stroke="' + O + '" stroke-width="1.3"/>';
      case 'happy':
        return '<path d="M31 46.5 Q36.5 38.5 42 46.5" stroke="' + eye + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
          '<path d="M58 46.5 Q63.5 38.5 69 46.5" stroke="' + eye + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
          '<path d="M41 60 Q50 70 59 60" stroke="' + eye + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
      case 'error':
        return '<path d="M33 41 L43.5 51.5 M43.5 41 L33 51.5" stroke="' + eye + '" stroke-width="3.1" stroke-linecap="round"/>' +
          '<path d="M56.5 41 L67 51.5 M67 41 L56.5 51.5" stroke="' + eye + '" stroke-width="3.1" stroke-linecap="round"/>' +
          '<path d="M41.5 67.5 Q50 60 58.5 67.5" stroke="' + eye + '" stroke-width="2.8" fill="none" stroke-linecap="round"/>';
      case 'looking':
        return '<rect x="39.5" y="43" width="9" height="12.5" rx="3.6" fill="' + eye + '"/>' +
          '<rect x="60.5" y="43" width="9" height="12.5" rx="3.6" fill="' + eye + '"/>';
      case 'sleeping':
        return '<path d="M31.5 48 H43" stroke="' + eye + '" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M57 48 H68.5" stroke="' + eye + '" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M63 14 H74 L63 26 H74" stroke="' + O + '" stroke-width="4.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M63 14 H74 L63 26 H74" stroke="' + S + '" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
      case 'inactive':
      case 'idle':
      default:
        return '<rect x="35" y="43" width="9" height="12.5" rx="3.6" fill="' + eye + '"/>' +
          '<rect x="56" y="43" width="9" height="12.5" rx="3.6" fill="' + eye + '"/>';
    }
  }

  function avatarSvg(shape, color, state, size) {
    state = state || 'idle';
    size = size || 40;
    var fill = COLOR_HEX[color] || '#1084FE';
    var eye = isLightColor(fill) ? '#0d0f11' : '#f2f4f5';
    var dim = DIM_STATES[state];
    var opacity = dim ? ' opacity="' + dim + '"' : '';
    var d = SHAPE_PATH[shape] || SHAPE_PATH.blob;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"' + opacity + '>' +
      '<path d="' + d + '" fill="' + fill + '" stroke="' + fill + '" stroke-width="2.5" stroke-linejoin="round"/>' +
      faceMarkup(state, eye) +
      '</svg>';
  }

  function avatarMarkup(shape, color, state, size) {
    return avatarSvg(shape, color, state, size);
  }

  function colorHex(color) {
    return COLOR_HEX[color] || '#1084FE';
  }

  global.LegacySvgAvatar = {
    SHAPES: AVATAR_SHAPES,
    COLORS: AVATAR_COLORS,
    COLOR_HEX: COLOR_HEX,
    deriveAvatarFace: deriveAvatarFace,
    avatarSvg: avatarSvg,
    avatarMarkup: avatarMarkup,
    colorHex: colorHex
  };
})(typeof window !== 'undefined' ? window : globalThis);
