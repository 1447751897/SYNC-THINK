#!/usr/bin/env node
/**
 * 每日抖音 × QQ音乐 爆款采集器
 *
 * 用法：
 *   node notes/hot-content/_tools/daily-hot.js [YYYY-MM-DD]
 *
 * 产出（默认写入 notes/hot-content/）：
 *   <date>.json  —— 原始结构化数据（抖音热榜/音乐榜 + QQ音乐四榜）
 *   <date>.md    —— Markdown 日报（数据部分自动生成，分析部分取自 <date>.analysis.json）
 *   <date>.html  —— 单文件深色看板（数据内联，可离线打开）
 *
 * 可选分析文件：notes/hot-content/<date>.analysis.json
 *   {
 *     "cross":  [{ "badge": "最强共振", "title": "...", "text": "...", "chips": ["..."] }],
 *     "advice": [{ "title": "...", "text": "..." }],
 *     "notes":  ["报告顶部的补充说明"]
 *   }
 *   存在时会被写入 md / html；不存在时看板显示自动匹配结果与占位提示。
 *
 * 环境变量 HOT_OUT_DIR 可覆盖输出目录（用于测试）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = process.env.HOT_OUT_DIR ? path.resolve(process.env.HOT_OUT_DIR) : path.join(ROOT, 'notes', 'hot-content');

const QQ_CHARTS = [
  { id: 4, name: '飙升榜' },
  { id: 26, name: '热歌榜' },
  { id: 27, name: '新歌榜' },
  { id: 62, name: '流行指数榜' },
];

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const log = (...a) => console.log(...a);
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const shiftDate = (iso, days) => {
  const d = new Date(iso + 'T12:00:00+08:00');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const stamp = () =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());

async function get(url, headers = {}, timeoutMs = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

/* ---------- 抖音：当日归档解析 ---------- */
async function fetchDouyin(date) {
  const status = { source: 'douyin-hot-hub 当日归档', ok: false, usedDate: date, updated: '', note: '' };
  let md = null;
  for (const d of [date, shiftDate(date, -1)]) {
    try {
      md = await get(`https://raw.githubusercontent.com/SnailDev/douyin-hot-hub/master/archives/${d}.md`);
      status.ok = true;
      status.usedDate = d;
      if (d !== date) status.note = `当日归档尚未生成，已回退到 ${d}`;
      break;
    } catch (e) {
      status.note = `archives/${d}.md 未取到（${e.message}）`;
    }
  }
  if (!md) return { status, sections: [] };

  const lines = md.split(/\r?\n/);
  const upd = lines.find((l) => l.includes('最后更新时间'));
  status.updated = upd ? upd.replace(/[`#]/g, '').trim() : '未知';

  const order = [];
  const map = new Map();
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      cur = h[1];
      if (!map.has(cur)) { map.set(cur, []); order.push(cur); }
      continue;
    }
    if (!cur) continue;
    const it = line.match(/^\d+\.\s+\[(.+?)\]\((.+?)\)(?:\s*-\s*(.+?))?\s*$/);
    if (!it) continue;
    const arr = map.get(cur);
    arr.push({ rank: arr.length + 1, title: it[1], url: it[2], artist: it[3] || null });
  }
  const sections = order.map((name) => ({ name, count: map.get(name).length, items: map.get(name) }));
  return { status, sections };
}

/* ---------- QQ音乐：四榜 ---------- */
async function fetchQQ() {
  const out = [];
  for (const c of QQ_CHARTS) {
    const url =
      `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=${c.id}&format=json&page=detail` +
      `&tpl=3&type=top&song_begin=0&song_num=20&platform=yqq&needNewCode=1`;
    try {
      const j = JSON.parse(await get(url, { Referer: 'https://y.qq.com/' }));
      const songs = (j.songlist || []).map((s, i) => ({
        rank: i + 1,
        song: s.data.songname,
        singer: (s.data.singer || []).map((x) => x.name).join('/'),
        album: s.data.albumname,
        seconds: s.data.interval,
      }));
      out.push({ id: c.id, name: c.name, ok: true, date: j.date, songs, note: '' });
    } catch (e) {
      out.push({ id: c.id, name: c.name, ok: false, date: '', songs: [], note: `未取到（${e.message}）` });
    }
  }
  return out;
}

/* ---------- 跨平台匹配 ---------- */
const base = (s) =>
  String(s || '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[（(【\[].*$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();

/** 把「h3R3刘清云」「李佳薇/张新成」这类串切成可比对的原子 token */
function tokens(s, min = 3) {
  return (
    String(s || '')
      .split(/[\/&、,，]|\s+/)
      .flatMap((x) => x.match(/[a-z0-9]+|[\u4e00-\u9fa5]+/gi) || [])
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= min)
  );
}

function crossMatch(dyMusic, qq) {
  const sameSong = [];
  const sameArtist = [];
  for (const g of qq) {
    for (const s of g.songs) {
      const bq = base(s.song);
      for (const d of dyMusic) {
        const bd = base(d.title);
        const hit = bq.length >= 2 && (bq === bd || (bq.length >= 4 && (bd.includes(bq) || bq.includes(bd))));
        if (hit) {
          sameSong.push({ qq: `${s.song} — ${s.singer}`, chart: g.name, qqRank: s.rank, dy: d.title, dyRank: d.rank, artist: d.artist });
        }
      }
      const singerTokens = tokens(s.singer);
      if (!singerTokens.length) continue;
      for (const d of dyMusic) {
        const artistTokens = tokens(d.artist);
        const titleTokens = tokens(d.title).filter((t) => !['cover', 'remix'].includes(t));
        const viaArtist = artistTokens.filter((t) => singerTokens.includes(t));
        const viaTitle = titleTokens.filter((t) => singerTokens.includes(t));
        const hit = viaArtist[0] || viaTitle[0];
        if (hit) {
          const shown = String(s.singer).match(new RegExp(hit, 'i'));
          sameArtist.push({
            artist: shown ? shown[0] : hit,
            qq: `${s.song} — ${s.singer}`,
            chart: g.name,
            qqRank: s.rank,
            dy: d.title,
            dyRank: d.rank,
            via: viaArtist.length ? '同一艺人' : '二创提及',
          });
        }
      }
    }
  }
  const uniq = (arr) => {
    const seen = new Set();
    return arr.filter((x) => {
      const k = JSON.stringify(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return { sameSong: uniq(sameSong), sameArtist: uniq(sameArtist) };
}

/* ---------- 渲染 ---------- */
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const secOf = (data, kw) => (data.sections || []).find((s) => s.name.includes(kw)) || { items: [], count: 0 };

function renderMd(data, analysis) {
  const hot = secOf(data, '热榜').items;
  const music = secOf(data, '音乐榜').items;
  const dyCount = (data.sections || []).map((s) => `${s.name} ${s.count} 条`).join('、');
  const L = [];
  L.push(`# 抖音 × QQ音乐 爆款日报 · ${data.date}`, '');
  L.push(`> 抓取时间：${data.capturedAt}（Asia/Shanghai）`);
  L.push(`> 数据脚本：\`notes/hot-content/_tools/daily-hot.js\` ｜ 原始数据：[${data.date}.json](${data.date}.json)`);
  L.push(`> 看板：[${data.date}.html](${data.date}.html)`, '');
  L.push('## 一、数据来源与状态', '');
  L.push('| 数据源 | 状态 | 说明 |', '| --- | --- | --- |');
  L.push(`| 抖音归档（热榜/音乐榜等） | ${data.douyin.ok ? '✅ 已取到' : '❌ 未取到'} | 使用日期 ${data.douyin.usedDate}；源站标注「${data.douyin.updated}」；本次解析：${dyCount}${data.douyin.note ? '；' + data.douyin.note : ''} |`);
  for (const g of data.qq) {
    L.push(`| QQ音乐 ${g.name} | ${g.ok ? '✅ 已取到' : '❌ 未取到'} | ${g.ok ? `榜单日期 ${g.date}，前 ${g.songs.length} 首` : g.note} |`);
  }
  L.push('', '> 热度值说明：抖音官方不公开热度数值，归档源仅提供名次；本报告以名次作为热度代理指标，缺失时记「—」。', '');
  if (analysis.notes?.length) {
    L.push('**补充说明**');
    analysis.notes.forEach((n) => L.push(`- ${n}`));
    L.push('');
  }
  L.push('## 二、抖音爆款视频 Top 10', '');
  L.push('| 排名 | 话题 | 类别 / 跟拍点 | 链接 |', '| --- | --- | --- | --- |');
  hot.slice(0, 10).forEach((it) =>
    L.push(`| ${it.rank} | ${it.title} | ${(analysis.hotTags || {})[it.rank] || '—'} | [打开](${it.url}) |`)
  );
  L.push('', `> 当日热榜共 ${hot.length} 条，完整榜单见 HTML 看板。`, '');
  L.push(`## 三、抖音音乐榜（爆款 BGM）Top ${Math.min(20, music.length)}`, '');
  L.push('| 排名 | 歌曲 | 创作者 / 演唱 |', '| --- | --- | --- |');
  music.slice(0, 20).forEach((it) => L.push(`| ${it.rank} | ${it.title} | ${it.artist || '—'} |`));
  L.push('', `> 当日音乐榜共 ${music.length} 首，完整榜单见 HTML 看板。`, '');
  L.push('## 四、QQ音乐四榜', '');
  for (const g of data.qq) {
    L.push(`### 4.${data.qq.indexOf(g) + 1} ${g.name}${g.ok ? `（榜单日期 ${g.date}）` : ''}`, '');
    if (!g.ok) { L.push(`> ${g.note}`, ''); continue; }
    L.push('| # | 歌曲 | 歌手 |', '| --- | --- | --- |');
    g.songs.forEach((s) => L.push(`| ${s.rank} | ${s.song} | ${s.singer} |`));
    L.push('');
  }
  L.push('## 五、双平台交叉爆款', '');
  if (analysis.cross?.length) {
    analysis.cross.forEach((c, i) => {
      L.push(`${i + 1}. **${c.title}${c.badge ? `（${c.badge}）` : ''}** — ${c.text}`);
    });
  } else {
    L.push('_（等待分析文件写入）_');
  }
  const ms = data.match;
  L.push('', '### 自动匹配结果（脚本计算）', '');
  if (ms.sameSong.length) {
    L.push('**同名歌曲**', '');
    ms.sameSong.forEach((m) => L.push(`- ${m.qq}（${m.chart} #${m.qqRank}） ↔ 抖音音乐榜 #${m.dyRank}《${m.dy}》`));
  } else {
    L.push('- 同名歌曲：今日两平台 Top 榜无完全同名同曲交叉。');
  }
  if (ms.sameArtist.length) {
    L.push('', '**同艺人 / 二创提及（跨平台）**', '');
    const groups = new Map();
    ms.sameArtist.forEach((m) => {
      const key = `${m.artist}|${m.dyRank}`;
      if (!groups.has(key)) groups.set(key, { artist: m.artist, dy: m.dy, dyRank: m.dyRank, hits: [] });
      groups.get(key).hits.push(`${m.qq}（${m.chart} #${m.qqRank}）`);
    });
    groups.forEach((v) => L.push(`- ${v.artist}：${v.hits.join('、')} ↔ 抖音音乐榜 #${v.dyRank}《${v.dy}》`));
  }
  L.push('');
  L.push('## 六、今日选题 / 选曲建议', '');
  if (analysis.advice?.length) {
    analysis.advice.forEach((a) => L.push(`- **${a.title}** — ${a.text}`));
  } else {
    L.push('_（等待分析文件写入）_');
  }
  L.push('');
  return L.join('\n');
}

function renderHtml(data, analysis) {
  const hot = secOf(data, '热榜').items;
  const music = secOf(data, '音乐榜').items;
  const qqTotal = data.qq.reduce((n, g) => n + g.songs.length, 0);
  const crossCards = (analysis.cross || [])
    .map(
      (c) => `<article class="cross"><header><span class="badge">${esc(c.badge || '交叉')}</span><h4>${esc(c.title)}</h4></header>
    <p>${esc(c.text)}</p><div class="chips">${(c.chips || []).map((x) => `<span>${esc(x)}</span>`).join('')}</div></article>`
    )
    .join('');
  const hotRows = hot
    .slice(0, 20)
    .map((it) => {
      const pct = Math.max(12, Math.round((100 * (1 - (it.rank - 1) / Math.max(hot.length, 1)))));
      const tag = (analysis.hotTags || {})[it.rank];
      return `<div class="row"><div class="rank r${it.rank <= 3 ? it.rank : ''}">${it.rank}</div>
    <div class="body"><div class="title"><a href="${esc(it.url)}" target="_blank" rel="noreferrer">${esc(it.title)}</a></div>
    <div class="bar"><i style="width:${pct}%"></i></div></div>${tag ? `<div class="tag">${esc(tag)}</div>` : ''}</div>`;
    })
    .join('');
  const musicRows = music
    .map((it) => `<li><span class="num">${it.rank}</span><span class="song">${esc(it.title)}</span><span class="artist">${esc(it.artist || '—')}</span></li>`)
    .join('');
  const qqCols = data.qq
    .map((g) => {
      if (!g.ok) return `<section class="chart"><h3>${esc(g.name)}</h3><p class="dim">${esc(g.note)}</p></section>`;
      const rows = g.songs
        .map((s) => `<li><span class="num">${s.rank}</span><span class="song">${esc(s.song)}</span><span class="artist">${esc(s.singer)}</span></li>`)
        .join('');
      return `<section class="chart"><h3>${esc(g.name)} <em>Top ${g.songs.length} · ${esc(g.date)}</em></h3><ol class="songs">${rows}</ol></section>`;
    })
    .join('');
  const advice = (analysis.advice || [])
    .map((a) => `<article><h5>${esc(a.title)}</h5><p>${esc(a.text)}</p></article>`)
    .join('');
  const ms = data.match;
  const matchBlock = `
    <div class="note"><b>脚本自动匹配</b>：同名歌曲 ${ms.sameSong.length} 组${ms.sameSong.length ? '（' + ms.sameSong.map((m) => esc(m.qq)).join('；') + '）' : '（今日无完全同名同曲交叉）'}；同艺人跨平台 ${ms.sameArtist.length} 组${ms.sameArtist.length ? '（' + [...new Set(ms.sameArtist.map((m) => esc(m.artist)))].slice(0, 6).join('、') + '）' : ''}。</div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>抖音 × QQ音乐 爆款日报 · ${data.date}</title>
<style>
  :root{--bg:#0b0e14;--panel:#151a23;--panel2:#1b2230;--line:#252d3b;--txt:#e8edf5;--dim:#8b97a8;--dy:#ff2d55;--qq:#31c27c;--gold:#ffb020}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 15% -10%,#1b2233 0%,var(--bg) 60%);color:var(--txt);font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif}
  .wrap{max-width:1240px;margin:0 auto;padding:34px 22px 70px}
  header.top{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:20px}
  h1{margin:0;font-size:27px;letter-spacing:.5px}
  h1 span.dy{color:var(--dy)} h1 span.qq{color:var(--qq)}
  .meta{color:var(--dim);font-size:12.5px;text-align:right}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:22px 0}
  .kpi{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  .kpi b{display:block;font-size:24px;color:#fff} .kpi small{color:var(--dim)}
  h2{font-size:18px;margin:34px 0 14px;padding-left:11px;border-left:4px solid var(--dy)}
  h2.qqb{border-color:var(--qq)}
  .note{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:10px;padding:11px 14px;color:#c8d2e0;font-size:12.8px;margin-bottom:14px}
  .dim{color:var(--dim)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
  .cross{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:14px;padding:16px}
  .cross header{display:flex;align-items:center;gap:9px}
  .cross h4{margin:0;font-size:15px}
  .badge{background:rgba(255,45,85,.15);color:#ff7d97;border:1px solid rgba(255,45,85,.35);border-radius:999px;font-size:11px;padding:2px 9px;white-space:nowrap}
  .cross p{color:#b9c4d4;font-size:12.8px;margin:9px 0}
  .chips{display:flex;flex-wrap:wrap;gap:6px}.chips span{background:#0f141c;border:1px solid var(--line);border-radius:8px;padding:3px 9px;font-size:11.5px;color:#9fb0c6}
  .list{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:8px}
  .row{display:grid;grid-template-columns:38px 1fr auto;gap:12px;align-items:center;padding:9px 10px;border-radius:10px}
  .row:hover{background:#1a2130}
  .tag{color:#8b97a8;font-size:11.5px;border:1px solid var(--line);border-radius:8px;padding:2px 8px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
  .rank{font-weight:700;color:#6f7d92;text-align:center;font-size:15px}
  .rank.r1{color:#ff4d6d}.rank.r2{color:#ffa62b}.rank.r3{color:#ffd93d}
  .title a{color:var(--txt);text-decoration:none;font-size:14px}.title a:hover{color:#7fb2ff;text-decoration:underline}
  .bar{height:4px;background:#0e131b;border-radius:3px;margin-top:6px;overflow:hidden}
  .bar i{display:block;height:100%;background:linear-gradient(90deg,var(--dy),#ff7d97)}
  ol.songs{list-style:none;margin:0;padding:0}
  ol.songs li{display:grid;grid-template-columns:30px 1fr auto;gap:10px;padding:6px 6px;border-bottom:1px dashed #1e2634;font-size:12.8px}
  ol.songs li:last-child{border-bottom:none}
  .num{color:#6f7d92;text-align:right}.song{color:#e3e9f2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .artist{color:#8b97a8;font-size:11.8px;white-space:nowrap}
  .musicgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:8px 20px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px}
  .charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px}
  .chart{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 14px 8px}
  .chart h3{margin:0 0 8px;font-size:14.5px;color:#dfe7f2}.chart h3 em{color:var(--qq);font-style:normal;font-size:11.5px;margin-left:6px}
  .advice{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
  .advice article{background:linear-gradient(180deg,#182030,var(--panel));border:1px solid var(--line);border-radius:14px;padding:16px}
  .advice h5{margin:0 0 8px;font-size:14.5px;color:#9fe3c0}.advice p{margin:0;color:#b9c4d4;font-size:12.8px}
  footer{margin-top:38px;padding-top:16px;border-top:1px solid var(--line);color:#6f7d92;font-size:12px}
</style></head><body><div class="wrap">
<header class="top">
  <div><h1><span class="dy">抖音</span> × <span class="qq">QQ音乐</span> 爆款日报</h1>
    <div style="color:#8b97a8;font-size:13px;margin-top:6px">${data.date} · 每日 20:00 自动更新</div></div>
  <div class="meta">抓取时间 ${esc(data.capturedAt)} (Asia/Shanghai)<br/>抖音归档：${esc(data.douyin.updated)}<br/>QQ音乐榜单日期 ${esc(data.qq.find((g) => g.ok)?.date || '未取到')}</div>
</header>
<div class="kpis">
  <div class="kpi"><b>${hot.length}</b><small>抖音热榜条目</small></div>
  <div class="kpi"><b>${music.length}</b><small>抖音音乐榜 BGM</small></div>
  <div class="kpi"><b>${qqTotal}</b><small>QQ音乐四榜歌曲</small></div>
  <div class="kpi"><b>${(analysis.cross || []).length || ms.sameSong.length + ms.sameArtist.length}</b><small>双平台交叉线索</small></div>
</div>
${matchBlock}
<h2>一、双平台交叉爆款</h2>
<div class="cards">${crossCards || '<div class="note">（等待分析文件写入）</div>'}</div>
<h2>二、抖音爆款视频 Top 20</h2>
<div class="list">${hotRows || '<div class="note">未取到抖音热榜数据</div>'}</div>
<h2>三、抖音音乐榜（爆款 BGM）· 全 ${music.length} 首</h2>
<div class="musicgrid"><ol class="songs">${musicRows}</ol></div>
<h2 class="qqb">四、QQ音乐四榜</h2>
<div class="charts">${qqCols}</div>
<h2>五、今日选题 / 选曲建议</h2>
<div class="advice">${advice || '<div class="note">（等待分析文件写入）</div>'}</div>
<footer>数据来源：douyin-hot-hub 当日归档（抖音热榜 / 音乐榜）、QQ音乐榜单接口（飙升榜 4 / 热歌榜 26 / 新歌榜 27 / 流行指数榜 62）。单文件看板，数据已内联，可离线打开。生成脚本 notes/hot-content/_tools/daily-hot.js。</footer>
</div></body></html>`;
}

/* ---------- 主流程 ---------- */
(async () => {
  const date = process.argv[2] || today();
  fs.mkdirSync(OUT, { recursive: true });
  log(`[daily-hot] date=${date} out=${OUT}`);

  const [dy, qq] = await Promise.all([fetchDouyin(date), fetchQQ()]);
  const hot = secOf({ sections: dy.sections }, '热榜');
  const music = secOf({ sections: dy.sections }, '音乐榜');
  log(`[daily-hot] douyin: ${dy.status.ok ? 'ok' : 'FAIL'} updated="${dy.status.updated}" hot=${hot.items.length} music=${music.items.length}`);
  qq.forEach((g) => log(`[daily-hot] qq ${g.id} ${g.name}: ${g.ok ? g.songs.length + ' songs @' + g.date : 'FAIL ' + g.note}`));

  const data = {
    date,
    capturedAt: stamp(),
    douyin: dy.status,
    sections: dy.sections,
    qq,
  };
  data.match = crossMatch(music.items, qq.filter((g) => g.ok));

  const analysisPath = path.join(OUT, `${date}.analysis.json`);
  let analysis = { cross: [], advice: [], notes: [] };
  if (fs.existsSync(analysisPath)) {
    try {
      analysis = { ...analysis, ...JSON.parse(fs.readFileSync(analysisPath, 'utf8')) };
      log('[daily-hot] analysis loaded');
    } catch (e) {
      log('[daily-hot] analysis parse failed:', e.message);
    }
  } else {
    log(`[daily-hot] no analysis file (${path.basename(analysisPath)}) - skeleton only`);
  }

  fs.writeFileSync(path.join(OUT, `${date}.json`), JSON.stringify(data, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, `${date}.md`), renderMd(data, analysis), 'utf8');
  fs.writeFileSync(path.join(OUT, `${date}.html`), renderHtml(data, analysis), 'utf8');
  log(`[daily-hot] wrote ${date}.json / ${date}.md / ${date}.html`);
  log(`[daily-hot] auto-match: sameSong=${data.match.sameSong.length} sameArtist=${data.match.sameArtist.length}`);
})().catch((e) => {
  console.error('[daily-hot] fatal:', e);
  process.exit(1);
});
