// Analytics storage + reporting.
// Raw beacons:   an/<site>/raw/<YYYY-MM-DD>/<HH>/<ts>-<sid>-<rand>.json   (Malaysia time)
// Hour rollups:  an/<site>/roll/<YYYY-MM-DD>/<HH>.json   (built once the hour is over)
// Day rollups:   an/<site>/roll/<YYYY-MM-DD>/day.json    (built once the day is over)
// Rollups hold one compact summary per session, so any date range / filter is computed from them.
// Stored through _storage.js (own server: ./data files · Vercel: private Blob).
import { putJson, getJson, listKeys as listAll, storageMode } from './_storage.js';

const MY = 8 * 3600e3;
export const myDate = (ts) => new Date(ts + MY).toISOString().slice(0, 10);
export const myHour = (ts) => new Date(ts + MY).toISOString().slice(11, 13);
const rnd = () => Math.random().toString(36).slice(2, 8);

async function pool(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}

export async function saveRaw(rec) {
  const t = rec.at;
  await putJson(`an/${rec.site}/raw/${myDate(t)}/${myHour(t)}/${t}-${rec.sid}-${rnd()}.json`, rec);
}

// ---------- session summaries ----------
export const normPath = (p) => {
  p = String(p || '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  return p === '/index' ? '/' : p;
};
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const cap = (o, k, max) => k in o || Object.keys(o).length < max;

function blank(rec) {
  return { sid: rec.sid, vid: rec.vid, ts: rec.ts, cc: rec.cc || '', dev: rec.page.dev || '', ref: rec.page.ref || '', src: {}, entry: normPath(rec.page.path),
    pages: {}, n: {}, clk: {}, sec: {}, scr: {}, vid_: {}, fld: {}, fdone: {}, lastf: '', lastT: 0, pvEng: {}, dwPv: {} };
}

function apply(S, rec) {
  const s = S[rec.sid] || (S[rec.sid] = blank(rec));
  const path = normPath(rec.page.path);
  if (rec.ts < s.ts) { s.ts = rec.ts; s.entry = path; }
  if (!Object.keys(s.src).length && rec.page.src && Object.keys(rec.page.src).length) s.src = rec.page.src;
  if (!s.ref && rec.page.ref) s.ref = rec.page.ref;
  for (const e of rec.ev) {
    const at = rec.ts + e.t;
    if (cap(s.n, e.n, 40)) inc(s.n, e.n);
    switch (e.n) {
      case 'page_view': inc(s.pages, path); break;
      case 'click': { const k = [path, e.s || '', e.l || '', e.h || ''].join('|'); if (cap(s.clk, k, 80)) inc(s.clk, k); break; }
      case 'scroll': s.scr[path] = Math.max(s.scr[path] || 0, +e.d || 0); break;
      case 'section_view': { const k = path + '|' + (e.s || ''); if (cap(s.sec, k, 60)) s.sec[k] = 1; break; }
      case 'video': { const v = e.v || 'video', p = e.a === 'play' ? 1 : +e.a || 0; s.vid_[v] = Math.max(s.vid_[v] || 0, p); break; }
      case 'field_focus': { const k = (e.f || 'form') + '|' + (e.fld || ''); if (cap(s.fld, k, 40)) s.fld[k] = 1; if (at >= s.lastT) { s.lastT = at; s.lastf = k; } break; }
      case 'field_done': { const k = (e.f || 'form') + '|' + (e.fld || ''); if (cap(s.fdone, k, 40)) s.fdone[k] = 1; break; }
      case 'leave': {
        const pv = rec.pv || 'x';
        s.pvEng[pv] = Math.max(s.pvEng[pv] || 0, +e.e || 0);
        if (e.dw) for (const sec of Object.keys(e.dw)) { const k = pv + '|' + path + '|' + sec; if (cap(s.dwPv, k, 150)) s.dwPv[k] = Math.max(s.dwPv[k] || 0, +e.dw[sec] || 0); }
        break;
      }
    }
  }
}

function merge(a, b) {
  if (!a) return b;
  if (b.ts < a.ts) { a.ts = b.ts; a.entry = b.entry; }
  if (!Object.keys(a.src).length) a.src = b.src;
  a.ref = a.ref || b.ref; a.cc = a.cc || b.cc; a.dev = a.dev || b.dev;
  for (const f of ['pages', 'n', 'clk']) for (const k in b[f]) inc(a[f], k, b[f][k]);
  for (const f of ['sec', 'fld', 'fdone']) Object.assign(a[f], b[f]);
  for (const f of ['scr', 'vid_', 'pvEng', 'dwPv']) for (const k in b[f]) a[f][k] = Math.max(a[f][k] || 0, b[f][k]);
  if (b.lastT >= a.lastT) { a.lastT = b.lastT; a.lastf = b.lastf; }
  return a;
}
const mergeInto = (A, B) => { for (const sid in B) A[sid] = merge(A[sid], B[sid]); return A; };

async function buildFromRaw(prefix) {
  const blobs = await listAll(prefix);
  const recs = await pool(blobs, 25, (b) => getJson(b.pathname).catch(() => null));
  const S = {};
  recs.filter(Boolean).sort((x, y) => x.at - y.at).forEach((r) => apply(S, r));
  return S;
}

async function hourSessions(site, date, hour, closed) {
  const rollPath = `an/${site}/roll/${date}/${hour}.json`;
  if (closed) { const r = await getJson(rollPath).catch(() => null); if (r) return r; }
  const S = await buildFromRaw(`an/${site}/raw/${date}/${hour}/`);
  if (closed) await putJson(rollPath, S).catch((e) => console.error('roll save', e));
  return S;
}

export async function daySessions(site, date, now = Date.now()) {
  const today = myDate(now), curH = myHour(now);
  if (date > today) return {};
  const closedDay = date < today;
  const dayPath = `an/${site}/roll/${date}/day.json`;
  if (closedDay) { const r = await getJson(dayPath).catch(() => null); if (r) return r; }
  if (storageMode() === 'blob') {
    // Vercel Blob (Hobby has a low write cap): 1 listing per day, no hourly rollup files,
    // only a finished day is saved once as a rollup.
    const S = await buildFromRaw(`an/${site}/raw/${date}/`);
    if (closedDay) await putJson(dayPath, S).catch((e) => console.error('day roll save', e));
    return S;
  }
  const hours = [];
  for (let h = 0; h < 24; h++) { const hh = String(h).padStart(2, '0'); if (closedDay || hh <= curH) hours.push(hh); }
  const parts = await pool(hours, 6, (hh) => hourSessions(site, date, hh, closedDay || hh < curH));
  const S = parts.reduce(mergeInto, {});
  if (closedDay) await putJson(dayPath, S).catch((e) => console.error('day roll save', e));
  return S;
}

export async function rangeSessions(site, from, to) {
  const dates = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z') && dates.length < 92; t += 864e5) dates.push(new Date(t).toISOString().slice(0, 10));
  const parts = await pool(dates, 4, (d) => daySessions(site, d));
  return Object.values(parts.reduce(mergeInto, {}));
}

// ---------- report ----------
const SITE_CFG = {
  adtomatic: {
    goal: ['booking_submit'],
    goalLabel: '提交预约',
    funnel: [
      ['进入 Landing Page', (s) => '/' in s.pages],
      ['进入预约页', (s) => '/book' in s.pages],
      ['开始填表', (s) => s.n.form_start > 0],
      ['提交预约', (s) => s.n.booking_submit > 0],
      ['WhatsApp 确认', (s) => s.n.whatsapp_confirm > 0]
    ],
    mainPage: '/'
  },
  _default: {
    goal: ['booking_submit', 'lead_submit', 'form_submit', 'hs_form_submit'],
    goalLabel: '提交表单',
    funnel: [
      ['访问', () => true],
      ['有互动（点击 / 滚动过半）', (s) => s.n.click > 0 || Object.values(s.scr).some((v) => v >= 50)],
      ['开始填表', (s) => s.n.form_start > 0 || s.n.hs_form_ready > 0 && s.n.field_focus > 0],
      ['提交表单', (s) => s.n.form_submit > 0 || s.n.hs_form_submit > 0 || s.n.booking_submit > 0 || s.n.lead_submit > 0]
    ],
    mainPage: null
  }
};
const cfgFor = (site) => SITE_CFG[site] || SITE_CFG._default;
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : 0);

