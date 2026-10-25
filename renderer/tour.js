// First-run tour: a spotlight and a small card that walk through the main window.
// Relies on globals: store, persist, $. Starts after the setup wizard, or from Settings.
const Tour = (() => {
  const STEPS = [
    { target: '.devices', title: 'Pick your devices', text: 'Choose your microphone and where the processed sound goes. Start turns the mixer on. With VB-Cable, send Output to CABLE Input.' },
    { target: '.meters', title: 'Watch the levels', text: 'IN is your raw mic and OUT is what leaves VocalForge. COMP shows the compressor working and GATE shows the noise gate opening and closing.' },
    { target: '.presets', title: 'Presets', text: 'A preset sets every control at once. Try Noisy room or Blown-out mic. Save your own, and use Export and Import to share them.' },
    { target: '#panels', title: 'The voice chain', text: 'Each panel is one stage, from the input through noise suppression, gate, EQ, de-esser and compressor to the limiter. Changes apply instantly while you talk.' },
    { target: '.board:not(.desk)', title: 'Soundboard', text: 'Add clips or browse free sound packs. Give each pad a global hotkey, use the slider under a pad for its volume, and search when you have lots.' },
    { target: '#settingsBtn', title: 'Settings', text: 'Start with Windows, run in the tray, only allow hotkeys while a game is focused, the native audio engine, and this tour again.' },
  ];

  let root, spot, card, index, steps, onResize;

  const visible = (el) => !!el && !el.closest('[hidden]');

  function place() {
    const s = steps[index];
    const el = document.querySelector(s.target);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el ? el.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };
    const pad = 6;
    Object.assign(spot.style, {
      top: `${Math.max(0, r.top - pad)}px`,
      left: `${Math.max(0, r.left - pad)}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    // Put the card below the target when there is room, otherwise above, and keep it on screen.
    const cardH = card.offsetHeight || 180;
    const cardW = Math.min(card.offsetWidth || 340, window.innerWidth - 24);
    const below = r.top + r.height + pad + 12 + cardH <= window.innerHeight;
    const top = below ? r.top + r.height + pad + 12 : Math.max(12, r.top - pad - 12 - cardH);
    const left = Math.min(Math.max(12, r.left), Math.max(12, window.innerWidth - cardW - 12));
    Object.assign(card.style, { top: `${top}px`, left: `${left}px` });
  }

  function render() {
    const s = steps[index];
    const last = index === steps.length - 1;
    card.innerHTML = `<span class="tour-step">${index + 1} of ${steps.length}</span>
      <h3>${s.title}</h3>
      <p>${s.text}</p>
      <div class="tour-foot">
        <button class="tour-skip" type="button">${last ? 'Close' : 'Skip tour'}</button>
        <span class="tour-gap"></span>
        <button class="tour-back" type="button"${index === 0 ? ' hidden' : ''}>Back</button>
        <button class="tour-next primary" type="button">${last ? 'Done' : 'Next'}</button>
      </div>`;
    card.querySelector('.tour-skip').onclick = end;
    card.querySelector('.tour-back').onclick = () => go(index - 1);
    card.querySelector('.tour-next').onclick = () => (last ? end() : go(index + 1));
    place();
    card.querySelector('.tour-next').focus({ preventScroll: true });
  }

  function go(n) {
    index = Math.max(0, Math.min(steps.length - 1, n));
    render();
  }

  function onKey(e) {
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
  }

  function end() {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    root.remove();
    root = null;
    store.tourDone = true;
    persist();
  }

  function start() {
    if (root) return;
    steps = STEPS.filter((s) => visible(document.querySelector(s.target)));
    if (!steps.length) return;
    index = 0;
    root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML = '<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-modal="true" aria-label="Quick tour"></div>';
    document.body.append(root);
    spot = root.querySelector('.tour-spot');
    card = root.querySelector('.tour-card');
    onResize = () => root && place();
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
    render();
  }

  // After the setup wizard on a first run. People who already finished setup only see it from Settings.
  const maybeStart = () => {
    if (!store.tourDone) start();
  };

  return { start, maybeStart, isOpen: () => !!root };
})();
