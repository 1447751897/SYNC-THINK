/*
 * code-blocks.js — two code-block renderers, side by side, for the beUI swap preview.
 *
 *   SyncThinkCodeBlock  what apps/desktop/src/renderer/shell/CodeBlock.tsx does today
 *   BeuiCodeBlock       what beui.dev/components/agents/code-block does
 *
 * Both are vanilla ports of the real React components, kept behaviourally faithful rather
 * than restyled. The differences below are the ones that decide the swap:
 *
 *   streaming    sync-think wraps `code` in useDeferredValue and re-highlights the whole
 *                buffer whenever the deferred value changes. beUI keeps a token cache and,
 *                while the incoming code still starts with the cached code, keeps drawing
 *                the CACHED tokens — that is its "stable streaming updates", and it is why
 *                the eye does not see the block re-shuffle on every chunk.
 *   following    sync-think pauses auto-follow when the reader scrolls up or presses
 *                Up/PageUp/Home. beUI scrolls to the bottom on every render while
 *                streaming, with no way to opt out.
 *   limits       sync-think caps the preview at 2000 lines and offers expand/collapse.
 *                beUI has neither.
 *   wrap         sync-think has a per-block wrap toggle bound to a shared preference.
 *                beUI takes a plain `wrap` prop with no control.
 *   identity     sync-think takes an `identity` node that replaces the whole header-left.
 *                beUI has no such slot.
 *   readingState sync-think persists expanded/scrollTop/scrollLeft per source offset so
 *                virtualised rows do not jump when they remount. beUI has no equivalent.
 *   theming      sync-think emits `hljs-*` classes and lets CSS retarget one palette.
 *                beUI resolves two real themes (github-*-high-contrast) per token and
 *                carries both colours as CSS variables on every span.
 *   languages    sync-think ships 36 highlight.js grammars; beUI ships 6.
 *
 * THE HIGHLIGHTER IS A STAND-IN. Real sync-think uses highlight.js, real beUI uses shiki.
 * Neither can be loaded into an offline file:// demo, so both sides here share one small
 * tokeniser — the comparison is about the SURFACE, and the engine swap is called out in
 * the README as a separate cost (shiki is the one genuinely new dependency).
 */
