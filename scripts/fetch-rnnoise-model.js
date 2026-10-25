// Downloads the RNNoise 0.2 model (a 29 MB C source file) into engine/third_party/rnnoise.
// It is too big to keep in git, so the engine build fetches it, checks a pinned SHA-256, and unpacks it.
// Same model version as the web engine's Jitsi build (see model_version in xiph/rnnoise).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const VERSION = '0b50c45';
const SHA256 = '4ac81c5c0884ec4bd5907026aaae16209b7b76cd9d7f71af582094a2f98f4b43';
const URL = `https://media.xiph.org/rnnoise/models/rnnoise_data-${VERSION}.tar.gz`;

const root = path.join(__dirname, '..', 'engine');
const dest = path.join(root, 'third_party', 'rnnoise');
const cache = path.join(root, 'build', `rnnoise_data-${VERSION}.tar.gz`);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function main() {
  if (fs.existsSync(path.join(dest, 'rnnoise_data.c')) && fs.existsSync(path.join(dest, 'rnnoise_data.h'))) return;
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  let data = fs.existsSync(cache) ? fs.readFileSync(cache) : null;
  if (!data || sha(data) !== SHA256) {
    console.log('Downloading the RNNoise model...');
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
    data = Buffer.from(await res.arrayBuffer());
    if (sha(data) !== SHA256) throw new Error('The downloaded RNNoise model does not match the pinned checksum');
    fs.writeFileSync(cache, data);
  }
  // Run from the archive's folder with a relative name: GNU tar (Git for Windows) would read a "C:" path as
  // a remote host. Windows 10 and later, and the GitHub runners, ship bsdtar, which accepts this too.
  const r = spawnSync('tar', ['-xzf', path.basename(cache), '-C', dest, '--strip-components=1', 'src/rnnoise_data.c', 'src/rnnoise_data.h'], { stdio: 'inherit', cwd: path.dirname(cache) });
  if (r.status !== 0) throw new Error('Could not unpack the RNNoise model');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