export function adKey(src) {
  if (!src || !src.source && !src.campaign && !src.ad_id) return null;
  return { campaign: src.campaign || src.campaign_id || '-', adset: src.term || src.adset_id || '-', ad: src.content || src.ad_id || '-', ad_id: src.ad_id || '', adset_id: src.adset_id || '', campaign_id: src.campaign_id || '' };
}
export function sourceLabel(s) {
  if (s.src.source) return s.src.source;
  if (s.src.fbclid) return 'meta (无 utm)';
  if (s.src.gclid) return 'google (无 utm)';
  if (/facebook|instagram|fb\./i.test(s.ref)) return 'facebook / ig';
  if (/google\./i.test(s.ref)) return 'google';
  return s.ref || '直接打开';
}

export function report(all, site, filt = {}) {
  const cfg = cfgFor(site);
  const isGoal = (s) => cfg.goal.some((g) => s.n[g] > 0);
  const options = { source: {}, campaign: {}, adset: {}, ad: {}, dev: {} };
  for (const s of all) {
    inc(options.source, sourceLabel(s)); inc(options.dev, s.dev || '-');
    const a = adKey(s.src); if (a) { inc(options.campaign, a.campaign); inc(options.adset, a.adset); inc(options.ad, a.ad); }
  }
  const S = all.filter((s) => {
    const a = adKey(s.src) || {};
    return (!filt.source || sourceLabel(s) === filt.source) && (!filt.campaign || a.campaign === filt.campaign) &&
      (!filt.adset || a.adset === filt.adset) && (!filt.ad || a.ad === filt.ad) && (!filt.dev || (s.dev || '-') === filt.dev);
  });
  const n = S.length;
  const eng = (s) => Object.values(s.pvEng).reduce((x, y) => x + y, 0);
  const pvs = (s) => Object.values(s.pages).reduce((x, y) => x + y, 0);
  const goals = S.filter(isGoal).length;
  const bounce = S.filter((s) => pvs(s) <= 1 && !s.n.click && !Object.values(s.scr).some((v) => v >= 50) && eng(s) < 10).length;
  const visitors = new Set(S.map((s) => s.vid)).size;

  // funnel
  const funnel = []; let prev = null;
  for (const [label, test] of cfg.funnel) {
    const c = S.filter(test).length;
    funnel.push({ label, sessions: c, of_first: pct(c, funnel.length ? funnel[0].sessions : c), of_prev: prev === null ? 100 : pct(c, prev) });
    prev = c;
  }

  // daily
  const daily = {};
  for (const s of S) { const d = myDate(s.ts); daily[d] = daily[d] || { date: d, sessions: 0, goals: 0 }; daily[d].sessions++; if (isGoal(s)) daily[d].goals++; }

  // groupings with conversion
  const group = (keyFn) => {
    const g = {};
    for (const s of S) {
      const k = keyFn(s); if (k == null) continue;
      const r = g[k] || (g[k] = { key: k, sessions: 0, form_start: 0, goals: 0, eng: 0 });
      r.sessions++; if (s.n.form_start) r.form_start++; if (isGoal(s)) r.goals++; r.eng += eng(s);
    }
    return Object.values(g).map((r) => ({ ...r, cvr: pct(r.goals, r.sessions), avg_eng: Math.round(r.eng / r.sessions) }))
      .sort((a, b) => b.sessions - a.sessions).slice(0, 50);
  };
  const ads = {};
  for (const s of S) {
    const a = adKey(s.src); if (!a) continue;
    const k = [a.campaign, a.adset, a.ad].join(' › ');
    const r = ads[k] || (ads[k] = { campaign: a.campaign, adset: a.adset, ad: a.ad, ad_id: a.ad_id, sessions: 0, vsl: 0, form_start: 0, goals: 0 });
    r.sessions++; if (Object.values(s.vid_).some((v) => v >= 1)) r.vsl++; if (s.n.form_start) r.form_start++; if (isGoal(s)) r.goals++;
  }

  // clicks
  const clicks = {};
  for (const s of S) for (const k in s.clk) {
    const r = clicks[k] || (clicks[k] = { page: k.split('|')[0], section: k.split('|')[1], label: k.split('|')[2], to: k.split('|')[3], clicks: 0, sessions: 0 });
    r.clicks += s.clk[k]; r.sessions++;
  }
  const pageSessions = {};
  for (const s of S) for (const p in s.pages) inc(pageSessions, p);

  // sections: reach + time
  const sections = {};
  for (const s of S) {
    for (const k in s.sec) { const [page, section] = k.split('|'); const r = sections[k] || (sections[k] = { page, section, sessions: 0, secs: 0, timed: 0 }); r.sessions++; }
    const dw = {};
    for (const k in s.dwPv) { const parts = k.split('|'); const kk = parts[1] + '|' + parts.slice(2).join('|'); dw[kk] = (dw[kk] || 0) + s.dwPv[k]; }
    for (const kk in dw) { const r = sections[kk]; if (r) { r.secs += dw[kk]; r.timed++; } }
  }

  // scroll on main page
  const main = cfg.mainPage || Object.entries(pageSessions).sort((a, b) => b[1] - a[1])[0]?.[0] || '/';
  const onMain = S.filter((s) => main in s.pages);
  const scroll = [25, 50, 75, 90, 100].map((d) => ({ depth: d, sessions: onMain.filter((s) => (s.scr[main] || 0) >= d).length, pct: pct(onMain.filter((s) => (s.scr[main] || 0) >= d).length, onMain.length) }));

  // videos
  const videos = {};
  for (const s of S) for (const v in s.vid_) {
    const r = videos[v] || (videos[v] = { video: v, play: 0, p25: 0, p50: 0, p75: 0, p100: 0 });
    const m = s.vid_[v]; r.play++; if (m >= 25) r.p25++; if (m >= 50) r.p50++; if (m >= 75) r.p75++; if (m >= 100) r.p100++;
  }

  // form fields
  const fields = {};
  for (const s of S) {
    for (const k in s.fld) { const r = fields[k] || (fields[k] = { field: k, focus: 0, done: 0, last_drop: 0 }); r.focus++; }
    for (const k in s.fdone) { const r = fields[k] || (fields[k] = { field: k, focus: 0, done: 0, last_drop: 0 }); r.done++; }
    if (s.lastf && !isGoal(s) && fields[s.lastf]) fields[s.lastf].last_drop++;
  }

  const custom = {};
  for (const s of S) for (const k in s.n) if (!['page_view', 'click', 'scroll', 'section_view', 'video', 'field_focus', 'field_done', 'leave'].includes(k)) inc(custom, k, 1);

  return {
    site, goal_label: cfg.goalLabel, main_page: main,
    totals: { sessions: n, visitors, pageviews: S.reduce((x, s) => x + pvs(s), 0), goals, cvr: pct(goals, n), avg_eng: n ? Math.round(S.reduce((x, s) => x + eng(s), 0) / n) : 0, bounce: pct(bounce, n) },
    funnel,
    daily: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)),
    ads: Object.values(ads).map((r) => ({ ...r, cvr: pct(r.goals, r.sessions) })).sort((a, b) => b.sessions - a.sessions).slice(0, 60),
    by_source: group(sourceLabel),
    by_campaign: group((s) => adKey(s.src)?.campaign ?? null),
    by_adset: group((s) => adKey(s.src)?.adset ?? null),
    by_device: group((s) => s.dev || '-'),
    by_country: group((s) => s.cc || '-').slice(0, 10),
    by_entry: group((s) => s.entry),
    pages: Object.entries(pageSessions).map(([path, sessions]) => ({ path, sessions, pct: pct(sessions, n) })).sort((a, b) => b.sessions - a.sessions).slice(0, 30),
    clicks: Object.values(clicks).map((r) => ({ ...r, pct: pct(r.sessions, pageSessions[r.page] || n) })).sort((a, b) => b.sessions - a.sessions).slice(0, 40),
    sections: Object.values(sections).map((r) => ({ page: r.page, section: r.section, sessions: r.sessions, pct: pct(r.sessions, pageSessions[r.page] || n), avg_secs: r.timed ? Math.round(r.secs / r.timed) : 0 })).sort((a, b) => a.page.localeCompare(b.page) || b.sessions - a.sessions).slice(0, 60),
    scroll, videos: Object.values(videos),
    fields: Object.values(fields).sort((a, b) => b.focus - a.focus).slice(0, 30),
    events: Object.entries(custom).map(([name, sessions]) => ({ name, sessions })).sort((a, b) => b.sessions - a.sessions),
    options: Object.fromEntries(Object.entries(options).map(([k, v]) => [k, Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 60).map((x) => x[0])]))
  };
}

