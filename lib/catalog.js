// Soundboard catalog: a curated JSON index of sound packs, each declaring its license.
// Validation is strict because the catalog comes from the network. Pure Node, unit-tested.
const sounds = require('./sounds');

const CATALOG_URL = 'https://raw.githubusercontent.com/qPublic/vocalforge/main/catalog/index.json';
const ALLOWED_HOSTS = new Set(['raw.githubusercontent.com', 'github.com', 'objects.githubusercontent.com']);
const MAX_PACKS = 50;
const MAX_CLIPS = 100;
const MAX_CATALOG_BYTES = 1024 * 1024;

const text = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

function validUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

// Returns { packs } with only well-formed packs and clips. Throws if the document is not a catalog at all.
function validate(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.packs)) throw new Error('Not a soundboard catalog');
  const packs = [];
  for (const raw of data.packs.slice(0, MAX_PACKS)) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.id) ? raw.id : null;
    const name = text(raw.name, 60);
    const license = text(raw.license, 60); // every pack must say what it is licensed under
    if (!id || !name || !license || !Array.isArray(raw.clips)) continue;
    const clips = [];
    for (const c of raw.clips.slice(0, MAX_CLIPS)) {
      const url = c && validUrl(c.url);
      let clipName = null;
      try {
        clipName = c && sounds.safeName(c.name);
      } catch {}
      if (url && clipName) clips.push({ name: clipName, url });
    }
    if (!clips.length) continue;
    packs.push({ id, name, license, author: text(raw.author, 60) || 'Unknown', description: text(raw.description, 200) || '', clips });
  }
  return { packs };
}

// Downloads every clip of a pack into `dir`. `fetchFn` is fetch-compatible (injected for tests).
async function installPack(dir, pack, fetchFn) {
  const added = [];
  const failed = [];
  for (const clip of pack.clips) {
    try {
      const res = await fetchFn(clip.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
      if (declared > sounds.MAX_BYTES) throw new Error('larger than 25 MB');
      const bytes = Buffer.from(await res.arrayBuffer());
      added.push(sounds.addBuffer(dir, clip.name, bytes));
    } catch (err) {
      failed.push({ file: clip.name, reason: err.message });
    }
  }
  return { added, failed };
}

module.exports = { CATALOG_URL, ALLOWED_HOSTS, MAX_CATALOG_BYTES, validate, installPack };
