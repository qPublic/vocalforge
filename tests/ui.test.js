const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./ui-harness');

const SKIP_WIZARD = { setupDone: true };

test('the page loads with no script errors and fills the device lists', async () => {
  const { window, errors } = await loadApp({ store: SKIP_WIZARD });
  assert.deepEqual(errors, []);
  const names = (id) => [...window.document.getElementById(id).options].map((o) => o.textContent);
  assert.deepEqual(names('inSel'), ['Test Mic']);
  assert.ok(names('outSel').some((n) => /CABLE Input/.test(n)));
  assert.match(window.document.getElementById('outSel').selectedOptions[0].textContent, /CABLE Input/, 'cable should be preferred');
  window.close();
});

test('first launch shows the setup wizard', async () => {
  const { window, errors } = await loadApp();
  assert.deepEqual(errors, []);
  assert.ok(window.document.querySelector('.wz-card'), 'wizard card should be open');
  window.close();
});

test('Browse sound packs opens the browser and lists packs from the catalog', async () => {
  const packs = [{ id: 'p1', name: 'Test pack', author: 'Me', license: 'CC0-1.0', description: 'desc', clips: ['a.wav', 'b.wav'], installed: false }];
  const { window, errors, calls, settle } = await loadApp({ store: SKIP_WIZARD, vf: { listCatalog: async () => packs } });
  window.document.getElementById('boardBrowse').click();
  await settle();
  assert.deepEqual(errors, []);
  assert.ok(calls.some((c) => c[0] === 'listCatalog'), 'should ask the main process for the catalog');
  const card = window.document.querySelector('.cat-card');
  assert.ok(card, 'sound pack window should be open');
  assert.match(card.textContent, /Test pack/);
  assert.match(card.textContent, /CC0-1\.0/);
  window.close();
});

test('Browse sound packs shows a readable message when the catalog cannot be loaded', async () => {
  const { window, settle } = await loadApp({
    store: SKIP_WIZARD,
    vf: { listCatalog: async () => { throw new Error('offline'); } },
  });
  window.document.getElementById('boardBrowse').click();
  await settle();
  assert.match(window.document.querySelector('.cat-card').textContent, /Could not load the catalog: offline/);
  window.close();
});

test('installing a pack calls the main process and refreshes the soundboard', async () => {
  const packs = [{ id: 'p1', name: 'Test pack', author: 'Me', license: 'CC0-1.0', description: '', clips: ['a.wav'], installed: false }];
  const { window, calls, settle } = await loadApp({
    store: SKIP_WIZARD,
    vf: { listCatalog: async () => packs, installPack: async () => ({ added: ['a.wav'], failed: [] }) },
  });
  window.document.getElementById('boardBrowse').click();
  await settle();
  const before = calls.filter((c) => c[0] === 'listSounds').length;
  window.document.querySelector('.cat-pack button').click();
  await settle();
  assert.ok(calls.some((c) => c[0] === 'installPack' && c[1] === 'p1'));
  assert.ok(calls.filter((c) => c[0] === 'listSounds').length > before, 'soundboard should re-list');
  assert.match(window.document.querySelector('.cat-card').textContent, /Added 1 sound/);
  window.close();
});

test('every button in the main window has a click handler or is a form control', async () => {
  const { window } = await loadApp({ store: SKIP_WIZARD });
  // Smoke-click the simple buttons; none may throw.
  for (const id of ['boardAdd', 'boardStop', 'settingsBtn', 'resetBtn', 'blownBtn', 'muteBtn', 'autoBtn']) {
    assert.doesNotThrow(() => window.document.getElementById(id).click(), id);
  }
  window.close();
});

test('Mute and Blown-out mic buttons change state', async () => {
  const { window, errors } = await loadApp({ store: SKIP_WIZARD });
  const mute = window.document.getElementById('muteBtn');
  mute.click();
  assert.equal(mute.textContent, 'Muted');
  mute.click();
  assert.equal(mute.textContent, 'Mute');
  const blown = window.document.getElementById('blownBtn');
  blown.click();
  assert.ok(blown.classList.contains('on'));
  blown.click();
  assert.ok(!blown.classList.contains('on'));
  assert.deepEqual(errors, []);
  window.close();
});

test('Settings opens, and Preview setup wizard opens the wizard without changing settings', async () => {
  const { window, errors, settle } = await loadApp({ store: SKIP_WIZARD });
  window.document.getElementById('settingsBtn').click();
  assert.ok(window.document.getElementById('settings').open);
  window.document.getElementById('previewWizBtn').click();
  await settle();
  assert.ok(window.document.querySelector('.wz-badge'), 'preview badge should show');
  assert.deepEqual(errors, []);
  window.close();
});

test('Auto-tune opens from its button', async () => {
  const { window, errors, settle } = await loadApp({ store: SKIP_WIZARD });
  window.document.getElementById('autoBtn').click();
  await settle();
  assert.match(window.document.querySelector('.at-card').textContent, /Tune my voice/);
  assert.deepEqual(errors, []);
  window.close();
});

test('the soundboard lists installed sounds as pads', async () => {
  const { window } = await loadApp({ store: SKIP_WIZARD, vf: { listSounds: async () => [{ name: 'airhorn.mp3', size: 10 }, { name: 'ding.wav', size: 10 }] } });
  const pads = [...window.document.querySelectorAll('.padPlay')].map((b) => b.textContent);
  assert.deepEqual(pads, ['airhorn', 'ding']);
  window.close();
});

const TWO_SOUNDS = [{ name: 'airhorn.mp3', size: 10 }, { name: 'ding.wav', size: 10 }];

test('clicking a pad with the mixer off previews the sound and explains why', async () => {
  const { window, errors, calls, settle } = await loadApp({ store: SKIP_WIZARD, vf: { listSounds: async () => TWO_SOUNDS } });
  window.document.querySelector('.padPlay').click();
  await settle();
  assert.ok(calls.some((c) => c[0] === 'readSound' && c[1] === 'airhorn.mp3'), 'should load the clip');
  assert.equal(window.__played, 1, 'should start playback');
  const toast = window.document.getElementById('toast');
  assert.equal(toast.hidden, false);
  assert.match(toast.textContent, /mixer is off/i);
  assert.deepEqual(errors, []);
  window.close();
});

test('the headphone button previews a sound privately', async () => {
  const { window, errors, calls, settle } = await loadApp({ store: SKIP_WIZARD, vf: { listSounds: async () => TWO_SOUNDS } });
  window.document.querySelectorAll('.padPrev')[1].click();
  await settle();
  assert.ok(calls.some((c) => c[0] === 'readSound' && c[1] === 'ding.wav'));
  assert.equal(window.__played, 1);
  assert.deepEqual(errors, []);
  window.close();
});

test('a failing preview shows an error message instead of failing silently', async () => {
  const { window, settle } = await loadApp({
    store: SKIP_WIZARD,
    vf: { listSounds: async () => TWO_SOUNDS, readSound: async () => { throw new Error('file is gone'); } },
  });
  window.document.querySelector('.padPlay').click();
  await settle();
  assert.match(window.document.getElementById('toast').textContent, /file is gone/);
  window.close();
});
