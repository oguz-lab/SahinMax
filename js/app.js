// SahinMax – private Film- und Serienverwaltung
// Datenhaltung: Firebase Firestore (geteilt, live) oder lokaler Demo-Modus.

import * as U from './util.js';
import * as T from './tmdb.js';
import { firebaseConfig } from '../firebase-config.js';

const { $, esc, norm, toast, openModal, confirmDialog, choiceDialog, safeUrl } = U;
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const COLS = ['franchises', 'movies', 'series', 'seasons'];

const S = {
  franchises: new Map(), movies: new Map(), series: new Map(), seasons: new Map(), trash: new Map(),
  settings: {}, user: null, loaded: new Set(), demo: false, error: null
};
const UI = {
  movieGroup: 'all', seriesGroup: 'all', franchiseFilm: 'all', seriesSeason: 'all', sortMode: false,
  lib: 'all', libQ: '', libFlat: false, q: '', type: 'all', status: 'all', group: 'all', bannerHidden: false
};
let backend = null;

// ═════════════════════════════════════════════════════════════
// Backends
// ═════════════════════════════════════════════════════════════
async function firebaseBackend() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch {
    db = F.initializeFirestore(app, { ignoreUndefinedProperties: true });
  }
  let unsubs = [];
  return {
    demo: false,
    newId: col => F.doc(F.collection(db, col)).id,
    onUser: cb => A.onAuthStateChanged(auth, cb),
    login: (e, p) => A.signInWithEmailAndPassword(auth, e, p),
    reset: e => A.sendPasswordResetEmail(auth, e),
    logout: () => A.signOut(auth),
    subscribe(onCol, onErr) {
      this.unsubscribe();
      for (const col of [...COLS, 'trash']) {
        unsubs.push(F.onSnapshot(F.collection(db, col), snap => {
          const m = new Map();
          snap.forEach(d => m.set(d.id, { ...d.data(), id: d.id }));
          onCol(col, m);
        }, onErr));
      }
      unsubs.push(F.onSnapshot(F.doc(db, 'settings', 'app'), d => onCol('settings', d.exists() ? d.data() : {}), onErr));
    },
    unsubscribe() { unsubs.forEach(u => u()); unsubs = []; },
    async commit(ops) {
      for (let i = 0; i < ops.length; i += 400) {
        const b = F.writeBatch(db);
        for (const o of ops.slice(i, i + 400)) {
          const r = F.doc(db, o.col, o.id);
          if (o.type === 'delete') b.delete(r); else b.set(r, o.data, { merge: o.merge !== false });
        }
        await b.commit();
      }
    }
  };
}

function demoBackend() {
  const KEY = 'filmvault-demo-v1';
  let store = null;
  try { store = JSON.parse(localStorage.getItem(KEY)); } catch { /* leer */ }
  store = store || {};
  for (const c of [...COLS, 'trash']) store[c] = store[c] || {};
  store.settings = store.settings || { app: {} };
  let onCol = null, n = 0;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
    }
    return out;
  };
  const emit = () => {
    if (!onCol) return;
    for (const col of [...COLS, 'trash']) onCol(col, new Map(Object.entries(store[col]).map(([id, d]) => [id, { ...d, id }])));
    onCol('settings', store.settings.app || {});
  };
  return {
    demo: true,
    newId: () => 'd' + Date.now().toString(36) + (n++).toString(36) + Math.random().toString(36).slice(2, 6),
    onUser: cb => { setTimeout(() => cb({ email: 'demo@lokal' }), 0); },
    login: async () => {}, reset: async () => {},
    logout: async () => leaveDemo(),
    subscribe(cb) { onCol = cb; emit(); },
    unsubscribe() { onCol = null; },
    async commit(ops) {
      for (const o of ops) {
        store[o.col] = store[o.col] || {};
        if (o.type === 'delete') delete store[o.col][o.id];
        else store[o.col][o.id] = o.merge === false ? merge({}, o.data) : merge(store[o.col][o.id] || {}, o.data);
      }
      try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { toast('Lokaler Speicher ist voll', 'err'); }
      emit();
    }
  };
}

// ═════════════════════════════════════════════════════════════
// Start
// ═════════════════════════════════════════════════════════════
const configured = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);
const demoFlag = () => { try { return sessionStorage.getItem('fv-demo') === '1'; } catch { return false; } };

async function boot() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // Beim Zurückholen der App (iPhone) nach neuer Version suchen
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    // Neue Version aktiv → einmal neu laden (nicht mitten in einer Eingabe)
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      if (!U.hasModals() && !document.body.classList.contains('kb-open')) location.reload();
    });
  }
  // ?demo=1 erzwingt den lokalen Demo-Modus (nur Daten in diesem Browser, zum Ausprobieren)
  const forceDemo = new URLSearchParams(location.search).has('demo');
  if (!configured && !demoFlag() && !forceDemo) return renderSetup();
  try { backend = configured && !forceDemo ? await firebaseBackend() : demoBackend(); }
  catch (e) { console.error(e); return renderFatal('Die Datenbank konnte nicht geladen werden. Bist du online? Lade die Seite neu.'); }
  S.demo = backend.demo;
  backend.onUser(u => {
    S.user = u;
    backend.unsubscribe();
    S.loaded.clear(); S.error = null;
    U.closeAllModals();
    if (!u) return renderLogin();
    renderShell();
    backend.subscribe((col, val) => {
      if (col === 'settings') {
        S.settings = val || {};
        T.setKeys({ tmdb: S.settings.tmdbKey || '', omdb: S.settings.omdbKey || '' });
      } else S[col] = val;
      S.loaded.add(col);
      schedule();
    }, err => { console.error(err); S.error = err; schedule(); });
    renderView(true);
  });
}

function leaveDemo() {
  try { sessionStorage.removeItem('fv-demo'); } catch { /* egal */ }
  location.hash = '';
  location.reload();
}

// ═════════════════════════════════════════════════════════════
// Schreib-Helfer
// ═════════════════════════════════════════════════════════════
const newId = col => backend.newId(col);
const setOp = (col, id, data, merge = true) => ({ type: 'set', col, id, merge, data: { ...data, updatedAt: Date.now(), updatedBy: S.user?.email || '' } });
const delOp = (col, id) => ({ type: 'delete', col, id });

function run(ops) {
  if (!ops.length) return Promise.resolve();
  return backend.commit(ops).catch(e => {
    console.error(e);
    toast('Speichern fehlgeschlagen: ' + (e.code === 'permission-denied' ? 'keine Berechtigung' : (e.message || e.code)), 'err');
  });
}

function trashOps(entries, label, detached = []) {
  const main = entries[0];
  const strip = d => { const { id, ...rest } = d; return rest; };
  return [
    setOp('trash', `${main.col}__${main.id}`, {
      label, deletedAt: Date.now(), deletedBy: S.user?.email || '', detached,
      items: entries.map(e => ({ col: e.col, id: e.id, data: strip(S[e.col].get(e.id)) }))
    }, false),
    ...entries.map(e => delOp(e.col, e.id))
  ];
}

// ═════════════════════════════════════════════════════════════
// Abgeleitete Daten
// ═════════════════════════════════════════════════════════════
const arr = m => [...m.values()];
const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const intOrNull = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
const str = v => String(v ?? '').trim();
const byTitle = (a, b) => String(a.title || a.name).localeCompare(String(b.title || b.name), 'de');
const byOrder = (a, b) => (num(a.order) ?? 1e9) - (num(b.order) ?? 1e9) || (num(a.year) || 0) - (num(b.year) || 0) || byTitle(a, b);
const frOf = m => (m.franchiseId && S.franchises.has(m.franchiseId)) ? m.franchiseId : null;
const moviesIn = fid => arr(S.movies).filter(m => frOf(m) === (fid || null)).sort(byOrder);
const seasonsOf = sid => arr(S.seasons).filter(s => s.seriesId === sid).sort((a, b) => (a.number || 0) - (b.number || 0));
const franchisesSorted = () => arr(S.franchises).sort((a, b) => a.name.localeCompare(b.name, 'de'));
const seriesSorted = () => arr(S.series).sort(byTitle);
const ownedCount = items => items.filter(i => i.owned).length;
const ratio = items => items.length ? ownedCount(items) / items.length : 0;

function gstat(items) {
  if (!items.length) return 'empty';
  const o = ownedCount(items);
  return o === items.length ? 'complete' : o === 0 ? 'none' : 'partial';
}
const GLABEL = { complete: 'Vollständig', partial: 'Unvollständig', none: 'Nicht begonnen', empty: 'Leer' };
const GROUP_OPTS = [['all', 'Alle'], ['complete', 'Vollständig'], ['incomplete', 'Unvollständig']];
const coversOf = (ms, fallback = '') => { const c = ms.map(m => m.poster).filter(Boolean); return c.length ? c : (fallback ? [fallback] : []); };
function groupMatch(st, g) {
  return g === 'all' || (g === 'complete' && st === 'complete') || (g === 'incomplete' && (st === 'partial' || st === 'none')) || (g === 'none' && (st === 'none' || st === 'empty'));
}
const frImage = (f, ms) => f.image || ms.find(m => m.backdrop)?.backdrop || ms.find(m => m.poster)?.poster || '';
const findFranchiseFor = c => arr(S.franchises).find(x => x.tmdbCollectionId && x.tmdbCollectionId === c.tmdbCollectionId) || arr(S.franchises).find(x => norm(x.name) === norm(c.name));
const parseImdb = v => (String(v || '').match(/tt\d{5,}/) || [''])[0];

// ═════════════════════════════════════════════════════════════
// Bausteine (HTML)
// ═════════════════════════════════════════════════════════════
function grad(t) { const h = U.hashHue(t); return `background:linear-gradient(135deg,hsl(${h} 45% 30%),hsl(${(h + 50) % 360} 50% 13%))`; }
function poster(url, title, cls = 'poster') {
  url = safeUrl(url);
  return `<div class="${cls}"><div class="ph" style="${grad(title)}">${esc(U.initials(title))}</div>${url ? `<img loading="lazy" src="${esc(url)}" alt="" onerror="this.remove()">` : ''}</div>`;
}
const badge = st => `<span class="badge ${st}">${GLABEL[st]}</span>`;
const progress = (own, total) => `<div class="progress" role="progressbar" aria-valuenow="${own}" aria-valuemax="${total}"><span style="width:${total ? Math.round(own / total * 100) : 0}%"></span></div>`;
const pageHead = (title, sub = '', actions = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
const empty = (msg, action = '') => `<div class="empty"><p>${esc(msg)}</p>${action}</div>`;
const chips = (key, opts) => `<div class="chips">${opts.map(([v, l]) => `<button class="chip ${UI[key] === v ? 'active' : ''}" data-act="setFilter" data-key="${key}" data-val="${v}">${esc(l)}</button>`).join('')}</div>`;

const vintedUrl = q => 'https://www.vinted.de/catalog?search_text=' + encodeURIComponent(String(q).trim());
const vMovie = m => vintedUrl(m.title + (S.settings.vintedYear !== false && m.year ? ' ' + m.year : ''));
const vSeason = (se, s) => vintedUrl(`${se.name} Staffel ${s.number}`);
const vintedBtn = (url, label = 'Auf Vinted suchen', cls = '') => `<a class="btn vinted small ${cls}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const imdbBtn = id => id ? `<a class="btn ghost small" href="https://www.imdb.com/title/${esc(id)}/" target="_blank" rel="noopener">IMDb ↗</a>` : '';
// Kompaktes Vinted-Symbol (Einkaufstüte) für Listen und Cover
const BAG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 8h13l-1 12.5h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>';
const vintedIcon = (url, cls = '') => `<a class="v-icon ${cls}" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Auf Vinted suchen" title="Auf Vinted suchen">${BAG}</a>`;
const ownBadge = owned => owned ? '<span class="own-badge" title="Gekauft" aria-label="Gekauft"></span>' : '';
// Fortschrittsring (z. B. 3/5)
function ring(own, total, size = 44, label = `${own}/${total}`) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, p = total ? own / total : 0;
  return `<span class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="${own} von ${total}">
    <svg viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>
    <b>${esc(label)}</b></span>`;
}
// Unscharfes Hintergrundbild für Detailansichten
const bgLayer = (url, cls = 'blur-bg') => { url = safeUrl(url); return url ? `<div class="${cls}" style="background-image:url(&quot;${esc(url.replace(/"/g, '%22'))}&quot;)"></div>` : ''; };

// Hintergrundbilder (Szenenbilder) bei Bedarf einmalig von TMDb nachladen
const triedBackdrop = new Set();
function ensureBackdrop(col, item) {
  if (!item || item.backdrop || !item.tmdbId || !T.hasTmdb() || triedBackdrop.has(item.id)) return;
  triedBackdrop.add(item.id);
  T.backdropFor(col === 'series' ? 'tv' : 'movie', item.tmdbId).then(b => { if (b) run([setOp(col, item.id, { backdrop: b })]); }).catch(() => {});
}
const fmtRuntime = m => { m = intOrNull(m); if (!m) return ''; return m >= 60 ? `${Math.floor(m / 60)} Std. ${m % 60} Min.` : `${m} Min.`; };
const fmtPrice = p => num(p) == null ? '' : num(p).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const fmtDate = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('de-DE'); };

function ratings(x) {
  const r = [];
  if (x.imdbRating) r.push(`<span class="rating imdb">IMDb ${esc(x.imdbRating)}</span>`);
  if (x.rating) r.push(`<span class="rating">TMDb ${esc(x.rating)}</span>`);
  return r.join('');
}

// Eindeutiger Status: Kästchen „Gekauft“ – angehakt = besitze ich, leer = fehlt noch.
function checkBtn(act, id, owned, cls = '') {
  return `<button class="check ${owned ? 'on' : ''} ${cls}" data-act="${act}" data-id="${esc(id)}" aria-pressed="${owned}" title="${owned ? 'Gekauft – antippen, um als fehlend zu markieren' : 'Noch nicht gekauft – antippen zum Abhaken'}"><span class="cb" aria-hidden="true"></span><span class="cl">Gekauft</span></button>`;
}

// Cover-Karte: Antippen = Details, lange drücken = gekauft/fehlt umschalten.
// Gekauft = farbig mit grünem Haken, fehlt = ausgegraut mit Vinted-Symbol.
function movieCard(m, sort = false) {
  const meta = [m.year, m.format].filter(Boolean).join(' · ');
  return `<article class="card ${m.owned ? 'owned' : 'missing'}" data-act="openMovie" data-long="toggleMovie" data-id="${esc(m.id)}" role="button" tabindex="0">
    <div class="card-media">${poster(m.poster, m.title)}${ownBadge(m.owned)}
      ${m.owned ? '' : vintedIcon(vMovie(m), 'on-cover')}
      ${m.order != null && frOf(m) ? `<span class="order">${esc(m.order)}</span>` : ''}
    </div>
    <div class="card-body"><h3>${esc(m.title)}</h3><div class="meta">${esc(meta)}</div>
      ${sort ? `<div class="card-actions"><button class="ghost small" data-act="moveMovie" data-id="${esc(m.id)}" data-dir="-1" aria-label="Nach vorne">◀</button><button class="ghost small" data-act="moveMovie" data-id="${esc(m.id)}" data-dir="1" aria-label="Nach hinten">▶</button></div>` : ''}
    </div></article>`;
}

