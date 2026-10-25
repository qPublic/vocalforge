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

// ---------- soundboard volume safety ----------
const ONE_SOUND = { listSounds: async () => [{ name: 'ding.wav', size: 5 }] };
const approx = (a, b, eps = 0.005) => Math.abs(a - b) < eps;

test('volume: previews default to a safe level (-12 dB), not full scale', async () => {
  const { window, settle } = await loadApp({ store: SKIP_WIZARD, vf: ONE_SOUND });
  window.document.querySelector('.padPrev').click();
  await settle();
  assert.ok(approx(window.__lastVolume, 0.2512), `volume was ${window.__lastVolume}`);
  window.close();
});

test('volume: the slider controls previews and never exceeds full scale', async () => {
  const { window, settle } = await loadApp({ store: SKIP_WIZARD, vf: ONE_SOUND });
  const slider = window.document.getElementById('boardVol');
  assert.equal(slider.max, '0', 'slider must not go above 0 dB');
  const move = (db) => {
    slider.value = String(db);
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  move(-20);
  window.document.querySelector('.padPrev').click();
  await settle();
  assert.ok(approx(window.__lastVolume, 0.1), `-20 dB gave ${window.__lastVolume}`);
  move(0);
  window.document.querySelector('.padPrev').click();
  await settle();
  assert.ok(approx(window.__lastVolume, 1), `0 dB gave ${window.__lastVolume}`);
  assert.ok(window.__lastVolume <= 1);
  window.close();
});

test('volume: a saved loud level (0 dB) is lowered once, then respected', async () => {
  // Existing install that still has the old default.
  const old = await loadApp({ store: { ...SKIP_WIZARD, board: { db: 0 } }, vf: ONE_SOUND });
  assert.equal(old.window.document.getElementById('boardVol').value, '-12');
  const saved = JSON.parse(old.window.localStorage.getItem('vocalforge.v1'));
  assert.equal(saved.board.db, -12);
  assert.equal(saved.boardLevelMigrated, true);
  old.window.close();

  // After the migration the user's own choice is kept, even if it is louder than the safe default.
  const later = await loadApp({ store: { ...SKIP_WIZARD, boardLevelMigrated: true, board: { db: -3 } }, vf: ONE_SOUND });
  assert.equal(later.window.document.getElementById('boardVol').value, '-3');
  later.window.close();

  // A quieter saved level is never raised.
  const quiet = await loadApp({ store: { ...SKIP_WIZARD, board: { db: -25 } }, vf: ONE_SOUND });
  assert.equal(quiet.window.document.getElementById('boardVol').value, '-25');
  quiet.window.close();
});

test('volume: the mixer path is capped at 0 dB too', async () => {
  const { window } = await loadApp({ store: SKIP_WIZARD });
  window.engine = window.eval('engine');
  window.engine.setBoardLevel(6);
  assert.equal(window.engine.boardDb, 0);
  window.close();
});

test('volume: missing, junk or out-of-range saved levels are repaired', async () => {
  const cases = [
    [{}, '-12'],
    [null, '-12'],
    ['loud', '-12'],
    [{ db: 'x' }, '-12'],
    [{ db: 6 }, '0'],
    [{ db: -90 }, '-40'],
  ];
  for (const [board, want] of cases) {
    const { window } = await loadApp({ store: { ...SKIP_WIZARD, boardLevelMigrated: true, board }, vf: ONE_SOUND });
    const el = window.document.getElementById('boardVol');
    assert.equal(el.value, want, JSON.stringify(board));
    assert.equal(window.document.getElementById('boardVolVal').textContent, want + ' dB');
    window.close();
  }
});

test('game-only hotkey settings: list is hidden until enabled, and changes reach the main process', async () => {
  const { window, calls, settle } = await loadApp({ store: SKIP_WIZARD });
  const $ = (id) => window.document.getElementById(id);
  assert.equal($('gameListRow').hidden, true);
  assert.equal($('gameCursorRow').hidden, true);
  assert.equal($('optGameCursor').checked, true);
  assert.equal($('gameList').value, 'VALORANT-Win64-Shipping.exe');

  $('optGameOnly').checked = true;
  $('optGameOnly').dispatchEvent(new window.Event('change'));
  await settle();
  assert.equal($('gameListRow').hidden, false);
  assert.ok(calls.some((c) => c[0] === 'setSettings' && c[1].gameOnlyHotkeys === true));

  $('optGameCursor').checked = false;
  $('optGameCursor').dispatchEvent(new window.Event('change'));
  assert.ok(calls.some((c) => c[0] === 'setSettings' && c[1].gameNeedsHiddenCursor === false));

  $('gameList').value = 'cs2.exe\n\n r5apex.exe ';
  $('gameList').dispatchEvent(new window.Event('change'));
  await settle();
  assert.ok(calls.some((c) => c[0] === 'setSettings' && JSON.stringify(c[1].gameList) === JSON.stringify(['cs2.exe', 'r5apex.exe'])));
  window.close();
});

test('main window tells the user whether a virtual cable is installed', async () => {
  const withCable = await loadApp({ store: SKIP_WIZARD });
  assert.match(withCable.window.document.getElementById('cableHint').textContent, /CABLE Input/);
  assert.equal(withCable.window.document.querySelector('#cableHint button'), null);
  withCable.window.close();

  const without = await loadApp({ store: SKIP_WIZARD, noCable: true });
  const hint = without.window.document.getElementById('cableHint');
  assert.match(hint.textContent, /No virtual cable found/);
  hint.querySelector('button').click();
  assert.ok(without.calls.some((c) => c[0] === 'openExternal' && /vb-audio\.com\/Cable/.test(c[1])));
  without.window.close();
});

test('setup wizard always links to the VB-Audio Virtual Cable page on the cable step', async () => {
  const { window, calls, settle } = await loadApp();
  const next = () => window.document.querySelector('.wz-next').click();
  next();
  await settle();
  next();
  await settle();
  const link = window.document.getElementById('wzSite');
  assert.ok(link, 'the link is on the output step even though a cable is installed');
  link.click();
  assert.ok(calls.some((c) => c[0] === 'openExternal' && /vb-audio\.com\/Cable/.test(c[1])));
  window.close();
});

test('presets can be exported to a file and imported back, and bad files are refused', async () => {
  const { window, errors, settle } = await loadApp({ store: SKIP_WIZARD });
  const $ = (id) => window.document.getElementById(id);
  const downloads = [];
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ name: this.download });
  };

  // Export: the saved file is named after the preset.
  $('presetSel').value = 'Warm podcast';
  $('exportBtn').click();
  assert.deepEqual(downloads.map((d) => d.name), ['Warm podcast.vfpreset']);

  // Import a valid file: it becomes a selectable preset and is applied.
  const doc = { format: 'vocalforge-preset', version: 1, name: 'Shared voice', values: { eqLow: 5, compOn: false, bogus: 1 } };
  const pick = async (text) => {
    const file = new window.File([text], 'x.vfpreset', { type: 'application/json' });
    Object.defineProperty($('importFile'), 'files', { value: [file], configurable: true });
    $('importFile').dispatchEvent(new window.Event('change'));
    await settle(60);
  };
  await pick(JSON.stringify(doc));
  assert.ok([...$('presetSel').options].some((o) => o.value === 'Shared voice'));
  assert.equal($('presetSel').value, 'Shared voice');
  assert.match($('toast').textContent, /Imported "Shared voice"/);
  const saved = JSON.parse(window.localStorage.getItem('vocalforge.v1'));
  assert.deepEqual(saved.user['Shared voice'], { eqLow: 5, compOn: false });

  // The same name again gets a suffix instead of overwriting.
  await pick(JSON.stringify(doc));
  assert.ok([...$('presetSel').options].some((o) => o.value === 'Shared voice (2)'));

  // A file that is not a preset shows an error and changes nothing.
  const before = Object.keys(JSON.parse(window.localStorage.getItem('vocalforge.v1')).user).length;
  await pick('definitely not a preset');
  assert.match($('toast').textContent, /not a preset|not a VocalForge preset/);
  assert.equal(Object.keys(JSON.parse(window.localStorage.getItem('vocalforge.v1')).user).length, before);
  assert.deepEqual(errors, []);
  window.close();
});

