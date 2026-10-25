const $ = (id) => document.getElementById(id);
// The native engine is opt-in (Settings) and only used when engine.exe is present.
const nativeCfg = (window.vf && window.vf.engineConfig) || {};
const engine = nativeCfg.enabled && nativeCfg.available ? new NativeEngine() : new Engine();

// Chromium device ids only mean something to Chromium, so the native engine's mic is not selectable here.
function webMicId(id) {
  return engine.isNative || !id || id === 'default' ? undefined : { exact: id };
}
const STORE_KEY = 'vocalforge.v1';

const BUILTIN_PRESETS = {
  'Clean voice (default)': {},
  'Warm podcast': { eqLow: 4, eqMud: -3, eqPres: 2, eqAir: 0, compRatio: 3, compAtk: 0.012, compThr: -26, makeup: 7, clarityOn: true, clarityAmt: 50 },
  'Bright streamer': { eqLow: 0, eqMud: -3, eqPres: 5, eqAir: 4, compRatio: 3, makeup: 6, gateThr: -48, clarityOn: true, clarityAmt: 30 },
  'Noisy room': { nsOn: true, nsAmt: 100, hpfFreq: 120, deessThr: -34, gateThr: -40, gateRel: 0.2, eqMud: -4, compRatio: 3.5, compThr: -28, clarityOn: true, clarityAmt: 60 },
  'Blown-out mic': { lofiOn: true, deessOn: false },
  Flat: { hpfOn: false, gateOn: false, eqOn: false, deessOn: false, compOn: false, limOn: true, makeup: 0 },
};

let store = { user: {}, devices: {}, last: 'Clean voice (default)' };
try {
  store = { ...store, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
} catch {}
const persist = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {}
};

const allPresets = () => ({ ...BUILTIN_PRESETS, ...store.user });

// ---------- toast ----------
function toast(message, isError = false) {
  const t = $('toast');
  t.textContent = message;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 6000);
}
engine.onError = (msg) => toast(msg, true);

// ---------- panels ----------
const sliders = {};
function buildPanels() {
  const root = $('panels');
  for (const [title, params] of Object.entries(PARAMS)) {
    const panel = document.createElement('section');
    panel.className = 'panel';
    const h = document.createElement('h2');
    h.textContent = title;
    panel.append(h);

    for (const p of params) {
      if (p.type === 'toggle') {
        const t = document.createElement('input');
        t.type = 'checkbox';
        t.className = 'toggle';
        t.title = 'Enable ' + title;
        t.addEventListener('change', () => { engine.set(p.id, t.checked); markCustom(); });
        h.append(t);
        sliders[p.id] = { set: (v) => (t.checked = !!v) };
        continue;
      }
      const row = document.createElement('label');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = p.label;
      const input = document.createElement('input');
      Object.assign(input, { type: 'range', min: p.min, max: p.max, step: p.step });
      const val = document.createElement('b');
      const fmt = (v) => `${Number(v).toFixed(p.step < 0.01 ? 3 : p.step < 1 ? 2 : p.step === 0.5 ? 1 : 0)} ${p.unit}`;
      input.addEventListener('input', () => {
        val.textContent = fmt(input.value);
        engine.set(p.id, parseFloat(input.value));
        markCustom();
      });
      input.addEventListener('dblclick', () => {
        input.value = p.def;
        input.dispatchEvent(new Event('input'));
      });
      row.append(name, input, val);
      panel.append(row);
      sliders[p.id] = {
        set: (v) => {
          input.value = v;
          val.textContent = fmt(v);
        },
      };
    }
    root.append(panel);
  }
}

function showValues() {
  for (const [id, s] of Object.entries(sliders)) s.set(engine.values[id]);
  syncBlownButton();
}

// ---------- presets ----------
function refreshPresets(selected) {
  const sel = $('presetSel');
  sel.innerHTML = '';
  for (const name of Object.keys(allPresets())) sel.add(new Option(name, name));
  if (selected && allPresets()[selected]) sel.value = selected;
}

function applyPreset(name) {
  const preset = allPresets()[name];
  if (!preset) return;
  engine.load(preset);
  showValues();
  store.last = name;
  persist();
}

function markCustom() {
  // Any manual tweak detaches from the stored preset until saved.
  const sel = $('presetSel');
  if (!sel.querySelector('option[value="(custom)"]')) sel.add(new Option('(custom)', '(custom)'));
  sel.value = '(custom)';
  store.custom = { ...engine.values };
  persist();
}