function seasonPosterCard(se, s) {
  return `<article class="card ${s.owned ? 'owned' : 'missing'}" data-act="openSeason" data-long="toggleSeason" data-id="${esc(s.id)}" role="button" tabindex="0">
    <div class="card-media">${poster(s.poster || se.poster, 'S' + s.number)}${ownBadge(s.owned)}${s.owned ? '' : vintedIcon(vSeason(se, s), 'on-cover')}</div>
    <div class="card-body"><h3>Staffel ${esc(s.number)}</h3><div class="meta">${esc([s.name, s.year].filter(Boolean).join(' · ')) || '&nbsp;'}</div></div></article>`;
}

// Mehrere Cover nebeneinander als Vorschaubild
function collage(covers, title, cls = 'tile-art') {
  const c = covers.map(safeUrl).filter(Boolean).slice(0, 4);
  if (!c.length) return poster('', title, cls);
  return `<div class="${cls} collage n${c.length}"><div class="ph" style="${grad(title)}"></div>${c.map(u => `<img loading="lazy" src="${esc(u)}" alt="" onerror="this.style.visibility='hidden'">`).join('')}</div>`;
}
function coverStack(covers, title) {
  const c = covers.map(safeUrl).filter(Boolean).slice(0, 3);
  if (!c.length) return `<span class="stack">${poster('', title, 'thumb')}</span>`;
  return `<span class="stack n${c.length}">${c.map(u => `<span class="thumb"><img loading="lazy" src="${esc(u)}" alt=""></span>`).join('')}</span>`;
}

function groupTile(href, name, covers, items, unit) {
  const st = gstat(items), own = ownedCount(items);
  return `<a class="tile" href="${href}">${collage(covers, name)}
    <div class="tile-body"><div class="tile-title">${esc(name)}</div>
    <div class="tile-sub">${badge(st)}<span>${own}/${items.length} ${unit}</span></div>${progress(own, items.length)}</div></a>`;
}

// Auf-/zuklappbare Gruppen (Zustand pro Gerät gemerkt)
const OPEN_DEFAULT = { filme: false, serien: false, mediathek: false };
function openState(view) {
  try { const s = JSON.parse(localStorage.getItem('fv-open2-' + view)); if (s && Array.isArray(s.t)) return s; } catch { /* egal */ }
  return { def: OPEN_DEFAULT[view], t: [] };
}
function saveOpenState(view, s) { try { localStorage.setItem('fv-open2-' + view, JSON.stringify(s)); } catch { /* egal */ } }
const isOpen = (view, gid) => { const s = openState(view); return s.t.includes(gid) ? !s.def : s.def; };

function groupBlock({ view, gid, title, covers, sub, actions = '', body }) {
  const open = isOpen(view, gid);
  return `<section class="group ${open ? 'open' : ''}">
    <div class="group-head">
      <button class="group-toggle" data-act="toggleGroup" data-view="${view}" data-gid="${esc(gid)}" aria-expanded="${open}">
        <span class="chev" aria-hidden="true">›</span>${coverStack(covers, title)}
        <span class="g-text"><span class="g-title">${esc(title)}</span><span class="g-sub">${sub}</span></span>
      </button>
    </div>
    <div class="group-body">${actions ? `<div class="group-actions">${actions}</div>` : ''}${body}</div>
  </section>`;
}
const groupTools = view => `<div class="group-tools"><button class="link" data-act="setAllGroups" data-view="${view}" data-val="open">Alle aufklappen</button><button class="link" data-act="setAllGroups" data-view="${view}" data-val="closed">Alle zuklappen</button></div>`;

function itemRow(it) {
  if (!it) return '';
  const tag = it.href ? `a href="${esc(it.href)}"` : 'div';
  const open = it.open ? ` data-act="${it.open}" data-id="${esc(it.id)}" role="button" tabindex="0"` : '';
  return `<div class="row-item ${it.owned === true ? 'owned' : it.owned === false ? 'missing' : ''}">
    <${tag} class="row-main"${open}>${poster(it.img, it.thumbTitle || it.title, 'thumb')}<div class="row-text"><div class="row-title">${esc(it.title)}</div><div class="row-sub">${it.sub}</div></div></${it.href ? 'a' : 'div'}>
    <div class="row-actions">${it.vinted ? vintedIcon(it.vinted) : ''}${it.toggle ? checkBtn(it.toggle, it.id, it.owned) : ''}</div>
  </div>`;
}

function movieItem(m) {
  const fr = frOf(m) && S.franchises.get(m.franchiseId);
  return {
    id: m.id, title: m.title, img: m.poster, owned: !!m.owned, toggle: 'toggleMovie', open: 'openMovie',
    vinted: m.owned ? null : vMovie(m),
    sub: esc(['Film', m.year, fr?.name].filter(Boolean).join(' · '))
  };
}
function seasonItem(s) {
  const se = S.series.get(s.seriesId);
  if (!se) return null;
  return {
    id: s.id, title: `${se.name} – Staffel ${s.number}`, thumbTitle: se.name, img: s.poster || se.poster, owned: !!s.owned,
    toggle: 'toggleSeason', href: '#/serie/' + se.id, vinted: s.owned ? null : vSeason(se, s),
    sub: esc(['Staffel', s.name, s.year].filter(Boolean).join(' · '))
  };
}
function franchiseItem(f) {
  const ms = moviesIn(f.id);
  return { id: f.id, title: f.name, img: coversOf(ms, f.image)[0], href: '#/franchise/' + f.id, sub: `Franchise · ${ownedCount(ms)}/${ms.length} Filme · ${badge(gstat(ms))}` };
}
function seriesItem(se) {
  const ss = seasonsOf(se.id);
  return { id: se.id, title: se.name, img: se.poster, href: '#/serie/' + se.id, sub: `Serie · ${ownedCount(ss)}/${ss.length} Staffeln · ${badge(gstat(ss))}` };
}

// ═════════════════════════════════════════════════════════════
// Rahmen, Login, Setup
// ═════════════════════════════════════════════════════════════
const NAV = [['', 'Start', '⌂'], ['filme', 'Filme', '🎬'], ['serien', 'Serien', '📺'], ['mediathek', 'Mediathek', '♥'], ['suche', 'Suche', '🔍']];

function renderShell() {
  document.body.classList.remove('kb-open');
  $('#app').innerHTML = `
  <header class="topbar">
    <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e14cff"/><stop offset=".5" stop-color="#7b3bff"/><stop offset="1" stop-color="#18d8ff"/></linearGradient></defs></svg>
    <a class="brand" href="#/"><img class="logo-img" src="icons/logo-mark.png" alt=""><span>Sahin<span class="grad-t">Max</span></span></a>
    <nav class="nav" id="nav">${NAV.map(([r, l, i]) => `<a href="#/${r}" data-nav="${r}"><span class="ni" aria-hidden="true">${i}</span><span>${l}</span></a>`).join('')}</nav>
    <div class="top-actions">
      <button class="primary" data-act="add" aria-label="Hinzufügen">＋<span class="hide-sm"> Hinzufügen</span></button>
      <a class="icon-btn" href="#/einstellungen" aria-label="Einstellungen" data-nav="einstellungen">⚙</a>
    </div>
  </header>
  <div id="banner" class="banner-wrap"></div>
  <main id="view" class="view"></main>`;
}

// Benutzernamen ohne „@“ werden intern zu name@sahinmax.local (Firebase braucht eine E-Mail-Form).
const USER_DOMAIN = '@sahinmax.local';
const loginId = v => { v = String(v || '').trim().toLowerCase(); return v.includes('@') ? v : v + USER_DOMAIN; };
const displayUser = e => String(e || '').endsWith(USER_DOMAIN) ? e.slice(0, -USER_DOMAIN.length) : String(e || '');

function renderLogin() {
  $('#app').innerHTML = `<div class="auth-wrap"><form class="auth-card" id="loginForm">
    <img class="logo-full" src="icons/logo-full.png" alt="SahinMax"><p class="muted">Deine private Film- und Serienverwaltung. Bitte melde dich an.</p>
    <div class="field"><label for="le">Benutzername oder E-Mail</label><input id="le" name="email" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>
    <div class="field"><label for="lp">Passwort</label><input id="lp" name="password" type="password" autocomplete="current-password" required></div>
    <button class="primary full" type="submit">Anmelden</button>
    <button type="button" class="link" id="forgot">Passwort vergessen?</button>
    <p class="err" id="loginErr" role="alert"></p>
  </form></div>`;
  const ERR = {
    'auth/invalid-credential': 'E-Mail oder Passwort ist falsch.', 'auth/wrong-password': 'E-Mail oder Passwort ist falsch.',
    'auth/user-not-found': 'E-Mail oder Passwort ist falsch.', 'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
    'auth/too-many-requests': 'Zu viele Versuche – bitte kurz warten.', 'auth/network-request-failed': 'Keine Internetverbindung.',
    'auth/user-disabled': 'Dieses Konto ist deaktiviert.'
  };
  const form = $('#loginForm'), errEl = $('#loginErr');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.textContent = '';
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try { await backend.login(loginId(form.email.value), form.password.value); }
    catch (err) { errEl.textContent = ERR[err.code] || ('Anmeldung fehlgeschlagen (' + (err.code || err.message) + ')'); }
    btn.disabled = false;
  });
  $('#forgot').addEventListener('click', async () => {
    const raw = form.email.value.trim();
    if (!raw) { errEl.textContent = 'Bitte zuerst deinen Benutzernamen oder deine E-Mail eintragen.'; return; }
    if (!raw.includes('@')) { errEl.textContent = 'Bei einem Benutzernamen kann das Passwort nur in der Firebase-Konsole zurückgesetzt werden. Frag die Person, die die App eingerichtet hat.'; return; }
    const email = raw;
    try { await backend.reset(email); errEl.textContent = ''; toast('E-Mail zum Zurücksetzen wurde gesendet (falls das Konto existiert).'); }
    catch (err) { errEl.textContent = ERR[err.code] || 'Konnte keine E-Mail senden.'; }
  });
}

function renderSetup() {
  $('#app').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <img class="logo-full" src="icons/logo-full.png" alt="SahinMax"><h1>Einrichten</h1>
    <p class="muted">Die Verbindung zur Datenbank ist noch nicht eingetragen. Trage die Werte deines Firebase-Projekts in die Datei <code>firebase-config.js</code> ein. Die Schritt-für-Schritt-Anleitung steht in der <code>README.md</code>.</p>
    <button class="primary full" id="demoBtn">Demo ansehen (Daten nur in diesem Browser)</button>
  </div></div>`;
  $('#demoBtn').addEventListener('click', () => { try { sessionStorage.setItem('fv-demo', '1'); } catch { /* egal */ } boot(); });
}

function renderFatal(msg) {
  $('#app').innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="logo big">!</div><h1>Fehler</h1><p class="muted">${esc(msg)}</p><button class="primary full" onclick="location.reload()">Neu laden</button></div></div>`;
}

function renderBanner() {
  const b = $('#banner');
  if (!b) return;
  const parts = [];
  if (S.demo) parts.push(`<div class="banner info">Demo-Modus: Die Daten liegen nur in diesem Browser. <button class="link" data-act="leaveDemo">Demo beenden</button></div>`);
  if (!navigator.onLine) parts.push(`<div class="banner warn">Offline – Änderungen werden gespeichert und synchronisiert, sobald du wieder online bist.</div>`);
  const last = S.settings.lastExport, cnt = S.movies.size + S.series.size;
  let hintOff = false;
  try { hintOff = localStorage.getItem('fv-install-hint') === '1'; } catch { /* egal */ }
  if (!isStandalone() && !hintOff) {
    if (isIOS()) parts.push(`<div class="banner info">📱 Als App nutzen: Tippe in Safari auf <strong>Teilen</strong> <span aria-hidden="true">⬆︎</span> und dann auf <strong>„Zum Home-Bildschirm“</strong>. <button class="link" data-act="hideInstall">Ausblenden</button></div>`);
    else if (installPrompt) parts.push(`<div class="banner info">📱 SahinMax als App installieren? <button class="link" data-act="installApp">Installieren</button><button class="link" data-act="hideInstall">Ausblenden</button></div>`);
  }
  if (!S.demo && !UI.bannerHidden && cnt > 0 && S.loaded.has('movies') && (!last || Date.now() - last > 30 * 864e5)) {
    parts.push(`<div class="banner">${last ? `Dein letztes Backup ist ${Math.floor((Date.now() - last) / 864e5)} Tage alt.` : 'Du hast noch kein Backup exportiert.'} <button class="link" data-act="exportJson">Jetzt sichern</button><button class="link" data-act="hideBanner">Später</button></div>`);
  }
  b.innerHTML = parts.join('');
}

// ═════════════════════════════════════════════════════════════
// Router
// ═════════════════════════════════════════════════════════════
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name = '', id] = h.split('/');
  return { name, id: id ? decodeURIComponent(id) : '' };
}

let lastKey = null, raf = 0;
function schedule() {
  if (raf) return;
  raf = setTimeout(() => { raf = 0; renderView(false); U.refreshModals(); }, 16);
}

const VIEWS = {};
function renderView(force) {
  const v = $('#view');
  if (!v) return;
  const r = route();
  const key = location.hash || '#/';
  const fresh = force || key !== lastKey;
  lastKey = key;
  const navKey = { franchise: 'filme', serie: 'serien', statistik: '' }[r.name] ?? r.name;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
  renderBanner();
  if (S.error) {
    const denied = S.error.code === 'permission-denied';
    v.innerHTML = `<div class="empty"><h2>${denied ? 'Kein Zugriff' : 'Verbindungsproblem'}</h2><p>${denied
      ? `Dein Konto (${esc(S.user?.email)}) ist nicht freigeschaltet. Trage genau diese Adresse in den Firestore-Regeln ein (siehe README).`
      : esc(S.error.message || 'Unbekannter Fehler')}</p><button class="ghost" data-act="logout">Abmelden</button></div>`;
    return;
  }
  if (!COLS.every(c => S.loaded.has(c))) {
    if (fresh) v.innerHTML = '<div class="loading"><div class="spinner"></div>Lade Sammlung …</div>';
    return;
  }
  (VIEWS[r.name] || VIEWS[''])(v, r.id, fresh);
}

window.addEventListener('hashchange', () => { document.body.classList.remove('kb-open'); U.closeAllModals(); UI.sortMode = false; window.scrollTo(0, 0); renderView(true); });
let installPrompt = null;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; renderBanner(); });
if (isStandalone()) document.documentElement.classList.add('standalone');
window.addEventListener('online', renderBanner);
window.addEventListener('offline', renderBanner);