// ---------- raw export (for offline analysis) ----------
const CSV = (rows) => '﻿' + rows.map((r) => r.map((v) => {
  v = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(v)) v = "'" + v;                         // spreadsheet formula injection guard
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}).join(',')).join('\n');

function datesBetween(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z') && out.length < 92; t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
const myIso = (ts) => new Date(ts + MY).toISOString().replace('T', ' ').slice(0, 19);

// Every single event, one row each — the rawest data we keep
export async function exportEvents(site, from, to) {
  const head = ['time_my', 'session_id', 'visitor_id', 'pageview_id', 'page', 'event', 'ms_on_page', 'label', 'section', 'link_to', 'y_pct',
    'scroll_pct', 'video', 'video_progress', 'form', 'field', 'engaged_s', 'max_scroll', 'section_dwell_json', 'props_json',
    'source', 'medium', 'campaign', 'adset', 'ad', 'campaign_id', 'adset_id', 'ad_id', 'placement', 'fbclid', 'referrer', 'device', 'screen_w', 'country'];
  const rows = [head];
  for (const d of datesBetween(from, to)) {
    const blobs = await listAll(`an/${site}/raw/${d}/`);
    const recs = (await pool(blobs, 25, (b) => getJson(b.pathname).catch(() => null))).filter(Boolean).sort((a, b) => a.at - b.at);
    for (const r of recs) {
      const s = r.page.src || {};
      for (const e of r.ev) {
        const props = {}; for (const k in e) if (k.startsWith('p_')) props[k.slice(2)] = e[k];
        rows.push([myIso(r.ts + e.t), r.sid, r.vid, r.pv, normPath(r.page.path), e.n, Math.round(e.t), e.l, e.s, e.h, e.y,
          e.n === 'scroll' ? e.d : '', e.v, e.a, e.f, e.fld, e.e, e.mx, e.dw ? JSON.stringify(e.dw) : '', Object.keys(props).length ? JSON.stringify(props) : '',
          s.source, s.medium, s.campaign, s.term, s.content, s.campaign_id, s.adset_id, s.ad_id, s.placement, s.fbclid ? 1 : '', r.page.ref, r.page.dev, r.page.w, r.cc]);
      }
    }
  }
  return CSV(rows);
}

// One row per session — easiest table for analysis (conversion vs. behaviour)
export function exportSessions(all, site) {
  const cfg = cfgFor(site);
  const isGoal = (s) => cfg.goal.some((g) => s.n[g] > 0);
  const head = ['session_id', 'visitor_id', 'start_my', 'date', 'hour', 'weekday', 'entry_page', 'pages', 'pageviews', 'engaged_s',
    'max_scroll_main', 'clicks', 'sections_seen', 'video_max_pct', 'form_started', 'fields_touched', 'fields_filled', 'last_field',
    'converted', 'whatsapp_confirm', 'calendar_add', 'events_json',
    'source', 'medium', 'campaign', 'adset', 'ad', 'campaign_id', 'adset_id', 'ad_id', 'placement', 'fbclid', 'referrer', 'device', 'country'];
  const rows = [head];
  const main = cfg.mainPage || '/';
  for (const s of all.sort((a, b) => a.ts - b.ts)) {
    const src = s.src || {}, t = new Date(s.ts + MY);
    rows.push([s.sid, s.vid, myIso(s.ts), myDate(s.ts), t.getUTCHours(), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()], s.entry,
      Object.keys(s.pages).join(' > '), Object.values(s.pages).reduce((x, y) => x + y, 0), Object.values(s.pvEng).reduce((x, y) => x + y, 0),
      s.scr[main] || 0, s.n.click || 0, Object.keys(s.sec).length, Math.max(0, ...Object.values(s.vid_)), s.n.form_start ? 1 : 0,
      Object.keys(s.fld).length, Object.keys(s.fdone).length, s.lastf, isGoal(s) ? 1 : 0, s.n.whatsapp_confirm ? 1 : 0, s.n.calendar_add ? 1 : 0, JSON.stringify(s.n),
      src.source, src.medium, src.campaign, src.term, src.content, src.campaign_id, src.adset_id, src.ad_id, src.placement, src.fbclid ? 1 : '', s.ref, s.dev, s.cc]);
  }
  return CSV(rows);
}