(function (global) {
  'use strict';

  /* ── tokeniser (stand-in for hljs / shiki) ──────────────────────────────── */

  var KEYWORDS = {
    typescript: 'const let var function return if else for while import from export default async await class extends new this typeof interface type enum implements readonly public private static void null undefined true false try catch finally throw switch case break continue as of in',
    tsx: 'const let var function return if else for while import from export default async await class extends new this typeof interface type enum implements readonly public private static void null undefined true false try catch finally throw switch case break continue as of',
    bash: 'if then else fi for do done while case esac function return export local echo cd pnpm npm node git',
    json: '',
    diff: '',
    text: ''
  };

  var LANG_ALIASES = {
    ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'typescript',
    jsx: 'tsx', mjs: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash', txt: 'text'
  };

  var TOKEN_COLORS = {
    // [light, dark] — the dark pair mirrors tokens.css' --color-syntax-* in .dark.
    comment: ['#6e7781', '#7d8590'],
    keyword: ['#cf222e', '#b3a6ff'],
    string: ['#0a3069', '#7ddea4'],
    number: ['#0550ae', '#f0b429'],
    title: ['#8250df', '#7eb6ff'],
    builtin: ['#953800', '#5fd0d6'],
    meta: ['#116329', '#7d8590'],
    plain: [null, null]
  };

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** Tokenise one line into [{ text, type }]. Good enough to show colour and stability. */
  function tokenizeLine(line, language) {
    var out = [];
    var keywords = KEYWORDS[language] || '';
    var keywordSet = {};
    keywords.split(' ').forEach(function (k) {
      if (k) keywordSet[k] = true;
    });
    if (language === 'diff') {
      if (line.charAt(0) === '+') return [{ text: line, type: 'string' }];
      if (line.charAt(0) === '-') return [{ text: line, type: 'keyword' }];
      if (line.charAt(0) === '@') return [{ text: line, type: 'meta' }];
      return [{ text: line, type: 'plain' }];
    }
    if (language === 'json') {
      var jsonRe = /("(?:[^"\\]|\\.)*")(\s*:)?|(\b-?\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g;
      var m;
      var last = 0;
      while ((m = jsonRe.exec(line))) {
        if (m.index > last) out.push({ text: line.slice(last, m.index), type: 'plain' });
        if (m[1] !== undefined) out.push({ text: m[1], type: m[2] ? 'title' : 'string' });
        if (m[2]) out.push({ text: m[2], type: 'plain' });
        if (m[3] !== undefined) out.push({ text: m[3], type: 'number' });
        if (m[4] !== undefined) out.push({ text: m[4], type: 'keyword' });
        last = m.index + m[0].length;
      }
      if (last < line.length) out.push({ text: line.slice(last), type: 'plain' });
      return out.length ? out : [{ text: line, type: 'plain' }];
    }
    if (language === 'text') return [{ text: line, type: 'plain' }];

    var re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([^\w$\s]+)|(\s+)/g;
    var match;
    while ((match = re.exec(line))) {
      if (match[1]) out.push({ text: match[1], type: 'comment' });
      else if (match[2]) out.push({ text: match[2], type: 'string' });
      else if (match[3]) out.push({ text: match[3], type: 'number' });
      else if (match[4]) {
        var word = match[4];
        if (keywordSet[word]) out.push({ text: word, type: 'keyword' });
        else if (line.charAt(re.lastIndex) === '(') out.push({ text: word, type: 'title' });
        else out.push({ text: word, type: 'plain' });
      } else if (match[5]) out.push({ text: match[5], type: 'plain' });
      else out.push({ text: match[6], type: 'plain' });
    }
    if (!out.length) out.push({ text: line, type: 'plain' });
    return out;
  }

  function normalizeLanguage(language) {
    if (!language) return 'text';
    var lower = String(language).toLowerCase();
    return LANG_ALIASES[lower] || lower;
  }

  function tokenize(code, language) {
    var lang = normalizeLanguage(language);
    return code.replace(/\r\n/g, '\n').split('\n').map(function (line) {
      return { content: line, tokens: tokenizeLine(line, lang) };
    });
  }

  /* ── shared helpers ─────────────────────────────────────────────────────── */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function copyButton(onLabel, offLabel) {
    var button = el('button', 'cb-copy');
    button.type = 'button';
    button.setAttribute('aria-label', offLabel);
    button.title = offLabel;
    return button;
  }

  /* ── sync-think's CodeBlock (apps/desktop/.../CodeBlock.tsx) ──────────────
   *
   * The markup below is the real component's markup, class for class, taken from
   * CodeBlock.tsx. The demo page loads the app's own compiled `shell.css`, so this side is
   * not a look-alike — it is the same DOM the app produces, styled by the same stylesheet,
   * under the same `.shell-md` scope. Keep it in step with CodeBlock.tsx.
   */

  var PREVIEW_LINE_LIMIT = 2000;

  /**
   * @param {{code:string, language?:string, filename?:string, streaming?:boolean,
   *          highlightLines?:number[], collapsible?:boolean, maxHeight?:number,
   *          showStatus?:boolean, wrapControl?:boolean, identity?:string}} options
   */
  function SyncThinkCodeBlock(options) {
    var self = this;
    this.options = options || {};
    this.stats = { retokenized: 0, chunks: 0 };
    this.expanded = false;
    this.following = true;
    this.wraps = Boolean(this.options.defaultWrap);
    this.copied = 0;

    this.root = el('div', 'shell-md-code shell-agent-code');
    this.root.dataset.engine = 'highlight.js';
    this.root.dataset.wrap = String(this.wraps);

    var bar = el('div', 'shell-md-code__bar');
    if (this.options.identity !== undefined) {
      // `identity` replaces the whole header-left, exactly like the real prop.
      var custom = el('span');
      custom.innerHTML = this.options.identity;
      bar.appendChild(custom.firstChild || custom);
    } else {
      var identity = el('div', 'shell-agent-code__identity');
      identity.appendChild(el('span', 'shell-agent-code__icon', '\u25A4'));
      if (this.options.filename) {
        var name = el('span', 'shell-agent-code__filename', this.options.filename);
        name.title = this.options.filename;
        identity.appendChild(name);
      }
      identity.appendChild(
        el('span', 'shell-md-code__lang', normalizeLanguage(this.options.language))
      );
      bar.appendChild(identity);
    }

    var actions = el('div', 'shell-md-code__actions');
    if (this.options.showStatus !== false) {
      this.statusEl = el('span', 'shell-agent-code__status');
      this.statusEl.setAttribute('role', 'status');
      actions.appendChild(this.statusEl);
    } else {
      this.statusEl = null;
    }

    this.copyEl = el('button', 'shell-md-code__action', '复制');
    this.copyEl.type = 'button';
    this.copyEl.addEventListener('click', function () {
      self.copied += 1;
      self.copyEl.classList.add('is-copied');
      self.copyEl.textContent = '已复制';
      window.setTimeout(function () {
        self.copyEl.classList.remove('is-copied');
        self.copyEl.textContent = '复制';
      }, 1400);
    });
    actions.appendChild(this.copyEl);

    if (this.options.wrapControl) {
      var wrapBtn = el('button', 'shell-md-code__action shell-md-code__wrap', '\u21B5');
      wrapBtn.type = 'button';
      wrapBtn.setAttribute('aria-label', '切换自动换行');
      wrapBtn.setAttribute('aria-pressed', String(this.wraps));
      wrapBtn.addEventListener('click', function () {
        self.wraps = !self.wraps;
        wrapBtn.setAttribute('aria-pressed', String(self.wraps));
        self.root.dataset.wrap = String(self.wraps);
      });
      actions.appendChild(wrapBtn);
    }
    bar.appendChild(actions);
    this.root.appendChild(bar);

    this.maxHeight = this.options.maxHeight || 280;

    var body = el('div', 'shell-agent-code__body');
    this.viewport = el('div', 'shell-md-code__viewport shell-agent-code__viewport');
    this.viewport.setAttribute('data-code-viewport', '');
    this.viewport.tabIndex = 0;
    this.viewport.setAttribute('role', 'region');
    var pre = el('pre', 'shell-agent-code__source');
    this.code = el('code', 'hljs');
    pre.appendChild(this.code);
    this.viewport.appendChild(pre);
    body.appendChild(this.viewport);
    this.root.appendChild(body);

    // Reader intent wins: scrolling up or pressing Up/PageUp/Home stops the autoscroll.
    this.viewport.addEventListener('scroll', function () {
      var v = self.viewport;
      self.following = v.scrollHeight - v.scrollTop - v.clientHeight <= 24;
    });
    this.viewport.addEventListener('wheel', function (event) {
      if (event.deltaY < 0) self.following = false;
    });
    this.viewport.addEventListener('keydown', function (event) {
      if (['ArrowUp', 'PageUp', 'Home'].indexOf(event.key) >= 0) self.following = false;
    });

    this.limitNote = el('div', 'shell-agent-code__limit');
    this.limitNote.hidden = true;
    this.limitNote.textContent = '仅预览前 ' + PREVIEW_LINE_LIMIT + ' 行；复制可获取完整内容。';
    this.root.appendChild(this.limitNote);

    this.expandBtn = el('button', 'shell-md-code__expand');
    this.expandBtn.type = 'button';
    this.expandBtn.hidden = true;
    this.expandBtn.addEventListener('click', function () {
      self.setExpanded(!self.expanded);
    });
    this.root.appendChild(this.expandBtn);

    this.lastDeferred = this.options.code || '';
    this.render(this.options.code || '', this.options.streaming);
  }

  SyncThinkCodeBlock.prototype.setExpanded = function (next) {
    this.expanded = next;
    this.root.classList.toggle('is-expanded', next);
    this.root.classList.toggle('is-collapsed', !next);
    this.viewport.style.maxHeight =
      (next ? Math.max(480, this.maxHeight) : this.maxHeight) + 'px';
    this.expandBtn.textContent = next ? '收起代码' : this.expandLabel;
    this.expandBtn.setAttribute('aria-expanded', String(next));
  };

  SyncThinkCodeBlock.prototype.setMaxHeight = function (height) {
    this.maxHeight = height;
    this.viewport.style.maxHeight = (this.expanded ? Math.max(480, height) : height) + 'px';
  };

  SyncThinkCodeBlock.prototype.render = function (code, streaming) {
    var deferred = this.options.defer !== false;
    // useDeferredValue: while the stream is arriving, the DOM keeps drawing the PREVIOUS
    // buffer — one commit behind — so the stale frame never blocks the incoming one.
    var source = deferred && streaming && this.lastDeferred !== undefined ? this.lastDeferred : code;
    this.lastDeferred = code;
    // The real component re-runs highlightCodeLines over the whole buffer on every commit
    // that changes the deferred value; that is the cost beUI's token cache avoids.
    this.stats.retokenized += 1;
    if (streaming) this.stats.chunks += 1;
    var writing = Boolean(streaming);

    var all = source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    var lines = all.slice(0, PREVIEW_LINE_LIMIT);
    var total = all.length;

    this.root.classList.toggle('is-expandable', total > 12);
    this.root.classList.toggle('is-expanded', this.expanded && total > 12);
    this.root.classList.toggle('is-collapsed', !this.expanded && total > 12);
    this.expandLabel =
      total > PREVIEW_LINE_LIMIT ? '展开预览 ' + PREVIEW_LINE_LIMIT + ' 行' : '展开全部 ' + total + ' 行';
    this.expandBtn.hidden = !(total > 12);
    this.expandBtn.textContent = this.expanded ? '收起代码' : this.expandLabel;
    this.limitNote.hidden = total <= PREVIEW_LINE_LIMIT;

    if (this.statusEl) {
      this.statusEl.textContent = writing ? '生成中' : '已完成';
      this.statusEl.dataset.state = writing ? 'writing' : 'done';
    }
    this.root.dataset.writing = String(writing);
    this.viewport.style.maxHeight =
      (this.expanded ? Math.max(480, this.maxHeight) : this.maxHeight) + 'px';
    this.code.className = 'hljs language-' + normalizeLanguage(this.options.language);

    var focused = {};
    (this.options.highlightLines || []).forEach(function (n) {
      focused[n] = true;
    });
    // The real component re-runs highlightCodeLines over the whole buffer every time.
    var tokenized = tokenize(lines.join('\n'), this.options.language);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < lines.length; i += 1) {
      var row = el('span', 'shell-agent-code__line');
      row.dataset.codeLine = String(i + 1);
      if (focused[i + 1]) row.dataset.highlighted = 'true';
      var num = el('span', 'shell-agent-code__number', String(i + 1));
      num.setAttribute('aria-hidden', 'true');
      row.appendChild(num);
      var text = el('span', 'shell-agent-code__text');
      var tokens = tokenized[i] ? tokenized[i].tokens : [{ text: lines[i], type: 'plain' }];
      tokens.forEach(function (token) {
        if (token.type === 'plain') {
          text.appendChild(document.createTextNode(token.text));
        } else {
          text.appendChild(el('span', 'hljs-' + token.type, token.text));
        }
      });
      row.appendChild(text);
      row.appendChild(document.createTextNode('\n'));
      frag.appendChild(row);
    }
    this.code.textContent = '';
    this.code.appendChild(frag);

    if (writing && this.following) this.viewport.scrollTop = this.viewport.scrollHeight;
  };

  /* ── beUI's CodeBlock (beui.dev/components/agents/code-block) ───────────── */

  var BEUI_LANGUAGES = ['bash', 'diff', 'json', 'text', 'tsx', 'typescript'];
  var beuiTokenCache = new Map();

  function beuiCacheKey(code, language) {
    return language + '\u0000' + code;
  }

  /** beUI's highlighter cache: unbounded Map, keyed by language + full source. */
  function beuiTokens(code, language) {
    var key = beuiCacheKey(code, language);
    var hit = beuiTokenCache.get(key);
    if (hit) return hit;
    var lines = tokenize(code, language);
    // An empty buffer is never cached: every later chunk "starts with" it, so caching it
    // would make the prefix-reuse branch serve empty tokens for the whole first stream.
    if (code.length > 0) beuiTokenCache.set(key, lines);
    return lines;
  }

  function BeuiCodeBlock(options) {
    var self = this;
    this.options = options || {};
    this.stats = { retokenized: 0, chunks: 0, cacheHits: 0, prefixReuses: 0, highlightErrors: 0 };
    this.copied = false;
    // The real component types `language` as a 6-value union and only preloads those
    // grammars. At runtime anything else reaches shiki's codeToTokensWithThemes, which
    // throws inside a promise chain — so the tokens never arrive and the block stays
    // plain text behind an unhandled rejection. That is a harder failure than a fallback,
    // and the header still prints the language you asked for.
    this.requestedLanguage = this.options.language === undefined ? 'typescript' : this.options.language;
    this.supported = BEUI_LANGUAGES.indexOf(this.requestedLanguage) >= 0;
    this.language = this.requestedLanguage;
    this.cached = null;

    this.root = el('div', 'cb cb--beui');
    this.root.dataset.engine = 'shiki';
    this.root.dataset.language = this.language;
    this.root.dataset.supported = String(this.supported);

    var bar = el('div', 'beui-bar');
    bar.appendChild(el('span', 'beui-fileicon', '\u25A4'));
    if (this.options.filename !== undefined && this.options.filename !== null) {
      var name = el('span', 'beui-filename', String(this.options.filename));
      bar.appendChild(name);
    }
    bar.appendChild(el('span', 'beui-lang', this.language));

    this.statusEl = el('span', 'beui-status');
    bar.appendChild(this.statusEl);

    this.copyEl = copyButton();
    this.copyEl.addEventListener('click', function () {
      self.copied = true;
      self.copyEl.classList.add('is-pressed', 'is-copied');
      self.copyEl.textContent = '\u2713';
      window.setTimeout(function () {
        self.copyEl.classList.remove('is-pressed');
      }, 120);
      window.setTimeout(function () {
        self.copied = false;
        self.copyEl.classList.remove('is-copied');
        self.copyEl.textContent = '\u29C9';
      }, 1600);
    });
    bar.appendChild(this.copyEl);
    this.root.appendChild(bar);

    this.viewport = el('div', 'beui-viewport');
    this.pre = el('pre', 'beui-pre');
    this.code = el('code');
    this.pre.appendChild(this.code);
    this.viewport.appendChild(this.pre);
    this.root.appendChild(this.viewport);

    this.setMaxHeight(this.options.maxHeight === undefined ? 280 : this.options.maxHeight);
    this.render(this.options.code || '', this.options.status === 'streaming');
  }

  BeuiCodeBlock.prototype.setMaxHeight = function (height) {
    this.viewport.style.maxHeight = height + 'px';
  };

  BeuiCodeBlock.prototype.render = function (code, streaming) {
    var writing = Boolean(streaming);
    if (writing) this.stats.chunks += 1;
    this.root.dataset.state = writing ? 'streaming' : 'complete';
    this.root.setAttribute('aria-busy', String(writing));

    this.statusEl.textContent = writing ? 'Writing' : 'Ready';
    this.statusEl.dataset.state = writing ? 'writing' : 'ready';

    var tokens;
    if (!this.supported) {
      // shiki has no grammar loaded for this language: no tokens, ever.
      this.stats.highlightErrors += 1;
      this.root.dataset.highlight = 'failed';
      tokens = null;
    } else {
      this.root.dataset.highlight = 'ok';
      var cachedKey = this.cached ? beuiCacheKey(this.cached.code, this.cached.language) : null;
      var exact = cachedKey ? beuiTokenCache.get(beuiCacheKey(code, this.language)) : null;
      if (exact) {
        tokens = exact;
        this.stats.cacheHits += 1;
      } else if (
        this.cached &&
        this.cached.code.length > 0 &&
        this.cached.language === this.language &&
        code.indexOf(this.cached.code) === 0
      ) {
        // The stability trick: while the stream is still appending, keep drawing the tokens
        // we already have instead of re-tokenising on every chunk.
        tokens = this.cached.lines;
        this.stats.prefixReuses += 1;
      } else {
        tokens = beuiTokens(code, this.language);
        this.stats.retokenized += 1;
      }
      if (code.length > 0) this.cached = { code: code, language: this.language, lines: tokens };
    }

    var focused = {};
    (this.options.highlightLines || []).forEach(function (n) {
      focused[n] = true;
    });

    var lines = code.split('\n');
    var showNumbers = this.options.showLineNumbers !== false;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < lines.length; i += 1) {
      var row = el('span', 'beui-line');
      row.style.gridTemplateColumns = showNumbers ? '2.75rem minmax(0,1fr)' : '1fr';
      if (focused[i + 1]) row.classList.add('is-focused');
      if (showNumbers) {
        var num = el('span', 'beui-num', String(i + 1));
        row.appendChild(num);
      }
      var text = el('span', 'beui-text' + (this.options.wrap ? ' is-wrap' : ''));
      var lineTokens = tokens && tokens[i] ? tokens[i].tokens : [{ text: lines[i], type: 'plain' }];
      lineTokens.forEach(function (token) {
        if (token.type === 'plain' || !TOKEN_COLORS[token.type]) {
          text.appendChild(document.createTextNode(token.text));
          return;
        }
        var colors = TOKEN_COLORS[token.type];
        var span = el('span', 'beui-token', token.text);
        // Two colours carried on every span; CSS picks one. This is what beUI's
        // `--agent-code-light` / `--agent-code-dark` pair does.
        span.style.setProperty('--agent-code-light', colors[0] || 'currentColor');
        span.style.setProperty('--agent-code-dark', colors[1] || colors[0] || 'currentColor');
        text.appendChild(span);
      });
      row.appendChild(text);
      frag.appendChild(row);
    }
    this.code.textContent = '';
    this.code.appendChild(frag);

    // beUI scrolls to the bottom on every render while streaming, unconditionally.
    if (writing) {
      var viewport = this.viewport;
      requestAnimationFrame(function () {
        if (viewport.scrollHeight <= viewport.clientHeight) return;
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
      });
    }
  };

  global.CodeBlocks = {
    SYNTAX_AVAILABLE: BEUI_LANGUAGES,
    PREVIEW_LINE_LIMIT: PREVIEW_LINE_LIMIT,
    TOKEN_COLORS: TOKEN_COLORS,
    tokenize: tokenize,
    normalizeLanguage: normalizeLanguage,
    escapeHtml: escapeHtml,
    createSyncThink: function (options) {
      return new SyncThinkCodeBlock(options);
    },
    createBeui: function (options) {
      return new BeuiCodeBlock(options);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
