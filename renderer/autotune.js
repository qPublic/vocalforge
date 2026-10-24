// Auto-tune UI: records a short quiet section and a short speech section from the selected mic,
// then applies the suggestion from autotune-core.js. Uses globals from app.js and engine.js.

const AutoTune = (() => {
  const QUIET_S = 2.5;
  const TALK_S = 7;
  const SAMPLE = 'The quick brown fox jumps over the lazy dog. She sells sea shells by the sea shore, and Sam saw six small ships sail south.';
  const FRAME_MS = 50;

  let el, rec;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function open() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'wz-backdrop';
    el.innerHTML = '<div class="wz-card at-card" role="dialog" aria-modal="true" aria-label="Auto-tune"><button class="wz-close" aria-label="Close">×</button><div class="wz-body"></div><div class="wz-foot"><span></span><span></span><span class="at-actions"></span></div></div>';
    document.body.append(el);
    el.querySelector('.wz-close').onclick = close;
    document.addEventListener('keydown', onKey);
    intro();
  }

  function close() {
    stopRec();
    document.removeEventListener('keydown', onKey);
    el?.remove();
    el = null;
  }

  const onKey = (e) => e.key === 'Escape' && close();
  const body = () => el.querySelector('.wz-body');
  const actions = (html) => (el.querySelector('.at-actions').innerHTML = html);
  const show = (html) => {
    const b = body();
    b.className = 'wz-body enter';
    b.innerHTML = html;
  };

  function intro() {
    show(`<span class="wz-step">Auto-tune</span><h2>Tune my voice</h2>
      <p class="lead">I'll listen to your room for a couple of seconds, then to you talking for a few more, and suggest settings for the gate, EQ, de-esser and compressor. It's a starting point; fine-tune by ear afterwards.</p>
      <p class="lead">Use the same distance and volume you normally stream or talk at.</p>`);
    actions('<button class="wz-next primary" id="atGo">Start</button>');
    el.querySelector('#atGo').onclick = run;
  }

  async function run() {
    actions('');
    try {
      rec = await startRec();
    } catch (err) {
      return fail('Could not open the microphone: ' + err.message);
    }
    show(phaseHtml('Stay quiet', 'Stay quiet for a moment so I can hear your room.'));
    const silence = await collect(QUIET_S);
    if (!el) return;
    show(phaseHtml('Now talk', 'Talk normally. You can read this aloud:', SAMPLE));
    const speech = await collect(TALK_S);
    if (!el) return;
    stopRec();

    const analysis = analyze({ silence, speech });
    if (!analysis.ok) return fail(analysis.reason);
    result(analysis, suggest(analysis));
  }

  const phaseHtml = (title, text, sample = '') => `<span class="wz-step">Recording</span><h2>${title}</h2>
    <p class="lead">${text}</p>${sample ? `<p class="at-sample">${esc(sample)}</p>` : ''}
    <div class="wz-meter"><div class="bar"><i id="atLevel"></i></div><b id="atTime"></b></div>`;

  function result(analysis, s) {
    const rows = s.notes.map((n) => `<li>${esc(n)}</li>`).join('');
    show(`<span class="wz-step">Done</span><h2>Here's what I suggest</h2>
      <ul class="at-notes">${rows}</ul>
      <p class="lead">Applying changes your current settings. You can save the result as a preset afterwards.</p>`);
    actions('<button id="atCancel">Cancel</button> <button class="wz-next primary" id="atApply">Apply</button>');
    el.querySelector('#atCancel').onclick = close;
    el.querySelector('#atApply').onclick = () => {
      engine.load({ ...engine.values, ...s.values });
      showValues();
      markCustom();
      close();
    };
  }

  function fail(msg) {
    stopRec();
    show(`<span class="wz-step">Auto-tune</span><h2>That didn't work</h2><p class="lead">${esc(msg)}</p>`);
    actions('<button id="atCancel">Close</button> <button class="wz-next primary" id="atRetry">Try again</button>');
    el.querySelector('#atCancel').onclick = close;
    el.querySelector('#atRetry').onclick = run;
  }

  async function startRec() {
    const id = $('inSel').value;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: id && id !== 'default' ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(stream).connect(analyser);
    return { stream, ctx, analyser, time: new Float32Array(analyser.fftSize), bins: new Float32Array(analyser.frequencyBinCount) };
  }

  function stopRec() {
    if (!rec) return;
    rec.stream.getTracks().forEach((t) => t.stop());
    rec.ctx.close();
    rec = null;
  }

  // Collects analysis frames for `seconds`, driving the progress UI.
  function collect(seconds) {
    return new Promise((resolve) => {
      const frames = [];
      const started = performance.now();
      const timer = setInterval(() => {
        if (!rec || !el) {
          clearInterval(timer);
          return resolve(frames);
        }
        const { analyser, time, bins, ctx } = rec;
        analyser.getFloatTimeDomainData(time);
        let sum = 0;
        for (const s of time) sum += s * s;
        const rmsDb = 10 * Math.log10(Math.max(sum / time.length, 1e-12));
        analyser.getFloatFrequencyData(bins);
        frames.push({ rmsDb, bands: computeBands(bins, ctx.sampleRate, analyser.fftSize) });

        const elapsed = (performance.now() - started) / 1000;
        const level = el.querySelector('#atLevel');
        if (level) level.style.width = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100)) + '%';
        const t = el.querySelector('#atTime');
        if (t) t.textContent = Math.max(0, Math.ceil(seconds - elapsed)) + ' s';
        if (elapsed >= seconds) {
          clearInterval(timer);
          resolve(frames);
        }
      }, FRAME_MS);
    });
  }

  return { open };
})();