$('presetSel').addEventListener('change', (e) => {
  if (e.target.value !== '(custom)') applyPreset(e.target.value);
});
$('saveBtn').addEventListener('click', () => {
  const name = $('presetName').value.trim();
  if (!name || BUILTIN_PRESETS[name]) return $('presetName').focus();
  store.user[name] = { ...engine.values };
  store.last = name;
  persist();
  refreshPresets(name);
  $('presetName').value = '';
});
$('delBtn').addEventListener('click', () => {
  const name = $('presetSel').value;
  if (!store.user[name]) return;
  delete store.user[name];
  store.last = 'Clean voice (default)';
  persist();
  refreshPresets(store.last);
  applyPreset(store.last);
});
$('resetBtn').addEventListener('click', () => {
  refreshPresets('Clean voice (default)');
  applyPreset('Clean voice (default)');
});

// ---------- preset files (see preset-io.js) ----------
function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('exportBtn').addEventListener('click', () => {
  const picked = $('presetSel').value;
  const name = picked && picked !== '(custom)' ? picked : $('presetName').value.trim() || 'My preset';
  downloadText(presetFileName(name), serializePreset(name, engine.values, FLAT));
  toast('Preset exported.');
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > MAX_PRESET_BYTES) return toast('That file is too large to be a preset.', true);
  const reader = new FileReader();
  reader.onload = () => {
    const result = parsePreset(String(reader.result), FLAT);
    if (!result.ok) return toast(result.error, true);
    if (Object.keys(store.user).length >= MAX_USER_PRESETS) return toast('You have too many saved presets. Delete one first.', true);
    const name = uniquePresetName(result.name, new Set(Object.keys(allPresets())));
    store.user[name] = result.values;
    persist();
    refreshPresets(name);
    applyPreset(name);
    toast(`Imported "${name}"` + (result.ignored ? ` (${result.ignored} unknown settings skipped)` : ''));
  };
  reader.onerror = () => toast('Could not read that file.', true);
  reader.readAsText(file);
});

$('autoBtn').addEventListener('click', () => AutoTune.open());

// Quick toggle for the blown-out mic effect (the same switch as in its panel).
function syncBlownButton() {
  const on = !!engine.values.lofiOn;
  $('blownBtn').classList.toggle('on', on);
  $('blownBtn').setAttribute('aria-pressed', String(on));
}
$('blownBtn').addEventListener('click', () => {
  engine.set('lofiOn', !engine.values.lofiOn);
  showValues();
  markCustom();
});

// ---------- devices / transport ----------
function fillSelect(sel, devices, saved) {
  const current = sel.value; // keep what the user has picked if it is still plugged in
  sel.innerHTML = '';
  for (const d of devices) sel.add(new Option(d.label || d.deviceId, d.deviceId));
  const has = (v) => v && [...sel.options].some((o) => o.value === v);
  if (has(current)) sel.value = current;
  else if (has(saved)) sel.value = saved;
  // Prefer a VB-Cable output when present and nothing was saved.
  else if (sel.id === 'outSel') {
    const cable = devices.find((d) => /cable input/i.test(d.label));
    if (cable) sel.value = cable.deviceId;
  }
}

// Other apps can only hear VocalForge through a virtual cable, so say whether one is installed.
function updateCableHint(outputs) {
  const hint = $('cableHint');
  if (outputs.some((d) => /cable input/i.test(d.label))) {
    hint.textContent = 'Tip: set Output to CABLE Input (VB-Cable), then pick CABLE Output as your microphone in Discord/OBS. Use headphones when monitoring to avoid feedback.';
    return;
  }
  hint.textContent = 'No virtual cable found. Discord, OBS and games cannot hear VocalForge without one. VB-Cable is free. After installing it, restart the app if it does not show up here. ';
  const get = document.createElement('button');
  get.textContent = 'Get VB-Cable';
  get.addEventListener('click', () => window.vf.openExternal('https://vb-audio.com/Cable/'));
  hint.append(get);
}

async function loadDevices() {
  const { inputs, outputs } = await engine.listDevices();
  fillSelect($('inSel'), inputs, store.devices.in);
  fillSelect($('outSel'), outputs, store.devices.out);
  fillSelect($('monSel'), outputs, store.devices.mon);
  $('monChk').checked = !!store.devices.monitor;
  updateCableHint(outputs);
}

