// Sound pack browser: lists packs from the curated catalog and installs them in one click.
// Uses globals: Soundboard, $.

const Catalog = (() => {
  let el;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function open() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'wz-backdrop';
    el.innerHTML = '<div class="wz-card cat-card" role="dialog" aria-modal="true" aria-label="Sound packs"><button class="wz-close" aria-label="Close">×</button><div class="wz-body"></div></div>';
    document.body.append(el);
    el.querySelector('.wz-close').onclick = close;
    el.addEventListener('mousedown', (e) => e.target === el && close());
    document.addEventListener('keydown', onKey);
    load();
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    el?.remove();
    el = null;
  }

  const onKey = (e) => e.key === 'Escape' && close();
  const body = () => el.querySelector('.wz-body');

  async function load() {
    body().innerHTML = '<span class="wz-step">Soundboard</span><h2>Sound packs</h2><p class="cat-msg">Loading…</p>';
    try {
      const packs = await window.vf.listCatalog();
      if (!el) return;
      render(packs);
    } catch (err) {
      if (el) body().innerHTML = `<span class="wz-step">Soundboard</span><h2>Sound packs</h2><p class="cat-msg error">Could not load the catalog: ${esc(err.message)}. Check your internet connection.</p>`;
    }
  }

  function render(packs) {
    const rows = packs
      .map(
        (p) => `<div class="cat-pack">
          <b>${esc(p.name)}</b>
          <button data-id="${esc(p.id)}"${p.installed ? ' disabled' : ''}>${p.installed ? 'Installed' : 'Install'}</button>
          <small>${esc(p.author)} · ${esc(p.license)} · ${p.clips.length} clip${p.clips.length === 1 ? '' : 's'}</small>
          <span class="cat-clips">${esc(p.description)}${p.description ? ' ' : ''}${esc(p.clips.slice(0, 6).join(', '))}${p.clips.length > 6 ? '…' : ''}</span>
        </div>`,
      )
      .join('');
    body().innerHTML = `<span class="wz-step">Soundboard</span><h2>Sound packs</h2>
      <p class="lead">Free packs with their licenses shown. Installing copies the clips to your soundboard.</p>
      <div class="cat-list">${rows || '<p class="cat-msg">No packs yet.</p>'}</div><p class="cat-msg" id="catStatus"></p>`;
    body().querySelectorAll('.cat-pack button').forEach((b) => (b.onclick = () => install(b)));
  }

  async function install(btn) {
    const status = body().querySelector('#catStatus');
    btn.disabled = true;
    btn.textContent = 'Installing…';
    try {
      const { added, failed } = await window.vf.installPack(btn.dataset.id);
      btn.textContent = failed.length ? 'Retry' : 'Installed';
      btn.disabled = !failed.length ? true : false;
      status.className = failed.length ? 'cat-msg error' : 'cat-msg';
      status.textContent = failed.length
        ? `Added ${added.length}, ${failed.length} failed: ${failed.map((f) => `${f.file} (${f.reason})`).join(', ')}`
        : `Added ${added.length} sound${added.length === 1 ? '' : 's'}. Give them hotkeys on the soundboard.`;
      Soundboard.render();
    } catch (err) {
      btn.textContent = 'Retry';
      btn.disabled = false;
      status.className = 'cat-msg error';
      status.textContent = 'Install failed: ' + err.message;
    }
  }

  return { open };
})();
