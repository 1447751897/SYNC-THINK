/*
 * verify.mjs — headless check + screenshots for the demo.
 *
 *   node demo/verify.mjs
 *
 * Starts demo/serve.mjs in-process on an ephemeral port, then checks the claims the page
 * makes. The first group matters most: the whole point of this demo is that the "现状"
 * comes from the app's own build, so the first thing verified is that the real shell really
 * renders inside the frame, from the real build, with the real stylesheet.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoServer, ensureQaBuild } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const require = createRequire(import.meta.url);

function loadChromium() {
  const candidates = [];
  try {
    candidates.push(require.resolve('playwright-core'));
  } catch {
    /* not resolvable */
  }
  const pnpm = join(repo, 'node_modules', '.pnpm');
  if (existsSync(pnpm)) {
    for (const entry of readdirSync(pnpm)) {
      if (entry.startsWith('playwright-core@')) {
        candidates.push(join(pnpm, entry, 'node_modules', 'playwright-core'));
      }
    }
  }
  for (const candidate of candidates) {
    try {
      return require(candidate).chromium;
    } catch {
      /* next */
    }
  }
  throw new Error('playwright-core not found — run pnpm install first');
}

function findChrome() {
  const dir = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir).sort().reverse()) {
    if (!entry.startsWith('chromium-')) continue;
    for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const exe = join(dir, entry, rel);
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const failures = [];
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

if (!ensureQaBuild()) process.exit(1);

const server = createDemoServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const exe = findChrome();
const browser = await loadChromium().launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const consoleErrors = [];
const failedResponses = [];
const allFailedResponses = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // Chrome's generic "Failed to load resource" carries no URL, so it cannot be filtered by
  // text. The response listener below captures the same failure with its real URL, so that
  // is the authoritative signal and this one is dropped.
  if (/Failed to load resource/i.test(m.text())) return;
  consoleErrors.push('console: ' + m.text());
});
page.on('response', (r) => {
  if (r.status() < 400) return;
  allFailedResponses.push(`${r.status()} ${r.url()}`);
  if (!/favicon\.ico/.test(r.url())) failedResponses.push(`${r.status()} ${r.url()}`);
});

await page.goto(base + '/', { waitUntil: 'load' });
await page.waitForTimeout(900);

if (consoleErrors.length || allFailedResponses.length) {
  console.log('  boot problems:');
  for (const m of consoleErrors.slice(0, 5)) console.log(`    ${m}`);
  for (const m of allFailedResponses.slice(0, 5)) console.log(`    ${m}`);
}

/* ── 1. the page itself ───────────────────────────────────────────────────── */
const shell = await page.evaluate(() => ({
  api: Boolean(window.__FP__),
  sections: Array.from(document.querySelectorAll('.fp-navbtn')).map((b) => b.textContent),
  // The app's own compiled stylesheet has to be the one in effect.
  tokenPage: getComputedStyle(document.documentElement).getPropertyValue('--color-page').trim(),
  tokenSidebar: getComputedStyle(document.documentElement)
    .getPropertyValue('--color-sidebar')
    .trim(),
  fontMono: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(),
}));
check('demo boots', shell.api);
check('five sections', shell.sections.length === 5, shell.sections.join(' | '));
check(
  "the app's own tokens are in effect (shell.css loaded)",
  shell.tokenPage === '#1e1f1f' && shell.tokenSidebar === '#252726' && shell.fontMono.length > 0,
  `page=${shell.tokenPage} sidebar=${shell.tokenSidebar}`
);

/* ── 2. the real shell really renders inside the frame ────────────────────── */
// Open the consistency section first: it is the diagnosis page and must render on its own.
const consistency = await page.evaluate(() => {
  window.__FP__.setSection('consistency');
  const text = document.querySelector('#fp-body')?.textContent ?? '';
  return {
    section: window.__FP__.section,
    cards: document.querySelectorAll('#fp-body .fp-card').length,
    tokenRows: document.querySelectorAll('#fp-body table.fp-map tbody tr').length,
    mentionsRootCause: text.includes('没有词汇') || text.includes('词汇缺失'),
    mentionsLintFail: text.includes('17 条是假警报') || text.includes('测错了地方'),
    mentionsDeadTheme: text.includes('DEPRECATED'),
    mentionsColourSources: text.includes('12') && text.includes('颜色真相'),
    mentionsPlan: text.includes('先补刻度'),
  };
});
check(
  'the consistency section renders its diagnosis',
  consistency.section === 'consistency' &&
    consistency.cards >= 4 &&
    consistency.tokenRows >= 19 &&
    consistency.mentionsRootCause &&
    consistency.mentionsLintFail &&
    consistency.mentionsDeadTheme &&
    consistency.mentionsColourSources &&
    consistency.mentionsPlan,
  JSON.stringify(consistency)
);
await page.screenshot({ path: join(here, 'shot-consistency.png') });