// ═════════════════════════════════════════════════════════════
// Ansichten
// ═════════════════════════════════════════════════════════════
VIEWS[''] = function viewHome(v) {
  const ms = arr(S.movies), ss = arr(S.seasons);
  const mo = ownedCount(ms), so = ownedCount(ss);
  if (!ms.length && !S.series.size) {
    v.innerHTML = `<section class="hero"><div><div class="eyebrow">Willkommen</div><h1>Deine Sammlung ist noch leer.</h1>
      <p>Übernimm deine vorhandene Sammlung mit einem Klick – oder lege Franchises, Filme und Serien selbst an.</p>
      <div class="actions"><button class="primary" data-act="loadStartData">⬇ Meine Sammlung übernehmen</button><button class="ghost" data-act="add">＋ Selbst anlegen</button><a class="btn ghost" href="#/einstellungen">Backup importieren</a></div></div></section>`;
    return;
  }
  // Großes Titelbild: zuletzt gekaufter Film
  const ownedAt = x => x.ownedAt || x.updatedAt || x.createdAt || 0;
  const recent = ms.filter(m => m.owned).sort((a, b) => ownedAt(b) - ownedAt(a));
  const feat = recent[0] || ms[0];
  ensureBackdrop('movies', feat);
  const featFr = feat && frOf(feat) && S.franchises.get(feat.franchiseId);

  // Wisch-Reihe: Als Nächstes kaufen (Reihen, die schon fast komplett sind, zuerst)
  const next = [];
  franchisesSorted().forEach(f => {
    const it = moviesIn(f.id);
    if (gstat(it) === 'partial') it.filter(m => !m.owned).forEach(m => next.push({ r: ratio(it), html: movieCard(m) }));
  });
  seriesSorted().forEach(se => {
    const it = seasonsOf(se.id);
    if (gstat(it) === 'partial') { const s = it.find(x => !x.owned); next.push({ r: ratio(it), html: seasonPosterCard(se, s).replace('<h3>Staffel', `<h3>${esc(se.name)} · Staffel`) }); }
  });
  next.sort((a, b) => b.r - a.r);

  // Wisch-Reihe: Fast komplett
  const groups = [
    ...franchisesSorted().map(f => { const it = moviesIn(f.id); return { href: '#/franchise/' + f.id, name: f.name, cover: coversOf(it, f.image)[0], it }; }),
    ...seriesSorted().map(se => ({ href: '#/serie/' + se.id, name: se.name, cover: se.poster, it: seasonsOf(se.id) }))
  ].filter(g => gstat(g.it) === 'partial').sort((a, b) => ratio(b.it) - ratio(a.it)).slice(0, 12);

  const items = ms.length + ss.length, done = mo + so, pct = items ? Math.round(done / items * 100) : 0;
  const shelf = (title, cards, link = '') => cards.length ? `<section class="shelf"><div class="section-head"><h2>${title}</h2>${link}</div><div class="shelf-row">${cards.join('')}</div></section>` : '';

  v.innerHTML = `${feat ? `<section class="feature">${bgLayer(feat.backdrop || feat.poster, 'feature-bg' + (feat.backdrop ? '' : ' soft'))}
      <div class="feature-body">
        <div class="eyebrow">${recent.length ? 'Zuletzt gekauft' : 'Aus deiner Sammlung'}</div>
        <h1>${esc(feat.title)}</h1>
        <div class="feature-meta">${esc([feat.year, featFr?.name, (feat.genres || '').split(',')[0]].filter(Boolean).join(' · '))}</div>
        <div class="actions"><button class="primary" data-act="openMovie" data-id="${esc(feat.id)}">Details</button><a class="btn ghost" href="#/mediathek">Zur Mediathek</a></div>
      </div></section>` : ''}
    <a class="ring-strip" href="#/statistik">${ring(done, items, 56, pct + '%')}
      <span class="rs-text"><strong>${pct} % deiner Sammlung komplett</strong><span>${mo} von ${ms.length} Filmen · ${so} von ${ss.length} Staffeln</span></span>
      <span class="rs-more">Statistik ›</span></a>
    ${shelf('Zuletzt gekauft', recent.slice(0, 15).map(m => movieCard(m)), '<a class="link" href="#/mediathek">Alle ›</a>')}
    ${shelf('Als Nächstes kaufen', next.slice(0, 15).map(n => n.html), '<button class="link" data-act="shopping">Einkaufsliste ›</button>')}
    ${shelf('Fast komplett', groups.map(g => `<a class="card shelf-group" href="${g.href}"><div class="card-media">${poster(g.cover, g.name)}${ring(ownedCount(g.it), g.it.length, 40)}</div><div class="card-body"><h3>${esc(g.name)}</h3><div class="meta">${ownedCount(g.it)} von ${g.it.length}</div></div></a>`))}
    <p class="hint-line">Tipp: Cover <strong>lange drücken</strong>, um einen Film schnell als gekauft abzuhaken.</p>`;
};

// Reiter „Filme“ = Wunschliste: fehlende Einzelfilme + unvollständige Reihen.
// Vollständige Reihen und gekaufte Einzelfilme stehen in der Mediathek.
VIEWS.filme = function viewMovies(v) {
  const looseMissing = moviesIn(null).filter(m => !m.owned);
  const groups = franchisesSorted().map(f => ({ f, ms: moviesIn(f.id) })).filter(g => gstat(g.ms) !== 'complete');
  const missingCount = arr(S.movies).filter(m => !m.owned).length;
  let html = '';
  if (looseMissing.length) html += groupBlock({
    view: 'filme', gid: '_', title: 'Einzelne Filme', covers: coversOf(looseMissing),
    sub: `${looseMissing.length} fehlen`,
    actions: `<button class="ghost small" data-act="addMovie">＋ Film hinzufügen</button>`,
    body: `<div class="cards">${looseMissing.map(m => movieCard(m)).join('')}</div>`
  });
  for (const { f, ms } of groups) {
    const own = ownedCount(ms), st = gstat(ms);
    html += groupBlock({
      view: 'filme', gid: f.id, title: f.name, covers: coversOf(ms, f.image),
      sub: `${badge(st)}<span>${own} von ${ms.length} gekauft</span>${progress(own, ms.length)}`,
      actions: `${ms.length ? vintedBtn(vintedUrl(f.name), 'Reihe auf Vinted') : ''}
        ${ms.length ? `<button class="success small" data-act="bulkFranchise" data-id="${esc(f.id)}">✓ Alle gekauft</button>` : ''}
        <button class="ghost small" data-act="addMovie" data-fr="${esc(f.id)}">＋ Film</button>
        <a class="btn ghost small" href="#/franchise/${esc(f.id)}">✎ Bearbeiten</a>`,
      body: ms.length ? `<div class="cards">${ms.map(m => movieCard(m)).join('')}</div>` : '<p class="muted">Noch keine Filme in dieser Reihe.</p>'
    });
  }
  v.innerHTML = `${pageHead('Filme', missingCount ? `${missingCount} Filme fehlen dir noch – vollständige Reihen findest du in der Mediathek.` : 'Dir fehlt gerade nichts. Alles ist in deiner Mediathek.', `<button class="ghost" data-act="addFranchise">＋ Franchise</button><button class="primary" data-act="addMovie">＋ Film</button>`)}
    ${html ? groupTools('filme') + html : empty(S.movies.size ? 'Alle Reihen sind vollständig 🎉' : 'Noch keine Filme angelegt.', S.movies.size ? '<a class="btn ghost" href="#/mediathek">Zur Mediathek</a>' : '<button class="primary" data-act="addFranchise">＋ Erstes Franchise anlegen</button>')}`;
};

VIEWS.franchise = function viewFranchise(v, id) {
  const pseudo = id === '_';
  const f = pseudo ? { id: '_', name: 'Einzelne Filme', desc: 'Filme, die keinem Franchise zugeordnet sind.' } : S.franchises.get(id);
  if (!f) { v.innerHTML = empty('Dieses Franchise gibt es nicht (mehr).', '<a class="btn ghost" href="#/filme">← Zu den Filmen</a>'); return; }
  const all = moviesIn(pseudo ? null : id), st = gstat(all), own = ownedCount(all);
  const list = all.filter(m => UI.franchiseFilm === 'all' || (UI.franchiseFilm === 'owned') === !!m.owned);
  const sort = UI.sortMode && UI.franchiseFilm === 'all' && !pseudo;
  const back = st === 'complete' && !pseudo ? ['#/mediathek', 'Mediathek'] : ['#/filme', 'Filme'];
  const bgMovie = all.find(m => m.backdrop) || all[0];
  if (!pseudo) ensureBackdrop('movies', bgMovie);
  v.innerHTML = `<a class="back" href="${back[0]}">← ${back[1]}</a>
    <section class="dhero">${bgLayer(bgMovie?.backdrop || bgMovie?.poster || f.image)}${collage(coversOf(all, f.image), f.name, 'dhero-art')}<div class="dhero-body">
      <div class="eyebrow">${pseudo ? 'Sammlung' : 'Franchise'}</div><h1>${esc(f.name)}</h1>
      <div class="dhero-meta">${badge(st)}<span>${own} von ${all.length} Filmen gekauft</span></div>${progress(own, all.length)}
      ${f.desc ? `<p class="desc">${esc(f.desc)}</p>` : ''}
      <div class="actions">
        ${!pseudo && all.length ? `<button class="${st === 'complete' ? 'ghost' : 'success'}" data-act="bulkFranchise" data-id="${esc(f.id)}">${st === 'complete' ? 'Alle als fehlend markieren' : '✓ Ganze Reihe abhaken'}</button>` : ''}
        ${!pseudo && st !== 'complete' ? vintedBtn(vintedUrl(f.name), 'Reihe auf Vinted') : ''}
        <button class="ghost" data-act="addMovie" data-fr="${esc(f.id)}">＋ Film</button>
        ${!pseudo && T.hasTmdb() ? `<button class="ghost" data-act="${f.tmdbCollectionId ? 'importCollection' : 'linkCollection'}" data-cid="${esc(f.tmdbCollectionId || '')}" data-id="${esc(f.id)}">↻ Filme von TMDb ergänzen</button>` : ''}
        ${!pseudo && all.length > 1 ? `<button class="ghost" data-act="toggleSort">${UI.sortMode ? '✓ Fertig sortiert' : '⇅ Reihenfolge'}</button>` : ''}
        ${!pseudo ? `<button class="ghost" data-act="editFranchise" data-id="${esc(f.id)}">✎ Bearbeiten</button><button class="danger" data-act="deleteFranchise" data-id="${esc(f.id)}">Löschen</button>` : ''}
      </div></div></section>
    ${chips('franchiseFilm', [['all', 'Alle'], ['owned', 'Gekauft'], ['missing', 'Fehlt noch']])}
    ${list.length ? `<div class="cards">${list.map(m => movieCard(m, sort)).join('')}</div>` : empty(all.length ? 'Keine Filme in dieser Ansicht.' : 'Noch keine Filme in diesem Franchise.', all.length ? '' : `<button class="primary" data-act="addMovie" data-fr="${esc(f.id)}">＋ Film hinzufügen</button>`)}`;
};

// Reiter „Serien“ = nur Serien, bei denen noch Staffeln fehlen.
VIEWS.serien = function viewSeries(v) {
  const list = seriesSorted().map(se => ({ se, ss: seasonsOf(se.id) })).filter(x => gstat(x.ss) !== 'complete');
  const missing = arr(S.seasons).filter(s => !s.owned && S.series.has(s.seriesId)).length;
  const html = list.map(({ se, ss }) => {
    const own = ownedCount(ss);
    return groupBlock({
      view: 'serien', gid: se.id, title: se.name, covers: [se.poster],
      sub: `${badge(gstat(ss))}<span>${own} von ${ss.length} Staffeln</span>${progress(own, ss.length)}`,
      actions: `${vintedBtn(vintedUrl(se.name + ' komplette Serie'), 'Serie auf Vinted')}
        ${ss.length ? `<button class="success small" data-act="bulkSeries" data-id="${esc(se.id)}">✓ Alle gekauft</button>` : ''}
        <button class="ghost small" data-act="addSeason" data-id="${esc(se.id)}">＋ Staffel</button>
        <a class="btn ghost small" href="#/serie/${esc(se.id)}">✎ Bearbeiten</a>`,
      body: ss.length ? `<div class="cards">${ss.map(s => seasonPosterCard(se, s)).join('')}</div>` : '<p class="muted">Noch keine Staffeln angelegt.</p>'
    });
  }).join('');
  v.innerHTML = `${pageHead('Serien', missing ? `${missing} Staffeln fehlen dir noch – vollständige Serien findest du in der Mediathek.` : 'Alle Serien sind vollständig.', `<button class="primary" data-act="addSeries">＋ Serie</button>`)}
    ${html ? groupTools('serien') + html : empty(S.series.size ? 'Alle Serien sind vollständig 🎉' : 'Noch keine Serien angelegt.', S.series.size ? '<a class="btn ghost" href="#/mediathek">Zur Mediathek</a>' : '<button class="primary" data-act="addSeries">＋ Erste Serie anlegen</button>')}`;
};

VIEWS.serie = function viewSerie(v, id) {
  const se = S.series.get(id);
  if (!se) { v.innerHTML = empty('Diese Serie gibt es nicht (mehr).', '<a class="btn ghost" href="#/serien">← Zu den Serien</a>'); return; }
  const ss = seasonsOf(id), st = gstat(ss), own = ownedCount(ss);
  const list = ss.filter(s => UI.seriesSeason === 'all' || (UI.seriesSeason === 'owned') === !!s.owned);
  ensureBackdrop('series', se);
  v.innerHTML = `<a class="back" href="${st === 'complete' ? '#/mediathek">← Mediathek' : '#/serien">← Serien'}</a>
    <section class="dhero">${bgLayer(se.backdrop || se.poster)}${poster(se.backdrop || se.poster, se.name, 'dhero-art')}<div class="dhero-body">
      <div class="eyebrow">Serie${se.year ? ' · ' + esc(se.year) : ''}</div><h1>${esc(se.name)}</h1>
      ${se.originalName && se.originalName !== se.name ? `<div class="muted">${esc(se.originalName)}</div>` : ''}
      <div class="dhero-meta">${badge(st)}<span>${own} von ${ss.length} Staffeln gekauft</span>${ratings(se)}</div>${progress(own, ss.length)}
      ${se.genres ? `<div class="muted small-t">${esc(se.genres)}</div>` : ''}
      ${se.desc ? `<p class="desc">${esc(se.desc)}</p>` : ''}
      ${se.notes ? `<div class="notes"><strong>Notizen</strong><br>${esc(se.notes)}</div>` : ''}
      <div class="actions">
        ${ss.length ? `<button class="${st === 'complete' ? 'ghost' : 'success'}" data-act="bulkSeries" data-id="${esc(se.id)}">${st === 'complete' ? 'Alle als fehlend markieren' : '✓ Ganze Serie abhaken'}</button>` : ''}
        ${st !== 'complete' ? vintedBtn(vintedUrl(se.name + ' komplette Serie'), 'Komplette Serie auf Vinted') : ''}
        <button class="ghost" data-act="addSeason" data-id="${esc(se.id)}">＋ Staffel</button>
        ${se.tmdbId && T.hasTmdb() ? `<button class="ghost" data-act="syncSeasons" data-id="${esc(se.id)}">↻ Staffeln von TMDb</button><button class="ghost" data-act="refreshSeries" data-id="${esc(se.id)}">↻ Infos aktualisieren</button>` : ''}
        ${imdbBtn(se.imdbId)}
        <button class="ghost" data-act="editSeries" data-id="${esc(se.id)}">✎ Bearbeiten</button>
        <button class="danger" data-act="deleteSeries" data-id="${esc(se.id)}">Löschen</button>
      </div></div></section>
    ${chips('seriesSeason', [['all', 'Alle'], ['owned', 'Gekauft'], ['missing', 'Fehlt noch']])}
    ${list.length ? `<div class="cards">${list.map(s => seasonPosterCard(se, s)).join('')}</div>` : empty(ss.length ? 'Keine Staffeln in dieser Ansicht.' : 'Noch keine Staffeln angelegt.', ss.length ? '' : `<button class="primary" data-act="addSeason" data-id="${esc(se.id)}">＋ Staffel hinzufügen</button>`)}`;
};

// ── Mediathek ────────────────────────────────────────────────
// Mediathek = gekaufte Einzelfilme + vollständige Reihen + vollständige Serien.
const LIB_OPTS = [['all', 'Alles'], ['movies', 'Filme'], ['series', 'Serien']];

VIEWS.mediathek = function viewLibrary(v, _, fresh) {
  if (fresh || !$('#libDyn')) {
    v.innerHTML = `${pageHead('Meine Mediathek', 'Alles, was du besitzt – automatisch aus deinen Markierungen.')}
      <div class="searchbar"><input type="search" id="libQ" placeholder="In der Mediathek suchen (Titel, Jahr, Genre) …" value="${esc(UI.libQ)}" autocomplete="off"></div>
      <div id="libDyn"></div>`;
    const i = $('#libQ');
    i.addEventListener('input', () => { UI.libQ = i.value; renderLibDyn(); });
  }
  renderLibDyn();
};

