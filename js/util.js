// Kleine UI-Helfer: Escaping, Toasts, Modals, Dialoge, Bilder, Download.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function toast(msg, type = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  box.appendChild(d);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => d.classList.add('out'), type === 'err' ? 4500 : 2200);
  setTimeout(() => d.remove(), type === 'err' ? 4900 : 2600);
}

// ── Modals ───────────────────────────────────────────────────
const stack = [];

export function openModal({ title = '', body = '', footer = '', wide = false, onClose = null } = {}) {
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-actions${footer ? '' : ' hidden'}">${footer}</div>
  </div>`;
  const md = {
    el, refresh: null, closed: false,
    close() {
      if (md.closed) return;
      md.closed = true;
      el.remove();
      const i = stack.indexOf(md);
      if (i >= 0) stack.splice(i, 1);
      document.body.classList.toggle('modal-open', stack.length > 0);
      onClose && onClose();
    },
    setBody(html) { el.querySelector('.modal-body').innerHTML = html; }
  };
  let downOnBackdrop = false;
  el.addEventListener('pointerdown', e => { downOnBackdrop = e.target === el; });
  el.addEventListener('click', e => {
    if ((e.target === el && downOnBackdrop) || e.target.closest('[data-close]')) md.close();
  });
  document.getElementById('modals').appendChild(el);
  stack.push(md);
  document.body.classList.add('modal-open');
  return md;
}

export function refreshModals() { stack.slice().forEach(m => m.refresh && m.refresh()); }
export function closeAllModals() { stack.slice().forEach(m => m.close()); }
export function hasModals() { return stack.length > 0; }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

export function confirmDialog(message, { title = 'Bist du sicher?', okText = 'OK', cancelText = 'Abbrechen', danger = false } = {}) {
  return new Promise(res => {
    let done = false;
    const md = openModal({
      title,
      body: `<p class="confirm-msg">${esc(message)}</p>`,
      footer: `<button type="button" class="ghost" data-close>${esc(cancelText)}</button><button type="button" class="${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button>`,
      onClose: () => { if (!done) { done = true; res(false); } }
    });
    const ok = md.el.querySelector('[data-ok]');
    ok.addEventListener('click', () => { done = true; res(true); md.close(); });
    ok.focus();
  });
}

export function choiceDialog({ title, message = '', choices, okText = 'OK', danger = false }) {
  return new Promise(res => {
    let done = false;
    const name = 'c' + Math.random().toString(36).slice(2);
    const md = openModal({
      title,
      body: `${message ? `<p class="confirm-msg">${esc(message)}</p>` : ''}<div class="choices">${choices.map(([v, l, d], i) =>
        `<label class="choice-opt"><input type="radio" name="${name}" value="${esc(v)}" ${i === 0 ? 'checked' : ''}><span><strong>${esc(l)}</strong>${d ? `<small>${esc(d)}</small>` : ''}</span></label>`).join('')}</div>`,
      footer: `<button type="button" class="ghost" data-close>Abbrechen</button><button type="button" class="${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button>`,
      onClose: () => { if (!done) { done = true; res(null); } }
    });
    md.el.querySelector('[data-ok]').addEventListener('click', () => {
      const v = md.el.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
      done = true; res(v); md.close();
    });
  });
}

// Liste mit Häkchen: „Was besitzt du schon?“ → Set der gewählten IDs (oder null bei Abbruch)
export function checklistDialog({ title, message = '', items, okText = 'Übernehmen' }) {
  return new Promise(res => {
    let done = false;
    const md = openModal({
      title,
      body: `${message ? `<p class="confirm-msg">${esc(message)}</p>` : ''}
        <label class="cl-item cl-all"><input type="checkbox" data-all><span><strong>Alle auswählen</strong></span></label>
        <div class="checklist">${items.map((it, i) => `<label class="cl-item${it.disabled ? ' disabled' : ''}"><input type="checkbox" value="${i}" ${it.checked ? 'checked' : ''} ${it.disabled ? 'disabled' : ''}><span><strong>${esc(it.label)}</strong>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></label>`).join('')}</div>`,
      footer: `<button type="button" class="ghost" data-close>Abbrechen</button><button type="button" class="primary" data-ok>${esc(okText)}</button>`,
      onClose: () => { if (!done) { done = true; res(null); } }
    });
    const boxes = [...md.el.querySelectorAll('.checklist input:not([disabled])')];
    const all = md.el.querySelector('[data-all]');
    const sync = () => { all.checked = boxes.length > 0 && boxes.every(b => b.checked); };
    all.addEventListener('change', () => boxes.forEach(b => { b.checked = all.checked; }));
    boxes.forEach(b => b.addEventListener('change', sync));
    sync();
    md.el.querySelector('[data-ok]').addEventListener('click', () => {
      const sel = new Set(boxes.filter(b => b.checked).map(b => items[+b.value].id));
      done = true; res(sel); md.close();
    });
  });
}

