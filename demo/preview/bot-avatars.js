/*
 * bot-avatars.js — animated canvas bot avatars for the SYNC-THINK integration preview.
 *
 * WHAT THIS IMPLEMENTS
 *   The animation model of libraries.dev/bots, not an invented one:
 *
 *   · three states only — `default` / `working` / `sleeping` — and they BLEND: a weight
 *     vector over the three is animated across ~1.2s, so every pose term is a weighted sum
 *     rather than a switch.
 *   · gaze: in `default` the bot picks a look direction, holds it 2.6–4.4s, then re-aims
 *     (66% reverse, 19% mirror one axis, else recentre). Yaw / pitch / roll wander on
 *     separate springs, so the head drifts instead of looping.
 *   · blinks (with a 22% chance of an immediate second blink), independent per-eye blinks
 *     (so a wink is possible), and random saccades every 1.2–3.8s.
 *   · idle hop every ~8s — every third hop is higher and spins the body a full turn.
 *   · `working` hops continuously (0.68s each), leans in 5°, and occasionally "laughs".
 *   · `sleeping` drops the head 16°, rolls 6°, breathes at 3.6–4.8s and nods every 4–8s.
 *   · pointer follow: a document-level pointermove drives every avatar. The eyes and head
 *     turn toward the cursor, with influence 1 inside one avatar-width and 0 past three,
 *     so a crowd of avatars all glance at the pointer while the wander quietens down.
 *   · click → poke(): the bot does a spin-hop with a short click squash. A second click
 *     inside the first 60% of a flip is ignored, exactly like the library.
 *   · eyes live on a sphere and are projected: they slide around the head with yaw/pitch,
 *     squash with perspective, and are hidden once they pass the horizon (z <= 0.02).
 *   · prefers-reduced-motion, `paused`, IntersectionObserver culling, and one shared rAF.
 *
 * WHAT THIS IS NOT
 *   Not the libraries.dev code or artwork. That is a paid product; its bundle is served
 *   from their site and copying it into this repo would be a licence violation. The
 *   geometry below is generated from a superformula plus hand-written radial functions and
 *   the shading is a plain canvas gradient stack — but the *behaviour* is a faithful
 *   reimplementation of the model above, because that behaviour is the thing being
 *   evaluated here. Same line avatar-gen.ts already draws for Grok Bot.
 *
 *   If the decision is to ship this, buy the libraries.dev Pro licence and swap the file
 *   in: the preview only ever touches create() / setFace() / setState() / setOptions() /
 *   poke() / destroy().
 *
 *   Not implemented (opt-in in the library, unused by this preview): `whirl` rings and the
 *   non-default jump easings. Everything else in the pose is here.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  /* ── maths ───────────────────────────────────────────────────────────────── */

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function angDiff(a, b) {
    var d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d <= -Math.PI) d += TAU;
    return d;
  }
  /** Exponential approach — the library's easing for anything that should settle. */
  function approach(from, to, rate, dt) {
    return from + (to - from) * (1 - Math.exp(-rate * dt));
  }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  /** Narrow pulse around the ends of a jump window. */
  function pulse(t) {
    return Math.exp(-Math.pow(Math.min(Math.abs(t), Math.abs(t - 1)) / 0.11, 2));
  }
  var EASE_TAIL = { sharp: 0, pulse: 2 / 7, soft: 0.5, bouncy: 0.144 };
  /** Squash-in curve, sampled by normalised time. */
  function squashIn(t, ease) {
    if (t <= 0 || t >= 1) return 0;
    var a;
    if (ease === 'sharp') a = (1 - t) * (1 - t);
    else if (ease === 'soft') a = Math.pow(Math.sin(Math.PI * t), 2);
    else if (ease === 'bouncy') a = (Math.exp(-3.15 * t) * Math.sin(8.43 * t)) / 0.596;
    else {
      var r = 7 * t;
      a = (r * r * Math.exp(2 - r)) / 4;
    }
    var i = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
    return a * i * i * (3 - 2 * i);
  }
  /** Ground-contact bounce. */
  function groundOut(t, ease) {
    return 1 + 0.25 * squashIn(t, ease);
  }
  /** Rebound after the squash, decaying. */
  function riseOut(t, ease) {
    if (t <= 0) return 1;
    if (t >= 1) return 0;
    if (ease === 'sharp') return (1 - t) * (1 - t);
    if (ease === 'soft') return 0.5 + 0.5 * Math.cos(Math.PI * t);
    if (ease === 'bouncy') return Math.exp(-3.2 * t) * Math.cos(5.4 * t) - t * t * t * 0.026;
    var a = 4.2 * t;
    return (1 + a) * Math.exp(-a) - t * t * t * 0.078;
  }
  function rand32(seed) {
    var s = (seed * 2654435761) >>> 0 || 1;
    return function () {
      s = (s + 1831565813) >>> 0;
      var a = s;
      a = Math.imul(a ^ (a >>> 15), a | 1);
      a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
      return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
    };
  }
  function fnv1a(input) {
    var h = 2166136261;
    for (var i = 0; i < input.length; i += 1) {
      h = Math.imul(h ^ input.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  }
  /** 0..1 seed from any string — the library uses the same 1000-step reduction. */
  function seedOf(input) {
    return (fnv1a(input) % 1000) / 1000;
  }

  /* ── colour ──────────────────────────────────────────────────────────────── */

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3)
      h = h
        .split('')
        .map(function (c) {
          return c + c;
        })
        .join('');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }
  function mix(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
  function lighten(hex, amt) {
    return mix(hexToRgb(hex), [255, 255, 255], amt);
  }
  function darken(hex, amt) {
    return mix(hexToRgb(hex), [8, 10, 14], amt);
  }
  function luminance(hex) {
    var c = hexToRgb(hex).map(function (v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  var INK_DARK = '#1E1A33';
  var INK_LIGHT = '#F7F5F2';
  /** The library flips the ink on near-black bodies only; same threshold here. */
  function inkFor(hex) {
    return luminance(hex) < 0.13 ? INK_LIGHT : INK_DARK;
  }

  var PALETTE = [
    { id: 'sky', label: '天蓝', hex: '#35B8FF' },
    { id: 'mint', label: '薄荷', hex: '#2FCB7A' },
    { id: 'violet', label: '紫罗兰', hex: '#DC48FF' },
    { id: 'indigo', label: '靛蓝', hex: '#7B77F0' },
    { id: 'teal', label: '青绿', hex: '#1ED3C6' },
    { id: 'amber', label: '琥珀', hex: '#FFD32B' },
    { id: 'coral', label: '珊瑚', hex: '#FF8C42' },
    { id: 'rose', label: '玫红', hex: '#FF7AB8' },
    { id: 'crimson', label: '朱红', hex: '#FF2A2A' },
    { id: 'lime', label: '青柠', hex: '#9BE85A' },
    { id: 'steel', label: '钢灰', hex: '#95A6C4' },
    { id: 'ivory', label: '象牙', hex: '#F4F2FA' },
    { id: 'ink', label: '墨黑', hex: '#2B2F3A' }
  ];
  var COLOR_HEX = {};
  PALETTE.forEach(function (c) {
    COLOR_HEX[c.id] = c.hex;
  });

  /* ── shape geometry (original; the library's 18 names, our own curves) ──── */

  function superR(m, n1, n2, n3) {
    return function (t) {
      var a = Math.pow(Math.abs(Math.cos((m * t) / 4)), n2);
      var b = Math.pow(Math.abs(Math.sin((m * t) / 4)), n3);
      var r = Math.pow(a + b, -1 / n1);
      return isFinite(r) ? r : 0;
    };
  }
  function bump(t, at, width, height) {
    var d = angDiff(t, at) / width;
    return height * Math.exp(-d * d);
  }

  // Deep-lobed bodies need n1 < 1; n1 > 1 only rounds a polygon off, which is how clover
  // and square first came out identical. shape-probe.mjs guards this.
  var SHAPE_SPECS = [
    { id: 'clover', label: '四叶草', r: superR(4, 0.62, 0.62, 0.62), faceY: 50 },
    { id: 'flower', label: '花朵', r: superR(6, 0.8, 0.8, 0.8), faceY: 51, faceScale: 0.95 },
    { id: 'triangle', label: '三角', r: superR(3, 4.6, 4.6, 4.6), rot: -Math.PI / 2, faceY: 61, faceScale: 0.9, tension: 0.6 },
    { id: 'square', label: '方块', r: superR(4, 9, 9, 9), faceY: 50, tension: 0.7 },
    { id: 'blob', label: '软团', r: function (t) {
        return 1 + 0.1 * Math.sin(2 * t + 0.9) + 0.06 * Math.sin(4 * t + 2.2) - 0.03 * Math.cos(t);
      }, sy: 0.94, faceY: 50, faceX: 49.5 },
    { id: 'ghost', label: '幽灵', r: function (t) {
        var hem = clamp((Math.sin(t) + 0.3) / 0.85, 0, 1);
        return 1 + 0.105 * Math.sin(4 * t) * hem - 0.045 * hem;
      }, sx: 0.94, sy: 1.06, faceY: 48, faceScale: 0.95 },
    { id: 'circle', label: '圆', r: function () { return 1; }, faceY: 50 },
    { id: 'drop', label: '水滴', r: function (t) {
        var k = (1 + Math.sin(t)) / 2;
        return 0.42 + 0.58 * Math.pow(k, 0.7);
      }, sx: 0.9, faceY: 62, faceScale: 0.9 },
    { id: 'star', label: '星', r: superR(5, 0.55, 0.55, 0.55), faceY: 52, faceScale: 0.82, tension: 0.55 },
    { id: 'droid', label: '机器人', r: superR(4, 6, 6, 6), sx: 0.78, sy: 1.02, faceY: 60, faceScale: 0.92, marks: ['antenna'] },
    { id: 'mech', label: '机甲', r: superR(4, 9, 9, 9), sx: 1.06, sy: 0.8, faceY: 59, tension: 0.7, marks: ['antennae'] },
    { id: 'alien', label: '外星', r: function (t) {
        return 1 - 0.21 * Math.pow(Math.max(0, -Math.sin(t)), 1.3);
      }, sx: 1.08, sy: 0.96, faceY: 46, faceScale: 1.05 },
    { id: 'hexagon', label: '六边', r: superR(6, 7, 7, 7), rot: Math.PI / 6, faceY: 50, faceScale: 0.95, tension: 0.6 },
    { id: 'cat', label: '猫', r: function (t) {
        return 1 + bump(t, -Math.PI / 2 - 0.62, 0.3, 0.36) + bump(t, -Math.PI / 2 + 0.62, 0.3, 0.36);
      }, sx: 0.96, faceY: 58, tension: 0.85 },
    { id: 'cloud', label: '云', r: function (t) {
        return 1 + 0.13 * Math.cos(3 * t + 1.2) + 0.09 * Math.cos(5 * t + 0.4) + 0.05 * Math.cos(7 * t + 2.6) - 0.06 * Math.max(0, Math.sin(t));
      }, sy: 0.88, faceY: 58, faceScale: 0.95 },
    { id: 'pill', label: '胶囊', r: superR(4, 6, 6, 6), sx: 1.14, sy: 0.7, faceY: 50, faceScale: 0.9 },
    { id: 'pebble', label: '卵石', r: superR(4, 3.4, 3.4, 3.4), sy: 0.82, faceY: 50, faceScale: 0.95 },
    { id: 'puddle', label: '水洼', r: function (t) {
        return 1 + 0.05 * Math.cos(7 * t + 0.7);
      }, sx: 1.2, sy: 0.46, faceY: 50, faceScale: 0.9 }
  ];

  var SHAPES = SHAPE_SPECS.map(function (s) {
    return { id: s.id, label: s.label };
  });
  var SHAPE_BY_ID = {};
  SHAPE_SPECS.forEach(function (s) {
    SHAPE_BY_ID[s.id] = s;
  });

  var DEFAULT_COLOR = {
    clover: '#35B8FF', flower: '#2FCB7A', triangle: '#DC48FF', square: '#35B8FF',
    blob: '#2FCB7A', ghost: '#F4F2FA', circle: '#7B77F0', drop: '#1ED3C6',
    star: '#FFD32B', droid: '#95A6C4', mech: '#95A6C4', alien: '#9BE85A',
    hexagon: '#FF2A2A', cat: '#FF8C42', cloud: '#CFE6FF', pill: '#7B77F0',
    pebble: '#2FCB7A', puddle: '#FF2A2A'
  };

  function sampleShape(spec) {
    var samples = spec.tension && spec.tension < 0.7 ? 56 : 96;
    var r = spec.r;
    var sx = spec.sx || 1;
    var sy = spec.sy || 1;
    var rot = spec.rot || 0;
    var pts = [];
    var max = 0;
    for (var i = 0; i < samples; i += 1) {
      var t = (i / samples) * TAU;
      var rad = r(t);
      var x = rad * Math.cos(t);
      var y = rad * Math.sin(t);
      var cx = x * Math.cos(rot) - y * Math.sin(rot);
      var cy = x * Math.sin(rot) + y * Math.cos(rot);
      x = cx * sx;
      y = cy * sy;
      max = Math.max(max, Math.sqrt(x * x + y * y));
      pts.push([x, y]);
    }
    for (var j = 0; j < pts.length; j += 1) {
      pts[j][0] /= max;
      pts[j][1] /= max;
    }
    return pts;
  }
  var SHAPE_POINTS = {};
  SHAPE_SPECS.forEach(function (s) {
    SHAPE_POINTS[s.id] = sampleShape(s);
  });

  function traceRing(path, pts, radius, tension) {
    var n = pts.length;
    var k = tension === undefined ? 1 : tension;
    path.moveTo(pts[0][0] * radius, pts[0][1] * radius);
    for (var i = 0; i < n; i += 1) {
      var p0 = pts[(i - 1 + n) % n];
      var p1 = pts[i];
      var p2 = pts[(i + 1) % n];
      var p3 = pts[(i + 2) % n];
      path.bezierCurveTo(
        (p1[0] + ((p2[0] - p0[0]) / 6) * k) * radius,
        (p1[1] + ((p2[1] - p0[1]) / 6) * k) * radius,
        (p2[0] - ((p3[0] - p1[0]) / 6) * k) * radius,
        (p2[1] - ((p3[1] - p1[1]) / 6) * k) * radius,
        p2[0] * radius,
        p2[1] * radius
      );
    }
    path.closePath();
  }

  /* ── the three states, and how they blend ────────────────────────────────── */

  var LIB_STATES = ['default', 'working', 'sleeping'];
  var LIB_STATE_LABEL = { default: '默认', working: '执行中', sleeping: '休眠' };

  /** Base pose offsets per state, in radians / face units. */
  var STATE_BASE = {
    default: { pitch: 0, roll: 0, y: 0, lookX: 0, lookY: 0 },
    working: { pitch: 5 * DEG, roll: 0, y: 0, lookX: 0, lookY: 0 },
    sleeping: { pitch: -16 * DEG, roll: 6 * DEG, y: 3, lookX: 0, lookY: 1 }
  };
  /** How long a state crossfade takes, per the state being left. */
  var TRANSITION = { default: 1.2, working: 0.7, sleeping: 1 };

  /**
   * Per-state wander configuration: [amplitude, holdMin, holdMax, rate]. Copied from the
   * library's state table so the three states feel different rather than three speeds of
   * the same motion.
   */
  var WANDER = {
    default: {
      yaw: [35 * DEG, 2.6, 5.4, 2, true],
      pitch: [14 * DEG, 2.8, 5.8, 1.8, true],
      roll: [3.2 * DEG, 3.4, 6.6, 1.5, true],
      lookX: [3.6, 0.6, 2.2, 13],
      lookY: [2.4, 0.6, 2.2, 13]
    },
    working: {
      yaw: [16 * DEG, 0.9, 1.8, 4, true],
      pitch: [3 * DEG, 1.2, 2.4, 3, true],
      roll: [0, 1, 2, 3, true],
      lookX: [2, 0.5, 1.2, 12],
      lookY: [1, 0.5, 1.2, 12]
    },
    sleeping: {
      yaw: [7 * DEG, 3, 6, 0.7, true],
      pitch: [3 * DEG, 3, 6, 0.7, true],
      roll: [2 * DEG, 3, 6, 0.6, true],
      lookX: [0, 2, 4, 2],
      lookY: [0, 2, 4, 2]
    }
  };

  var GAZE_MIN = 2.6;
  var GAZE_MAX = 4.4;

  /** A value that drifts toward a random target, then holds it. Spring mode overshoots. */
  function Wander(rand, amp, holdMin, holdMax, rate, spring) {
    this.rand = rand;
    this.amp = amp;
    this.holdMin = holdMin;
    this.holdMax = holdMax;
    this.rate = rate;
    this.spring = Boolean(spring);
    this.value = 0;
    this.vel = 0;
    this.target = 0;
    this.next = 0;
  }
  Wander.prototype.set = function (amp, holdMin, holdMax, rate, spring) {
    this.amp = amp;
    this.holdMin = holdMin;
    this.holdMax = holdMax;
    this.rate = rate;
    if (spring !== undefined) this.spring = Boolean(spring);
  };
  Wander.prototype.aim = function (target) {
    this.target = target;
    this.next = Infinity;
  };
  Wander.prototype.update = function (t, dt) {
    if (t >= this.next) {
      this.target = (this.rand() * 2 - 1) * this.amp;
      this.next = t + this.holdMin + this.rand() * (this.holdMax - this.holdMin);
    }
    if (this.spring) {
      var w = this.rate * 1.6;
      var damping = 0.9;
      this.vel += (w * w * (this.target - this.value) - 2 * damping * w * this.vel) * dt;
      this.value += this.vel * dt;
    } else {
      this.value = approach(this.value, this.target, this.rate, dt);
    }
  };

  /** One-shot timer with a normalised progress. */
  function Timer(duration) {
    this.duration = duration;
    this.p = -1;
  }
  Timer.prototype.fire = function () {
    this.p = 0;
  };
  Timer.prototype.update = function (dt) {
    if (this.p < 0) return;
    this.p += dt / this.duration;
    if (this.p >= 1) this.p = -1;
  };
  Object.defineProperty(Timer.prototype, 'active', {
    get: function () {
      return this.p >= 0;
    }
  });

  /* ── jump / flip configuration, straight from the library defaults ───────── */

  var JUMP_DEFAULTS = {
    height: 26,
    time: 0.68,
    stretch: 1,
    squash: 1.15,
    squashTime: 0.37,
    squashEase: 'pulse',
    groundTime: 0.11,
    groundEase: 'pulse',
    riseTime: 0.33,
    riseEase: 'pulse',
    clickSquashTime: 0.24,
    spin: 1,
    lean: 6,
    every: 8,
    land: 0
  };
  var HOP_TIME = 0.68;
  var HOP_HEIGHT = 18;
  var HOP_HEIGHT_BIG = 26;

  function jumpLead(jump, clicked) {
    return clicked ? jump.clickSquashTime : 0.2 * jump.time;
  }
  function jumpTotal(jump, clicked) {
    return (
      jumpLead(jump, clicked) +
      jump.time +
      EASE_TAIL[jump.squashEase] * (clicked ? jump.clickSquashTime : jump.squashTime) +
      Math.max(0, jump.groundTime) +
      jump.riseTime +
      Math.max(0, jump.land) +
      0.05
    );
  }

  /* ── the pose engine ─────────────────────────────────────────────────────── */

  function Pose(seed, state) {
    this.rand = rand32(Math.floor(seed * 1e6) + 1);
    var i = this.rand;

    this.state = 'default';
    this.t = i() * 10;
    this.w = [1, 0, 0];
    this.wFrom = [1, 0, 0];
    this.tr = 1;
    this.trDuration = 1.2;

    this.yawW = new Wander(i, 0, 2.6, 5.4, 2, true);
    this.pitchW = new Wander(i, 0, 2.8, 5.8, 1.8, true);
    this.rollW = new Wander(i, 0, 3.4, 6.6, 1.5, true);
    this.lookXW = new Wander(i, 0, 0.6, 2.2, 13);
    this.lookYW = new Wander(i, 0, 0.6, 2.2, 13);

    this.blink = new Timer(0.17);
    this.blinkAgain = false;
    this.blinkAt = this.t + 1 + i() * 3;
    this.dart = new Timer(0.12);
    this.dartX = 0;
    this.dartY = 0;
    this.dartAt = this.t + 1 + i() * 2;
    this.flip = new Timer(jumpTotal(JUMP_DEFAULTS, false));
    this.flipPoked = false;
    this.flipSide = 1;
    this.flipAt = this.t + 4;
    this.nod = new Timer(1.7);
    this.nodAt = this.t + 3 + i() * 4;
    this.laughEv = new Timer(0.8);
    this.laughAt = this.t + 0.6 + i() * 1.5;

    this.hopPhase = i();
    this.hopCount = 0;
    this.hopGain = 0;
    this.breathPhase = i();
    this.gazeLead = 0;
    this.gazeDir = [0, 0];
    this.gazeAt = 0;
    this.prevYaw = 0;
    this.jelly = 0;
    this.jellyV = 0;
    this.turnK = 1;

    this.ptrX = 0;
    this.ptrY = 0;
    this.ptrS = 0;
    this.ptrTargetX = 0;
    this.ptrTargetY = 0;
    this.ptrTargetS = 0;

    this.jump = {};
    for (var k in JUMP_DEFAULTS) this.jump[k] = JUMP_DEFAULTS[k];

    this.pose = {
      yaw: 0, pitch: STATE_BASE[state].pitch, roll: STATE_BASE[state].roll,
      x: 0, y: STATE_BASE[state].y, sx: 1, sy: 1,
      eyeOpen: 1, blinkL: 0, blinkR: 0,
      lookX: 0, lookY: 0, breath: 0, laugh: 0,
      w: [1, 0, 0]
    };
    this.setState(state, true);
  }

  Pose.prototype.setState = function (next, immediate) {
    if (next === this.state && !immediate) return;
    var previous = this.state;
    this.state = next;
    var w = this.pose.w;
    if (immediate) {
      for (var n = 0; n < 3; n += 1) w[n] = LIB_STATES[n] === next ? 1 : 0;
      this.wFrom = [w[0], w[1], w[2]];
      this.tr = 1;
    } else {
      this.wFrom = [w[0], w[1], w[2]];
      this.tr = 0;
      this.trDuration = previous === 'sleeping' ? 1 : TRANSITION[next] || 1.2;
    }
    var spec = WANDER[next] || WANDER.default;
    this.yawW.set(spec.yaw[0], spec.yaw[1], spec.yaw[2], spec.yaw[3], spec.yaw[4]);
    this.pitchW.set(spec.pitch[0], spec.pitch[1], spec.pitch[2], spec.pitch[3], spec.pitch[4]);
    this.rollW.set(spec.roll[0], spec.roll[1], spec.roll[2], spec.roll[3], spec.roll[4]);
    this.lookXW.set(spec.lookX[0], spec.lookX[1], spec.lookX[2], spec.lookX[3]);
    this.lookYW.set(spec.lookY[0], spec.lookY[1], spec.lookY[2], spec.lookY[3]);
    if (next === 'default') {
      this.gazeAt = 0;
      this.gazeDir = [0, 0];
      this.flipAt = this.nextFlip(this.t, 0.6);
    } else if (next === 'working') {
      this.hopPhase = 0;
      this.hopCount = 0;
      this.laughAt = this.t + 0.5 + this.rand() * 1.2;
    } else if (next === 'sleeping') {
      this.nodAt = this.t + 2.5 + this.rand() * 4;
    }
  };
  Pose.prototype.setPointer = function (x, y, strength) {
    this.ptrTargetX = clamp(x, -1.2, 1.2);
    this.ptrTargetY = clamp(y, -1.2, 1.2);
    this.ptrTargetS = clamp(strength, 0, 1);
  };
  /** Click feedback: a spin-hop with the short click squash. */
  Pose.prototype.poke = function () {
    if (this.flip.active && this.flip.p < 0.6) return;
    this.flipPoked = true;
    this.flip.duration = jumpTotal(this.jump, true);
    this.flipSide = this.rand() < 0.5 ? -1 : 1;
    this.flip.fire();
    this.flipAt = this.nextFlip(this.t, 1.1);
  };
  Pose.prototype.nextFlip = function (t, scale) {
    var every = this.jump.every;
    return every > 0 ? t + every * scale * (0.625 + this.rand() * 0.75) : Infinity;
  };
  Pose.prototype.nextGaze = function () {
    var r = this.rand;
    var a = this.gazeDir[0];
    var i = this.gazeDir[1];
    if (a !== 0 || i !== 0) {
      var n = r();
      if (n < 0.66) return [-a, -i];
      if (n < 0.85) return [-a, i];
      return [0, 0];
    }
    var dirs = [[1, -1], [-1, 1], [-1, -1], [1, 1]];
    return dirs[Math.floor(r() * dirs.length)];
  };

  Pose.prototype.update = function (dtRaw) {
    var dt = Math.min(dtRaw, 0.05);
    this.t += dt;
    var t = this.t;
    var p = this.pose;
    var w = p.w;

    /* state crossfade */
    if (this.tr < 1) {
      this.tr = Math.min(1, this.tr + dt / this.trDuration);
      var f = 0.5 - 0.5 * Math.cos(Math.PI * this.tr);
      for (var x = 0; x < 3; x += 1) {
        var target = LIB_STATES[x] === this.state ? 1 : 0;
        w[x] = this.wFrom[x] + (target - this.wFrom[x]) * f;
      }
    }
    var wDefault = w[0];
    var wWorking = w[1];
    var wSleeping = w[2];

    var base = { pitch: 0, roll: 0, y: 0, lookX: 0, lookY: 0 };
    for (var s = 0; s < 3; s += 1) {
      var b = STATE_BASE[LIB_STATES[s]];
      base.pitch += b.pitch * w[s];
      base.roll += b.roll * w[s];
      base.y += b.y * w[s];
      base.lookX += b.lookX * w[s];
      base.lookY += b.lookY * w[s];
    }

    /* gaze: only the default state aims at points of interest */
    if (this.state === 'default' && t >= this.gazeAt) {
      var dir = this.nextGaze();
      this.gazeDir = [dir[0], dir[1]];
      var N = 0.84 + this.rand() * 0.16;
      // `turn` scales yaw and roll but not pitch — that asymmetry is the library's, kept
      // deliberately: turning the gaze down still leaves the head nodding up and down.
      this.yawW.aim(dir[0] * 35 * DEG * N * this.turnK);
      this.pitchW.aim(dir[1] * 14 * DEG * N);
      this.rollW.aim(dir[0] * 3.2 * DEG * N * this.turnK);
      this.gazeAt = t + GAZE_MIN + this.rand() * (GAZE_MAX - GAZE_MIN);
    }

    this.yawW.update(t, dt);
    this.pitchW.update(t, dt);
    this.rollW.update(t, dt);
    this.lookXW.update(t, dt);
    this.lookYW.update(t, dt);

    /* pointer easing: strength settles slower than direction */
    this.ptrS = approach(this.ptrS, this.ptrTargetS, 8, dt);
    this.ptrX = approach(this.ptrX, this.ptrTargetX, 14, dt);
    this.ptrY = approach(this.ptrY, this.ptrTargetY, 14, dt);

    var c = this.ptrS;
    var quiet = 1 - 0.75 * c; // the pointer suppresses the idle wander
    this.baseYaw = approach(this.baseYaw || 0, this.yawW.value * quiet + 22 * DEG * this.ptrX * c, 5, dt);

    var pitch = base.pitch + this.pitchW.value * quiet - 12 * DEG * this.ptrY * c;
    var roll = base.roll + this.rollW.value * quiet;
    var y = base.y;
    var lookX = base.lookX + this.lookXW.value * quiet + 4.5 * this.ptrX * c;
    var lookY = base.lookY + this.lookYW.value * quiet + 3 * this.ptrY * c;

    var spinYaw = 0;
    var lift = 0;
    var scaleX = 1;
    var scaleY = 1;
    var lean = 0;
    var laugh = 0;
    var eyeDartX = 0;
    var eyeDartY = 0;

    /* blink: only while awake; 22% chance of a quick second blink */
    if (
      t >= this.blinkAt &&
      !this.blink.active &&
      wDefault + wWorking > 0.5
    ) {
      this.blink.fire();
      this.blinkAgain = !this.blinkAgain && this.rand() < 0.22;
      this.blinkAt = t + (this.blinkAgain ? 0.28 : 2.2 + this.rand() * 2.6);
    }
    this.blink.update(dt);
    var blink = this.blink.active ? Math.sin(Math.PI * this.blink.p) : 0;

    /* saccade: a fast small eye flick while awake */
    if (t >= this.dartAt && !this.dart.active && wDefault + wWorking > 0.5) {
      this.dart.fire();
      this.dartX = (this.rand() * 2 - 1) * 4;
      this.dartY = (this.rand() * 2 - 1) * 2;
      this.dart.duration = 0.25 + this.rand() * 0.45;
      this.dartAt = t + 1.2 + this.rand() * 2.6;
    }
    this.dart.update(dt);
    if (this.dart.active) {
      var dp = this.dart.p;
      var dw = dp < 0.15 ? dp / 0.15 : dp > 0.8 ? (1 - dp) / 0.2 : 1;
      eyeDartX += this.dartX * dw * (wDefault + wWorking);
      eyeDartY += this.dartY * dw * (wDefault + wWorking);
    }

    /* idle flip: the ~8s hop, with a full spin */
    if (this.state === 'default' && t >= this.flipAt && !this.flip.active) {
      this.flipPoked = false;
      this.flip.duration = jumpTotal(this.jump, false);
      this.flipSide = this.rand() < 0.5 ? -1 : 1;
      this.flip.fire();
      this.flipAt = this.nextFlip(t, 1);
    }
    this.flip.update(dt);
    if (this.flip.active) {
      var j = this.jump;
      var lead = jumpLead(j, this.flipPoked);
      var n = (this.flip.p * this.flip.duration - lead) / j.time;
      var yn = clamp(n, 0, 1);
      var arc = Math.sin(Math.PI * yn);
      spinYaw += TAU * j.spin * easeInOutCubic(yn);
      lift -= j.height * arc;

      var after = (n - 1) * j.time - j.land;
      var squashWindow = this.flipPoked ? j.clickSquashTime : j.squashTime;
      var clickedEase = function (nt) {
        return nt * nt * (3 - 2 * nt);
      };
      var easy = function (nt) {
        return clickedEase(nt - 1);
      };
      var groundWindow = Math.max(0, j.groundTime);
      var tail = EASE_TAIL[j.squashEase] * squashWindow;
      var rest = after - tail - groundWindow;
      var contact =
        after <= tail
          ? squashIn(after / squashWindow, j.squashEase)
          : rest <= 0
            ? groundOut((after - tail) / groundWindow, j.groundEase)
            : riseOut(rest / j.riseTime, j.riseEase);
      var squashAmt =
        (n < 0
          ? (this.flipPoked ? clickedEase : easy)(Math.max(0, 1 + (n * j.time) / lead))
          : after > 0
            ? contact
            : n < 0.2
              ? pulse(n)
              : 0) * j.squash;
      scaleX += 0.16 * squashAmt - 0.06 * arc * j.stretch;
      scaleY += -0.18 * squashAmt + 0.09 * arc * j.stretch;
      lean += this.flipSide * j.lean * DEG * arc;
    }

    /* working hop: continuous, every third one is higher and spins */
    if (this.state === 'working') this.hopGain = wWorking;
    if (this.hopGain > 0.02 && (this.state === 'working' || this.hopPhase > 0)) {
      this.hopPhase += dt / HOP_TIME;
      var settle = Math.max(0, this.jump.groundTime) + this.jump.riseTime;
      if (this.hopPhase >= 1) {
        if (this.state === 'working') {
          this.hopPhase -= 1;
          this.hopCount += 1;
        } else if ((this.hopPhase - 1) * HOP_TIME >= settle) {
          this.hopPhase = 0;
          this.hopGain = 0;
        }
      }
      var gain = this.hopGain;
      var hx = Math.min(1, this.hopPhase);
      var hArc = Math.sin(Math.PI * hx);
      var big = this.hopCount % 3 === 2;
      lift -= (big ? HOP_HEIGHT_BIG : HOP_HEIGHT) * hArc * gain;
      var over = this.state !== 'working' && this.hopPhase > 1 ? (this.hopPhase - 1) * HOP_TIME : -1;
      var hv =
        over < 0
          ? pulse(this.hopPhase)
          : over < this.jump.groundTime
            ? groundOut(over / Math.max(0.001, this.jump.groundTime), this.jump.groundEase)
            : riseOut((over - this.jump.groundTime) / this.jump.riseTime, this.jump.riseEase);
      scaleX += (0.16 * hv - 0.06 * hArc) * gain;
      scaleY += (-0.18 * hv + 0.09 * hArc) * gain;
      if (big) spinYaw += TAU * easeInOutCubic(hx) * gain;
      lean += (this.hopCount % 2 === 0 ? 1 : -1) * 6 * DEG * hArc * gain;
    }

    /* working "laugh": a brief squint */
    if (this.state === 'working' && t >= this.laughAt && !this.laughEv.active) {
      this.laughEv.fire();
      this.laughEv.duration = 0.6 + this.rand() * 0.5;
      this.laughAt = t + 1.6 + this.rand() * 2.2;
    }
    this.laughEv.update(dt);
    if (this.laughEv.active) {
      var lp = this.laughEv.p;
      laugh = Math.max(laugh, lp < 0.18 ? lp / 0.18 : lp > 0.78 ? (1 - lp) / 0.22 : 1);
    }

    /* sleeping nod: the head dips forward then recovers */
    if (this.state === 'sleeping' && t >= this.nodAt && !this.nod.active) {
      this.nod.fire();
      this.nodAt = t + 4 + this.rand() * 4;
    }
    this.nod.update(dt);
    if (this.nod.active) {
      var np = this.nod.p;
      var nk = np < 0.72 ? easeInOutCubic(np / 0.72) : 1 - easeInOutCubic((np - 0.72) / 0.28);
      pitch -= 13 * DEG * nk * wSleeping;
    }

    /* breathing: slower and deeper the more asleep it is */
    this.breathPhase += dt / (3.6 + 1.2 * wSleeping);
    var breath = Math.sin(this.breathPhase * TAU);
    scaleX += breath * (0.008 + 0.014 * wSleeping);
    scaleY += breath * (0.012 + 0.02 * wSleeping);

    /* head bob, only while awake */
    var bob = Math.sin((t * TAU) / 3.4) * 2 * (1 - wSleeping);
    p.yaw = this.baseYaw + spinYaw;

    /* gaze lead: eyes lead a fast turn */
    var delta = angDiff(this.baseYaw, this.prevYaw);
    this.prevYaw = this.baseYaw;
    var yawRate = dt > 0 ? Math.abs(delta) / dt : 0;
    this.gazeLead = approach(this.gazeLead, dt > 0 ? clamp((delta / dt) * 2.4, -2.2, 2.2) : 0, 9, dt);

    /* jelly: the body wobbles behind a turn */
    var jellyTarget = Math.min(0.22, 0.055 * yawRate);
    var jellyW = 16;
    var jellyDamp = 0.45;
    this.jellyV += (jellyW * jellyW * (jellyTarget - this.jelly) - 2 * jellyDamp * jellyW * this.jellyV) * dt;
    this.jelly += this.jellyV * dt;
    var jelly = clamp(this.jelly, -0.08, 0.28) * 0.6;
    scaleX *= 1 + jelly;
    scaleY *= 1 - 0.55 * jelly;

    p.pitch = pitch;
    p.roll = roll + lean;
    p.y = y + lift + bob;
    p.sx = scaleX;
    p.sy = scaleY;
    p.eyeOpen = 1;
    p.laugh = approach(p.laugh, laugh, 30, dt);
    p.blinkL = blink;
    p.blinkR = blink;
    p.lookX = lookX + eyeDartX + this.gazeLead;
    p.lookY = lookY + eyeDartY;
    p.breath = breath;
    p.w = w;
  };

  /** The static pose used when motion is off, so a still bot still faces the pointer. */
  function stillPose(pose) {
    var b = STATE_BASE[pose.state] || STATE_BASE.default;
    var w = LIB_STATES.indexOf(pose.state);
    var weights = [0, 0, 0];
    if (w >= 0) weights[w] = 1;
    var c = pose.ptrS;
    var quiet = 1 - 0.75 * c;
    return {
      yaw: 0,
      pitch: b.pitch - 12 * DEG * pose.ptrY * c,
      roll: b.roll,
      x: 0,
      y: b.y,
      sx: 1,
      sy: 1,
      eyeOpen: 1,
      blinkL: 0,
      blinkR: 0,
      lookX: b.lookX + 4.5 * pose.ptrX * c * quiet,
      lookY: b.lookY + 3 * pose.ptrY * c * quiet,
      breath: 0,
      laugh: 0,
      w: weights
    };
  }

  /* ── face geometry (the library's numbers, in units of head radius) ─────── */

  var EYE_SPHERE = 0.6; // (_t 30 against a 50-unit head radius)
  var EYE_SPACING = 0.25; // (fe 25 -> +-12.5)
  var EYE_WIDTH = 6.3; // stroke weight multiplier
  var FACE_Y = { eyes: 1, mouth: -3.5 };
  var EYE_SEGMENTS = 8;

  /**
   * Eye outline: a lens from (-hw, corner) to (hw, corner) with the middle at `bulge`.
   * Drawn STROKED, which is what turns it into a dot when open (hw ~ 0) and a flat line
   * when closed — the trick the library uses. Cached on quantised parameters because this
   * runs twice per avatar per frame.
   */
  var EYE_PATH_CACHE = new Map();
  function eyePath(hw, corner, bulge) {
    var key = Math.round(hw * 50) + ':' + Math.round(corner * 50) + ':' + Math.round(bulge * 50);
    var hit = EYE_PATH_CACHE.get(key);
    if (hit) return hit;
    var path = new Path2D();
    path.moveTo(-hw, corner);
    for (var i = 1; i <= EYE_SEGMENTS; i += 1) {
      var d = i / EYE_SEGMENTS;
      var u = 1 - d;
      path.lineTo(u * u * -hw + d * d * hw, (u * u + d * d) * corner + 2 * u * d * bulge);
    }
    if (EYE_PATH_CACHE.size > 256) EYE_PATH_CACHE.clear();
    EYE_PATH_CACHE.set(key, path);
    return path;
  }

  /**
   * Spherical eye projection. `x`/`y` are face-plane offsets, the result is the on-screen
   * position plus perspective scale and depth. Depth <= 0.02 means the eye has rotated
   * around the back of the head and must not be drawn.
   */
  function projectEye(x, y, yaw, pitch, radius) {
    var r = Math.asin(clamp(x / radius, -1, 1)) + yaw;
    var n = Math.asin(clamp(-y / radius, -1, 1)) + pitch;
    var o = Math.cos(n);
    return {
      x: radius * Math.sin(r) * o,
      y: -radius * Math.sin(n),
      sx: Math.cos(r),
      sy: o,
      z: Math.cos(r) * o
    };
  }

  /* ── the shared clock and the global pointer ─────────────────────────────── */

  var POINTER = { x: NaN, y: NaN };
  var live = [];
  var raf = null;
  var last = 0;
  var pointerBound = false;
  var reduced =
    typeof global.matchMedia === 'function' &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function bindPointer() {
    if (pointerBound || typeof document === 'undefined') return;
    pointerBound = true;
    document.addEventListener(
      'pointermove',
      function (e) {
        POINTER.x = e.clientX;
        POINTER.y = e.clientY;
      },
      { passive: true }
    );
    document.addEventListener('pointerleave', function () {
      POINTER.x = NaN;
      POINTER.y = NaN;
    });
    global.addEventListener('blur', function () {
      POINTER.x = NaN;
      POINTER.y = NaN;
    });
  }

  function frame(now) {
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    for (var i = 0; i < live.length; i += 1) {
      try {
        live[i].tick(dt);
      } catch (err) {
        if (global.console) global.console.error('[bot-avatars] tick failed', err);
        live[i].visible = false;
      }
    }
    raf = live.length ? global.requestAnimationFrame(frame) : null;
  }
  function pump() {
    if (raf !== null || typeof global.requestAnimationFrame !== 'function') return;
    if (typeof document !== 'undefined' && document.hidden) return;
    last = 0;
    raf = global.requestAnimationFrame(frame);
  }
  function halt() {
    if (raf === null) return;
    global.cancelAnimationFrame(raf);
    raf = null;
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) halt();
      else if (live.length) pump();
    });
  }

  /* ── the avatar ──────────────────────────────────────────────────────────── */

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{shape?:string,color?:string,state?:string,size?:number,speed?:number,
   *          paused?:boolean,shading?:string,interactive?:boolean,seed?:string,
   *          face?:'eyes'|'mouth'}} [options]
   */
  function create(canvas, options) {
    var opts = options || {};
    var seedValue = opts.seed === undefined ? Math.random() : seedOf(String(opts.seed));

    var inst = {
      canvas: canvas,
      shape: opts.shape || 'clover',
      color: opts.color || COLOR_HEX[DEFAULT_COLOR[opts.shape || 'clover']] || '#35B8FF',
      state: LIB_STATES.indexOf(opts.state) >= 0 ? opts.state : 'default',
      face: opts.face === 'mouth' ? 'mouth' : 'eyes',
      size: opts.size || 40,
      speed: opts.speed === undefined ? 1 : opts.speed,
      paused: Boolean(opts.paused),
      interactive: opts.interactive === undefined ? true : Boolean(opts.interactive),
      shading: opts.shading || 'plastic',
      shadow: opts.shadow === undefined ? 0.35 : opts.shadow,
      visible: true,
      pose: null,
      _path: null,
      _pathKey: ''
    };
    inst.pose = new Pose(seedValue, inst.state);
    // `turn` scales the idle gaze. 1 = the library default, 0 = never wander, only follow
    // the pointer.
    inst.pose.turnK = clamp(opts.turn === undefined ? 1 : opts.turn, 0, 2);

    var ctx = canvas.getContext('2d');

    if (typeof IntersectionObserver === 'function') {
      inst._io = new IntersectionObserver(
        function (entries) {
          inst.visible = entries[0] ? entries[0].isIntersecting : true;
        },
        { rootMargin: '120px' }
      );
      inst._io.observe(canvas);
    }

    function resize() {
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var box = Math.max(1, Math.round(inst.size * 1.5 * dpr));
      if (canvas.width !== box || canvas.height !== box) {
        canvas.width = box;
        canvas.height = box;
      }
      canvas.style.width = inst.size * 1.5 + 'px';
      canvas.style.height = inst.size * 1.5 + 'px';
      inst._dpr = dpr;
    }

    function bodyPath(radius) {
      var key = inst.shape + '|' + Math.round(radius);
      if (inst._pathKey === key) return inst._path;
      var spec = SHAPE_BY_ID[inst.shape] || SHAPE_BY_ID.clover;
      var path = new Path2D();
      traceRing(path, SHAPE_POINTS[spec.id], radius, spec.tension);
      inst._path = path;
      inst._pathKey = key;
      return path;
    }

    /** Feed the global pointer into this avatar's pose, with distance falloff. */
    function updatePointer() {
      if (!inst.interactive || Number.isNaN(POINTER.x)) {
        inst.pose.setPointer(0, 0, 0);
        return;
      }
      var rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      var scale = rect.width / 1.5;
      // The head sits 10% of the box above centre, so aim from there, not from the box.
      var dx = (POINTER.x - (rect.left + rect.width / 2)) / scale;
      var dy = (POINTER.y - (rect.top + rect.height / 2 + 0.1 * scale)) / scale;
      var dist = Math.hypot(dx, dy);
      var reach = 3;
      var strength = dist < 1 ? 1 : dist > reach ? 0 : 1 - (dist - 1) / (reach - 1);
      inst.pose.setPointer(dx / Math.max(1, dist), dy / Math.max(1, dist), strength);
    }

    inst.tick = function (dt) {
      if (!inst.visible) return;
      if (inst.paused || reduced) {
        updatePointer();
        inst.pose.update(0);
        inst._draw(stillPose(inst.pose));
        return;
      }
      updatePointer();
      inst.pose.update(dt * inst.speed);
      inst._draw(inst.pose.pose);
    };

    /** Click feedback — same call the library makes from its own onClick. */
    inst.poke = function () {
      if (inst.interactive && !inst.paused && !reduced) inst.pose.poke();
      return inst;
    };

    /* ── painting ── */

    inst._draw = function (p) {
      var D = inst.size * 1.5;
      var dpr = inst._dpr || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      var spec = SHAPE_BY_ID[inst.shape] || SHAPE_BY_ID.clover;
      var R = D * 0.287; // head radius
      var cx = D / 2;
      var cy = D / 2;
      var baseHex = inst.color;
      var ink = inkFor(baseHex);
      var lift = -p.y * (R / 50); // library units (50 = head radius) -> px

      /* ground shadow, cast on the floor below the head */
      var flight = clamp(lift / (R * 0.6), 0, 1);
      var shadowR = R * (1.02 - 0.2 * flight);
      var shadowA = (1 - 0.6 * flight) * inst.shadow;
      var floorY = cy + R * 0.98;
      var g = ctx.createRadialGradient(cx, floorY, shadowR * 0.1, cx, floorY, shadowR);
      g.addColorStop(0, 'rgba(0,0,0,' + shadowA.toFixed(3) + ')');
      g.addColorStop(0.55, 'rgba(0,0,0,' + (shadowA * 0.45).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, floorY, shadowR, shadowR * 0.3, 0, 0, TAU);
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy + lift);
      ctx.rotate(p.roll);
      ctx.scale(p.sx, p.sy);

      var path = bodyPath(R);

      /* parts behind the body */
      if (spec.marks) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(darken(baseHex, 0.34), 1);
        ctx.fillStyle = rgba(darken(baseHex, 0.34), 1);
        if (spec.marks.indexOf('antenna') >= 0) {
          ctx.lineWidth = R * 0.075;
          ctx.beginPath();
          ctx.moveTo(0, -R * 0.86);
          ctx.lineTo(0, -R * 1.24);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, -R * 1.31, R * 0.105, 0, TAU);
          ctx.fill();
        }
        if (spec.marks.indexOf('antennae') >= 0) {
          ctx.lineWidth = R * 0.07;
          [-1, 1].forEach(function (s) {
            ctx.beginPath();
            ctx.moveTo(s * R * 0.46, -R * 0.78);
            ctx.lineTo(s * R * 0.78, -R * 1.16);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(s * R * 0.82, -R * 1.23, R * 0.095, 0, TAU);
            ctx.fill();
          });
        }
        ctx.restore();
      }

      var plastic = inst.shading === 'plastic';
      var flat = inst.shading === 'flat';
      var crisp = inst.shading === 'crisp';
      var soft = inst.shading === 'smooth';

      var body = ctx.createRadialGradient(
        -R * 0.36, -R * 0.46, R * (crisp ? 0.04 : 0.08),
        R * 0.06, R * 0.1, R * 1.42
      );
      if (flat) {
        body.addColorStop(0, rgba(hexToRgb(baseHex), 1));
        body.addColorStop(1, rgba(hexToRgb(baseHex), 1));
      } else {
        body.addColorStop(0, rgba(lighten(baseHex, crisp ? 0.42 : soft ? 0.24 : 0.34), 1));
        body.addColorStop(crisp ? 0.34 : 0.44, rgba(hexToRgb(baseHex), 1));
        body.addColorStop(1, rgba(darken(baseHex, crisp ? 0.4 : 0.28), 1));
      }
      ctx.fillStyle = body;
      ctx.fill(path);

      ctx.save();
      ctx.clip(path);
      if (!flat) {
        var core = ctx.createRadialGradient(R * 0.5, R * 0.62, R * 0.05, R * 0.34, R * 0.5, R * 1.5);
        core.addColorStop(0, rgba(darken(baseHex, 0.55), 0.34));
        core.addColorStop(0.6, rgba(darken(baseHex, 0.55), 0.1));
        core.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = core;
        ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2);

        var sheen = ctx.createRadialGradient(
          -R * 0.34, -R * 0.44, 0, -R * 0.34, -R * 0.44, R * (plastic ? 0.86 : 0.7)
        );
        sheen.addColorStop(0, 'rgba(255,255,255,' + (plastic ? 0.62 : 0.4) + ')');
        sheen.addColorStop(0.45, 'rgba(255,255,255,' + (plastic ? 0.14 : 0.08) + ')');
        sheen.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen;
        ctx.beginPath();
        ctx.ellipse(-R * 0.34, -R * 0.44, R * (plastic ? 0.62 : 0.5), R * (plastic ? 0.44 : 0.36), -0.5, 0, TAU);
        ctx.fill();

        if (plastic) {
          var hot = ctx.createRadialGradient(-R * 0.44, -R * 0.56, 0, -R * 0.44, -R * 0.56, R * 0.28);
          hot.addColorStop(0, 'rgba(255,255,255,0.92)');
          hot.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = hot;
          ctx.beginPath();
          ctx.ellipse(-R * 0.44, -R * 0.56, R * 0.2, R * 0.13, -0.6, 0, TAU);
          ctx.fill();
        }

        var bounce = ctx.createRadialGradient(0, R * 0.95, 0, 0, R * 0.95, R * 0.7);
        bounce.addColorStop(0, rgba(lighten(baseHex, 0.5), 0.22));
        bounce.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bounce;
        ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2);
      }
      ctx.restore();

      if (!flat) {
        ctx.strokeStyle = rgba(lighten(baseHex, plastic ? 0.34 : 0.2), plastic ? 0.55 : 0.3);
        ctx.lineWidth = Math.max(0.6, R * 0.035);
        ctx.stroke(path);
      }

      drawFace(p, R, spec, ink);
      ctx.restore();
    };

    /**
     * The face runs in the library's own unit system: a sphere of radius 30 where the
     * head radius is 50. Scaling the whole group by `sphere` px-per-unit means every
     * constant below can be the library's number, unmodified.
     */
    function drawFace(poseNow, radius, shapeSpec, inkColor) {
      var unit = (radius * EYE_SPHERE) / 30; // 1 library unit in px (1.0 when radius = 50)
      var faceScale = shapeSpec.faceScale || 1;
      var faceOffsetY = (((shapeSpec.faceY === undefined ? 50 : shapeSpec.faceY) - 50) / 50) * radius;
      var faceOffsetX = (((shapeSpec.faceX === undefined ? 50 : shapeSpec.faceX) - 50) / 50) * radius;

      var wDefault = poseNow.w[0];
      var wWorking = poseNow.w[1];
      var wSleeping = poseNow.w[2];

      ctx.save();
      ctx.translate(faceOffsetX, faceOffsetY);
      ctx.scale(unit * faceScale, unit * faceScale);
      ctx.strokeStyle = inkColor;
      ctx.fillStyle = inkColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Perspective response: looking up or down squashes the eye vertically, looking
      // sideways widens it. Dead zones stop the eye twitching around the centre.
      var vertical = shoulder(clamp(-poseNow.pitch / 0.26 - poseNow.lookY / 7, -1, 1), 0.34);
      var horizontal = Math.abs(shoulder(clamp(poseNow.lookX / 4.5, -1, 1), 0.4));
      var heightK = Math.max(0.3, 1 + 0.55 * vertical - 0.1 * horizontal);
      var widthK = 1 - 0.05 * vertical + 0.12 * horizontal;

      // State-weighted eye radius: `default` gives a full round eye, `working` squints
      // through `laugh`, `sleeping` collapses the eye into a low arc.
      var eyeRadius = wDefault + wWorking * (1 - poseNow.laugh);
      var laughRadius = wWorking * poseNow.laugh;
      var flight = Math.max(0, -poseNow.y) / 26;
      var breathK = 0.5 + 0.5 * poseNow.breath;

      [-1, 1].forEach(function (side) {
        var blinkAmt = side < 0 ? poseNow.blinkL : poseNow.blinkR;
        var open = clamp(poseNow.eyeOpen * (1 - blinkAmt), 0, 1);
        var k = eyeRadius * open;
        var g = eyeRadius * (1 - open);
        var T = laughRadius;
        var P = wSleeping;

        var hw = k * 0.01 + g * 5.4 + T * 6.2 + P * 6;
        var corner = k * 1.1 * heightK + g * 0.6 + T * (2.2 - flight * 1.5) + P * (-1.4 + breathK);
        var bulge = k * -3.3 * heightK + g * 0.6 + T * (-11.4 - 4 * flight) + P * (5.4 + 2 * breathK);
        var weight = k * EYE_WIDTH * 2 * widthK + g * 2.8 + T * 4.4 + P * 4;
        if (weight <= 0.01) return;

        var lookOffX = poseNow.lookX * (k + 0.5 * (g + T));
        var lookOffY = poseNow.lookY * (k + 0.5 * g);
        var projected = projectEye(side * 12.5 + lookOffX, 1 + lookOffY, poseNow.yaw, poseNow.pitch, 30);
        if (projected.z <= 0.02) return; // rotated around the back of the head

        ctx.save();
        ctx.globalAlpha = Math.min(1, projected.z * 5);
        ctx.translate(projected.x, projected.y);
        ctx.scale(Math.max(0.02, projected.sx), Math.max(0.02, projected.sy));
        ctx.lineWidth = weight;
        ctx.stroke(eyePath(hw, corner, bulge));
        ctx.restore();
      });

      if (inst.face === 'mouth') {
        var mix3 = function (a, b, c) {
          return wDefault * a + wWorking * b + wSleeping * c;
        };
        var calmK = (0.6 + 0.4 * wDefault) * (1 + 0.06 * poseNow.breath);
        var openK = (0.6 + 0.4 * wWorking) * (1 + (0.25 * Math.max(0, -poseNow.y)) / 26);
        var sleepK = 2.7 * wSleeping * (1 + 0.25 * poseNow.breath);
        var mouthW = Math.max(0.4, mix3(6.5 * calmK, 9.5 * openK, sleepK));
        var mouthH = Math.max(0.4, mix3(3.4 * calmK, 2.2 * openK, sleepK * 0.8));
        var mouthAt = projectEye(poseNow.lookX * 0.35, 4.5, poseNow.yaw, poseNow.pitch, 30);
        if (mouthAt.z > 0.02) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, mouthAt.z * 5);
          ctx.translate(mouthAt.x, mouthAt.y);
          ctx.scale(Math.max(0.02, mouthAt.sx), Math.max(0.02, mouthAt.sy));
          ctx.beginPath();
          ctx.ellipse(0, 0, mouthW, mouthH, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.restore();
    }

    function shoulder(value, dead) {
      var abs = Math.abs(value);
      if (abs <= dead) return 0;
      return (Math.sign(value) * (abs - dead)) / (1 - dead);
    }

    inst.setFace = function (next) {
      if (next.shape && SHAPE_BY_ID[next.shape]) inst.shape = next.shape;
      if (next.color) inst.color = next.color;
      if (next.shading) inst.shading = next.shading;
      if (next.face === 'mouth' || next.face === 'eyes') inst.face = next.face;
      if (next.interactive !== undefined) inst.interactive = Boolean(next.interactive);
      if (next.turn !== undefined) inst.pose.turnK = clamp(next.turn, 0, 2);
      inst._pathKey = '';
      resize();
      return inst;
    };
    inst.setState = function (next) {
      if (LIB_STATES.indexOf(next) < 0) return inst;
      inst.state = next;
      inst.pose.setState(next, false);
      return inst;
    };
    inst.setOptions = function (next) {
      if (next.size !== undefined && next.size !== inst.size) {
        inst.size = next.size;
        resize();
      }
      if (next.speed !== undefined) inst.speed = next.speed;
      if (next.paused !== undefined) inst.paused = Boolean(next.paused);
      if (next.seed !== undefined) inst.pose = new Pose(seedOf(String(next.seed)), inst.state);
      return inst;
    };
    inst.destroy = function () {
      if (inst._io) inst._io.disconnect();
      var i = live.indexOf(inst);
      if (i >= 0) live.splice(i, 1);
      if (!live.length) halt();
      inst.visible = false;
    };

    bindPointer();
    resize();
    live.push(inst);
    pump();
    inst.pose.update(0);
    inst.tick(0.016);
    return inst;
  }

  /* ── deterministic derivation (same hashes as avatar-gen.ts) ─────────────── */

  var GOLDEN = 2654435769;
  function shapeHash(input) {
    var e = fnv1a(input) | 0;
    e = Math.imul(e ^ (e >>> 16), 73244475);
    e = Math.imul(e ^ (e >>> 13), 3266489909);
    return (e ^ (e >>> 16)) >>> 0;
  }
  function deriveFace(id) {
    var colors = PALETTE.filter(function (c) {
      return c.id !== 'ink';
    });
    var rnd = rand32((fnv1a(id) ^ Math.imul(1, GOLDEN)) >>> 0);
    var color = colors[Math.floor(rnd() * colors.length)] || PALETTE[0];
    var shape = SHAPES[shapeHash(id) % SHAPES.length];
    return { shape: shape.id, color: color.id };
  }

  /**
   * SYNC-THINK models nine avatar states (agentAvatarState.ts); the library animates
   * three. Six of them have no built-in motion — that gap is the integration cost, so it
   * is declared here rather than papered over with invented faces.
   */
  var SYNC_THINK_STATE_MAP = {
    idle: { lib: 'default', note: '直接对应', exact: true },
    thinking: { lib: 'default', note: '无专属动效，只能用默认态', exact: false },
    working: { lib: 'working', note: '直接对应（连跳 + 前倾 + 偶尔笑）', exact: true },
    waiting: { lib: 'default', note: '无专属动效，没有「举手/提示」的表现', exact: false },
    happy: { lib: 'working', note: '无专属动效，只有 working 态自带的 laugh 眯眼', exact: false },
    error: { lib: 'default', note: '无专属动效，失败在头像上完全看不出来', exact: false },
    looking: { lib: 'default', note: '无专属动效，但指针跟随即时可用', exact: false },
    sleeping: { lib: 'sleeping', note: '直接对应（低头 + 打盹 + 点头）', exact: true },
    inactive: { lib: 'sleeping', note: '无专属动效，只能退化成休眠或静态', exact: false }
  };

  global.BotAvatars = {
    SHAPES: SHAPES,
    PALETTE: PALETTE,
    COLOR_HEX: COLOR_HEX,
    DEFAULT_COLOR: DEFAULT_COLOR,
    /** The library's own state vocabulary — three values, not nine. */
    LIB_STATES: LIB_STATES,
    LIB_STATE_LABEL: LIB_STATE_LABEL,
    SYNC_THINK_STATE_MAP: SYNC_THINK_STATE_MAP,
    JUMP_DEFAULTS: JUMP_DEFAULTS,
    INK_DARK: INK_DARK,
    INK_LIGHT: INK_LIGHT,
    inkFor: inkFor,
    deriveFace: deriveFace,
    create: create,
    _internal: {
      Pose: Pose,
      Wander: Wander,
      sampleShape: sampleShape,
      SHAPE_POINTS: SHAPE_POINTS,
      traceRing: traceRing,
      projectEye: projectEye,
      eyePath: eyePath,
      seedOf: seedOf,
      hexToRgb: hexToRgb,
      luminance: luminance
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