let running = false;
async function toggle() {
  const btn = $('startBtn');
  if (reconnectId) {
    // Stop pressed while reconnecting: give up and go back to a clean Start state.
    reconnectId = 0;
    running = false;
    try { await engine.stop(); } catch {}
    btn.textContent = 'Start';
    btn.classList.remove('on');
    return;
  }
  btn.disabled = true;
  try {
    if (running) {
      await engine.stop();
      running = false;
      btn.textContent = 'Start';
      btn.classList.remove('on');
    } else {
      store.devices = {
        in: $('inSel').value,
        out: $('outSel').value,
        mon: $('monSel').value,
        monitor: $('monChk').checked,
      };
      persist();
      await engine.start({
        inputId: store.devices.in,
        outputId: store.devices.out,
        monitorId: store.devices.mon,
        monitor: store.devices.monitor,
      });
      running = true;
      btn.textContent = 'Stop';
      btn.classList.add('on');
    }
  } catch (err) {
    alert('Audio error: ' + err.message);
  }
  btn.disabled = false;
}
$('startBtn').addEventListener('click', toggle);

// Changing a device while the mixer is running takes effect immediately.
let switching = Promise.resolve();
function onDeviceChange(which) {
  store.devices = {
    in: $('inSel').value,
    out: $('outSel').value,
    mon: $('monSel').value,
    monitor: $('monChk').checked,
  };
  persist();
  if (!running) return;
  // Queue changes so rapid clicks cannot overlap a stop/start.
  switching = switching.then(async () => {
    try {
      if (which === 'out') return await engine.setOutput(store.devices.out);
      await toggle(); // stop
      await toggle(); // start with the new devices
    } catch (err) {
      toast('Could not switch device: ' + err.message, true);
    }
  });
}
for (const [id, which] of [['inSel', 'in'], ['outSel', 'out'], ['monSel', 'mon'], ['monChk', 'monitor']]) {
  $(id).addEventListener('change', () => onDeviceChange(which));
}

// A mic or output that disappears (unplugged, disabled) is reconnected on its own: the same devices are tried every
// two seconds, and after about 20 seconds the lost one is replaced by the system default so audio keeps flowing.
let reconnectId = 0;
let RECONNECT_DELAY_MS = 2000; // not a constant only so a test can shorten it
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const DEVICE_NAMES = { input: 'microphone', output: 'output device', monitor: 'monitor device' };
engine.onDeviceLost = async (which) => {
  if (!running || reconnectId) return;
  const me = (reconnectId = Date.now());
  const btn = $('startBtn');
  const lost = DEVICE_NAMES[which] || 'audio device';
  toast(`Your ${lost} was disconnected. Reconnecting...`, true);
  btn.textContent = 'Reconnecting…';
  try { await engine.stop(); } catch {}
  for (let attempt = 1; reconnectId === me; attempt++) {
    if (attempt === 11) {
      const sel = which === 'input' ? 'inSel' : which === 'monitor' ? 'monSel' : 'outSel';
      $(sel).value = 'default';
      store.devices = { ...store.devices, [which === 'input' ? 'in' : which === 'monitor' ? 'mon' : 'out']: 'default' };
      toast(`Still no ${lost}: using the default one for now.`, true);
    }
    try {
      await engine.start({ inputId: store.devices.in, outputId: store.devices.out, monitorId: store.devices.mon, monitor: store.devices.monitor });
      if (reconnectId !== me) { await engine.stop(); return; }
      running = true;
      reconnectId = 0;
      btn.textContent = 'Stop';
      toast('Reconnected.');
      loadDevices().catch(() => {});
      return;
    } catch {
      await sleepMs(RECONNECT_DELAY_MS);
    }
  }
};

// The native engine can stop on its own (crash, killed): put the UI back to a clean Start state.
engine.onExited = () => {
  running = false;
  $('startBtn').textContent = 'Start';
  $('startBtn').classList.remove('on');
};

// ---------- meters ----------
engine.onGate = (g) => {
  const open = g > 0.5;
  $('gateBar').style.width = Math.round(g * 100) + '%';
  $('gateState').textContent = open ? 'open' : 'closed';
};

const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
const fmtDb = (db) => (db <= -99 ? '-∞' : db.toFixed(1));
const held = { in: -100, out: -100 };
function tick() {
  if (running) {
    for (const k of ['in', 'out']) {
      const db = engine.level(k);
      held[k] = Math.max(db, held[k] - 0.6); // slow fall-off
      $(k + 'Bar').style.width = dbToPct(held[k]) + '%';
      $(k + 'Db').textContent = fmtDb(held[k]);
      $(k + 'Bar').classList.toggle('hot', held[k] > -3);
    }
    const gr = -engine.reduction;
    $('grBar').style.width = Math.min(100, (gr / 24) * 100) + '%';
    $('grDb').textContent = gr.toFixed(1);
    $('lat').textContent = engine.latencyMs + ' ms' + (engine.latencyMeasured ? ' (measured)' : '');
  }
  requestAnimationFrame(tick);
}

