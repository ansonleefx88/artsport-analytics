// Analytics report for the CRM (password: header x-crm-key = CRM_PASSWORD)
// GET /api/analytics?site=adtomatic&range=7d|today|yesterday|30d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
//     &source=&campaign=&adset=&ad=&dev=
import { authed } from './_lib.js';
import { rangeSessions, report, myDate } from './_an.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });

export async function GET(request) {
  if (!authed(request)) return json({ ok: false, error: 'unauthorized' }, 401);
  const q = new URL(request.url).searchParams;
  const sites = (process.env.ANALYTICS_SITES || 'adtomatic').split(',').map((x) => x.trim()).filter(Boolean);
  const site = q.get('site') && /^[a-z0-9-]{2,40}$/.test(q.get('site')) ? q.get('site') : sites[0];
  const now = Date.now(), today = myDate(now), day = (n) => myDate(now - n * 864e5);
  const range = q.get('range') || '7d';
  let from = today, to = today;
  if (range === 'yesterday') { from = to = day(1); }
  else if (range === '7d') from = day(6);
  else if (range === '30d') from = day(29);
  else if (range === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(q.get('from') || '') && /^\d{4}-\d{2}-\d{2}$/.test(q.get('to') || '')) { from = q.get('from'); to = q.get('to'); }
  const filt = {}; for (const k of ['source', 'campaign', 'adset', 'ad', 'dev']) if (q.get(k)) filt[k] = q.get(k);

  if (process.env.ANALYTICS_ENABLED !== '1') return json({ ok: true, disabled: true, sites, site, from, to });
  try {
    const all = await rangeSessions(site, from, to);
    return json({ ok: true, sites, site, from, to, filters: filt, ...report(all, site, filt) });
  } catch (err) {
    console.error('analytics failed', err);
    return json({ ok: false, error: 'analytics read failed' }, 500);
  }
}