// ── Fehlertolerante Suche ────────────────────────────────────
// „spiderman“ findet „Spider-Man“, „hary poter“ findet „Harry Potter“.
const fold = s => norm(s).replace(/ß/g, 'ss');
const compact = s => fold(s).replace(/[^a-z0-9]/g, '');
const words = s => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

export function makeMatcher(query) {
  const qc = compact(query);
  if (!qc) return () => true;
  const qw = words(query);
  return hay => {
    const hc = compact(hay);
    if (hc.includes(qc)) return true;
    const hw = words(hay);
    const cand = [...hw];
    for (let i = 0; i < hw.length - 1; i++) cand.push(hw[i] + hw[i + 1]);
    return qw.every(w => {
      if (hc.includes(w)) return true;
      if (w.length < 4) return false;
      const tol = w.length >= 8 ? 2 : 1;
      return cand.some(h => dist(w, h, tol) <= tol || (h.length > w.length && dist(w, h.slice(0, w.length), tol) <= tol));
    });
  };
}

// ── Bilder ───────────────────────────────────────────────────
export function resizeImage(file, max = 600) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = e => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

export function safeUrl(v) {
  v = String(v || '').trim();
  return /^(https?:\/\/|data:image\/)/i.test(v) ? v : '';
}

export function imageField(name, label, value = '') {
  value = safeUrl(value);
  return `<div class="field full img-field" data-imgfield="${esc(name)}">
    <label>${esc(label)}</label>
    <div class="img-row">
      <div class="img-prev">${value ? `<img src="${esc(value)}" alt="">` : '<span>Kein Bild</span>'}</div>
      <div class="img-ctrls">
        <input type="url" data-imgurl placeholder="Bild-URL einfügen …" value="${value && !value.startsWith('data:') ? esc(value) : ''}">
        <div class="row">
          <label class="btn ghost small">Bild hochladen<input type="file" accept="image/*" hidden data-imgfile></label>
          <button type="button" class="ghost small" data-imgclear>Entfernen</button>
        </div>
      </div>
    </div>
    <input type="hidden" name="${esc(name)}" value="${esc(value)}">
  </div>`;
}

export function bindImageFields(root) {
  root.querySelectorAll('[data-imgfield]').forEach(w => {
    const hidden = w.querySelector('input[type=hidden]');
    const url = w.querySelector('[data-imgurl]');
    const file = w.querySelector('[data-imgfile]');
    const prev = w.querySelector('.img-prev');
    const show = v => {
      v = safeUrl(v);
      hidden.value = v;
      prev.innerHTML = v ? `<img src="${esc(v)}" alt="">` : '<span>Kein Bild</span>';
    };
    w.setImage = v => { show(v); url.value = v && !String(v).startsWith('data:') ? v : ''; };
    url.addEventListener('input', () => show(url.value.trim()));
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try { const d = await resizeImage(f); url.value = ''; show(d); }
      catch { toast('Bild konnte nicht gelesen werden', 'err'); }
      file.value = '';
    });
    w.querySelector('[data-imgclear]').addEventListener('click', () => { url.value = ''; show(''); });
  });
}

// ── Sonstiges ────────────────────────────────────────────────
export function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function hashHue(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 360;
}

export function initials(t) {
  t = String(t || '').trim();
  if (t.length <= 4) return t || '?';
  return t.split(/[\s:–-]+/).filter(Boolean).slice(0, 3).map(w => w[0]).join('').toUpperCase();
}
