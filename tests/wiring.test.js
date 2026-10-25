const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

test('every script and stylesheet referenced by index.html exists', () => {
  const refs = [...scripts, ...[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1])];
  assert.ok(refs.length >= 5);
  for (const f of refs) assert.ok(fs.existsSync(path.join(dir, f)), `${f} is missing`);
});

test('top-level names are unique across the page scripts', () => {
  const seen = new Map();
  for (const f of scripts) {
    for (const m of read(f).matchAll(/^(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/gm)) {
      assert.ok(!seen.has(m[1]), `${m[1]} is declared in both ${seen.get(m[1])} and ${f}`);
      seen.set(m[1], f);
    }
  }
});

test("every $('id') lookup matches an element id in index.html", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const f of scripts) {
    for (const m of read(f).matchAll(/\$\('([^']+)'\)/g)) {
      // Ids built from a prefix (e.g. $(k + 'Bar')) are skipped because they aren't literals.
      assert.ok(ids.has(m[1]), `${f}: $('${m[1]}') has no element with that id`);
    }
  }
});

test('dynamic meter ids exist', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const k of ['in', 'out']) for (const suffix of ['Bar', 'Db']) assert.ok(ids.has(k + suffix), k + suffix);
});

test('preload exposes everything the renderer calls on window.vf', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  for (const f of scripts) {
    for (const m of read(f).matchAll(/window\.vf\.(\w+)/g)) {
      assert.ok(preload.includes(`${m[1]}:`), `preload.js does not expose vf.${m[1]}`);
    }
  }
});

test('main process handles every IPC channel the preload invokes', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  for (const m of preload.matchAll(/invoke\('([^']+)'/g)) {
    assert.ok(main.includes(`'${m[1]}'`), `main.js has no handler for ${m[1]}`);
  }
});

test('device dropdowns react to changes while the mixer is running', () => {
  const app = read('app.js');
  for (const id of ['inSel', 'outSel', 'monSel', 'monChk']) {
    assert.ok(app.includes(`['${id}',`), `${id} has no change handler`);
  }
  assert.ok(app.includes("addEventListener('change', () => onDeviceChange(which))"));
  // Rebuilding the lists must not throw away the user's current pick.
  assert.ok(app.includes('const current = sel.value'));
});

test('wiring: installing an update is silent and relaunches, so the install wizard is not shown again', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes('autoUpdater.quitAndInstall(true, true)'));
});
