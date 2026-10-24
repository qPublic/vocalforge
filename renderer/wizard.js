// First-run setup wizard. Also reachable from Settings > Debug > Preview setup wizard.
// Relies on globals from app.js: store, persist, BUILTIN_PRESETS, allPresets, applyPreset,
// refreshPresets, loadDevices, toggle, running, $.

const Wizard = (() => {
  const PRESET_BLURBS = {
    'Clean voice (default)': ['Balanced', 'Natural tone with gentle polish. A safe starting point.'],
    'Warm podcast': ['Warm', 'Fuller low end and smooth dynamics, like a radio voice.'],
    'Bright streamer': ['Bright', 'Crisp, forward and present. Cuts through game audio.'],
    'Noisy room': ['Noisy room', 'Tighter gate and stronger filtering for fans and keyboards.'],
  };
  const STEPS = ['welcome', 'mic', 'output', 'sound', 'done'];
  const CABLE_URL = 'https://vb-audio.com/Cable/';

  let el, step, preview, choice, meter;

  const logoSvg = `<svg class="wz-logo" viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="wzg" x1="0" x2="1"><stop offset="0" stop-color="#4cc2ff"/><stop offset="1" stop-color="#46d39a"/></linearGradient></defs>
    ${Array.from({ length: 9 }, (_, i) => {
      const k = Math.abs(i - 4) / 4;
      const h = 30 + 66 * (1 - k);
      return `<rect class="bar" style="--i:${i}" x="${6 + i * 12.5}" y="6" width="7.5" height="${h}" rx="3.75" fill="url(#wzg)"/>`;
    }).join('')}
  </svg>`;

  const opts = (sel) => [...$(sel).options].map((o) => ({ value: o.value, label: o.textContent }));
  const optionsHtml = (list, selected) =>
    list.map((o) => `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cableOutput = () => opts('outSel').find((o) => /cable input/i.test(o.label));

  function open({ preview: isPreview = false } = {}) {
    if (el) return;
    preview = isPreview;
    step = 0;
    choice = {
      mic: $('inSel').value,
      out: $('outSel').value,
      monitor: $('monChk').checked,
      preset: allPresets()[store.last] ? store.last : 'Clean voice (default)',
    };
    el = document.createElement('div');
    el.className = 'wz-backdrop';
    el.innerHTML = `<div class="wz-card" role="dialog" aria-modal="true" aria-label="Setup wizard">
        ${preview ? '<div class="wz-badge">Preview, nothing will be changed</div>' : ''}
        <button class="wz-close" title="${preview ? 'Close preview' : 'Skip setup'}" aria-label="Close">×</button>
        <div class="wz-body"></div>
        <div class="wz-foot">
          <button class="wz-back">Back</button>
          <div class="wz-dots">${STEPS.map(() => '<i></i>').join('')}</div>
          <button class="wz-next primary">Next</button>
        </div>
      </div>`;
    document.body.append(el);
    el.querySelector('.wz-close').onclick = close;
    el.querySelector('.wz-back').onclick = () => go(step - 1);
    el.querySelector('.wz-next').onclick = next;
    document.addEventListener('keydown', onKey);
    render();
  }

  function close() {
    stopMeter();
    document.removeEventListener('keydown', onKey);
    el?.classList.add('leaving');
    const gone = el;
    el = null;
    setTimeout(() => gone?.remove(), 180);
    if (!preview) {
      store.setupDone = true;
      persist();
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) next();
  }

  function go(n) {
    stopMeter();
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    render();
  }

  async function next() {
    if (step < STEPS.length - 1) return go(step + 1);
    await finish();
  }

  async function finish() {
    if (!preview) {
      $('inSel').value = choice.mic;
      $('outSel').value = choice.out;
      $('monChk').checked = choice.monitor;
      refreshPresets(choice.preset);
      applyPreset(choice.preset);
    }
    close();
    if (!preview && !running) await toggle();
  }

  function render() {
    const body = el.querySelector('.wz-body');
    body.className = 'wz-body';
    void body.offsetWidth; // restart the entrance animation
    body.className = 'wz-body enter';
    body.innerHTML = views[STEPS[step]]();
    bind[STEPS[step]]?.(body);

    el.querySelectorAll('.wz-dots i').forEach((d, i) => d.classList.toggle('on', i <= step));
    el.querySelector('.wz-back').style.visibility = step === 0 ? 'hidden' : 'visible';
    el.querySelector('.wz-next').textContent =
      step === 0 ? 'Get started' : step === STEPS.length - 1 ? (preview ? 'Close preview' : 'Start mixing') : 'Next';
  }

  const views = {
    welcome: () => `${logoSvg}
      <h1>Welcome to VocalForge</h1>
      <p class="lead">Let's get your mic sounding great. It takes about a minute: pick your mic, choose where your voice goes, then choose a sound.</p>`,

    mic: () => `<span class="wz-step">Step 1 of 3</span>
      <h2>Pick your microphone</h2>
      <p class="lead">Choose the mic you talk into, then say something. The bar should move.</p>
      <select class="wz-select" id="wzMic">${optionsHtml(opts('inSel'), choice.mic)}</select>
      <div class="wz-meter"><div class="bar"><i id="wzBar"></i></div><b id="wzHeard">Listening…</b></div>`,

    output: () => {
      const cable = cableOutput();
      return `<span class="wz-step">Step 2 of 3</span>
      <h2>Where should your voice go?</h2>
      ${
        cable
          ? `<div class="wz-note good"><b>Virtual cable found</b>Your processed voice goes to <em>CABLE Input</em>. In Discord, OBS or Zoom, choose <em>CABLE Output</em> as your microphone.</div>`
          : `<div class="wz-note warn"><b>No virtual cable found</b>Other apps need a virtual cable to hear your processed mic. VB-Cable is free.
             <span class="wz-actions"><button id="wzGet">Get VB-Cable</button><button id="wzScan">Re-scan devices</button></span></div>`
      }
      <label class="wz-field">Send to <select class="wz-select" id="wzOut">${optionsHtml(opts('outSel'), choice.out)}</select></label>
      <label class="wz-check"><input type="checkbox" id="wzMon"${choice.monitor ? ' checked' : ''}> Let me hear myself <small>(use headphones to avoid feedback)</small></label>`;
    },

    sound: () => `<span class="wz-step">Step 3 of 3</span>
      <h2>Choose your sound</h2>
      <p class="lead">You can fine-tune everything later, or save your own presets.</p>
      <div class="wz-cards">${Object.keys(PRESET_BLURBS)
        .map(
          (name) => `<button class="wz-pcard${name === choice.preset ? ' on' : ''}" data-p="${esc(name)}">
            <b>${PRESET_BLURBS[name][0]}</b><span>${PRESET_BLURBS[name][1]}</span></button>`,
        )
        .join('')}</div>`,

    done: () => {
      const label = (sel, v) => opts(sel).find((o) => o.value === v)?.label ?? 'Default';
      return `${logoSvg}
      <h2>You're all set</h2>
      <ul class="wz-summary">
        <li><span>Microphone</span><b>${esc(label('inSel', choice.mic))}</b></li>
        <li><span>Output</span><b>${esc(label('outSel', choice.out))}</b></li>
        <li><span>Sound</span><b>${esc(choice.preset)}</b></li>
      </ul>
      <p class="lead">${preview ? 'This was a preview. Your settings were not changed.' : 'Press Start mixing to turn it on. You can change any of this later.'}</p>`;
    },
  };

  const bind = {
    mic(body) {
      const sel = body.querySelector('#wzMic');
      sel.onchange = () => {
        choice.mic = sel.value;
        startMeter(body);
      };
      startMeter(body);
    },
    output(body) {
      body.querySelector('#wzOut').onchange = (e) => (choice.out = e.target.value);
      body.querySelector('#wzMon').onchange = (e) => (choice.monitor = e.target.checked);
      body.querySelector('#wzGet')?.addEventListener('click', () => window.vf.openExternal(CABLE_URL));
      body.querySelector('#wzScan')?.addEventListener('click', async () => {
        await loadDevices();
        const cable = cableOutput();
        if (cable) choice.out = cable.value;
        render();
      });
      // Default to the virtual cable when it exists and the user hasn't picked yet.
      const cable = cableOutput();
      if (cable && choice.out !== cable.value && !store.devices.out) {
        choice.out = cable.value;
        body.querySelector('#wzOut').value = cable.value;
      }
    },
    sound(body) {
      body.querySelectorAll('.wz-pcard').forEach((b) => {
        b.onclick = () => {
          choice.preset = b.dataset.p;
          body.querySelectorAll('.wz-pcard').forEach((x) => x.classList.toggle('on', x === b));
        };
      });
    },
  };

  // Live mic level for step 1, using its own throwaway audio graph.
  async function startMeter(body) {
    stopMeter();
    const token = (meter = { stopped: false });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: webMicId(choice.mic), echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (token.stopped) return stream.getTracks().forEach((t) => t.stop());
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      Object.assign(token, { stream, ctx });
      const buf = new Float32Array(analyser.fftSize);
      let peakHold = -100, heard = 0;
      const bar = body.querySelector('#wzBar'), label = body.querySelector('#wzHeard');
      const loop = () => {
        if (token.stopped) return;
        analyser.getFloatTimeDomainData(buf);
        let p = 0;
        for (const s of buf) p = Math.max(p, Math.abs(s));
        const db = p > 0 ? 20 * Math.log10(p) : -100;
        peakHold = Math.max(db, peakHold - 0.8);
        bar.style.width = Math.max(0, Math.min(100, ((peakHold + 60) / 60) * 100)) + '%';
        heard = db > -45 ? Math.min(heard + 1, 30) : Math.max(heard - 0.2, 0);
        label.textContent = heard > 8 ? 'Hearing you' : 'Listening…';
        label.classList.toggle('ok', heard > 8);
        requestAnimationFrame(loop);
      };
      loop();
    } catch (err) {
      const label = body.querySelector('#wzHeard');
      if (label) label.textContent = 'Could not open this mic';
    }
  }

  function stopMeter() {
    if (!meter) return;
    meter.stopped = true;
    meter.stream?.getTracks().forEach((t) => t.stop());
    meter.ctx?.close();
    meter = null;
  }

  return { open, isOpen: () => !!el };
})();
