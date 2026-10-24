// Desktop audio channel: mixes system audio into the output. Uses globals: engine, store, persist, $.

const Desktop = (() => {
  function init() {
    const cfg = (store.desktop ??= { on: false, db: -6 });
    const show = () => ($('deskVolVal').textContent = cfg.db + ' dB');
    $('deskVol').value = cfg.db;
    show();
    engine.setDesktopLevel(cfg.db);
    $('deskOn').checked = cfg.on;

    $('deskVol').addEventListener('input', (e) => {
      cfg.db = parseFloat(e.target.value);
      show();
      engine.setDesktopLevel(cfg.db);
      persist();
    });

    $('deskOn').addEventListener('change', async (e) => {
      cfg.on = e.target.checked;
      persist();
      await engine.setDesktop(cfg.on);
    });

    // If capture fails (for example when auto-starting without a click), untick the box so the UI
    // matches reality, but keep the saved preference so the next launch tries again.
    engine.onDesktopFailed = () => {
      $('deskOn').checked = false;
    };

    // Applied when the mixer starts.
    engine.desktopOn = cfg.on;
  }

  return { init };
})();
