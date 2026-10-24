// Global hotkeys: capture UI, persistence, and sync to the main process.
// Relies on globals from app.js: store, persist.

// Converts a KeyboardEvent to an Electron accelerator ("Control+Alt+M"), or null when the combo
// is not allowed (no modifier, or only modifier keys pressed). Uses e.code, so it is layout independent.
const CODE_NAMES = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';',
  BracketLeft: '[', BracketRight: ']', Backquote: '`', Quote: "'",
};

function eventToAccelerator(e) {
  let key = CODE_NAMES[e.code];
  if (!key) {
    const m = /^(?:Key([A-Z])|Digit(\d)|(F(?:[1-9]|1\d|2[0-4]))|(Numpad\d))$/.exec(e.code || '');
    key = m && (m[1] || m[2] || m[3] || m[4]);
  }
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  return mods.length ? [...mods, key].join('+') : null;
}

const Hotkeys = (() => {
  const handlers = new Map(); // action id -> function, or a prefix handler via onPrefix
  const prefixes = [];
  const chips = new Set();
  let capturing = null;

  const map = () => (store.hotkeys ??= {});

  function onAction(action, fn) {
    handlers.set(action, fn);
  }

  function onPrefix(prefix, fn) {
    prefixes.push([prefix, fn]);
  }

  function dispatch(action) {
    const fn = handlers.get(action);
    if (fn) return fn();
    for (const [prefix, f] of prefixes) if (action.startsWith(prefix)) return f(action.slice(prefix.length));
  }

  // Registers every saved hotkey with the OS. Returns the failures keyed by action.
  async function sync() {
    const list = Object.entries(map()).map(([action, accelerator]) => ({ action, accelerator }));
    const results = await window.vf.setHotkeys(list);
    const failed = new Set(results.filter((r) => !r.ok).map((r) => r.action));
    for (const c of chips) c.refresh(failed);
    return failed;
  }

  function stopCapture() {
    if (!capturing) return;
    document.removeEventListener('keydown', capturing, true);
    capturing = null;
  }

  // A button showing the current combo; click it, then press the new combo.
  // Esc cancels, Backspace/Delete clears.
  function chip(action, { defaultAccelerator } = {}) {
    if (defaultAccelerator && !(action in map())) map()[action] = defaultAccelerator;
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.type = 'button';
    let failed = new Set();
    const label = () => {
      const acc = map()[action];
      btn.classList.toggle('bad', !!acc && failed.has(action));
      btn.title = acc && failed.has(action) ? 'Another app is using this combo' : 'Click, then press a key combo';
      btn.textContent = acc ? acc.replace('Control', 'Ctrl') : 'Set hotkey';
    };
    btn.refresh = (f) => {
      failed = f || failed;
      label();
    };
    btn.addEventListener('click', () => {
      stopCapture();
      btn.textContent = 'Press keys…';
      btn.classList.add('listening');
      capturing = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') return done();
        if (e.key === 'Backspace' || e.key === 'Delete') delete map()[action];
        else {
          const acc = eventToAccelerator(e);
          if (!acc) return; // keep listening until a valid combo
          for (const [a, existing] of Object.entries(map())) if (existing === acc && a !== action) delete map()[a];
          map()[action] = acc;
        }
        done();
      };
      const done = () => {
        stopCapture();
        btn.classList.remove('listening');
        persist();
        sync();
        for (const c of chips) c.refresh();
      };
      document.addEventListener('keydown', capturing, true);
    });
    chips.add(btn);
    label();
    return btn;
  }

  // Remove chips that left the DOM (e.g. a deleted pad).
  const prune = () => chips.forEach((c) => !c.isConnected && chips.delete(c));

  window.vf.onHotkey((action) => dispatch(action));
  return { chip, sync, onAction, onPrefix, prune, forget: (action) => delete map()[action] };
})();