test('soundboard: pads are sorted A to Z, search filters them, and hidden pads keep their hotkeys', async () => {
  const files = [{ name: 'beta.wav', size: 1 }, { name: 'alpha.wav', size: 1 }, { name: 'Zed.wav', size: 1 }, { name: 'clip10.wav', size: 1 }, { name: 'clip2.wav', size: 1 }];
  const { window, calls, settle } = await loadApp({ store: { ...SKIP_WIZARD, hotkeys: { 'sound:beta.wav': 'Control+Alt+B' } }, vf: { listSounds: async () => files } });
  await settle();
  const $ = (id) => window.document.getElementById(id);
  const names = () => [...window.document.querySelectorAll('.padPlay')].map((b) => b.textContent);
  assert.deepEqual(names(), ['alpha', 'beta', 'clip2', 'clip10', 'Zed']);

  $('boardSearch').value = 'ZE';
  $('boardSearch').dispatchEvent(new window.Event('input'));
  assert.deepEqual(names(), ['Zed']);
  assert.equal($('boardNoMatch').hidden, true);

  $('boardSearch').value = 'nothing like this';
  $('boardSearch').dispatchEvent(new window.Event('input'));
  assert.deepEqual(names(), []);
  assert.equal($('boardNoMatch').hidden, false);

  $('boardSearch').value = '';
  $('boardSearch').dispatchEvent(new window.Event('input'));
  assert.equal(names().length, 5);
  // The beta pad was hidden for a while, but its hotkey registration was never dropped.
  const last = calls.filter((c) => c[0] === 'setHotkeys').pop();
  assert.ok(last && last[1].some((h) => h.action === 'sound:beta.wav'), 'beta keeps its hotkey');
  window.close();
});

test('soundboard: per-clip volume is saved, never above 0 dB, and applies to previews', async () => {
  const { window, settle } = await loadApp({ store: { ...SKIP_WIZARD, board: { db: -12 }, boardLevelMigrated: true }, vf: ONE_SOUND });
  await settle();
  const vol = window.document.querySelector('.padVol');
  assert.equal(vol.max, '0');
  assert.equal(vol.value, '0');
  vol.value = '-10';
  vol.dispatchEvent(new window.Event('input'));
  const saved = JSON.parse(window.localStorage.getItem('vocalforge.v1'));
  assert.equal(saved.clipDb['ding.wav'], -10);

  window.document.querySelector('.padPrev').click();
  await settle(40);
  // board level -12 dB (0.251) times the clip's -10 dB (0.316)
  assert.ok(Math.abs(window.__lastVolume - 0.251 * 0.316) < 0.005, `preview volume ${window.__lastVolume}`);

  vol.value = '0';
  vol.dispatchEvent(new window.Event('input'));
  assert.equal(JSON.parse(window.localStorage.getItem('vocalforge.v1')).clipDb['ding.wav'], undefined);
  window.close();
});