// ---------- version / updates ----------
function setupUpdates() {
  const btn = $('updBtn');
  const msg = $('updMsg');
  let ready = false;
  window.vf.getVersion().then((v) => ($('ver').textContent = 'v' + v));
  window.vf.onUpdateStatus((s) => {
    msg.textContent = s.message;
    msg.className = s.state === 'error' ? 'error' : s.state === 'current' || s.state === 'ready' ? 'ok' : '';
    ready = s.state === 'ready';
    btn.textContent = ready ? 'Restart to update' : 'Check for updates';
    btn.disabled = s.state === 'checking' || s.state === 'downloading';
  });
  btn.addEventListener('click', () => (ready ? window.vf.installUpdate() : window.vf.checkForUpdates()));
}

// ---------- hear the difference ----------
// "Hear raw" switches every effect off (input gain and limiter stay) so you can compare with your processed voice.
let raw = false;
function setRaw(on) {
  raw = on;
  engine.setBypass(on);
  $('rawBtn').classList.toggle('on', on);
  $('rawBtn').textContent = on ? 'Raw mic' : 'Hear raw';
  $('rawBtn').title = on ? 'Effects are off. Click to hear your processed voice again' : 'Hear your raw mic, without any effects, to compare';
}

function setupRaw() {
  $('rawBtn').addEventListener('click', () => setRaw(!raw));
  Hotkeys.onAction('raw', () => setRaw(!raw));
  $('rawChip').append(Hotkeys.chip('raw'));
}

// ---------- mute ----------
let muted = false;
function setMuted(m) {
  muted = m;
  engine.setMuted(m);
  $('muteBtn').classList.toggle('on', m);
  $('muteBtn').textContent = m ? 'Muted' : 'Mute';
}

function setupMute() {
  $('muteBtn').addEventListener('click', () => setMuted(!muted));
  Hotkeys.onAction('mute', () => setMuted(!muted));
  $('muteChip').append(Hotkeys.chip('mute', { defaultAccelerator: 'Control+Alt+M' }));
}

// ---------- settings / debug ----------
async function setupGeneral() {
  const cfg = await window.vf.getSettings();
  $('optLaunch').checked = cfg.launchAtLogin;
  $('optTray').checked = cfg.closeToTray;
  $('optAutoStart').checked = !!store.autoStartMixer;
  $('optNative').checked = !!cfg.nativeEngine;
  $('optNative').disabled = !nativeCfg.available;
  $('nativeNote').textContent = nativeCfg.available
    ? 'Lower-latency C++ audio engine. Restart VocalForge after changing this.'
    : 'The native engine file was not found in this install.';
  $('measureRow').hidden = !engine.isNative;
  $('measureBtn').addEventListener('click', async () => {
    const note = (t) => ($('measureNote').textContent = t);
    if (!running) return note('Press Start first, then measure.');
    $('measureBtn').disabled = true;
    note('Measuring…');
    try {
      const r = await engine.measureLatency();
      const total = Math.round(r.outputMs + r.inputMs);
      note(`About ${total} ms from your mic to your output device: ${Math.round(r.outputMs)} ms through the effects and Windows audio` +
        `${r.noiseSuppressionMs ? ' (including noise suppression)' : ''}, plus about ${Math.round(r.inputMs)} ms of mic buffering. ` +
        `Measured ${r.trials} times, ${Math.round(r.minMs)} to ${Math.round(r.maxMs)} ms.`);
    } catch (err) {
      note('Could not measure: ' + err.message);
    } finally {
      $('measureBtn').disabled = false;
    }
  });
  $('optBuffer').value = String(NATIVE_BUFFER_CHOICES.includes(Number(store.nativeBuffer)) ? Number(store.nativeBuffer) : 240);
  $('optBuffer').disabled = !nativeCfg.available;
  $('optNative').addEventListener('change', (e) => {
    window.vf.setSettings({ nativeEngine: e.target.checked });
    $('nativeNote').textContent = 'Press Restart VocalForge above to switch engines.';
  });
  $('optBuffer').addEventListener('change', (e) => {
    store.nativeBuffer = NATIVE_BUFFER_CHOICES.includes(Number(e.target.value)) ? Number(e.target.value) : 240;
    persist();
    $('nativeNote').textContent = running ? 'Press Stop then Start to apply the new buffer size.' : '';
  });
  $('optGameOnly').checked = !!cfg.gameOnlyHotkeys;
  $('gameList').value = (cfg.gameList || []).join('\n');
  $('optGameCursor').checked = cfg.gameNeedsHiddenCursor !== false;
  $('gameListRow').hidden = $('gameCursorRow').hidden = !cfg.gameOnlyHotkeys;
  $('optGameCursor').addEventListener('change', (e) => window.vf.setSettings({ gameNeedsHiddenCursor: e.target.checked }));
  $('optGameOnly').addEventListener('change', (e) => {
    $('gameListRow').hidden = $('gameCursorRow').hidden = !e.target.checked;
    window.vf.setSettings({ gameOnlyHotkeys: e.target.checked });
  });
  $('gameList').addEventListener('change', async (e) => {
    const lines = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean);
    const saved = await window.vf.setSettings({ gameList: lines });
    if (saved && saved.gameList) e.target.value = saved.gameList.join('\n');
    $('gameListNote').textContent = saved && saved.gameList && saved.gameList.length < lines.length ? 'Some lines were ignored: use names like VALORANT-Win64-Shipping.exe.' : '';
  });
  $('optLaunch').addEventListener('change', (e) => window.vf.setSettings({ launchAtLogin: e.target.checked }));
  $('optTray').addEventListener('change', (e) => window.vf.setSettings({ closeToTray: e.target.checked }));
  $('optAutoStart').addEventListener('change', (e) => {
    store.autoStartMixer = e.target.checked;
    persist();
  });
}

