// Soundboard: local clips, played into the mic output with optional global hotkeys.
// Relies on globals: engine, store, persist, running, Hotkeys, $.


const Soundboard = (() => {
  const SAFE_DB = -12; // default soundboard level
  const MIN_DB = -40; // slider range; the top is 0 dB because an audio element cannot go above full scale
  const MAX_DB = 0;
  const clampDb = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_DB, Math.max(MIN_DB, v)) : SAFE_DB);
  const prettyName = (file) => file.replace(/\.[^.]+$/, '');
  let status;

  function say(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
    clearTimeout(say.t);
    if (text) say.t = setTimeout(() => (status.textContent = ''), 4000);
  }

  // Local preview through a plain audio element, so a pad can be auditioned with the mixer off or the
  // output pointed at a virtual cable. Goes to the monitor device when one is chosen.
  const previews = new Set();
  // Previews follow the soundboard volume. An audio element cannot go above full scale, so the slider tops out at 0 dB.
  const previewVolume = () => dbToLin(clampDb(store.board && store.board.db));
  let hintedCable = false;
  let files = [];
  let query = '';

  // Per-clip volume: 0 dB (full) down to -20 dB, kept in the settings store. Never above full scale.
  const CLIP_MIN_DB = -20;
  const clipDb = (name) => {
    const v = store.clipDb && store.clipDb[name];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(0, Math.max(CLIP_MIN_DB, v)) : 0;
  };

  async function preview(name) {
    const bytes = await window.vf.readSound(name);
    const url = URL.createObjectURL(new Blob([bytes]));
    const audio = new Audio(url);
    audio.volume = Math.min(1, previewVolume() * dbToLin(clipDb(name)));
    const monitor = store.devices && store.devices.mon;
    if (monitor && monitor !== 'default' && audio.setSinkId) {
      try {
        await audio.setSinkId(monitor);
      } catch {}
    }
    audio.dataset.clip = name;
    previews.add(audio);
    audio.addEventListener('ended', () => {
      previews.delete(audio);
      URL.revokeObjectURL(url);
    });
    await audio.play();
  }

  function flash(button) {
    if (!button) return;
    button.classList.add('hit');
    setTimeout(() => button.classList.remove('hit'), 180);
  }

  async function play(name, button) {
    flash(button);
    try {
      if (!running) {
        toast('The mixer is off, so this is a preview on your speakers. Press Start to send sounds to your output.');
        return await preview(name);
      }
      const bytes = engine.hasSound(name) ? null : await window.vf.readSound(name);
      await engine.playSound(name, bytes, clipDb(name));
      if (!hintedCable && !(store.devices && store.devices.monitor)) {
        hintedCable = true;
        toast('Sounds play into your output (what other apps hear). Turn on Monitor to hear them yourself, or use the headphone button on a pad to preview.');
      }
    } catch (err) {
      toast(`Could not play ${prettyName(name)}: ${err.message}`, true);
    }
  }

  function stopAll() {
    engine.stopSounds();
    for (const a of previews) a.pause();
    previews.clear();
  }

  async function render() {
    files = await window.vf.listSounds();
    draw();
  }

  // Pads shown: those matching the search, in A to Z order. Hidden pads keep their hotkeys.
  function draw() {
    const grid = $('padGrid');
    grid.innerHTML = '';
    $('boardEmpty').hidden = files.length > 0;
    const q = query.trim().toLowerCase();
    const shown = files
      .filter(({ name }) => !q || prettyName(name).toLowerCase().includes(q))
      .sort((a, b) => prettyName(a.name).localeCompare(prettyName(b.name), undefined, { sensitivity: 'base', numeric: true }));
    $('boardNoMatch').hidden = !(files.length && !shown.length);
    for (const { name } of shown) {
      const pad = document.createElement('div');
      pad.className = 'pad';
      const btn = document.createElement('button');
      btn.className = 'padPlay';
      btn.textContent = prettyName(name);
      btn.title = 'Play ' + name;
      btn.addEventListener('click', () => play(name, btn));
      const prev = document.createElement('button');
      prev.className = 'padPrev icon';
      prev.textContent = '🎧';
      prev.title = 'Preview privately (only you hear it)';
      prev.addEventListener('click', () => preview(name).catch((err) => toast('Preview failed: ' + err.message, true)));
      const row = document.createElement('div');
      row.className = 'padRow';
      const del = document.createElement('button');
      del.className = 'padDel icon';
      del.textContent = '✕';
      del.title = 'Remove from soundboard (your original file is not touched)';
      del.addEventListener('click', async () => {
        await window.vf.removeSound(name);
        engine.forgetSound(name);
        if (store.clipDb) delete store.clipDb[name];
        Hotkeys.forget('sound:' + name);
        persist();
        Hotkeys.prune();
        await Hotkeys.sync();
        render();
      });
      row.append(Hotkeys.chip('sound:' + name), prev, del);
      const vol = document.createElement('input');
      vol.type = 'range';
      vol.className = 'padVol';
      vol.min = String(CLIP_MIN_DB);
      vol.max = '0';
      vol.step = '1';
      vol.value = String(clipDb(name));
      vol.title = `Clip volume: ${clipDb(name)} dB`;
      vol.setAttribute('aria-label', 'Volume for ' + prettyName(name));
      vol.addEventListener('input', () => {
        const db = Math.min(0, Math.max(CLIP_MIN_DB, Number(vol.value)));
        store.clipDb = store.clipDb || {};
        if (db === 0) delete store.clipDb[name];
        else store.clipDb[name] = db;
        vol.title = `Clip volume: ${db} dB`;
        for (const a of previews) if (a.dataset.clip === name) a.volume = Math.min(1, previewVolume() * dbToLin(db));
        persist();
      });
      pad.append(btn, row, vol);
      grid.append(pad);
    }
    Hotkeys.prune();
    Hotkeys.sync();
  }

  function init() {
    status = $('boardStatus');
    // Clips are mastered near full scale, so the old 0 dB default was far louder than a voice. Existing
    // settings are lowered once to a safe level; after that the slider is the user's to set.
    if (!store.board || typeof store.board !== 'object') store.board = { db: SAFE_DB };
    const board = store.board;
    const before = board.db;
    board.db = clampDb(board.db);
    if (typeof before !== 'number') persist();
    if (!store.boardLevelMigrated) {
      board.db = Math.min(board.db, SAFE_DB);
      store.boardLevelMigrated = true;
    }
    if (board.db !== before) persist();
    $('boardVol').value = board.db;
    $('boardVolVal').textContent = board.db + ' dB';
    engine.setBoardLevel(board.db);

    $('boardVol').addEventListener('input', (e) => {
      board.db = clampDb(parseFloat(e.target.value));
      $('boardVolVal').textContent = board.db + ' dB';
      engine.setBoardLevel(board.db);
      for (const a of previews) a.volume = Math.min(1, previewVolume() * dbToLin(clipDb(a.dataset.clip)));
      persist();
    });
    $('boardAdd').addEventListener('click', async () => {
      const { added, skipped } = await window.vf.addSounds();
      if (skipped.length) say(`Skipped ${skipped.map((s) => `${s.file} (${s.reason})`).join(', ')}`, true);
      else if (added.length) say(`Added ${added.length} sound${added.length > 1 ? 's' : ''}.`);
      render();
    });
    $('boardBrowse').addEventListener('click', () => Catalog.open());
    $('boardSearch').addEventListener('input', (e) => {
      query = e.target.value;
      draw();
    });
    $('boardStop').addEventListener('click', stopAll);

    Hotkeys.onPrefix('sound:', (name) => play(name));
    Hotkeys.onAction('stopSounds', stopAll);
    $('stopChip').append(Hotkeys.chip('stopSounds'));
    render();
  }

  return { init, play, preview, stopAll, render };
})();
