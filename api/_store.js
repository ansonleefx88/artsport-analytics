// CRM storage. Each lead is one JSON object: crm/leads/<id>.json
// Where it is stored (own server files or Vercel Blob) is decided in _storage.js.
import { putJson, getJson, listKeys, storageReady } from './_storage.js';

const PREFIX = 'crm/leads/';
const keyOf = (id) => PREFIX + id + '.json';

export const storeReady = storageReady;

export async function saveLead(lead) {
  await putJson(keyOf(lead.id), lead);
  return lead;
}

export async function getLead(id) {
  return getJson(keyOf(id), { fresh: true });
}

export async function listLeads(max = 1000) {
  const items = await listKeys(PREFIX);
  items.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const ids = items.slice(0, max).map((b) => b.pathname.slice(PREFIX.length).replace(/\.json$/, ''));
  const out = [];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = await Promise.all(ids.slice(i, i + 25).map((id) => getLead(id).catch(() => null)));
    out.push(...chunk.filter(Boolean));
  }
  return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export async function updateLead(id, patch) {
  const lead = await getLead(id);
  if (!lead) return null;
  Object.assign(lead, patch, { updated_at: new Date().toISOString() });
  await saveLead(lead);
  return lead;
}
