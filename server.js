// Adtomatic site + CRM + analytics on your own server. No database, no outside service.
//
//   1. Install Node.js 20+  (node -v)
//   2. Copy .env.example to .env and fill it in
//   3. node server.js                    -> http://SERVER-IP:3000
//      (keep it running: pm2 start server.js --name adtomatic  — see README)
//
// Data (leads + analytics) is saved as files in ./data (or DATA_DIR). Back that folder up.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---- .env (simple KEY=VALUE file, no package needed) ----
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.STORAGE) process.env.STORAGE = 'file';
if (!process.env.DATA_DIR) process.env.DATA_DIR = path.join(ROOT, 'data');
process.chdir(ROOT);

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const API = ['lead', 'leads', 't', 'analytics'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.woff2': 'font/woff2'
};

const handlers = {};
async function handlerFor(name) {
  if (!handlers[name]) handlers[name] = await import(pathToFileURL(path.join(ROOT, 'api', name + '.js')).href);
  return handlers[name];
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Only these public files are served — never data/, .env, server code or node_modules
function staticPath(urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === '/' || p === '') p = '/index.html';
  if (p.includes('..') || p.includes('\0')) return null;
  const allowed = /^\/[a-z0-9_-]+\.html$/i.test(p) || /^\/(assets|css|js)\/[a-z0-9_./-]+$/i.test(p);
  if (!allowed) {
    if (/^\/[a-z0-9_-]+$/i.test(p) && fs.existsSync(path.join(ROOT, p + '.html'))) return path.join(ROOT, p + '.html');   // clean URLs: /book -> book.html
    return null;
  }
  const full = path.join(ROOT, p);
  return full.startsWith(ROOT + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
}

function sendFile(req, res, file, extraHeaders) {
  const st = fs.statSync(file), ext = path.extname(file).toLowerCase();
  const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', ...extraHeaders };
  headers['cache-control'] = ext === '.html' ? 'no-cache' : (/\/assets\//.test(file) ? 'public, max-age=604800' : 'public, max-age=3600');
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {                                                     // video seeking (Safari needs this)
    let start = range[1] ? +range[1] : st.size - +range[2], end = range[1] && range[2] ? +range[2] : st.size - 1;
    if (!range[1]) end = st.size - 1;
    if (start >= st.size || start > end) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/api\/([a-z]+)\/?$/);

    if (m && API.includes(m[1])) {
      const mod = await handlerFor(m[1]);
      const fn = mod[req.method];
      if (!fn) { res.writeHead(405); return res.end(); }
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      if (!headers.get('x-forwarded-for')) headers.set('x-forwarded-for', (req.socket.remoteAddress || '').replace(/^::ffff:/, ''));
      const host = req.headers.host || 'localhost';
      const out = await fn(new Request('http://' + host + req.url, { method: req.method, headers, body }));
      const h = Object.fromEntries(out.headers);
      h['x-robots-tag'] = 'noindex';
      res.writeHead(out.status, h);
      return res.end(Buffer.from(await out.arrayBuffer()));
    }

    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const file = staticPath(url.pathname);
    if (!file) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const extra = {};
    if (/crm\.html$/.test(file)) { extra['x-robots-tag'] = 'noindex, nofollow'; extra['cache-control'] = 'no-store'; }
    if (/\/js\/t\.js$/.test(file)) extra['access-control-allow-origin'] = '*';
    return sendFile(req, res, file, extra);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Adtomatic running on http://${HOST === '0.0.0.0' ? 'SERVER-IP' : HOST}:${PORT}`);
  console.log(`Data folder: ${process.env.DATA_DIR}`);
  if (!process.env.CRM_PASSWORD) console.log('WARNING: CRM_PASSWORD is not set — /crm login will not work.');
});