function setupSettings() {
  const dlg = $('settings');
  const note = (t) => ($('dbgNote').textContent = t);
  $('settingsBtn').addEventListener('click', () => {
    note('');
    dlg.showModal();
  });
  // A click on the dimmed area outside the dialog closes it. Both the press and the release must land outside,
  // so selecting text and letting go past the edge does not close it.
  const outside = (e) => {
    const r = dlg.getBoundingClientRect();
    return e.target === dlg && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  let pressedOutside = false;
  dlg.addEventListener('mousedown', (e) => (pressedOutside = outside(e)));
  dlg.addEventListener('click', (e) => {
    if (pressedOutside && outside(e)) dlg.close();
    pressedOutside = false;
  });
  $('restartBtn').addEventListener('click', () => {
    $('restartBtn').disabled = true;
    $('restartBtn').textContent = 'Restarting…';
    window.vf.restartApp();
  });
  $('tourBtn').addEventListener('click', () => {
    dlg.close();
    Tour.start();
  });
  $('runSetupBtn').addEventListener('click', () => {
    dlg.close();
    Wizard.open();
  });
  $('previewWizBtn').addEventListener('click', () => {
    dlg.close();
    Wizard.open({ preview: true });
  });
  $('resetFirstRunBtn').addEventListener('click', () => {
    store.setupDone = false;
    persist();
    note('Done. The wizard will show on next launch.');
  });
  $('devtoolsBtn').addEventListener('click', () => window.vf.toggleDevTools());
}

// ---------- init ----------
async function init() {
  const safely = (name, fn) => {
    try {
      return fn();
    } catch (err) {
      console.error(name + ' failed', err);
      toast(name + ' failed to start: ' + err.message, true);
    }
  };
  safely('Panels', buildPanels);
  safely('Updates', setupUpdates);
  safely('Settings', setupSettings);
  safely('Mute', setupMute);
  safely('Raw', setupRaw);
  safely('General options', setupGeneral);
  safely('Soundboard', () => Soundboard.init());
  safely('Desktop audio', () => Desktop.init());
  refreshPresets(store.last);
  if (store.last === '(custom)' || !allPresets()[store.last]) {
    if (store.custom) {
      engine.load(store.custom);
      markCustom();
    } else applyPreset('Clean voice (default)');
  } else applyPreset(store.last);
  showValues();
  try {
    await loadDevices();
  } catch (err) {
    toast('Could not access the microphone: ' + err.message, true);
  }
  navigator.mediaDevices.addEventListener('devicechange', () => loadDevices().catch(() => {}));
  tick();
  if (!store.setupDone) safely('Setup wizard', () => Wizard.open());
  else if (store.autoStartMixer && !running) toggle();
}

// Start only once every script on the page has run: init uses Hotkeys, Soundboard, Desktop and
// Wizard, which are defined by scripts that load after this one.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