function libMovieCard(m) {
  return `<article class="card lib" data-act="openMovie" data-id="${esc(m.id)}" role="button" tabindex="0">
    <div class="card-media">${poster(m.poster, m.title)}${m.imdbRating || m.rating ? `<span class="score">${esc(m.imdbRating || m.rating)}</span>` : ''}</div>
    <div class="card-body"><h3>${esc(m.title)}</h3><div class="meta">${esc([m.year, (m.genres || '').split(',').slice(0, 2).join(',')].filter(Boolean).join(' · '))}</div></div></article>`;
}
function libSeriesCard(se, ss) {
  return `<a class="card lib" href="#/serie/${esc(se.id)}"><div class="card-media">${poster(se.poster, se.name)}${se.imdbRating || se.rating ? `<span class="score">${esc(se.imdbRating || se.rating)}</span>` : ''}</div>
    <div class="card-body"><h3>${esc(se.name)}</h3><div class="meta">${esc([se.year, `${ownedCount(ss)}/${ss.length} Staffeln`].filter(Boolean).join(' · '))}</div>
    <div class="season-chips">${ss.map(s => `<span class="sc ${s.owned ? 'on' : ''}" title="Staffel ${esc(s.number)}${s.owned ? ' gekauft' : ' fehlt'}">${esc(s.number)}</span>`).join('')}</div></div></a>`;
}

function renderLibDyn() {
  const box = $('#libDyn');
  if (!box) return;
  const q = UI.libQ.trim();
  const match = U.makeMatcher(q);
  const mMatch = (m, frName = '') => match([m.title, m.originalTitle, frName].join(' '), [m.year, m.genres].join(' '));
  const grid = items => `<div class="cards">${items.join('')}</div>`;

  // Filme: gekaufte Einzelfilme + vollständige Reihen (alphabetisch)
  const loose = moviesIn(null).filter(m => m.owned && mMatch(m)).sort(byTitle);
  const fullFr = franchisesSorted().map(f => ({ f, ms: moviesIn(f.id) }))
    .filter(g => gstat(g.ms) === 'complete')
    .map(g => ({ ...g, hit: match(g.f.name) ? g.ms : g.ms.filter(m => mMatch(m, g.f.name)) }))
    .filter(g => g.hit.length);
  // Serien: nur vollständige
  const fullSe = seriesSorted().map(se => ({ se, ss: seasonsOf(se.id) }))
    .filter(x => gstat(x.ss) === 'complete' && match([x.se.name, x.se.originalName].join(' '), [x.se.year, x.se.genres].join(' ')));

  const filmCount = loose.length + fullFr.reduce((n, g) => n + g.hit.length, 0);
  let movies = '';
  if (UI.libFlat) {
    const all = [...loose, ...fullFr.flatMap(g => g.hit)].sort(byTitle);
    movies = all.length ? grid(all.map(libMovieCard)) : '';
  } else {
    const opened = !!q; // bei Suche Treffer direkt zeigen
    const block = (gid, title, ms, sub, link = '') => {
      const h = groupBlock({ view: 'mediathek', gid, title, covers: coversOf(ms), sub, body: `${link}${grid(ms.map(libMovieCard))}` });
      return opened ? h.replace('class="group ', 'class="group open ') : h;
    };
    if (loose.length) movies += block('_', 'Einzelne Filme', loose, `${loose.length} Filme`);
    for (const g of fullFr) movies += block(g.f.id, g.f.name, g.hit, `${badge('complete')}<span>${g.ms.length} Filme</span>`, `<div class="group-link"><a class="link" href="#/franchise/${esc(g.f.id)}">Reihe öffnen / bearbeiten →</a></div>`);
  }
  const series = fullSe.length ? grid(fullSe.map(x => libSeriesCard(x.se, x.ss))) : '';
  const head = (t, n) => `<div class="section-head"><h2>${t}</h2><span class="muted">${n}</span></div>`;
  let html = '';
  if (UI.lib !== 'series' && movies) html += `<section class="section">${head('Filme', filmCount)}${UI.libFlat ? '' : groupTools('mediathek')}${movies}</section>`;
  if (UI.lib !== 'movies' && series) html += `<section class="section">${head('Serien', fullSe.length)}${series}</section>`;
  box.innerHTML = `<div class="lib-bar">${chips('lib', LIB_OPTS)}<button class="chip ${UI.libFlat ? 'active' : ''}" data-act="toggleFlat">${UI.libFlat ? '✓ ' : ''}Alle Filme einzeln</button></div>
    ${html || empty(q ? 'Keine Treffer in deiner Mediathek.' : 'Hier erscheinen deine gekauften Einzelfilme sowie alle vollständigen Reihen und Serien.')}`;
}

// ── Suche ────────────────────────────────────────────────────
VIEWS.suche = function viewSearch(v, _, fresh) {
  if (fresh || !$('#sDyn')) {
    v.innerHTML = `${pageHead('Suche', 'Filme, Franchises, Serien und Staffeln finden und kombiniert filtern.')}
      <div class="searchbar"><input type="search" id="sq" placeholder="Titel, Jahr, Genre, Franchise …" value="${esc(UI.q)}" autocomplete="off"></div>
      <div id="sDyn"></div>`;
    const i = $('#sq');
    i.addEventListener('input', () => { UI.q = i.value; renderSearchDyn(); });
    if (!matchMedia('(hover: none)').matches) i.focus();
  }
  renderSearchDyn();
};

function renderSearchDyn() {
  const box = $('#sDyn');
  if (!box) return;
  const q = UI.q.trim(), match = U.makeMatcher(q);
  const want = k => UI.type === 'all' || UI.type === k || (UI.type === 'items' && (k === 'movie' || k === 'season'));
  const frStat = new Map(franchisesSorted().map(f => [f.id, gstat(moviesIn(f.id))]));
  const seStat = new Map(arr(S.series).map(se => [se.id, gstat(seasonsOf(se.id))]));
  const okItem = o => UI.status === 'all' || (UI.status === 'owned') === !!o;
  const okGroup = st => UI.status === 'all' || (UI.status === 'owned' ? st === 'complete' : st !== 'complete');
  const grp = st => groupMatch(st, UI.group);
  const items = [];
  if (want('franchise')) franchisesSorted().forEach(f => {
    const st = frStat.get(f.id);
    if (okGroup(st) && grp(st) && match(f.name)) items.push(franchiseItem(f));
  });
  if (want('series')) seriesSorted().forEach(se => {
    const st = seStat.get(se.id);
    if (okGroup(st) && grp(st) && match([se.name, se.originalName].join(' '), [se.year, se.genres].join(' '))) items.push(seriesItem(se));
  });
  if (want('movie')) arr(S.movies).sort(byTitle).forEach(m => {
    const fid = frOf(m), fr = fid && S.franchises.get(fid);
    if (!okItem(m.owned)) return;
    if (UI.group !== 'all' && (!fid || !grp(frStat.get(fid)))) return;
    if (q && !match([m.title, m.originalTitle, fr?.name].join(' '), [m.year, m.genres, m.format].join(' '))) return;
    items.push(movieItem(m));
  });
  if (want('season')) seriesSorted().forEach(se => seasonsOf(se.id).forEach(s => {
    if (!okItem(s.owned)) return;
    if (UI.group !== 'all' && !grp(seStat.get(se.id))) return;
    if (q && !match([se.name, 'staffel ' + s.number, s.name].join(' '), ['s' + s.number, s.year].join(' '))) return;
    items.push(seasonItem(s));
  }));
  const total = items.length, shown = items.slice(0, 400);
  const isShop = UI.status === 'missing' && UI.type === 'items';
  const dirty = UI.q || UI.type !== 'all' || UI.status !== 'all' || UI.group !== 'all';
  const sel = (key, opts) => `<select class="fsel ${UI[key] !== 'all' ? 'on' : ''}" data-filter="${key}" aria-label="${key}">${opts.map(([v, l]) => `<option value="${v}" ${UI[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  box.innerHTML = `<div class="fbar">
      ${sel('type', [['all', 'Alle Typen'], ['movie', 'Filme'], ['franchise', 'Franchises'], ['series', 'Serien'], ['season', 'Staffeln'], ['items', 'Filme & Staffeln']])}
      ${sel('status', [['all', 'Jeder Status'], ['owned', 'Gekauft'], ['missing', 'Fehlt noch']])}
      ${sel('group', [['all', 'Alle Reihen'], ['complete', 'Vollständige'], ['incomplete', 'Unvollständige']])}
      <button class="chip ${isShop ? 'active' : ''}" data-act="shopping">🛒 Fehlt mir</button>
    </div>
    <div class="result-count">${total} Treffer${total > shown.length ? ' (die ersten 400 werden angezeigt)' : ''}${dirty ? ' · <button class="link" data-act="resetSearch">Zurücksetzen</button>' : ''}</div>
    ${shown.length ? `<div class="rows">${shown.map(itemRow).join('')}</div>` : empty('Keine Treffer.')}`;
}

// ── Statistik ────────────────────────────────────────────────
// Einfarbige Balken mit direkten Werten (eine Datenreihe je Diagramm → keine Legende nötig).
function barList(rows, { fmt = n => n, max } = {}) {
  if (!rows.length) return '<p class="muted small-t">Noch keine Daten.</p>';
  const top = max ?? Math.max(...rows.map(r => r[1]), 1);
  return `<div class="bars" role="table">${rows.map(([label, val, hint]) => `<div class="bar-row" role="row" title="${esc(label)}: ${esc(fmt(val))}${hint ? ' · ' + esc(hint) : ''}">
      <span class="bar-label" role="cell">${esc(label)}</span>
      <span class="bar-track" role="cell"><span class="bar-fill" style="width:${Math.max(2, Math.round(val / top * 100))}%"></span></span>
      <span class="bar-val" role="cell">${esc(fmt(val))}</span></div>`).join('')}</div>`;
}

VIEWS.statistik = function viewStats(v) {
  const ms = arr(S.movies), ss = arr(S.seasons).filter(s => S.series.has(s.seriesId));
  const om = ms.filter(m => m.owned), os = ss.filter(s => s.owned);
  const frs = franchisesSorted().map(f => gstat(moviesIn(f.id)));
  const ses = arr(S.series).map(se => gstat(seasonsOf(se.id)));
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const tile = (n, total, label) => `<div class="stat-tile">${ring(n, total, 64, pct(n, total) + '%')}<div><strong>${n} <small>von ${total}</small></strong><span>${label}</span></div></div>`;

  // Ausgaben
  const paid = [...om, ...os].filter(x => num(x.price) != null);
  const sum = paid.reduce((a, x) => a + num(x.price), 0);
  const months = new Map();
  paid.filter(x => x.purchaseDate).forEach(x => { const k = String(x.purchaseDate).slice(0, 7); months.set(k, (months.get(k) || 0) + num(x.price)); });
  const monthRows = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
    .map(([k, val]) => [new Date(k + '-01').toLocaleDateString('de-DE', { month: 'short', year: 'numeric' }), val]);

  // Genres, Jahrzehnte, Formate (nur gekaufte Filme)
  const count = list => { const m = new Map(); list.forEach(k => m.set(k, (m.get(k) || 0) + 1)); return [...m.entries()]; };
  const genres = count(om.flatMap(m => String(m.genres || '').split(',').map(g => g.trim()).filter(Boolean))).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const decades = count(om.filter(m => intOrNull(m.year)).map(m => Math.floor(intOrNull(m.year) / 10) * 10)).sort((a, b) => a[0] - b[0]).map(([d, n]) => [`${d}er`, n]);
  const formats = count(om.map(m => m.format || 'Ohne Angabe')).sort((a, b) => b[1] - a[1]);

  v.innerHTML = `<a class="back" href="#/">← Start</a>
    ${pageHead('Statistik', 'Deine Sammlung in Zahlen.')}
    <div class="stat-tiles">
      ${tile(om.length, ms.length, 'Filme gekauft')}
      ${tile(os.length, ss.length, 'Staffeln gekauft')}
      ${tile(frs.filter(s => s === 'complete').length, frs.length, 'Reihen vollständig')}
      ${tile(ses.filter(s => s === 'complete').length, ses.length, 'Serien vollständig')}
    </div>
    <div class="stat-grid">
      <section class="panel"><h3>Ausgaben</h3>
        <div class="big-num">${fmtPrice(sum) || '0,00 €'}</div>
        <p class="muted small-t">${paid.length ? `für ${paid.length} Titel mit Preis · Ø ${fmtPrice(sum / paid.length)}` : 'Trag beim Bearbeiten eines Films Kaufpreis und Kaufdatum ein, dann erscheinen hier deine Ausgaben.'}</p>
        ${monthRows.length ? `<h4>Pro Monat</h4>${barList(monthRows, { fmt: fmtPrice })}` : ''}</section>
      <section class="panel"><h3>Lieblingsgenres</h3>${barList(genres)}</section>
      <section class="panel"><h3>Filme pro Jahrzehnt</h3>${barList(decades)}</section>
      <section class="panel"><h3>Formate</h3>${barList(formats)}</section>
    </div>`;
};

// ── Einstellungen ────────────────────────────────────────────
VIEWS.einstellungen = function viewSettings(v, _, fresh) {
  if (fresh || !$('#setDyn')) {
    v.innerHTML = `${pageHead('Einstellungen')}
    <div class="settings">
      <section class="panel"><h3>Konto</h3>
        <p class="muted">Angemeldet als <strong>${esc(displayUser(S.user?.email))}</strong>${S.demo ? ' – Demo-Modus, Daten nur in diesem Browser.' : '.'}</p>
        <button class="ghost" data-act="logout">${S.demo ? 'Demo beenden' : 'Abmelden'}</button></section>
      <section class="panel"><h3>Filmdaten (TMDb)</h3>
        <p class="muted">Für automatische Infos, Poster und Staffeln. Kostenlosen Schlüssel gibt es auf themoviedb.org unter Einstellungen → API. Er wird geschützt in eurer Datenbank gespeichert und gilt für alle, die die App nutzen.</p>
        <div class="field"><label for="tmdbKey">TMDb API-Schlüssel oder Lesezugriffs-Token</label><input id="tmdbKey" type="password" autocomplete="off" spellcheck="false" value="${esc(S.settings.tmdbKey || '')}"></div>
        <div class="field"><label for="omdbKey">OMDb API-Schlüssel (optional, für echte IMDb-Bewertungen)</label><input id="omdbKey" type="password" autocomplete="off" spellcheck="false" value="${esc(S.settings.omdbKey || '')}"></div>
        <label class="check"><input type="checkbox" id="vintedYear" ${S.settings.vintedYear !== false ? 'checked' : ''}> Erscheinungsjahr in die Vinted-Suche bei Filmen aufnehmen</label>
        <div class="row"><button class="primary" data-act="saveSettings">Speichern</button><button class="ghost" data-act="testTmdb">Verbindung testen</button></div></section>
      <section class="panel"><h3>Daten sichern</h3>
        <p class="muted">Exportiere regelmäßig ein Backup. Mit dem Import kannst du es jederzeit wiederherstellen – auch Backups aus der alten FilmVault-Version.</p>
        <div class="row wrap"><button class="primary" data-act="exportJson">⬇ Backup exportieren (JSON)</button><button class="ghost" data-act="exportCsv">⬇ Liste als CSV</button>
          <label class="btn ghost">⬆ Backup importieren<input type="file" accept="application/json,.json" id="importFile" hidden></label></div>
        <div id="lastExport" class="muted small-t"></div></section>
      <section class="panel"><h3>Papierkorb</h3><div id="setDyn"></div></section>
      <section class="panel"><h3>Über</h3><p class="muted small-t">SahinMax 1.0 · Daten: ${S.demo ? 'lokal (Demo)' : 'Firebase Firestore'} · Filminformationen von TMDb. This product uses the TMDB API but is not endorsed or certified by TMDB.</p></section>
    </div>`;
    $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) doImport(f); });
  }
  const le = $('#lastExport');
  if (le) le.textContent = S.settings.lastExport ? 'Letztes Backup: ' + new Date(S.settings.lastExport).toLocaleString('de-DE') : 'Noch kein Backup exportiert.';
  const t = arr(S.trash).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  $('#setDyn').innerHTML = t.length ? `<div class="rows">${t.map(x => `<div class="row-item"><div class="row-main"><div class="row-text"><div class="row-title">${esc(x.label)}</div>
      <div class="row-sub">${esc(fmtDate(x.deletedAt))}${x.deletedBy ? ' · ' + esc(displayUser(x.deletedBy)) : ''}${x.items?.length > 1 ? ` · ${x.items.length} Einträge` : ''}</div></div></div>
      <div class="row-actions"><button class="ghost small" data-act="restoreTrash" data-id="${esc(x.id)}">Wiederherstellen</button><button class="danger small" data-act="purgeTrash" data-id="${esc(x.id)}">Endgültig löschen</button></div></div>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="danger small" data-act="emptyTrash">Papierkorb leeren</button></div>`
    : '<p class="muted">Der Papierkorb ist leer. Gelöschte Einträge landen hier und können wiederhergestellt werden.</p>';
};

// ═════════════════════════════════════════════════════════════
// Detailansicht Film
// ═════════════════════════════════════════════════════════════
function openMovie(id) {
  const build = () => {
    const m = S.movies.get(id);
    if (!m) return null;
    const fid = frOf(m), fr = fid && S.franchises.get(fid);
    const buy = [m.purchaseDate ? 'am ' + fmtDate(m.purchaseDate) : '', m.price != null && m.price !== '' ? 'für ' + fmtPrice(m.price) : ''].filter(Boolean).join(' ');
    ensureBackdrop('movies', m);
    return mediaDetail({
      bg: m.backdrop || m.poster, soft: !m.backdrop, poster: m.poster, title: m.title,
      eyebrow: fr ? `<a href="#/franchise/${esc(fr.id)}">${esc(fr.name)}</a>${m.order != null ? ' · Teil ' + esc(m.order) : ''}` : 'Einzelner Film',
      sub: m.originalTitle && m.originalTitle !== m.title ? m.originalTitle : '',
      meta: [m.year, fmtRuntime(m.runtime), m.genres].filter(Boolean).join(' · '),
      chips: `${ratings(m)}${m.format ? `<span class="rating">${esc(m.format)}</span>` : ''}`,
      main: `${checkBtn('toggleMovie', m.id, m.owned, 'big')}${m.owned ? '' : vintedBtn(vMovie(m))}${imdbBtn(m.imdbId)}`,
      body: `<p class="desc">${esc(m.desc || 'Keine Beschreibung hinterlegt.')}</p>
        ${m.owned && buy ? `<div class="purchase">Gekauft ${esc(buy)}</div>` : ''}
        ${m.notes ? `<div class="notes"><strong>Notizen</strong><br>${esc(m.notes)}</div>` : ''}`,
      more: `<button class="ghost small" data-act="editMovie" data-id="${esc(m.id)}">✎ Bearbeiten</button>
        ${m.tmdbId && T.hasTmdb() ? `<button class="ghost small" data-act="refreshMovie" data-id="${esc(m.id)}">↻ Infos aktualisieren</button>` : ''}
        <button class="danger small" data-act="deleteMovie" data-id="${esc(m.id)}">Löschen</button>`
    });
  };
  openMedia(build);
}

// Gemeinsames Layout: großes (unscharfes) Szenenbild oben, Poster + Infos darüber
function mediaDetail({ bg, soft, poster: p, title, eyebrow, sub, meta, chips: ch, main, body, more }) {
  return `<div class="media">
    <div class="media-hero">${bgLayer(bg, 'media-bg' + (soft ? ' soft' : ''))}<div class="media-fade"></div></div>
    <div class="media-head">${poster(p, title, 'poster media-poster')}
      <div class="media-titles"><div class="eyebrow">${eyebrow}</div><h2>${esc(title)}</h2>${sub ? `<div class="muted">${esc(sub)}</div>` : ''}
        <div class="meta-line">${esc(meta)}</div>${ch ? `<div class="ratings">${ch}</div>` : ''}</div></div>
    <div class="media-main">${main}</div>
    <div class="media-body">${body}</div>
    <div class="media-more">${more}</div>
  </div>`;
}
function openMedia(build) {
  const html = build();
  if (!html) return;
  const md = openModal({ title: '', body: html, wide: true, cls: 'media-modal' });
  md.refresh = () => { const h = build(); if (h === null) md.close(); else md.setBody(h); };
}

function openSeason(id) {
  const build = () => {
    const s = S.seasons.get(id), se = s && S.series.get(s.seriesId);
    if (!s || !se) return null;
    ensureBackdrop('series', se);
    const buy = [s.purchaseDate ? 'am ' + fmtDate(s.purchaseDate) : '', s.price != null && s.price !== '' ? 'für ' + fmtPrice(s.price) : ''].filter(Boolean).join(' ');
    return mediaDetail({
      bg: se.backdrop || s.poster || se.poster, soft: !se.backdrop, poster: s.poster || se.poster, title: `Staffel ${s.number}`,
      eyebrow: `<a href="#/serie/${esc(se.id)}">${esc(se.name)}</a>`, sub: s.name,
      meta: [s.year, s.episodes ? s.episodes + ' Folgen' : ''].filter(Boolean).join(' · '), chips: '',
      main: `${checkBtn('toggleSeason', s.id, s.owned, 'big')}${s.owned ? '' : vintedBtn(vSeason(se, s))}`,
      body: `${s.owned && buy ? `<div class="purchase">Gekauft ${esc(buy)}</div>` : ''}${s.notes ? `<div class="notes"><strong>Notizen</strong><br>${esc(s.notes)}</div>` : ''}`,
      more: `<button class="ghost small" data-act="editSeason" data-id="${esc(s.id)}">✎ Bearbeiten</button><a class="btn ghost small" href="#/serie/${esc(se.id)}">Zur Serie</a>`
    });
  };
  openMedia(build);
}

// ═════════════════════════════════════════════════════════════
// Formulare
// ═════════════════════════════════════════════════════════════
function fld(label, name, value = '', { type = 'text', full = false, ph = '', attrs = '' } = {}) {
  return `<div class="field${full ? ' full' : ''}"><label>${esc(label)}</label><input name="${name}" type="${type}" value="${esc(value ?? '')}" placeholder="${esc(ph)}" ${attrs}></div>`;
}
function area(label, name, value = '') {
  return `<div class="field full"><label>${esc(label)}</label><textarea name="${name}" rows="4">${esc(value ?? '')}</textarea></div>`;
}
function select(label, name, opts, value, full = false) {
  return `<div class="field${full ? ' full' : ''}"><label>${esc(label)}</label><select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
}
function tmdbBlock(label) {
  if (!T.hasTmdb()) return `<div class="hint">Tipp: Hinterlege in den <a href="#/einstellungen">Einstellungen</a> einen kostenlosen TMDb-Schlüssel – dann werden Infos und Poster automatisch geladen.</div>`;
  return `<div class="tmdb-search"><label class="lbl" for="tq">${esc(label)}</label>
    <div class="row"><input type="search" id="tq" placeholder="Titel eingeben …" autocomplete="off"><button type="button" class="ghost" id="tgo">Suchen</button></div>
    <div id="tres" class="tmdb-results"></div></div>`;
}
function setForm(form, data, keys) {
  for (const k of keys) if (form.elements[k] && data[k] != null) form.elements[k].value = data[k];
}
const setImg = (form, name, v) => form.querySelector(`[data-imgfield="${name}"]`)?.setImage(v || '');