await page.evaluate(() => window.__FP__.setSection('live'));
await page.waitForTimeout(2600);
const frame = page.frames().find((f) => f.url().includes('/qa/index.html'));
check('the real shell frame loaded', Boolean(frame), frame ? frame.url() : 'no /qa frame');

let real = { rootChildren: 0, codeBlocks: 0, codeLines: 0, colorPage: '', codeElClass: '', hljsTokens: 0 };
if (frame) {
  real = await frame.evaluate(() => ({
    rootChildren: document.getElementById('root')?.children.length ?? 0,
    text: (document.getElementById('root')?.textContent ?? '').trim().slice(0, 60),
    codeBlocks: document.querySelectorAll('.shell-md-code').length,
    codeLines: document.querySelectorAll('.shell-agent-code__line').length,
    // The real component writes `hljs language-<lang>` on the <code> element and colours
    // run per token; a sample with no keyword tokens still proves the wiring.
    codeElClass: document.querySelector('.shell-md-code code')?.className ?? '',
    hljsTokens: document.querySelectorAll('.shell-md-code [class^="hljs-"]').length,
    colorPage: getComputedStyle(document.documentElement).getPropertyValue('--color-page').trim(),
    dark: document.documentElement.classList.contains('dark'),
  }));
}
check('the real shell rendered content', real.rootChildren > 0 && real.colorPage === '#1e1f1f',
  `children=${real.rootChildren} colorPage=${real.colorPage}`);
check(
  'the real CodeBlock component is on screen inside it',
  real.codeBlocks > 0 && real.codeLines > 0,
  `blocks=${real.codeBlocks} lines=${real.codeLines}`
);
check(
  'the real component wired its language and highlighter class through',
  /(^|\s)hljs(\s|$)/.test(real.codeElClass) && /language-/.test(real.codeElClass),
  `code class="${real.codeElClass}" hljs tokens=${real.hljsTokens}`
);
await page.screenshot({ path: join(here, 'shot-live.png') });

/* ── 3. avatars ───────────────────────────────────────────────────────────── */
await page.evaluate(() => window.__FP__.setSection('avatars'));
await page.waitForTimeout(600);
const avatars = await page.evaluate(() => {
  const api = window.__FP__;
  const scope = api.av;
  return {
    slots: scope.slots.length,
    domSlots: document.querySelectorAll('.av[data-av]').length,
    canvases: document.querySelectorAll('.av canvas').length,
    twins: document.querySelectorAll('.av .av__old svg').length,
    realWrapper: document.querySelectorAll('.agent-card__avatar').length,
    callSites: document.querySelectorAll('.fp-callsite').length,
    libStates: window.BotAvatars.LIB_STATES,
  };
});
check(
  'every avatar slot mounted in both renderers',
  avatars.slots > 25 &&
    avatars.slots === avatars.domSlots &&
    avatars.canvases === avatars.domSlots &&
    avatars.twins === avatars.domSlots,
  `slots=${avatars.slots} canvas=${avatars.canvases} twin=${avatars.twins}`
);
check("the real call-site wrapper class is used", avatars.realWrapper >= 1, `count=${avatars.realWrapper}`);
check('only the three library states exist',
  JSON.stringify(avatars.libStates) === JSON.stringify(['default', 'working', 'sleeping']));

// Pin the gaze wander so the pointer term's sign is observable, then steer it.
await page.evaluate(() => {
  const probe = window.__FP__.av.slots.find((s) => s.node.dataset.noPoke);
  const p = probe.inst.pose;
  p.turnK = 0;
  p.yawW.aim(0);
  p.pitchW.aim(0);
  p.rollW.aim(0);
  p.lookXW.aim(0);
  p.lookYW.aim(0);
  p.blinkAt = Infinity;
  p.dartAt = Infinity;
  p.flipAt = Infinity;
});

