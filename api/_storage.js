// Storage adapter used by the CRM (_store.js) and analytics (_an.js).
//
//   • Own server (default):  files in DATA_DIR (default ./data next to server.js). No database, no account.
//   • Vercel:                 private Vercel Blob store, used automatically when a Blob store is connected.
//   Force one with STORAGE=file or STORAGE=blob.
//
// Moving to a real database later = rewrite only these four functions.
import fs from 'node:fs/promises';
import path from 'node:path';

const MODE = process.env.STORAGE || ((process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN) ? 'blob' : 'file');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const storageMode = () => MODE;
export const storageReady = () => MODE === 'file' || !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);

// keys look like "crm/leads/261118-abc123.json" — only safe characters allowed
function filePath(key) {
  if (!/^[a-z0-9][a-z0-9/_.-]*$/i.test(key) || key.includes('..')) throw new Error('bad storage key: ' + key);
  return path.join(DATA_DIR, key);
}

let blobSdk = null;
const blob = async () => blobSdk || (blobSdk = await import('@vercel/blob'));   // only loaded on Vercel

export async function putJson(key, obj) {
  const body = JSON.stringify(obj);
  if (MODE === 'blob') {
    const { put } = await blob();
    await put(key, body, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    return;
  }
  const p = filePath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, p);                                   // atomic replace
}

export async function getJson(key, { fresh = false } = {}) {
  if (MODE === 'blob') {
    const { get } = await blob();
    const r = await get(key, fresh ? { access: 'private', useCache: false } : { access: 'private' });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  }
  try { return JSON.parse(await fs.readFile(filePath(key), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// Returns [{ pathname, uploadedAt }] for every stored object whose key starts with prefix
export async function listKeys(prefix) {
  if (MODE === 'blob') {
    const { list } = await blob();
    const out = []; let cursor;
    do {
      const page = await list({ prefix, limit: 1000, cursor });
      out.push(...page.blobs.map((b) => ({ pathname: b.pathname, uploadedAt: b.uploadedAt })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor && out.length < 50000);
    return out;
  }
  const base = filePath(prefix.replace(/\/$/, '') || '.');
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.json')) {
        const st = await fs.stat(full);
        out.push({ pathname: path.relative(DATA_DIR, full).split(path.sep).join('/'), uploadedAt: st.mtime });
      }
    }
  }
  await walk(base);
  return out.filter((b) => b.pathname.startsWith(prefix));
}