function formModal({ title, pre = '', body, submitText = 'Speichern', onSubmit, onMount }) {
  const fid = 'f' + Math.random().toString(36).slice(2, 8);
  const md = openModal({
    title, wide: true,
    body: `${pre}<form id="${fid}" class="form-grid" novalidate>${body}</form>`,
    footer: `<button type="button" class="ghost" data-close>Abbrechen</button><button type="submit" form="${fid}" class="primary">${esc(submitText)}</button>`
  });
  const form = md.el.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = md.el.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const r = await onSubmit(Object.fromEntries(new FormData(form)), form, md);
      if (r !== false) md.close();
    } catch (err) { console.error(err); toast(err.message || 'Fehler', 'err'); }
    btn.disabled = false;
  });
  U.bindImageFields(form);
  onMount && onMount(form, md);
  return md;
}

function bindTmdb(md, searchFn, onPick) {
  const q = md.el.querySelector('#tq');
  if (!q) return;
  const res = md.el.querySelector('#tres');
  let t, seq = 0;
  const go = async () => {
    const v = q.value.trim();
    if (v.length < 2) { res.innerHTML = ''; return; }
    const my = ++seq;
    res.innerHTML = '<div class="muted pad">Suche …</div>';
    try {
      const items = await searchFn(v);
      if (my !== seq) return;
      res.innerHTML = items.length ? items.map(it => `<button type="button" class="tres" data-tid="${it.id}">${it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : '<span class="noimg">?</span>'}<span><strong>${esc(it.title)}</strong><small>${esc(it.sub || '')}</small></span></button>`).join('')
        : '<div class="muted pad">Nichts gefunden – du kannst den Eintrag auch unten manuell ausfüllen.</div>';
    } catch (e) { if (my === seq) res.innerHTML = `<div class="err pad">${esc(e.message)}</div>`; }
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(go, 450); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); go(); } });
  md.el.querySelector('#tgo')?.addEventListener('click', go);
  res.addEventListener('click', async e => {
    const b = e.target.closest('[data-tid]');
    if (!b) return;
    res.querySelectorAll('.tres').forEach(x => x.classList.toggle('sel', x === b));
    b.classList.add('loading');
    try { await onPick(Number(b.dataset.tid)); } catch (err) { toast(err.message, 'err'); }
    b.classList.remove('loading');
  });
  setTimeout(() => q.focus(), 50);
}

// ── Film ─────────────────────────────────────────────────────
const MOVIE_META = ['title', 'originalTitle', 'year', 'poster', 'desc', 'genres', 'runtime', 'rating', 'imdbRating', 'imdbId'];
const LABELS = { title: 'Titel', originalTitle: 'Originaltitel', year: 'Jahr', poster: 'Poster', desc: 'Beschreibung', genres: 'Genre', runtime: 'Laufzeit', rating: 'TMDb-Bewertung', imdbRating: 'IMDb-Bewertung', imdbId: 'IMDb-ID', name: 'Name', originalName: 'Originalname' };
const normMovieMeta = d => ({ ...d, year: intOrNull(d.year), runtime: intOrNull(d.runtime), rating: num(d.rating), imdbRating: num(d.imdbRating) });

function movieForm(existing = null, preset = {}) {
  const m = existing || { owned: false, franchiseId: preset.franchiseId || null };
  const draft = { tmdbId: m.tmdbId || null, backdrop: m.backdrop || '', picked: null, newFrMeta: null };
  const frOpts = [['', '— Ohne Franchise —'], ...franchisesSorted().map(x => [x.id, x.name]), ['__new', '＋ Neues Franchise erstellen …']];
  const body = `
    ${fld('Titel *', 'title', m.title, { full: true, attrs: 'required' })}
    ${fld('Originaltitel', 'originalTitle', m.originalTitle)}
    ${fld('Erscheinungsjahr', 'year', m.year, { type: 'number', attrs: 'min="1880" max="2100" inputmode="numeric"' })}
    ${select('Franchise', 'franchiseId', frOpts, frOf(m) || '')}
    ${fld('Position in der Reihe', 'order', m.order, { type: 'number', attrs: 'step="any" inputmode="decimal"' })}
    <div class="field full hidden" id="newFrWrap"><label>Name des neuen Franchise</label><input name="newFranchise" placeholder="z. B. Mission: Impossible"></div>
    ${select('Status', 'owned', [['0', 'Fehlt noch (ausgegraut)'], ['1', '✓ Gekauft']], m.owned ? '1' : '0')}
    ${select('Format', 'format', [['', '—'], ['DVD', 'DVD'], ['Blu-ray', 'Blu-ray'], ['4K UHD', '4K UHD'], ['Digital', 'Digital'], ['Sonstiges', 'Sonstiges']], m.format || '')}
    ${U.imageField('poster', 'Poster', m.poster)}
    ${area('Beschreibung', 'desc', m.desc)}
    <details class="full more" ${existing ? 'open' : ''}><summary>Weitere Angaben</summary><div class="form-grid">
      ${fld('Genre', 'genres', m.genres, { ph: 'z. B. Fantasy, Abenteuer' })}
      ${fld('Laufzeit (Minuten)', 'runtime', m.runtime, { type: 'number', attrs: 'inputmode="numeric"' })}
      ${fld('TMDb-Bewertung (0–10)', 'rating', m.rating, { type: 'number', attrs: 'step="0.1" min="0" max="10" inputmode="decimal"' })}
      ${fld('IMDb-Bewertung (0–10)', 'imdbRating', m.imdbRating, { type: 'number', attrs: 'step="0.1" min="0" max="10" inputmode="decimal"' })}
      ${fld('IMDb-ID oder IMDb-Link', 'imdbId', m.imdbId, { ph: 'tt0241527' })}
      ${fld('Kaufdatum', 'purchaseDate', m.purchaseDate, { type: 'date' })}
      ${fld('Kaufpreis (€)', 'price', m.price, { type: 'number', attrs: 'step="0.01" min="0" inputmode="decimal"' })}
      ${area('Notizen', 'notes', m.notes)}
    </div></details>
    <div id="collHint" class="full"></div>`;

  formModal({
    title: existing ? 'Film bearbeiten' : 'Film hinzufügen',
    pre: !existing || !existing.tmdbId ? tmdbBlock(existing ? 'Mit TMDb verknüpfen (optional)' : 'In TMDb suchen (optional)') : '',
    body,
    onSubmit: fd => saveMovie(fd, existing, draft),
    onMount(form, md) {
      const toggleNew = () => form.querySelector('#newFrWrap').classList.toggle('hidden', form.elements.franchiseId.value !== '__new');
      form.elements.franchiseId.addEventListener('change', toggleNew);
      bindTmdb(md, T.searchMovies, async tid => {
        const d = await T.movieDetails(tid);
        setForm(form, d, ['title', 'originalTitle', 'year', 'desc', 'genres', 'runtime', 'rating', 'imdbRating', 'imdbId']);
        setImg(form, 'poster', d.poster);
        Object.assign(draft, { tmdbId: d.tmdbId, backdrop: d.backdrop, picked: normMovieMeta(d) });
        const hint = form.querySelector('#collHint');
        hint.innerHTML = '';
        const dup = arr(S.movies).find(x => x.tmdbId === d.tmdbId && x.id !== existing?.id);
        if (dup) hint.innerHTML = `<div class="hint warn">„${esc(dup.title)}“ ist bereits in deiner Sammlung.</div>`;
        if (!d.collection) return;
        let c = null;
        try { c = await T.collectionDetails(d.collection.id); } catch { return; }
        const pos = c.parts.findIndex(p => p.tmdbId === d.tmdbId) + 1;
        const fr = findFranchiseFor(c);
        const cur = form.elements.franchiseId.value;
        if (fr && cur === fr.id) {
          if (pos && !form.elements.order.value) form.elements.order.value = pos;
        } else if (fr && !cur) {
          hint.insertAdjacentHTML('beforeend', `<div class="hint">Gehört zur Reihe „${esc(fr.name)}“${pos ? ` (Teil ${pos})` : ''}. Ohne Zuordnung landet der Film bei den Einzelfilmen.
            <div class="row"><button type="button" class="ghost small" data-h="assign">Der Reihe zuordnen</button></div></div>`);
          hint.querySelector('[data-h=assign]').onclick = e => {
            form.elements.franchiseId.value = fr.id; toggleNew();
            if (pos) form.elements.order.value = pos;
            e.target.closest('.hint').innerHTML = `Wird der Reihe „${esc(fr.name)}“ zugeordnet.`;
          };
        } else if (!cur) {
          hint.insertAdjacentHTML('beforeend', `<div class="hint">Gehört zur Filmreihe <strong>${esc(c.name)}</strong> (${c.parts.length} Filme).
            <div class="row"><button type="button" class="ghost small" data-h="newfr">Als neues Franchise anlegen</button>${existing ? '' : '<button type="button" class="primary small" data-h="all">Ganze Reihe importieren</button>'}</div></div>`);
          hint.querySelector('[data-h=newfr]').onclick = () => {
            form.elements.franchiseId.value = '__new'; toggleNew();
            form.elements.newFranchise.value = c.name;
            draft.newFrMeta = { tmdbCollectionId: c.tmdbCollectionId, image: c.image, desc: c.desc };
            if (pos) form.elements.order.value = pos;
          };
          const all = hint.querySelector('[data-h=all]');
          if (all) all.onclick = () => { md.close(); importCollection(c.tmdbCollectionId); };
        } else if (pos && !form.elements.order.value) form.elements.order.value = pos;
      });
    }
  });
}