async function poseWithPointer(dx, dy) {
  const handle = await page.$('.av[data-no-poke]');
  await handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  for (let i = 0; i < 16; i += 1) {
    await page.evaluate(() => {
      const p = window.__FP__.av.slots.find((s) => s.node.dataset.noPoke).inst.pose;
      p.pitchW.aim(0);
      p.rollW.aim(0);
      p.lookXW.aim(0);
      p.lookYW.aim(0);
    });
    await page.waitForTimeout(120);
  }
  return page.evaluate(() => {
    const p = window.__FP__.av.slots.find((s) => s.node.dataset.noPoke).inst.pose;
    return { yaw: p.pose.yaw, pitch: p.pose.pitch, lookX: p.pose.lookX, ptrS: p.ptrS };
  });
}
const right = await poseWithPointer(300, 0);
const left = await poseWithPointer(-300, 0);
const up = await poseWithPointer(0, -300);
check(
  'pointer steers the head and eyes',
  right.yaw > 0.05 && left.yaw < -0.05 && right.lookX > 0.3 && left.lookX < -0.3,
  `right ${right.yaw.toFixed(3)}/${right.lookX.toFixed(2)} left ${left.yaw.toFixed(3)}/${left.lookX.toFixed(2)}`
);
check('pointer above raises the pitch', up.pitch > right.pitch + 0.05,
  `up ${up.pitch.toFixed(3)} vs level ${right.pitch.toFixed(3)}`);

const poke = await page.evaluate(async () => {
  const slot = window.__FP__.av.slots.find((s) => s.node.dataset.noPoke);
  slot.inst.visible = true; // off-screen avatars are culled and never tick
  slot.inst.pose.flip.p = -1;
  const before = slot.inst.pose.pose.y;
  slot.inst.poke();
  let minY = Infinity;
  let maxYaw = 0;
  for (let i = 0; i < 120; i += 1) {
    slot.inst.tick(1 / 60);
    minY = Math.min(minY, slot.inst.pose.pose.y);
    maxYaw = Math.max(maxYaw, Math.abs(slot.inst.pose.pose.yaw));
  }
  slot.inst.visible = false;
  return { before, minY, maxYaw };
});
check('click lifts the bot and spins it', poke.minY < poke.before - 10 && poke.maxYaw > 3,
  `y ${poke.before.toFixed(1)} -> ${poke.minY.toFixed(1)}, |yaw| ${poke.maxYaw.toFixed(2)}`);
await page.screenshot({ path: join(here, 'shot-avatars.png') });

/* ── 4. code blocks ───────────────────────────────────────────────────────── */
await page.evaluate(() => window.__FP__.setSection('code'));
await page.waitForTimeout(500);
const code = await page.evaluate(() => {
  const c = window.__FP__.codeScope.code;
  c.mountScenario();
  return {
    oldRoot: document.querySelector('.fp-side--old .shell-md-code')?.className,
    oldLines: document.querySelectorAll('.fp-side--old .shell-agent-code__line').length,
    oldViewport: Boolean(document.querySelector('.fp-side--old [data-code-viewport]')),
    oldLang: document.querySelector('.fp-side--old .shell-md-code__lang')?.textContent,
    newRoot: Boolean(document.querySelector('.fp-side--new .cb--beui')),
    insideShellMd: Boolean(document.querySelector('.fp-side--old.shell-md, .shell-md .shell-md-code')),
    matrixRows: document.querySelectorAll('.fp-card table.fp-map tbody tr').length,
  };
});
check(
  "the 'old' side uses the real component's class names",
  code.oldRoot === 'shell-md-code shell-agent-code' &&
    code.oldViewport === true &&
    code.oldLang === 'typescript',
  JSON.stringify({ root: code.oldRoot, viewport: code.oldViewport, lang: code.oldLang })
);
check('the old side is inside a real .shell-md scope', code.insideShellMd === true);
check('the new side mounted', code.newRoot === true);
check('the prop matrix is populated', code.matrixRows >= 15, `rows=${code.matrixRows}`);

const stream = await page.evaluate(async () => {
  const c = window.__FP__.codeScope.code;
  const btn = Array.from(document.querySelectorAll('.fp-btn')).find((b) => b.textContent.includes('流式'));
  btn.click();
  await new Promise((r) => setTimeout(r, 1200));
  const mid = {
    oldLines: document.querySelectorAll('.fp-side--old .shell-agent-code__line').length,
    newLines: document.querySelectorAll('.fp-side--new .beui-line').length,
    oldStats: { ...c.old.stats },
    newStats: { ...c.beui.stats },
  };
  c.stopStream();
  c.renderBoth(window.__FP__.scenarios.stream.code, false);
  return {
    mid,
    done: {
      oldLines: document.querySelectorAll('.fp-side--old .shell-agent-code__line').length,
      newLines: document.querySelectorAll('.fp-side--new .beui-line').length,
      oldWriting: c.old.root.dataset.writing,
      newState: c.beui.root.dataset.state,
    },
    total: window.__FP__.scenarios.stream.code.split('\n').length,
  };
});
check('the stream grows both blocks', stream.mid.oldLines > 1 && stream.mid.newLines > 1,
  `${stream.mid.oldLines} / ${stream.mid.newLines}`);
