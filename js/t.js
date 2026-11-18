/*! Adtomatic Analytics — first-party page analytics (no cookies sent to third parties).
 * Add to any page (our site or a client's HubSpot page):
 *   <script async src="https://YOUR-DOMAIN/js/t.js" data-site="adtomatic"></script>
 * Optional:  data-endpoint="https://YOUR-DOMAIN/api/t"
 * Custom events from your own code:  window.adtTrack('booking_submit', { industry: 'Property' })
 * Name things for the report:  data-track="底部 CTA" on a button/link,  data-section="Value Stack" on a section.
 * Never records what people type — only which fields they touched.
 * Leads into our CRM (+ Meta Pixel/CAPI event, + which ad they came from):
 *   window.adtLead({ name, phone, email, company, industry, challenge, extra: {...}, event_name: 'Lead' })
 * HubSpot forms send leads automatically when the script tag has  data-hubspot-leads="1"
 */
(function () {
  if (window.__adtT) return; window.__adtT = 1;
  var d = document, w = window, nav = navigator;
  var me = d.currentScript || d.querySelector('script[src*="/js/t.js"]');
  var SITE = (me && me.getAttribute('data-site')) || 'adtomatic';
  var EP = (me && me.getAttribute('data-endpoint')) || (me && me.src ? new URL(me.src, location.href).origin + '/api/t' : '/api/t');
  var LEAD_EP = EP.replace(/\/api\/t$/, '/api/lead');
  var HS_LEADS = me && me.getAttribute('data-hubspot-leads') === '1';
  var LEAD_EVENT = (me && me.getAttribute('data-lead-event')) || 'Lead';
  if (/bot|crawl|spider|facebookexternalhit|headless|lighthouse/i.test(nav.userAgent)) { w.adtTrack = function () {}; return; }
  if (location.protocol === 'file:') { w.adtTrack = function () {}; return; }   // local preview: don't send

  // ---- ids ----
  function rid(n) { var s = ''; var c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < n; i++) s += c[Math.floor(Math.random() * 36)]; return s; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
  var vid = ls('adt_vid'); if (!vid) { vid = rid(12); ls('adt_vid', vid); }
  var now = Date.now(), last = +(ss('adt_last') || 0), sid = ss('adt_sid');
  if (!sid || now - last > 30 * 60 * 1000) { sid = rid(12); ss('adt_sid', sid); }
  ss('adt_last', String(now));

  // Ad source / attribution. Meta ad URL parameters (see README):
  //   utm_source=meta&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}
  //   &campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}
  // Remembered for the session (analytics) and 30 days (lead attribution, last touch).
  var q = new URLSearchParams(location.search), src = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { if (q.get(k)) src[k.slice(4)] = q.get(k).slice(0, 120); });
  ['campaign_id', 'adset_id', 'ad_id', 'placement', 'site_source'].forEach(function (k) { if (q.get(k) && !/^\{\{/.test(q.get(k))) src[k] = q.get(k).slice(0, 60); });
  if (q.get('fbclid')) src.fbclid = 1;
  if (q.get('gclid')) src.gclid = 1;
  if (Object.keys(src).length) {
    ss('adt_src', JSON.stringify(src));
    var attr = {}; for (var k0 in src) attr[k0] = src[k0];
    if (q.get('fbclid')) attr.fbclid = q.get('fbclid').slice(0, 300);
    attr.landing = location.pathname; attr.at = Date.now();
    ls('adt_attr', JSON.stringify(attr));
  } else { try { src = JSON.parse(ss('adt_src') || '{}'); } catch (e) { src = {}; } }
  // For forms on the page: returns the last ad that brought this visitor (within 30 days)
  w.adtAttribution = function () {
    try { var a = JSON.parse(ls('adt_attr') || 'null'); if (a && Date.now() - a.at < 30 * 864e5) return a; } catch (e) {}
    return {};
  };
  w.adtIds = function () { return { vid: vid, sid: sid }; };
  var ref = '';
  try { if (d.referrer && new URL(d.referrer).host !== location.host) ref = new URL(d.referrer).host; } catch (e) {}
  if (ref && !ss('adt_ref')) ss('adt_ref', ref);
  var dev = /iPad|Tablet/i.test(nav.userAgent) ? 'tablet' : (/Mobi|Android|iPhone/i.test(nav.userAgent) ? 'mobile' : 'desktop');
  var pv = rid(8);
  var page = { path: location.pathname, title: d.title.slice(0, 120), ref: ss('adt_ref') || '', src: src, dev: dev, w: w.innerWidth, lang: (nav.language || '').slice(0, 10) };

  // ---- queue + send ----
  var Q = [], t0 = Date.now();
  function push(n, p) { var e = { n: n, t: Date.now() - t0 }; if (p) for (var k in p) e[k] = p[k]; Q.push(e); if (Q.length > 180) flush(); }
  function flush(sync) {
    if (!Q.length) return;
    var body = JSON.stringify({ site: SITE, vid: vid, sid: sid, pv: pv, ts: t0, page: page, ev: Q.splice(0, Q.length) });
    try {
      if (nav.sendBeacon && nav.sendBeacon(EP, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) {}
    try { fetch(EP, { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } }); } catch (e) {}
  }
  w.adtTrack = function (name, props) {
    push(String(name).slice(0, 40), props && typeof props === 'object' ? clean(props) : null);
    if (/submit|confirm|purchase|lead|book/i.test(name)) flush();          // conversions go out right away
  };
  function clean(o) { var r = {}; Object.keys(o).slice(0, 10).forEach(function (k) { var v = o[k]; r['p_' + k.slice(0, 20)] = typeof v === 'number' ? v : String(v).slice(0, 80); }); return r; }

  push('page_view');

  // ---- labels ----
  function txt(el) { return (el.getAttribute('data-track') || el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 60); }
  function sectionOf(el) {
    var s = el.closest && el.closest('[data-section],section,header,footer,form,.cta-bar');
    if (!s) return '';
    if (s.getAttribute('data-section')) return s.getAttribute('data-section').slice(0, 40);
    if (s.id) return s.id;
    var h = s.querySelector('h1,h2,h3');
    return h ? h.innerText.replace(/\s+/g, ' ').trim().slice(0, 40) : s.tagName.toLowerCase();
  }
  function docH() { return Math.max(d.documentElement.scrollHeight, d.body.scrollHeight); }

  // ---- clicks ----
  d.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('a,button,[data-track],input[type=submit],input[type=button],summary,[role=button],video,img');
    if (!el) return;
    var r = el.getBoundingClientRect(), y = Math.round((r.top + w.scrollY) / docH() * 100);
    var p = { l: txt(el) || el.tagName.toLowerCase(), s: sectionOf(el), y: y, tag: el.tagName.toLowerCase() };
    if (el.tagName === 'A' && el.href) {
      try { var u = new URL(el.href); p.h = /wa\.me|whatsapp/i.test(u.host) ? 'whatsapp' : (u.host === location.host ? u.pathname : u.host); } catch (x) {}
    }
    push('click', p);
    if (p.h === 'whatsapp' || (el.tagName === 'A' && el.target === '_blank')) flush();
  }, true);

  // ---- scroll depth ----
  var marks = [25, 50, 75, 90, 100], hit = {};
  function onScroll() {
    var pct = Math.round((w.scrollY + w.innerHeight) / docH() * 100);
    marks.forEach(function (m) { if (pct >= m && !hit[m]) { hit[m] = 1; push('scroll', { d: m }); } });
  }
  w.addEventListener('scroll', onScroll, { passive: true });
  setTimeout(onScroll, 1500);

  // ---- sections seen + time spent ----
  var dwell = {}, inView = {};
  if ('IntersectionObserver' in w) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var name = sectionOf(en.target); if (!name) return;
        if (en.isIntersecting) { if (!(name in dwell)) { dwell[name] = 0; push('section_view', { s: name }); } inView[name] = Date.now(); }
        else if (inView[name]) { dwell[name] += Date.now() - inView[name]; delete inView[name]; }
      });
    }, { threshold: 0.35 });
    var watch = function () { d.querySelectorAll('[data-section],section').forEach(function (el) { if (!el.__adtW) { el.__adtW = 1; io.observe(el); } }); };
    watch(); setTimeout(watch, 2000);
  }

  // ---- videos ----
  function watchVideo(v) {
    if (v.__adtV) return; v.__adtV = 1;
    var id = (v.id || v.getAttribute('data-track') || (v.currentSrc || '').split('/').pop() || 'video').slice(0, 40), got = {};
    v.addEventListener('play', function () { if (!got.play) { got.play = 1; push('video', { v: id, a: 'play' }); } });
    v.addEventListener('timeupdate', function () {
      if (!v.duration) return;
      var p = v.currentTime / v.duration * 100;
      [25, 50, 75, 95].forEach(function (m) { if (p >= m && !got[m]) { got[m] = 1; push('video', { v: id, a: String(m === 95 ? 100 : m) }); } });
    });
  }
  d.querySelectorAll('video').forEach(watchVideo); setTimeout(function () { d.querySelectorAll('video').forEach(watchVideo); }, 2000);

  // ---- forms (field names only, never values) ----
  var started = {};
  function fname(el) {
    var lab = el.labels && el.labels[0] ? el.labels[0].innerText.split('\n')[0].replace(/[*：:]/g, '').trim() : '';
    return (el.getAttribute('data-track') || lab || el.getAttribute('aria-label') || el.name || el.id || el.placeholder || el.type || 'field').slice(0, 40);
  }
  function fform(el) { var f = el.form || el.closest('form'); return f ? (f.id || f.getAttribute('name') || f.getAttribute('data-track') || 'form').slice(0, 40) : 'form'; }
  d.addEventListener('focusin', function (e) {
    var el = e.target; if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.type === 'hidden') return;
    var f = fform(el);
    if (!started[f]) { started[f] = 1; push('form_start', { f: f }); }
    push('field_focus', { f: f, fld: fname(el) });
  }, true);
  d.addEventListener('change', function (e) {
    var el = e.target; if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.type === 'hidden') return;
    if (el.value) push('field_done', { f: fform(el), fld: fname(el) });
  }, true);
  d.addEventListener('submit', function (e) { push('form_submit', { f: fform(e.target) }); flush(); }, true);

  // ---- leads: save into our CRM (+ Meta event with the same id the server sends) ----
  function cookie(n) { var m = d.cookie.match('(?:^|; )' + n + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : ''; }
  w.adtLead = function (data) {
    data = data || {};
    var a = w.adtAttribution(), eid = 'bk_' + Date.now().toString(36) + rid(6);
    var ev = data.event_name || LEAD_EVENT;
    try { if (w.fbq) w.fbq('track', ev, { content_name: SITE }, { eventID: eid }); } catch (x) {}
    push('lead_submit', { p_event: ev }); flush();
    var fbclid = a.fbclid && a.fbclid !== 1 ? a.fbclid : '';
    var body = JSON.stringify({
      site: SITE, event_id: eid, event_name: ev,
      name: data.name || '', phone: data.phone || '', email: data.email || '', company: data.company || '',
      industry: data.industry || '', challenge: data.challenge || data.message || '', extra: data.extra || null,
      ad: { source: a.source, medium: a.medium, campaign: a.campaign, adset: a.term, ad: a.content, campaign_id: a.campaign_id, adset_id: a.adset_id, ad_id: a.ad_id, placement: a.placement, landing: a.landing, fbclid: a.fbclid ? 1 : 0 },
      ids: { vid: vid, sid: sid }, fbp: cookie('_fbp'), fbc: cookie('_fbc') || (fbclid ? 'fb.1.' + Date.now() + '.' + fbclid : ''),
      source_url: location.origin + location.pathname
    });
    try {
      return fetch(LEAD_EP, { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } })
        .then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
    } catch (x) { return Promise.resolve({ ok: false }); }
  };

  // HubSpot form values -> lead
  function hsToLead(list) {
    var v = {}, extra = {};
    (list || []).forEach(function (f) { if (f && f.name) v[String(f.name).toLowerCase().replace(/^0-\d+\//, '')] = Array.isArray(f.value) ? f.value.join(', ') : f.value; });
    var used = { firstname: 1, lastname: 1, phone: 1, mobilephone: 1, email: 1, company: 1, industry: 1, message: 1, hs_context: 1 };
    Object.keys(v).forEach(function (k) { if (!used[k] && v[k] !== '' && v[k] != null) extra[k] = v[k]; });
    return { name: [v.firstname, v.lastname].filter(Boolean).join(' '), phone: v.mobilephone || v.phone || '', email: v.email || '', company: v.company || '', industry: v.industry || '', challenge: v.message || '', extra: extra };
  }
  var hsPending = null;
  // HubSpot forms (client sites)
  w.addEventListener('message', function (e) {
    var m = e.data;
    if (m && m.type === 'hsFormCallback') {
      if (m.eventName === 'onFormSubmit' && Array.isArray(m.data)) hsPending = hsToLead(m.data);   // legacy forms: values arrive here
      if (m.eventName === 'onFormSubmitted') {
        push('hs_form_submit', { f: String(m.id || '').slice(0, 40) }); flush();
        if (HS_LEADS) { var l = hsPending || (m.data && m.data.submissionValues ? hsToLead(Object.keys(m.data.submissionValues).map(function (k) { return { name: k, value: m.data.submissionValues[k] }; })) : null); if (l) w.adtLead(l); hsPending = null; }
      }
      else if (m.eventName === 'onFormReady') push('hs_form_ready', { f: String(m.id || '').slice(0, 40) });
    }
  });
  // New HubSpot forms (2024+ editor)
  w.addEventListener('hs-form-event:on-submission:success', function (e) {
    push('hs_form_submit', {}); flush();
    if (!HS_LEADS) return;
    try {
      var form = w.HubSpotFormsV4 && w.HubSpotFormsV4.getFormFromEvent(e);
      if (form && form.getFormFieldValues) form.getFormFieldValues().then(function (vals) { w.adtLead(hsToLead(vals)); });
    } catch (x) {}
  });

  // ---- engaged time + send on leave ----
  var active = 0, lastAct = Date.now(), visible = !d.hidden;
  ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) { w.addEventListener(ev, function () { lastAct = Date.now(); }, { passive: true }); });
  setInterval(function () { if (visible && Date.now() - lastAct < 30000) active += 1; }, 1000);
  var left = false;
  function leave() {
    if (left) return; left = true;
    Object.keys(inView).forEach(function (n) { dwell[n] += Date.now() - inView[n]; inView[n] = Date.now(); });
    var ds = {}; Object.keys(dwell).forEach(function (n) { if (dwell[n] > 0) ds[n] = Math.round(dwell[n] / 1000); });
    push('leave', { e: active, dw: ds, mx: Math.max.apply(null, [0].concat(Object.keys(hit).map(Number))) });
    flush(true);
  }
  d.addEventListener('visibilitychange', function () { visible = !d.hidden; if (d.hidden) leave(); else left = false; });
  w.addEventListener('pagehide', leave);
})();