async function saveMovie(fd, existing, draft) {
  const title = str(fd.title);
  if (!title) { toast('Bitte einen Titel eingeben', 'err'); return false; }
  const ops = [];
  let franchiseId = fd.franchiseId || null;
  if (franchiseId === '__new') {
    const name = str(fd.newFranchise);
    if (!name) { toast('Bitte einen Namen für das neue Franchise eingeben', 'err'); return false; }
    const ex = arr(S.franchises).find(x => norm(x.name) === norm(name));
    if (ex) franchiseId = ex.id;
    else {
      franchiseId = newId('franchises');
      const meta = draft.newFrMeta || {};
      ops.push(setOp('franchises', franchiseId, { name, image: meta.image || '', desc: meta.desc || '', tmdbCollectionId: meta.tmdbCollectionId || null, order: null, createdAt: Date.now() }));
    }
  }
  let order = num(fd.order);
  if (order == null && franchiseId && (!existing || frOf(existing) !== franchiseId)) order = Math.max(0, ...moviesIn(franchiseId).map(x => num(x.order) || 0)) + 1;
  const data = {
    title, originalTitle: str(fd.originalTitle), year: intOrNull(fd.year), franchiseId, order,
    owned: fd.owned === '1', format: str(fd.format), poster: safeUrl(fd.poster), desc: str(fd.desc),
    genres: str(fd.genres), runtime: intOrNull(fd.runtime), rating: num(fd.rating), imdbRating: num(fd.imdbRating),
    imdbId: parseImdb(fd.imdbId), purchaseDate: str(fd.purchaseDate), price: num(fd.price), notes: str(fd.notes)
  };
  if (draft.tmdbId) data.tmdbId = draft.tmdbId;
  if (draft.backdrop) data.backdrop = draft.backdrop;
  const base = draft.picked || existing;
  if (base) {
    const manual = {};
    for (const k of MOVIE_META) if (String(base[k] ?? '') !== String(data[k] ?? '')) manual[k] = true;
    if (Object.keys(manual).length) data.manual = manual;
  }
  if (!existing) {
    const dup = data.tmdbId && arr(S.movies).find(x => x.tmdbId === data.tmdbId);
    if (dup) { toast(`„${dup.title}“ ist bereits vorhanden – kein Duplikat angelegt`, 'err'); return false; }
    const dup2 = arr(S.movies).find(x => norm(x.title) === norm(title) && (intOrNull(x.year) || null) === (data.year || null));
    if (dup2 && !await confirmDialog(`„${title}“${data.year ? ` (${data.year})` : ''} gibt es schon in deiner Sammlung. Trotzdem anlegen?`, { okText: 'Trotzdem anlegen' })) return false;
    data.createdAt = Date.now();
    ops.push(setOp('movies', newId('movies'), data));
  } else {
    ops.push(setOp('movies', existing.id, data));
  }
  run(ops);
  toast(existing ? 'Film gespeichert' : `„${title}“ hinzugefügt`);
}

async function refreshMovie(id) {
  const m = S.movies.get(id);
  if (!m?.tmdbId) return;
  toast('Lade Infos von TMDb …');
  const d = normMovieMeta(await T.movieDetails(m.tmdbId));
  const updates = {}, skipped = [];
  for (const k of MOVIE_META) {
    if (d[k] == null || d[k] === '') continue;
    if (m.manual?.[k]) { if (String(m[k] ?? '') !== String(d[k])) skipped.push(LABELS[k]); continue; }
    if (String(m[k] ?? '') !== String(d[k])) updates[k] = d[k];
  }
  if (!m.backdrop && d.backdrop) updates.backdrop = d.backdrop;
  const keys = Object.keys(updates).filter(k => k !== 'backdrop');
  if (!keys.length && !updates.backdrop) { toast(skipped.length ? 'Nichts aktualisiert – abweichende Felder sind manuell geschützt' : 'Alles ist bereits aktuell'); return; }
  const ok = await confirmDialog(`Folgende Felder werden aktualisiert: ${keys.map(k => LABELS[k]).join(', ') || 'Hintergrundbild'}.${skipped.length ? `\n\nManuell geändert und daher geschützt: ${skipped.join(', ')}.` : ''}`, { title: 'Infos aktualisieren', okText: 'Aktualisieren' });
  if (ok) { run([setOp('movies', id, updates)]); toast('Infos aktualisiert'); }
}

async function importCollection(collId, overrides = {}) {
  if (!collId) return;
  toast('Lade Filmreihe von TMDb …');
  const c = { ...(await T.collectionDetails(collId)), ...overrides };
  const fr = findFranchiseFor(c);
  const all = arr(S.movies);
  const existingFor = p => all.find(m => m.tmdbId === p.tmdbId);
  const toAdd = c.parts.filter(p => !existingFor(p));
  const toLink = c.parts.map(existingFor).filter(m => m && !frOf(m));
  if (!toAdd.length && !toLink.length && fr) { toast('Alle Filme dieser Reihe sind bereits vorhanden'); return; }
  // Nachfragen: Welche Filme besitzt du schon? Der Rest wird ausgegraut als „fehlt“ angelegt.
  const ownedIds = await U.checklistDialog({
    title: `${c.name}: Was hast du schon?`,
    okText: 'Reihe anlegen',
    message: `Hake an, welche Filme du schon besitzt. Alle anderen werden ausgegraut als „fehlt noch“ angelegt.${fr ? `\nZiel: dein Franchise „${fr.name}“.` : ''}`,
    items: c.parts.map(p => {
      const ex = existingFor(p);
      return { id: p.tmdbId, label: p.title, sub: [p.year, ex ? (ex.owned ? 'schon in deiner Sammlung (gekauft)' : 'schon in deiner Sammlung') : ''].filter(Boolean).join(' · '), checked: !!ex?.owned, disabled: !!ex };
    })
  });
  if (!ownedIds) return;
  const frId = fr?.id || newId('franchises');
  const ops = [];
  if (!fr) ops.push(setOp('franchises', frId, { name: c.name, image: c.image, desc: c.desc, tmdbCollectionId: c.tmdbCollectionId, order: null, createdAt: Date.now() }));
  else {
    const patch = {};
    if (!fr.tmdbCollectionId) patch.tmdbCollectionId = c.tmdbCollectionId;
    if (!fr.image && c.image) patch.image = c.image;
    if (!fr.desc && c.desc) patch.desc = c.desc;
    if (Object.keys(patch).length) ops.push(setOp('franchises', frId, patch));
  }
  toast(`Lade ${toAdd.length} Filme …`);
  for (const [i, p] of c.parts.entries()) {
    const ex = existingFor(p);
    if (ex) {
      if (!frOf(ex)) ops.push(setOp('movies', ex.id, { franchiseId: frId, order: ex.order ?? i + 1 }));
      continue;
    }
    let d;
    try { d = await T.movieDetails(p.tmdbId); } catch { d = { tmdbId: p.tmdbId, title: p.title, year: p.year }; }
    const meta = {};
    for (const k of [...MOVIE_META, 'tmdbId', 'backdrop']) if (d[k] != null && d[k] !== '') meta[k] = d[k];
    ops.push(setOp('movies', newId('movies'), { ...normMovieMeta(meta), franchiseId: frId, order: i + 1, owned: ownedIds.has(p.tmdbId), createdAt: Date.now() }));
  }
  await run(ops);
  const complete = c.parts.every(p => ownedIds.has(p.tmdbId) || existingFor(p)?.owned);
  toast(complete ? `🎉 „${c.name}“ ist vollständig – in deiner Mediathek` : `„${c.name}“ angelegt`);
  const target = '#/franchise/' + frId;
  if (location.hash !== target) location.hash = target;
}

async function linkCollection(frId) {
  const f = S.franchises.get(frId);
  const md = openModal({ title: `„${f.name}“ mit TMDb-Filmreihe verknüpfen`, wide: true, body: tmdbBlock('Filmreihe in TMDb suchen') });
  md.el.querySelector('#tq').value = f.name;
  bindTmdb(md, T.searchCollections, async cid => {
    md.close();
    run([setOp('franchises', frId, { tmdbCollectionId: cid })]);
    await importCollection(cid);
  });
  md.el.querySelector('#tgo').click();
}

// ── Franchise ────────────────────────────────────────────────
function franchiseForm(existing = null) {
  const f = existing || {};
  const draft = { tmdbCollectionId: f.tmdbCollectionId || null };
  formModal({
    title: existing ? 'Franchise bearbeiten' : 'Franchise hinzufügen',
    pre: existing ? '' : tmdbBlock('Filmreihe in TMDb suchen (optional)'),
    body: `${fld('Name *', 'name', f.name, { full: true, attrs: 'required', ph: 'z. B. Harry Potter' })}
      ${U.imageField('image', 'Logo oder Titelbild', f.image)}
      ${area('Beschreibung', 'desc', f.desc)}
      ${fld('Reihenfolge in der Übersicht', 'order', f.order, { type: 'number', attrs: 'step="any" inputmode="decimal"', ph: 'leer = alphabetisch' })}
      <div id="frHint" class="full"></div>`,
    onMount(form, md) {
      bindTmdb(md, T.searchCollections, async cid => {
        const c = await T.collectionDetails(cid);
        setForm(form, c, ['name', 'desc']);
        setImg(form, 'image', c.image);
        draft.tmdbCollectionId = c.tmdbCollectionId;
        const h = form.querySelector('#frHint');
        h.innerHTML = `<div class="hint">Diese Reihe enthält ${c.parts.length} Filme. Beim Speichern fragt die App, welche du schon besitzt – alle anderen werden ausgegraut angelegt.</div>`;
        md.el.querySelector('[type=submit]').textContent = 'Weiter';
      });
    },
    async onSubmit(fd, form, md) {
      const name = str(fd.name);
      if (!name) { toast('Bitte einen Namen eingeben', 'err'); return false; }
      if (!existing && draft.tmdbCollectionId) {
        md.close();
        await importCollection(draft.tmdbCollectionId, { name, image: safeUrl(fd.image), desc: str(fd.desc) });
        return false;
      }
      if (!existing && arr(S.franchises).some(x => norm(x.name) === norm(name)) && !await confirmDialog(`Ein Franchise „${name}“ gibt es schon. Trotzdem anlegen?`, { okText: 'Trotzdem anlegen' })) return false;
      const data = { name, image: safeUrl(fd.image), desc: str(fd.desc), order: num(fd.order), tmdbCollectionId: draft.tmdbCollectionId };
      const id = existing?.id || newId('franchises');
      if (!existing) data.createdAt = Date.now();
      run([setOp('franchises', id, data)]);
      toast(existing ? 'Franchise gespeichert' : 'Franchise angelegt');
      if (!existing) location.hash = '#/franchise/' + id;
    }
  });
}

async function deleteFranchise(id) {
  const f = S.franchises.get(id);
  if (!f) return;
  const ms = moviesIn(id);
  const others = franchisesSorted().filter(x => x.id !== id);
  let mode = 'keep';
  if (ms.length) {
    mode = await choiceDialog({
      title: `„${f.name}“ löschen`, okText: 'Weiter', danger: true,
      message: `Zu diesem Franchise gehören ${ms.length} Filme. Was soll mit ihnen passieren?`,
      choices: [
        ['keep', 'Filme behalten', 'Die Filme bleiben erhalten und erscheinen unter „Einzelne Filme“.'],
        ...(others.length ? [['move', 'In anderes Franchise verschieben', 'Im nächsten Schritt wählst du das Ziel.']] : []),
        ['delete', 'Filme ebenfalls löschen', 'Franchise und Filme kommen in den Papierkorb.']
      ]
    });
    if (!mode) return;
  }
  let target = null;
  if (mode === 'move') {
    target = await choiceDialog({ title: 'Ziel-Franchise wählen', okText: 'Verschieben & löschen', choices: others.map(o => [o.id, o.name, '']) });
    if (!target) return;
  }
  if (!await confirmDialog(mode === 'delete' ? `Franchise „${f.name}“ und ${ms.length} Filme löschen? Du kannst sie im Papierkorb wiederherstellen.` : `Franchise „${f.name}“ löschen? Du kannst es im Papierkorb wiederherstellen.`, { danger: true, okText: 'Löschen' })) return;
  const entries = [{ col: 'franchises', id }];
  if (mode === 'delete') ms.forEach(m => entries.push({ col: 'movies', id: m.id }));
  const ops = trashOps(entries, `Franchise: ${f.name}`, mode === 'keep' ? ms.map(m => m.id) : []);
  if (mode === 'keep') ms.forEach(m => ops.push(setOp('movies', m.id, { franchiseId: null })));
  if (mode === 'move') {
    let base = Math.max(0, ...moviesIn(target).map(m => num(m.order) || 0));
    ms.forEach(m => ops.push(setOp('movies', m.id, { franchiseId: target, order: ++base })));
  }
  location.hash = '#/filme';
  run(ops);
  toast('Franchise gelöscht – im Papierkorb wiederherstellbar');
}

// ── Serie ────────────────────────────────────────────────────
const SERIES_META = ['name', 'originalName', 'year', 'poster', 'desc', 'genres', 'rating', 'imdbRating', 'imdbId'];
const normSeriesMeta = d => ({ ...d, rating: num(d.rating), imdbRating: num(d.imdbRating) });