check('both finish with every line',
  stream.done.oldLines === stream.total && stream.done.newLines === stream.total,
  `total ${stream.total}, old ${stream.done.oldLines}, new ${stream.done.newLines}`);
check('the real component reports complete when the stream ends',
  stream.done.oldWriting === 'false' && stream.done.newState === 'complete',
  `${stream.done.oldWriting} / ${stream.done.newState}`);
check(
  'beUI reuses the cached prefix instead of re-tokenising',
  stream.mid.newStats.prefixReuses > 5 && stream.mid.newStats.retokenized < stream.mid.newStats.prefixReuses,
  `prefixReuses=${stream.mid.newStats.prefixReuses} retokenized=${stream.mid.newStats.retokenized}`
);
check('the old block re-tokenises far more often',
  stream.mid.oldStats.retokenized > stream.mid.newStats.retokenized * 2,
  `old=${stream.mid.oldStats.retokenized} new=${stream.mid.newStats.retokenized}`);

const follow = await page.evaluate(async () => {
  const c = window.__FP__.codeScope.code;
  c.mountScenario();
  c.renderBoth(window.__FP__.scenarios.stream.code, true);
  await new Promise((r) => setTimeout(r, 60));
  Array.from(document.querySelectorAll('.fp-btn'))
    .find((b) => b.textContent.includes('向上滚动'))
    .click();
  await new Promise((r) => setTimeout(r, 40));
  const afterScroll = { oldScroll: c.old.viewport.scrollTop, oldFollowing: c.old.following };
  c.renderBoth(window.__FP__.scenarios.stream.code, true);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 90));
  return {
    afterScroll,
    afterMore: { oldScroll: c.old.viewport.scrollTop, newScroll: c.beui.viewport.scrollTop },
    newMax: c.beui.viewport.scrollHeight - c.beui.viewport.clientHeight,
  };
});
check('the real component stops following once the reader scrolls up',
  follow.afterScroll.oldFollowing === false && follow.afterScroll.oldScroll === 0,
  JSON.stringify(follow.afterScroll));
check('beUI snaps the reader back to the bottom',
  follow.afterMore.newScroll > 0 && follow.afterMore.newScroll >= follow.newMax - 4,
  `newScroll=${follow.afterMore.newScroll} max=${follow.newMax}`);

const abilities = await page.evaluate(() => {
  const api = window.__FP__;
  const c = api.codeScope.code;
  const out = {};
  const select = (key) => {
    c.scenario = key;
    c.sceneSel.value = key;
    c.mountScenario();
  };
  select('long');
  out.long = {
    oldExpand: document.querySelectorAll('.fp-side--old .shell-md-code__expand:not([hidden])').length,
    newExpand: document.querySelectorAll('.fp-side--new .cb__expand, .fp-side--new .beui-expand').length,
  };
  select('huge');
  out.huge = {
    oldLines: document.querySelectorAll('.fp-side--old .shell-agent-code__line').length,
    oldLimitShown: !document.querySelector('.fp-side--old .shell-agent-code__limit')?.hidden,
    newLines: document.querySelectorAll('.fp-side--new .beui-line').length,
    total: api.scenarios.huge.code.split('\n').length,
  };
  select('tool');
  out.tool = {
    oldIdentity: Boolean(document.querySelector('.fp-side--old .shell-tool-result__label')),
    oldStatus: document.querySelectorAll('.fp-side--old .shell-agent-code__status').length,
  };
  select('unsupported');
  out.unsupported = {
    requested: api.scenarios.unsupported.language,
    newLanguage: c.beui.language,
    newTokens: document.querySelectorAll('.fp-side--new .beui-token').length,
    oldTokens: document.querySelectorAll('.fp-side--old .hljs-keyword, .fp-side--old .hljs-title').length,
  };
  return out;
});
check('the real component has an expand control on a long file', abilities.long.oldExpand === 1);
check('beUI has no expand control', abilities.long.newExpand === 0);
check('the real component caps at 2000 lines and says so',
  abilities.huge.oldLines === 2000 && abilities.huge.oldLimitShown, `oldLines=${abilities.huge.oldLines}`);
