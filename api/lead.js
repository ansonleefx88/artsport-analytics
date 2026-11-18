// Lead / booking submit — from our book.html, or from any client page via window.adtLead() in js/t.js:
//   1. saves the lead into our own CRM (crm.html), tagged with the site id and the ad it came from
//   2. sends a Meta Conversions API event (Schedule by default; same event_id as the browser Pixel)
// Cross-site: client pages post as text/plain (no CORS preflight); the response allows any origin.
//   Storage: own server files (./data) or Vercel Blob — see api/_storage.js
// Env vars: META_PIXEL_ID, META_CAPI_TOKEN, optional META_TEST_EVENT_CODE / META_API_VERSION
import crypto from 'node:crypto';
import { sha256, str, normPhone, sendCapi } from './_lib.js';
import { saveLead, storeReady } from './_store.js';
import { storageMode } from './_storage.js';

// Which Meta campaign / ad set / ad the lead came from (from the ad's URL parameters)
function cleanAd(a) {
  if (!a || typeof a !== 'object') return {};
  const out = {};
  for (const k of ['source', 'medium', 'campaign', 'adset', 'ad', 'campaign_id', 'adset_id', 'ad_id', 'placement', 'landing']) {
    const v = str(String(a[k] ?? ''), 150);
    if (v && v !== 'undefined' && !/^\{\{/.test(v)) out[k] = v;
  }
  if (a.fbclid) out.fbclid = 1;
  return out;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
const reply = (obj, status = 200) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
const EVENTS = ['Schedule', 'Lead', 'CompleteRegistration', 'Contact', 'SubmitApplication'];

function cleanExtra(x) {
  if (!x || typeof x !== 'object') return undefined;
  const out = {};
  for (const k of Object.keys(x).slice(0, 25)) {
    const key = String(k).replace(/[^\w\u4e00-\u9fff -]/g, '').slice(0, 40);
    if (key) out[key] = str(String(x[k] ?? ''), 300);
  }
  return Object.keys(out).length ? out : undefined;
}

export function buildLead(body, now = Date.now()) {
  const id = new Date(now).toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex');
  return {
    id,
    created_at: new Date(now).toISOString(),
    site: /^[a-z0-9-]{2,40}$/.test(str(body.site, 40)) ? str(body.site, 40) : 'adtomatic',
    page: str(body.source_url, 200),
    name: str(body.name, 80),
    phone: str(body.phone, 30),
    email: str(body.email, 120).toLowerCase(),
    company: str(body.company, 120),
    extra: cleanExtra(body.extra),
    industry: str(body.industry, 60),
    industry_other: str(body.industry_other, 80),
    challenge: str(body.challenge, 1000),
    date_label: str(body.date_label, 40),
    time: str(body.time, 20),
    custom_time: str(body.custom_time, 200),
    start: str(body.start, 40),
    ad: cleanAd(body.ad),
    vid: str(body.ids && body.ids.vid, 16),
    sid: str(body.ids && body.ids.sid, 16),
    event_id: str(body.event_id, 64),
    status: 'new',
    notes: ''
  };
}

export function buildEvent(lead, body, headers, now = Date.now()) {
  const name = lead.name.toLowerCase();
  const [fn, ...rest] = name.split(/\s+/);
  const ln = rest.join(' ');
  const phone = normPhone(lead.phone);
  const ip = String(headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const ua = str(headers.get('user-agent') || '', 400);
  const user_data = { country: [sha256('my')] };
  if (phone) { user_data.ph = [sha256(phone)]; user_data.external_id = [sha256(phone)]; }
  if (lead.email) user_data.em = [sha256(lead.email)];
  if (fn) user_data.fn = [sha256(fn)];
  if (ln) user_data.ln = [sha256(ln)];
  if (str(body.fbp)) user_data.fbp = str(body.fbp);
  if (str(body.fbc)) user_data.fbc = str(body.fbc);
  if (ip) user_data.client_ip_address = ip;
  if (ua) user_data.client_user_agent = ua;
  return {
    event_name: EVENTS.includes(body.event_name) ? body.event_name : 'Schedule',
    event_time: Math.floor(now / 1000),
    event_id: lead.event_id,
    action_source: 'website',
    event_source_url: str(body.source_url, 300) || undefined,
    user_data,
    custom_data: { content_name: 'Free Zoom', content_category: lead.industry_other || lead.industry || undefined, ad_id: lead.ad.ad_id || undefined }
  };
}

export async function POST(request) {
  let body;
  try { body = JSON.parse(await request.text()); } catch { return reply({ ok: false, error: 'bad json' }, 400); }
  if (str(body.website)) return reply({ ok: true });                             // honeypot: bots fill hidden field
  if (!/^bk_[a-z0-9]{6,30}$/i.test(str(body.event_id, 64))) return reply({ ok: false, error: 'bad event' }, 400);
  const hasPhone = normPhone(body.phone).length >= 9, hasEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(body.email, 120));
  if (!str(body.name) && !hasEmail) return reply({ ok: false, error: 'missing name' }, 400);
  if (!hasPhone && !hasEmail) return reply({ ok: false, error: 'missing phone or email' }, 400);
  const allow = (process.env.ANALYTICS_SITES || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (allow.length && body.site && !allow.includes(String(body.site))) return reply({ ok: false, error: 'unknown site' }, 400);

  const lead = buildLead(body);
  let saved = false;
  try { await saveLead(lead); saved = true; }
  catch (err) { console.error('CRM save failed', err, 'LEAD:', JSON.stringify(lead)); }   // lead still in Vercel logs

  try { await sendCapi(buildEvent(lead, body, request.headers)); } catch (err) { console.error('CAPI failed', err); }
  return reply({ ok: true, id: lead.id, saved });
}

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

// Health check: shows only whether settings exist (never their values)
export function GET() {
  const has = (k) => !!process.env[k];
  return Response.json({
    ok: true,
    service: 'booking → CRM + Meta CAPI',
    crm: storeReady(),
    storage: storageMode(),
    check: {
      BLOB_STORE_ID: has('BLOB_STORE_ID'),
      BLOB_READ_WRITE_TOKEN: has('BLOB_READ_WRITE_TOKEN'),
      VERCEL_OIDC_TOKEN: has('VERCEL_OIDC_TOKEN'),
      CRM_PASSWORD: has('CRM_PASSWORD'),
      META_PIXEL_ID: has('META_PIXEL_ID'),
      META_CAPI_TOKEN: has('META_CAPI_TOKEN'),
      env: process.env.VERCEL_ENV || 'unknown',
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)
    }
  }, { headers: { 'cache-control': 'no-store' } });
}
