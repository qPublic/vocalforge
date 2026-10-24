// Soundboard file storage. Pure Node (no Electron) so it can be unit-tested.
// Clips live in one flat directory; names are sanitized so a caller can never escape it.
const fs = require('fs');
const path = require('path');

const EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus']);
const MAX_BYTES = 25 * 1024 * 1024;

function safeName(name) {
  const base = path.basename(String(name));
  const ext = path.extname(base).toLowerCase();
  if (!base || base.startsWith('.') || base !== String(name) || !EXTENSIONS.has(ext)) {
    throw new Error('Invalid sound name: ' + name);
  }
  return base;
}

function list(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => ({ name: e.name, size: fs.statSync(path.join(dir, e.name)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueName(dir, base) {
  const { name, ext } = path.parse(base);
  let candidate = base;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${name} (${i})${ext}`;
  return candidate;
}

// Copies the given files into the library. Returns { added: [names], skipped: [{file, reason}] }.
function add(dir, sources) {
  fs.mkdirSync(dir, { recursive: true });
  const added = [];
  const skipped = [];
  for (const src of sources) {
    const base = path.basename(src);
    try {
      if (!EXTENSIONS.has(path.extname(base).toLowerCase())) throw new Error('unsupported file type');
      const stat = fs.statSync(src);
      if (!stat.isFile()) throw new Error('not a file');
      if (stat.size > MAX_BYTES) throw new Error('larger than 25 MB');
      const target = uniqueName(dir, base);
      fs.copyFileSync(src, path.join(dir, target));
      added.push(target);
    } catch (err) {
      skipped.push({ file: base, reason: err.message });
    }
  }
  return { added, skipped };
}

function remove(dir, name) {
  fs.rmSync(path.join(dir, safeName(name)), { force: true });
}

function read(dir, name) {
  return fs.readFileSync(path.join(dir, safeName(name)));
}

module.exports = { EXTENSIONS, MAX_BYTES, safeName, list, add, remove, read };