check('beUI renders all 2400 lines', abilities.huge.newLines === abilities.huge.total,
  `${abilities.huge.newLines}/${abilities.huge.total}`);
check('the identity override renders in the real header', abilities.tool.oldIdentity === true);
check('showStatus=false really removes the status element', abilities.tool.oldStatus === 0);
check('beUI fails hard on a language outside its union',
  abilities.unsupported.newLanguage === 'python' && abilities.unsupported.newTokens === 0,
  `requested ${abilities.unsupported.requested}, tokens ${abilities.unsupported.newTokens}`);
check('the real component highlights python fine', abilities.unsupported.oldTokens > 0,
  `${abilities.unsupported.oldTokens}`);
await page.screenshot({ path: join(here, 'shot-code.png') });

/* ── 5. theme ─────────────────────────────────────────────────────────────── */
const theming = await page.evaluate(async () => {
  const api = window.__FP__;
  // setTheme() re-renders the whole page, so the code section has to be re-mounted with the
  // full source before the token spans exist again — a fresh mount starts with an empty
  // streaming buffer.
  const remount = () => {
    const c = api.codeScope.code;
    c.scenario = 'stream';
    c.sceneSel.value = 'stream';
    c.mountScenario();
    c.renderBoth(api.scenarios.stream.code, false);
  };
  const token = () => document.querySelector('.fp-side--new .beui-token');
  const grab = async (theme) => {
    api.setTheme(theme);
    await new Promise((r) => setTimeout(r, 120));
    remount();
    const t = token();
    return {
      page: getComputedStyle(document.documentElement).getPropertyValue('--color-page').trim(),
      light: t ? t.style.getPropertyValue('--agent-code-light') : null,
      dark: t ? t.style.getPropertyValue('--agent-code-dark') : null,
      applied: t ? getComputedStyle(t).color : null,
      tokens: document.querySelectorAll('.fp-side--new .beui-token').length,
    };
  };
  const dark = await grab('dark');
  const light = await grab('light');
  // The live tab's iframe must follow the theme too; check it while that tab is mounted.
  api.setSection('live');
  await new Promise((r) => setTimeout(r, 200));
  const frameTheme = new URL(document.querySelector('.fp-frame').src).searchParams.get('theme');
  api.setTheme('dark');
  api.setSection('code');
  await new Promise((r) => setTimeout(r, 150));
  return { dark, light, frameTheme };
});
check(
  'the demo follows the app theme (real tokens change)',
  theming.dark.page === '#1e1f1f' && theming.light.page === '#f2eee6',
  `${theming.dark.page} / ${theming.light.page}`
);
check(
  'beUI carries both theme colours on one span',
  theming.dark.tokens > 20 && Boolean(theming.dark.light && theming.dark.dark),
  `tokens=${theming.dark.tokens} ${JSON.stringify(theming.dark)}`
);
check(
  'the same span renders a different colour under the two themes',
  theming.dark.applied !== theming.light.applied,
  `${theming.dark.applied} vs ${theming.light.applied}`
);
check(
  'the live frame follows the same theme switch',
  theming.frameTheme === 'light',
  `theme param=${theming.frameTheme}`
);

/* ── 6. map + light screenshot ────────────────────────────────────────────── */
await page.evaluate(() => window.__FP__.setSection('map'));
await page.waitForTimeout(300);
const map = await page.evaluate(() => ({
  tables: document.querySelectorAll('.fp-card table.fp-map').length,
  rows: document.querySelectorAll('.fp-card table.fp-map tbody tr').length,
}));
check('the map lists both replacement surfaces', map.tables === 2 && map.rows >= 17,
  `tables=${map.tables} rows=${map.rows}`);
await page.screenshot({ path: join(here, 'shot-map.png') });

await page.evaluate(() => {
  window.__FP__.setSection('avatars');
  window.__FP__.setTheme('light');
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(here, 'shot-avatars-light.png') });

check('no console / page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('no failed requests', failedResponses.length === 0, failedResponses.slice(0, 3).join(' | '));

await browser.close();
await new Promise((r) => server.close(r));

console.log('');
if (failures.length) {
  console.log(`${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('all checks passed — screenshots written next to verify.mjs');
