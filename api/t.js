// Analytics collector for js/t.js (our pages + client pages, e.g. HubSpot).
// Stores each beacon through _storage.js (own server: files in ./data · Vercel: private Blob).
// On by default. ANALYTICS_ENABLED=0 turns it off. Vercel Hobby caps Blob writes (2,000 / month);
// going over locks the store for 30 days — CRM included — until you upgrade to Pro.
// Optional ANALYTICS_SITES="adtomatic,client-a" = only accept these site ids.
import { saveRaw } from './_an.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store'
};
const ok = () => new Response(null, { status: 204, headers: CORS });
const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' && isFinite(v) ? v : undefined);

function cleanEvent(e) {
  if (!e || typeof e !== 'object' || typeof e.n !== 'string') return null;
  const out = { n: e.n.slice(0, 40), t: Math.round(Math.max(0, Math.min(+e.t || 0, 864e5))) };
  for (const k of Object.keys(e).slice(0, 16)) {
    if (k === 'n' || k === 't') continue;
    const v = e[k];
    if (k === 'dw' && v && typeof v === 'object') {                     // section dwell seconds
      out.dw = {};
      for (const sk of Object.keys(v).slice(0, 40)) out.dw[sk.slice(0, 40)] = Math.min(+v[sk] || 0, 3600);
    } else if (/^[a-z_]{1,24}$/i.test(k)) {
      const c = s(v, 120); if (c !== undefined) out[k] = c;
    }
  }
  return out;
}

export function OPTIONS() { return ok(); }

export async function POST(request) {
  if (process.env.ANALYTICS_ENABLED === '0') return ok();
  const ua = request.headers.get('user-agent') || '';
  if (/bot|crawl|spider|facebookexternalhit|headless|lighthouse/i.test(ua)) return ok();
  const raw = await request.text();
  if (raw.length > 64000) return new Response('too big', { status: 413, headers: CORS });
  let b; try { b = JSON.parse(raw); } catch { return new Response('bad', { status: 400, headers: CORS }); }

  const site = String(b.site || '');
  if (!/^[a-z0-9-]{2,40}$/.test(site)) return new Response('bad site', { status: 400, headers: CORS });
  const allow = (process.env.ANALYTICS_SITES || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (allow.length && !allow.includes(site)) return ok();
  if (!/^[a-z0-9]{6,16}$/.test(String(b.sid || '')) || !/^[a-z0-9]{6,16}$/.test(String(b.vid || ''))) return new Response('bad id', { status: 400, headers: CORS });

  const p = b.page || {};
  const src = {};
  if (p.src && typeof p.src === 'object') for (const k of ['source', 'medium', 'campaign', 'content', 'term', 'campaign_id', 'adset_id', 'ad_id', 'placement', 'site_source', 'fbclid', 'gclid']) {
    if (p.src[k] !== undefined) src[k] = s(String(p.src[k]), 120);
  }
  const rec = {
    site, sid: b.sid, vid: b.vid, pv: s(String(b.pv || ''), 16),
    ts: Number.isFinite(+b.ts) ? +b.ts : Date.now(), at: Date.now(),
    cc: request.headers.get('x-vercel-ip-country') || '',
    page: { path: s(String(p.path || '/'), 120), title: s(String(p.title || ''), 120), ref: s(String(p.ref || ''), 80), dev: s(String(p.dev || ''), 10), w: +p.w || 0, src },
    ev: (Array.isArray(b.ev) ? b.ev : []).slice(0, 200).map(cleanEvent).filter(Boolean)
  };
  if (!rec.ev.length) return ok();
  try { await saveRaw(rec); } catch (err) { console.error('analytics save failed', err); }
  return ok();
}