function seriesForm(existing = null) {
  const se = existing || {};
  const draft = { tmdbId: se.tmdbId || null, backdrop: se.backdrop || '', seasons: null, picked: null };
  formModal({
    title: existing ? 'Serie bearbeiten' : 'Serie hinzufügen',
    pre: !existing || !existing.tmdbId ? tmdbBlock(existing ? 'Mit TMDb verknüpfen (optional)' : 'In TMDb suchen (optional)') : '',
    body: `${fld('Name *', 'name', se.name, { full: true, attrs: 'required', ph: 'z. B. Scrubs' })}
      ${fld('Originalname', 'originalName', se.originalName)}
      ${fld('Zeitraum', 'year', se.year, { ph: 'z. B. 2001–2010' })}
      ${existing ? '' : fld('Anzahl Staffeln', 'seasonCount', 1, { type: 'number', attrs: 'min="0" max="100" inputmode="numeric"' })}
      ${U.imageField('poster', 'Coverbild', se.poster)}
      ${area('Beschreibung', 'desc', se.desc)}
      <details class="full more" ${existing ? 'open' : ''}><summary>Weitere Angaben</summary><div class="form-grid">
        ${fld('Genre', 'genres', se.genres)}
        ${fld('IMDb-ID oder IMDb-Link', 'imdbId', se.imdbId, { ph: 'tt0285403' })}
        ${fld('TMDb-Bewertung (0–10)', 'rating', se.rating, { type: 'number', attrs: 'step="0.1" min="0" max="10" inputmode="decimal"' })}
        ${fld('IMDb-Bewertung (0–10)', 'imdbRating', se.imdbRating, { type: 'number', attrs: 'step="0.1" min="0" max="10" inputmode="decimal"' })}
        ${area('Notizen', 'notes', se.notes)}
      </div></details>
      <div id="seHint" class="full"></div>`,
    onMount(form, md) {
      bindTmdb(md, T.searchTv, async tid => {
        const d = await T.tvDetails(tid);
        setForm(form, d, ['name', 'originalName', 'year', 'desc', 'genres', 'rating', 'imdbRating', 'imdbId']);
        setImg(form, 'poster', d.poster);
        Object.assign(draft, { tmdbId: d.tmdbId, backdrop: d.backdrop, seasons: d.seasons, picked: normSeriesMeta(d) });
        if (form.elements.seasonCount) form.elements.seasonCount.value = d.seasons.length;
        const dup = arr(S.series).find(x => x.tmdbId === d.tmdbId && x.id !== existing?.id);
        form.querySelector('#seHint').innerHTML = dup ? `<div class="hint warn">„${esc(dup.name)}“ ist bereits in deiner Sammlung.</div>` : (existing ? '' : `<div class="hint">${d.seasons.length} Staffeln werden mit Jahr und Cover angelegt.</div>`);
      });
    },
    async onSubmit(fd) {
      const name = str(fd.name);
      if (!name) { toast('Bitte einen Namen eingeben', 'err'); return false; }
      const data = { name, originalName: str(fd.originalName), year: str(fd.year), poster: safeUrl(fd.poster), desc: str(fd.desc), genres: str(fd.genres), imdbId: parseImdb(fd.imdbId), rating: num(fd.rating), imdbRating: num(fd.imdbRating), notes: str(fd.notes) };
      if (draft.tmdbId) data.tmdbId = draft.tmdbId;
      if (draft.backdrop) data.backdrop = draft.backdrop;
      const base = draft.picked || existing;
      if (base) {
        const manual = {};
        for (const k of SERIES_META) if (String(base[k] ?? '') !== String(data[k] ?? '')) manual[k] = true;
        if (Object.keys(manual).length) data.manual = manual;
      }
      if (existing) { run([setOp('series', existing.id, data)]); toast('Serie gespeichert'); return; }
      const dup = data.tmdbId && arr(S.series).find(x => x.tmdbId === data.tmdbId);
      if (dup) { toast(`„${dup.name}“ ist bereits vorhanden – kein Duplikat angelegt`, 'err'); return false; }
      if (arr(S.series).some(x => norm(x.name) === norm(name)) && !await confirmDialog(`Eine Serie „${name}“ gibt es schon. Trotzdem anlegen?`, { okText: 'Trotzdem anlegen' })) return false;
      const id = newId('series');
      const n = Math.max(0, Math.min(100, intOrNull(fd.seasonCount) ?? 0));
      const list = Array.from({ length: n }, (_, i) => draft.seasons?.[i] || { number: i + 1 });
      // Nachfragen: Welche Staffeln besitzt du schon? Der Rest wird ausgegraut angelegt.
      let ownedNums = new Set();
      if (list.length) {
        ownedNums = await U.checklistDialog({
          title: `${name}: Was hast du schon?`, okText: 'Serie anlegen',
          message: 'Hake an, welche Staffeln du schon besitzt. Alle anderen werden ausgegraut als „fehlt noch“ angelegt.',
          items: list.map(t => ({ id: t.number, label: `Staffel ${t.number}`, sub: [t.name, t.year].filter(Boolean).join(' · ') }))
        });
        if (!ownedNums) return false;
      }
      const ops = [setOp('series', id, { ...data, createdAt: Date.now() })];
      for (const t of list) {
        ops.push(setOp('seasons', newId('seasons'), { seriesId: id, number: t.number, name: t.name || '', year: t.year || null, poster: t.poster || '', episodes: t.episodes || null, owned: ownedNums.has(t.number), createdAt: Date.now() }));
      }
      run(ops);
      toast(list.length && ownedNums.size === list.length ? `🎉 „${name}“ ist vollständig – in deiner Mediathek` : `„${name}“ angelegt`);
      location.hash = '#/serie/' + id;
    }
  });
}

async function refreshSeries(id) {
  const se = S.series.get(id);
  if (!se?.tmdbId) return;
  toast('Lade Infos von TMDb …');
  const d = normSeriesMeta(await T.tvDetails(se.tmdbId));
  const updates = {}, skipped = [];
  for (const k of SERIES_META) {
    if (d[k] == null || d[k] === '') continue;
    if (se.manual?.[k]) { if (String(se[k] ?? '') !== String(d[k])) skipped.push(LABELS[k]); continue; }
    if (String(se[k] ?? '') !== String(d[k])) updates[k] = d[k];
  }
  if (!se.backdrop && d.backdrop) updates.backdrop = d.backdrop;
  const keys = Object.keys(updates).filter(k => k !== 'backdrop');
  if (!keys.length && !updates.backdrop) { toast(skipped.length ? 'Nichts aktualisiert – abweichende Felder sind manuell geschützt' : 'Alles ist bereits aktuell'); return; }
  if (await confirmDialog(`Folgende Felder werden aktualisiert: ${keys.map(k => LABELS[k]).join(', ') || 'Hintergrundbild'}.${skipped.length ? `\n\nManuell geändert und daher geschützt: ${skipped.join(', ')}.` : ''}`, { title: 'Infos aktualisieren', okText: 'Aktualisieren' })) {
    run([setOp('series', id, updates)]);
    toast('Infos aktualisiert');
  }
}

async function syncSeasons(id) {
  const se = S.series.get(id);
  if (!se?.tmdbId) return;
  toast('Lade Staffeln von TMDb …');
  const d = await T.tvDetails(se.tmdbId);
  const ex = seasonsOf(id);
  const ops = [];
  let added = 0, filled = 0;
  for (const t of d.seasons) {
    const s = ex.find(x => x.number === t.number);
    if (!s) { added++; ops.push(setOp('seasons', newId('seasons'), { seriesId: id, number: t.number, name: t.name, year: t.year, poster: t.poster, episodes: t.episodes, owned: false, createdAt: Date.now() })); continue; }
    const patch = {};
    for (const k of ['name', 'year', 'poster', 'episodes']) if ((s[k] == null || s[k] === '') && t[k]) patch[k] = t[k];
    if (Object.keys(patch).length) { filled++; ops.push(setOp('seasons', s.id, patch)); }
  }
  if (!ops.length) { toast('Staffeln sind bereits aktuell'); return; }
  if (await confirmDialog(`${added} neue Staffeln anlegen${filled ? `, bei ${filled} Staffeln fehlende Infos (Jahr, Cover, Name) ergänzen` : ''}? Vorhandene Angaben bleiben unverändert.`, { title: 'Staffeln von TMDb', okText: 'Übernehmen' })) {
    run(ops);
    toast('Staffeln aktualisiert');
  }
}

// ── Staffel ──────────────────────────────────────────────────
function seasonForm(seriesId, existing = null) {
  const se = S.series.get(seriesId);
  if (!se) return;
  const s = existing || { number: Math.max(0, ...seasonsOf(seriesId).map(x => x.number || 0)) + 1, owned: false };
  formModal({
    title: existing ? `${se.name} – Staffel ${s.number}` : `Staffel zu „${se.name}“ hinzufügen`,
    body: `${fld('Staffelnummer *', 'number', s.number, { type: 'number', attrs: 'min="0" required inputmode="numeric"' })}
      ${fld('Staffelname (optional)', 'name', s.name)}
      ${fld('Erscheinungsjahr', 'year', s.year, { type: 'number', attrs: 'min="1900" max="2100" inputmode="numeric"' })}
      ${select('Status', 'owned', [['0', 'Fehlt noch (ausgegraut)'], ['1', '✓ Gekauft']], s.owned ? '1' : '0')}
      ${U.imageField('poster', 'Coverbild (leer = Cover der Serie)', s.poster)}
      ${fld('Kaufdatum', 'purchaseDate', s.purchaseDate, { type: 'date' })}
      ${fld('Kaufpreis (€)', 'price', s.price, { type: 'number', attrs: 'step="0.01" min="0" inputmode="decimal"' })}
      ${area('Notizen', 'notes', s.notes)}
      ${existing ? `<div class="full"><button type="button" class="danger small" data-act="deleteSeason" data-id="${esc(existing.id)}" data-close>Staffel löschen</button></div>` : ''}`,
    onSubmit(fd) {
      const number = intOrNull(fd.number);
      if (number == null || number < 0) { toast('Bitte eine gültige Staffelnummer eingeben', 'err'); return false; }
      if (seasonsOf(seriesId).some(x => x.number === number && x.id !== existing?.id)) { toast(`Staffel ${number} gibt es schon`, 'err'); return false; }
      const data = { seriesId, number, name: str(fd.name), year: intOrNull(fd.year), owned: fd.owned === '1', poster: safeUrl(fd.poster), purchaseDate: str(fd.purchaseDate), price: num(fd.price), notes: str(fd.notes) };
      if (!existing) data.createdAt = Date.now();
      run([setOp('seasons', existing?.id || newId('seasons'), data)]);
      toast(existing ? 'Staffel gespeichert' : `Staffel ${number} hinzugefügt`);
    }
  });
}

