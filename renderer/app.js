const $ = (id) => document.getElementById(id);
const engine = new Engine();
const STORE_KEY = 'vocalforge.v1';

const BUILTIN_PRESETS = {
  'Clean voice (default)': {},
  'Warm podcast': { eqLow: 4, eqMud: -3, eqPres: 2, eqAir: 0, compRatio: 4, compThr: -26, makeup: 7 },
  'Bright streamer': { eqLow: 0, eqMud: -3, eqPres: 5, eqAir: 4, compRatio: 3, makeup: 6, gateThr: -48 },
  'Noisy room': { hpfFreq: 120, deessThr: -34, gateThr: -40, gateRel: 0.12, eqMud: -4, compRatio: 5, compThr: -28 },
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

$('autoBtn').addEventListener('click', () => AutoTune.open());

// ---------- devices / transport ----------
function fillSelect(sel, devices, saved) {
  sel.innerHTML = '';
  for (const d of devices) sel.add(new Option(d.label || d.deviceId, d.deviceId));
  if (saved && [...sel.options].some((o) => o.value === saved)) sel.value = saved;
  // Prefer a VB-Cable output when present and nothing was saved.
  else if (sel.id === 'outSel') {
    const cable = devices.find((d) => /cable input/i.test(d.label));
    if (cable) sel.value = cable.deviceId;
  }
}

async function loadDevices() {
  const { inputs, outputs } = await Engine.listDevices();
  fillSelect($('inSel'), inputs, store.devices.in);
  fillSelect($('outSel'), outputs, store.devices.out);
  fillSelect($('monSel'), outputs, store.devices.mon);
  $('monChk').checked = !!store.devices.monitor;
}

let running = false;
async function toggle() {
  const btn = $('startBtn');
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
    $('lat').textContent = engine.latencyMs + ' ms';
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

// ---------- settings / debug ----------
function setupSettings() {
  const dlg = $('settings');
  const note = (t) => ($('dbgNote').textContent = t);
  $('settingsBtn').addEventListener('click', () => {
    note('');
    dlg.showModal();
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
(async function init() {
  buildPanels();
  setupUpdates();
  setupSettings();
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
    alert('Could not access microphone: ' + err.message);
  }
  navigator.mediaDevices.addEventListener('devicechange', () => loadDevices().catch(() => {}));
  tick();
  if (!store.setupDone) Wizard.open();
})();
