// Soundboard: local clips, played into the mic output with optional global hotkeys.
// Relies on globals: engine, store, persist, running, Hotkeys, $.

const Soundboard = (() => {
  const prettyName = (file) => file.replace(/\.[^.]+$/, '');
  let status;

  function say(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
    clearTimeout(say.t);
    if (text) say.t = setTimeout(() => (status.textContent = ''), 4000);
  }

  async function play(name) {
    if (!running) return say('Start the mixer first, then play sounds.', true);
    try {
      const bytes = engine.hasSound(name) ? null : await window.vf.readSound(name);
      await engine.playSound(name, bytes);
    } catch (err) {
      say(`Could not play ${prettyName(name)}: ${err.message}`, true);
    }
  }

  async function render() {
    const grid = $('padGrid');
    const files = await window.vf.listSounds();
    grid.innerHTML = '';
    $('boardEmpty').hidden = files.length > 0;
    for (const { name } of files) {
      const pad = document.createElement('div');
      pad.className = 'pad';
      const btn = document.createElement('button');
      btn.className = 'padPlay';
      btn.textContent = prettyName(name);
      btn.title = 'Play ' + name;
      btn.addEventListener('click', () => play(name));
      const row = document.createElement('div');
      row.className = 'padRow';
      const del = document.createElement('button');
      del.className = 'padDel icon';
      del.textContent = '✕';
      del.title = 'Remove from soundboard (your original file is not touched)';
      del.addEventListener('click', async () => {
        await window.vf.removeSound(name);
        engine.forgetSound(name);
        Hotkeys.forget('sound:' + name);
        persist();
        Hotkeys.prune();
        await Hotkeys.sync();
        render();
      });
      row.append(Hotkeys.chip('sound:' + name), del);
      pad.append(btn, row);
      grid.append(pad);
    }
    Hotkeys.prune();
    Hotkeys.sync();
  }

  function init() {
    status = $('boardStatus');
    const board = (store.board ??= { db: 0 });
    $('boardVol').value = board.db;
    $('boardVolVal').textContent = board.db + ' dB';
    engine.setBoardLevel(board.db);

    $('boardVol').addEventListener('input', (e) => {
      board.db = parseFloat(e.target.value);
      $('boardVolVal').textContent = board.db + ' dB';
      engine.setBoardLevel(board.db);
      persist();
    });
    $('boardAdd').addEventListener('click', async () => {
      const { added, skipped } = await window.vf.addSounds();
      if (skipped.length) say(`Skipped ${skipped.map((s) => `${s.file} (${s.reason})`).join(', ')}`, true);
      else if (added.length) say(`Added ${added.length} sound${added.length > 1 ? 's' : ''}.`);
      render();
    });
    $('boardBrowse').addEventListener('click', () => Catalog.open());
    $('boardStop').addEventListener('click', () => engine.stopSounds());

    Hotkeys.onPrefix('sound:', play);
    Hotkeys.onAction('stopSounds', () => engine.stopSounds());
    $('stopChip').append(Hotkeys.chip('stopSounds'));
    render();
  }

  return { init, play, render };
})();