// ═════════════════════════════════════════════════════════════
// Import / Export
// ═════════════════════════════════════════════════════════════
const today = () => new Date().toISOString().slice(0, 10);
function exportData() {
  return { app: 'SahinMax', version: 2, exportedAt: new Date().toISOString(), franchises: arr(S.franchises), movies: arr(S.movies), series: arr(S.series), seasons: arr(S.seasons) };
}
function doExportJson() {
  U.download(`sahinmax-backup-${today()}.json`, JSON.stringify(exportData(), null, 2), 'application/json');
  run([setOp('settings', 'app', { lastExport: Date.now() })]);
  toast('Backup exportiert');
}
function doExportCsv() {
  const rows = [['Typ', 'Titel', 'Jahr', 'Franchise/Serie', 'Position/Staffel', 'Status', 'Format', 'Genre', 'Laufzeit', 'IMDb-ID', 'Kaufdatum', 'Kaufpreis', 'Notizen']];
  const fr = id => S.franchises.get(id)?.name || '';
  arr(S.movies).sort((a, b) => fr(frOf(a)).localeCompare(fr(frOf(b)), 'de') || byOrder(a, b)).forEach(m =>
    rows.push(['Film', m.title, m.year, fr(frOf(m)), m.order, m.owned ? 'vorhanden' : 'fehlt', m.format, m.genres, m.runtime, m.imdbId, m.purchaseDate, m.price, m.notes]));
  seriesSorted().forEach(se => seasonsOf(se.id).forEach(s =>
    rows.push(['Staffel', s.name || `Staffel ${s.number}`, s.year, se.name, s.number, s.owned ? 'vorhanden' : 'fehlt', '', se.genres, '', se.imdbId, s.purchaseDate, s.price, s.notes])));
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  U.download(`sahinmax-liste-${today()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

// Wandelt Backups der alten FilmVault-Version (image/genre/seasons in der Serie …) ins neue Format um.
function normalizeImport(data) {
  const img = p => !p ? '' : String(p).startsWith('/') ? T.IMG(p) : safeUrl(p);
  const legacy = (data.series || []).some(s => Array.isArray(s.seasons)) || (data.movies || []).some(m => 'image' in m || 'genre' in m || 'origTitle' in m);
  if (!legacy) return { franchises: data.franchises || [], movies: data.movies || [], series: data.series || [], seasons: data.seasons || [] };
  const franchises = (data.franchises || []).map(f => ({ id: f.id, name: f.name || 'Ohne Namen', desc: f.desc || '', image: img(f.image), order: num(f.order), tmdbCollectionId: f.tmdbCollectionId || null, createdAt: f.createdAt || Date.now() }));
  const movies = (data.movies || []).map(m => ({
    id: m.id, title: m.title || 'Ohne Titel', originalTitle: m.origTitle || m.originalTitle || '', year: intOrNull(m.year),
    franchiseId: m.franchiseId || null, order: num(m.order), owned: !!m.owned, poster: img(m.image || m.poster), desc: m.desc || '',
    genres: m.genre || m.genres || '', runtime: intOrNull(m.runtime), rating: num(m.rating), imdbRating: num(m.imdbRating),
    imdbId: parseImdb(m.imdbId), tmdbId: m.tmdbId || null, format: m.format || '',
    purchaseDate: m.buyDate || m.purchaseDate || '', price: num(m.price), notes: m.notes || '', createdAt: m.createdAt || Date.now()
  }));
  const series = [], seasons = [...(data.seasons || [])];
  for (const s of data.series || []) {
    series.push({ id: s.id, name: s.name || 'Ohne Namen', originalName: s.origName || s.originalName || '', year: s.years || s.year || '', genres: s.genre || s.genres || '', rating: num(s.rating), imdbId: parseImdb(s.imdbId), tmdbId: s.tmdbId || null, desc: s.desc || '', notes: s.notes || '', poster: img(s.image || s.poster), createdAt: s.createdAt || Date.now() });
    for (const x of s.seasons || []) {
      const n = intOrNull(x.n ?? x.number);
      if (n == null) continue;
      seasons.push({ id: `${s.id}-s${n}`, seriesId: s.id, number: n, name: x.name || '', year: intOrNull(x.year), owned: !!x.owned, poster: img(x.image || x.poster), createdAt: s.createdAt || Date.now() });
    }
  }
  return { franchises, movies, series, seasons };
}

async function doImport(file) {
  let raw;
  try { raw = JSON.parse(await file.text()); } catch { toast('Die Datei ist kein gültiges JSON', 'err'); return; }
  if (!raw || !Array.isArray(raw.movies)) { toast('Das sieht nicht nach einem SahinMax-Backup aus', 'err'); return; }
  const data = normalizeImport(raw);
  const mode = await choiceDialog({
    title: 'Backup importieren', okText: 'Importieren',
    message: `Die Datei enthält ${data.franchises.length} Franchises, ${data.movies.length} Filme, ${data.series.length} Serien und ${data.seasons.length} Staffeln.`,
    choices: [
      ['merge', 'Zusammenführen', 'Einträge mit gleicher ID werden aktualisiert, neue hinzugefügt. Es wird nichts gelöscht.'],
      ['replace', 'Ersetzen', 'Der aktuelle Datenbestand wird komplett durch die Datei ersetzt. Vorher wird automatisch ein Backup heruntergeladen.']
    ]
  });
  if (!mode) return;
  if (mode === 'replace') {
    if (!await confirmDialog('Wirklich alle aktuellen Daten durch das Backup ersetzen?', { danger: true, okText: 'Ersetzen' })) return;
    if (S.movies.size || S.series.size) doExportJson();
  }
  const ops = importOps(data, mode);
  toast('Importiere …');
  try { await backend.commit(ops); toast(`Import abgeschlossen: ${data.movies.length} Filme, ${data.series.length} Serien`); }
  catch (e) { console.error(e); toast('Import fehlgeschlagen: ' + (e.message || e.code), 'err'); }
}

function importOps(data, mode) {
  const safeId = id => String(id).replace(/\//g, '_').slice(0, 300);
  const ops = [];
  for (const col of COLS) {
    const keep = new Set();
    for (const item of data[col]) {
      const { id, updatedAt, updatedBy, ...rest } = item;
      const docId = id ? safeId(id) : newId(col);
      keep.add(docId);
      ops.push(setOp(col, docId, rest, mode !== 'merge'));
    }
    if (mode === 'replace') for (const id of S[col].keys()) if (!keep.has(id)) ops.push(delOp(col, id));
  }
  return ops;
}

// Startdaten (data/startdaten.json) einmalig in die leere Datenbank übernehmen.
async function loadStartData() {
  let raw;
  try {
    const r = await fetch('data/startdaten.json', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    raw = await r.json();
  } catch { toast('Keine Startdaten gefunden (data/startdaten.json)', 'err'); return; }
  const data = normalizeImport(raw);
  if (!await confirmDialog(`${data.franchises.length} Franchises, ${data.movies.length} Filme, ${data.series.length} Serien und ${data.seasons.length} Staffeln übernehmen?`, { title: 'Meine Sammlung übernehmen', okText: 'Übernehmen' })) return;
  toast('Übernehme Sammlung …');
  try { await backend.commit(importOps(data, 'merge')); toast('Sammlung übernommen ✓'); }
  catch (e) { console.error(e); toast('Übernahme fehlgeschlagen: ' + (e.message || e.code), 'err'); }
}

// ═════════════════════════════════════════════════════════════
// Aktionen
// ═════════════════════════════════════════════════════════════
const A = {
  add() {
    const r = route();
    const fr = r.name === 'franchise' ? r.id : '';
    if (r.name === 'serie' && S.series.has(r.id)) {
      openModal({ title: 'Hinzufügen', body: `<div class="choose">
        <button class="choice" data-act="addSeason" data-id="${esc(r.id)}" data-close><span>📀</span><strong>Staffel</strong><small>zu „${esc(S.series.get(r.id).name)}“</small></button>
        <button class="choice" data-act="addSeries" data-close><span>📺</span><strong>Neue Serie</strong><small>Serie mit Staffeln anlegen</small></button>
        <button class="choice" data-act="addMovie" data-close><span>🎬</span><strong>Film</strong><small>Einzelnen Film anlegen</small></button></div>` });
      return;
    }
    openModal({ title: 'Hinzufügen', body: `<div class="choose">
      <button class="choice" data-act="addMovie" data-fr="${esc(fr)}" data-close><span>🎬</span><strong>Film</strong><small>Mit TMDb-Suche oder manuell</small></button>
      <button class="choice" data-act="addFranchise" data-close><span>📚</span><strong>Franchise / Filmreihe</strong><small>Neu anlegen oder komplett von TMDb importieren</small></button>
      <button class="choice" data-act="addSeries" data-close><span>📺</span><strong>Serie</strong><small>Serie mit Staffeln anlegen</small></button></div>` });
  },
  addMovie: d => movieForm(null, { franchiseId: d.fr && d.fr !== '_' && S.franchises.has(d.fr) ? d.fr : null }),
  addFranchise: () => franchiseForm(),
  addSeries: () => seriesForm(),
  addSeason: d => seasonForm(d.id),
  openMovie: d => openMovie(d.id),
  openSeason: d => openSeason(d.id),
  editMovie: d => { const m = S.movies.get(d.id); if (m) movieForm(m); },
  editFranchise: d => { const f = S.franchises.get(d.id); if (f) franchiseForm(f); },
  editSeries: d => { const s = S.series.get(d.id); if (s) seriesForm(s); },
  editSeason: d => { const s = S.seasons.get(d.id); if (s) seasonForm(s.seriesId, s); },
  refreshMovie: d => refreshMovie(d.id),
  refreshSeries: d => refreshSeries(d.id),
  syncSeasons: d => syncSeasons(d.id),
  importCollection: d => importCollection(Number(d.cid)),
  linkCollection: d => linkCollection(d.id),
  deleteFranchise: d => deleteFranchise(d.id),

  toggleMovie(d) {
    const m = S.movies.get(d.id);
    if (!m) return;
    const fid = frOf(m);
    const completes = !m.owned && fid && moviesIn(fid).every(x => x.id === m.id || x.owned);
    run([setOp('movies', m.id, m.owned ? { owned: false } : { owned: true, ownedAt: Date.now() })]);
    if (m.owned) toast(`„${m.title}“ als fehlend markiert`);
    else if (completes) toast(`🎉 „${S.franchises.get(fid).name}“ ist vollständig – jetzt in deiner Mediathek`);
    else if (!fid) toast(`„${m.title}“ gekauft – jetzt in deiner Mediathek`);
    else toast(`„${m.title}“ als gekauft abgehakt`);
  },
  toggleSeason(d) {
    const s = S.seasons.get(d.id);
    if (!s) return;
    const se = S.series.get(s.seriesId);
    const completes = !s.owned && seasonsOf(s.seriesId).every(x => x.id === s.id || x.owned);
    run([setOp('seasons', s.id, s.owned ? { owned: false } : { owned: true, ownedAt: Date.now() })]);
    if (completes) toast(`🎉 „${se?.name}“ ist vollständig – jetzt in deiner Mediathek`);
    else toast(`${se?.name || 'Serie'} – Staffel ${s.number}: ${s.owned ? 'fehlt' : 'gekauft'}`);
  },
  toggleGroup(d, el) {
    const s = openState(d.view);
    const i = s.t.indexOf(d.gid);
    if (i >= 0) s.t.splice(i, 1); else s.t.push(d.gid);
    saveOpenState(d.view, s);
    const sec = el.closest('.group');
    sec.classList.toggle('open');
    el.setAttribute('aria-expanded', sec.classList.contains('open'));
  },
  setAllGroups(d) { saveOpenState(d.view, { def: d.val === 'open', t: [] }); renderView(false); },
  toggleFlat() { UI.libFlat = !UI.libFlat; renderView(false); },
  async installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null; renderBanner();
  },
  hideInstall() { try { localStorage.setItem('fv-install-hint', '1'); } catch { /* egal */ } renderBanner(); },
  async bulkFranchise(d) {
    const f = S.franchises.get(d.id);
    const ms = moviesIn(d.id);
    const target = !ms.every(m => m.owned);
    if (!await confirmDialog(`Alle ${ms.length} Filme von „${f.name}“ als ${target ? 'gekauft' : 'fehlend'} markieren?`, { title: 'Ganze Reihe ändern', okText: target ? 'Alle abhaken' : 'Alle als fehlend' })) return;
    run(ms.filter(m => !!m.owned !== target).map(m => setOp('movies', m.id, target ? { owned: true, ownedAt: Date.now() } : { owned: false })));
    toast(`„${f.name}“ aktualisiert`);
  },
  async bulkSeries(d) {
    const se = S.series.get(d.id);
    const ss = seasonsOf(d.id);
    const target = !ss.every(s => s.owned);
    if (!await confirmDialog(`Alle ${ss.length} Staffeln von „${se.name}“ als ${target ? 'gekauft' : 'fehlend'} markieren?`, { title: 'Ganze Serie ändern', okText: target ? 'Alle abhaken' : 'Alle als fehlend' })) return;
    run(ss.filter(s => !!s.owned !== target).map(s => setOp('seasons', s.id, target ? { owned: true, ownedAt: Date.now() } : { owned: false })));
    toast(`„${se.name}“ aktualisiert`);
  },
  async deleteMovie(d) {
    const m = S.movies.get(d.id);
    if (!m || !await confirmDialog(`„${m.title}“ löschen? Du kannst den Film im Papierkorb wiederherstellen.`, { danger: true, okText: 'Löschen' })) return;
    run(trashOps([{ col: 'movies', id: m.id }], `Film: ${m.title}`));
    toast('Film gelöscht');
  },
  async deleteSeries(d) {
    const se = S.series.get(d.id);
    const ss = seasonsOf(d.id);
    if (!se || !await confirmDialog(`Serie „${se.name}“ mit ${ss.length} Staffeln löschen? Du kannst sie im Papierkorb wiederherstellen.`, { danger: true, okText: 'Löschen' })) return;
    location.hash = '#/serien';
    run(trashOps([{ col: 'series', id: se.id }, ...ss.map(s => ({ col: 'seasons', id: s.id }))], `Serie: ${se.name}`));
    toast('Serie gelöscht');
  },
  async deleteSeason(d) {
    const s = S.seasons.get(d.id);
    const se = s && S.series.get(s.seriesId);
    if (!s || !await confirmDialog(`Staffel ${s.number}${se ? ` von „${se.name}“` : ''} löschen?`, { danger: true, okText: 'Löschen' })) return;
    run(trashOps([{ col: 'seasons', id: s.id }], `Staffel: ${se?.name || ''} – Staffel ${s.number}`));
    toast('Staffel gelöscht');
  },
  moveMovie(d) {
    const m = S.movies.get(d.id);
    const list = moviesIn(frOf(m));
    const i = list.findIndex(x => x.id === m.id), j = i + Number(d.dir);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    run(list.map((x, k) => x.order === k + 1 ? null : setOp('movies', x.id, { order: k + 1 })).filter(Boolean));
  },
  toggleSort() { UI.sortMode = !UI.sortMode; renderView(false); },
  setFilter(d) { UI[d.key] = d.val; renderView(false); },
  shopping() {
    UI.type = 'items'; UI.status = 'missing'; UI.group = 'all'; UI.q = '';
    if (route().name !== 'suche') location.hash = '#/suche';
    else { const i = $('#sq'); if (i) i.value = ''; renderView(false); }
  },
  resetSearch() {
    UI.type = 'all'; UI.status = 'all'; UI.group = 'all'; UI.q = '';
    const i = $('#sq'); if (i) i.value = '';
    renderView(false);
  },
  hideBanner() { UI.bannerHidden = true; renderBanner(); },
  leaveDemo: () => leaveDemo(),
  loadStartData: () => loadStartData(),
  exportJson: () => doExportJson(),
  exportCsv: () => doExportCsv(),
  saveSettings() {
    const data = { tmdbKey: $('#tmdbKey').value.trim(), omdbKey: $('#omdbKey').value.trim(), vintedYear: $('#vintedYear').checked };
    T.setKeys({ tmdb: data.tmdbKey, omdb: data.omdbKey });
    run([setOp('settings', 'app', data)]);
    toast('Einstellungen gespeichert');
  },
  async testTmdb() {
    T.setKeys({ tmdb: $('#tmdbKey').value.trim(), omdb: $('#omdbKey').value.trim() });
    try {
      const r = await T.searchMovies('Matrix');
      toast(r.length ? 'TMDb funktioniert ✓' : 'TMDb erreichbar, aber keine Treffer');
      const om = $('#omdbKey').value.trim();
      if (om) toast((await T.imdbRating('tt0133093')) ? 'OMDb funktioniert ✓' : 'OMDb-Schlüssel funktioniert nicht', (await T.imdbRating('tt0133093')) ? 'ok' : 'err');
    } catch (e) { toast(e.message, 'err'); }
  },
  restoreTrash(d) {
    const t = S.trash.get(d.id);
    if (!t) return;
    const ops = [];
    for (const it of t.items || []) {
      if (it.col === 'seasons' && !S.series.has(it.data.seriesId) && !(t.items || []).some(x => x.col === 'series' && x.id === it.data.seriesId)) {
        toast('Die zugehörige Serie existiert nicht mehr – bitte zuerst die Serie wiederherstellen', 'err');
        return;
      }
      ops.push(setOp(it.col, it.id, it.data, false));
    }
    const main = t.items?.[0];
    (t.detached || []).forEach(mid => { const m = S.movies.get(mid); if (m && !frOf(m)) ops.push(setOp('movies', mid, { franchiseId: main.id })); });
    ops.push(delOp('trash', t.id));
    run(ops);
    toast('Wiederhergestellt');
  },
  async purgeTrash(d) {
    const t = S.trash.get(d.id);
    if (t && await confirmDialog(`„${t.label}“ endgültig löschen? Das kann nicht rückgängig gemacht werden.`, { danger: true, okText: 'Endgültig löschen' })) run([delOp('trash', t.id)]);
  },
  async emptyTrash() {
    if (await confirmDialog(`Alle ${S.trash.size} Einträge im Papierkorb endgültig löschen? Das kann nicht rückgängig gemacht werden.`, { danger: true, okText: 'Papierkorb leeren' })) run(arr(S.trash).map(t => delOp('trash', t.id)));
  },
  async logout() {
    if (S.demo) return leaveDemo();
    if (await confirmDialog('Wirklich abmelden?', { okText: 'Abmelden' })) backend.logout();
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = e.target.closest('a[href]');
  if (a && a !== el && el.contains(a)) return; // Links in Karten normal öffnen
  const fn = A[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  Promise.resolve().then(() => fn({ ...el.dataset }, el)).catch(err => { console.error(err); toast(err.message || 'Fehler', 'err'); });
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button][data-act]')) { e.preventDefault(); e.target.click(); }
});
// iPhone: Während getippt wird, untere Leiste ausblenden (sonst schiebt die Tastatur sie nach oben)
const TYPING = 'input:not([type=checkbox]):not([type=radio]):not([type=file]),textarea';
const kbCheck = () => {
  const typing = !!document.activeElement?.matches?.(TYPING) && document.activeElement.isConnected;
  // Zusätzlich prüfen, ob die Tastatur wirklich Platz wegnimmt (sichtbarer Bereich geschrumpft)
  const vv = window.visualViewport;
  const shrunk = !vv || vv.height < window.innerHeight * 0.85;
  document.body.classList.toggle('kb-open', typing && shrunk);
};
document.addEventListener('focusin', e => { if (e.target.matches?.(TYPING)) setTimeout(kbCheck, 350); });
document.addEventListener('focusout', () => setTimeout(kbCheck, 80));
window.visualViewport?.addEventListener('resize', kbCheck);
window.addEventListener('pageshow', kbCheck);
document.addEventListener('visibilitychange', kbCheck);
// Lange drücken (Cover) = gekauft/fehlt umschalten, ohne die Details zu öffnen
let lpTimer = null, lpFired = false, lpStart = null;
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-long]');
  if (!el || e.button > 0 || e.target.closest('a[href]')) return;
  lpFired = false; lpStart = [e.clientX, e.clientY];
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    lpFired = true;
    navigator.vibrate?.(15);
    el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 250);
    A[el.dataset.long]?.({ id: el.dataset.id });
  }, 480);
});
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => clearTimeout(lpTimer), true));
document.addEventListener('pointermove', e => { if (lpStart && Math.hypot(e.clientX - lpStart[0], e.clientY - lpStart[1]) > 10) clearTimeout(lpTimer); }, true);
document.addEventListener('click', e => { if (lpFired) { lpFired = false; e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-long]')) e.preventDefault(); });
// Kompakte Filter-Auswahlfelder
document.addEventListener('change', e => {
  const s = e.target.closest('[data-filter]');
  if (!s) return;
  UI[s.dataset.filter] = s.value;
  renderView(false);
});

boot();
