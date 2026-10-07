/* Pronote GOAT — éditeur visuel « no-code »
 *
 * Toute l'interface de l'éditeur vit dans un Shadow DOM (<pg-ui>) posé
 * au-dessus de la page : ses styles ne fuient pas dans Pronote et ceux de
 * Pronote ne l'atteignent pas. Rien n'est inséré dans les widgets eux-mêmes.
 *
 * Fonctions :
 *   - poignée ⠿ sur chaque widget : glisser-déposer entre colonnes (souris,
 *     tactile) ou flèches du clavier ;
 *   - largeur (1 à 3 colonnes), repli, masquage de chaque widget ;
 *   - « 🎯 Masquer un élément » : survol + clic sur n'importe quel élément de
 *     Pronote pour le cacher (sélecteur CSS généré et mémorisé) ;
 *   - réglages des widgets de l'extension ;
 *   - nombre de colonnes, profil et thème accessibles depuis la barre d'outils.
 * Chaque modification est sauvegardée automatiquement dans le profil actif.
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || !PG.core || !PG.layout || PG.editor) return;

  const core = PG.core;
  const layout = PG.layout;
  const esc = core.esc;
  const html = document.documentElement;

  const editor = { active: false };
  PG.editor = editor;

  /* ------------------------------------------------------------------ */
  /* Styles de l'interface (isolés dans le Shadow DOM)                   */
  /* ------------------------------------------------------------------ */

  const UI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 1;
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #f3f4f6; }
.layer > * { pointer-events: auto; }
button { font: inherit; color: inherit; cursor: pointer; }
.frame { position: fixed; pointer-events: none !important; border: 2px dashed rgba(34,197,94,.75);
  border-radius: 10px; transition: border-color .15s; }
.frame.hid { border-color: rgba(248,113,113,.8); }
.frame.drag { border-style: solid; border-color: #22c55e; background: rgba(34,197,94,.06); }
.bar { position: fixed; z-index: 2; display: flex; align-items: center; gap: 2px; padding: 3px; height: 30px;
  background: rgba(17,24,39,.94); border: 1px solid rgba(255,255,255,.14); border-radius: 9px;
  box-shadow: 0 6px 18px rgba(0,0,0,.28); max-width: calc(100vw - 16px); }
.bar .t { padding: 0 6px; max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-weight: 600; font-size: 12px; }
.bar button, .tb button, .pop button { border: 0; background: transparent; border-radius: 6px; min-width: 24px;
  height: 24px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
.bar button:hover, .tb button:hover, .pop button:hover { background: rgba(255,255,255,.12); }
.bar button:focus-visible, .tb button:focus-visible, .pop button:focus-visible { outline: 2px solid #22c55e; }
.bar .h { cursor: grab; font-size: 15px; touch-action: none; }
.bar .h:active { cursor: grabbing; }
.bar .on { background: rgba(34,197,94,.22); }
.ghost { position: fixed; z-index: 15; pointer-events: none !important; padding: 8px 12px; border-radius: 9px; background: #22c55e;
  color: #052e16; font-weight: 700; box-shadow: 0 12px 28px rgba(0,0,0,.35); transform: translate(-50%, -120%); white-space: nowrap; }
.drop { position: fixed; pointer-events: none !important; height: 4px; border-radius: 4px; background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34,197,94,.25), 0 0 16px rgba(34,197,94,.7); }
.colhint { position: fixed; pointer-events: none !important; border-radius: 12px; background: rgba(34,197,94,.07);
  border: 1px dashed rgba(34,197,94,.45); }

.tb { position: fixed; z-index: 10; top: 74px; right: 16px; width: 300px; max-height: calc(100vh - 100px); display: flex; flex-direction: column;
  background: rgba(17,24,39,.97); border: 1px solid rgba(255,255,255,.12); border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0,0,0,.4); overflow: hidden; }
.tb.min .body { display: none; }
.tb .head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; cursor: move; user-select: none;
  background: linear-gradient(135deg, rgba(34,197,94,.22), rgba(59,130,246,.12)); }
.tb .head b { flex: 1; font-size: 13px; }
.tb .body { overflow: auto; padding: 4px 14px 14px; }
.tb h4 { margin: 14px 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #9ca3af; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 0; }
.tb select, .pop select, .pop input[type=text], .pop input[type=date], .pop input[type=number] {
  font: inherit; color: #f9fafb; background: #1f2937; border: 1px solid #374151; border-radius: 7px; padding: 5px 7px; max-width: 170px; }
.pop input[type=number] { width: 70px; }
.stepper { display: inline-flex; align-items: center; gap: 4px; }
.stepper b { min-width: 18px; text-align: center; }
.btn { background: #374151 !important; padding: 0 10px !important; height: 28px !important; }
.btn.primary { background: #22c55e !important; color: #052e16; font-weight: 700; }
.btn.danger { background: rgba(239,68,68,.18) !important; color: #fca5a5; }
.btn.wide { width: 100%; margin-top: 6px; }
.status { font-size: 11px; color: #86efac; white-space: nowrap; }
.status.err { color: #fca5a5; }
.chk { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; }
.chk input { accent-color: #22c55e; width: 15px; height: 15px; margin: 0; }
.list { margin: 0; padding: 0; list-style: none; }
.list li { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,.06); }
.list li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #d1d5db; }
.muted { color: #9ca3af; font-size: 12px; }
.hint { margin: 6px 0 0; color: #9ca3af; font-size: 12px; }

.zap { position: fixed; pointer-events: none !important; border: 2px solid #f43f5e; background: rgba(244,63,94,.12);
  border-radius: 4px; transition: all .06s ease-out; }
.zap i { position: absolute; left: -2px; top: -22px; background: #f43f5e; color: #fff; font: 600 11px/20px system-ui;
  font-style: normal; padding: 0 6px; border-radius: 4px 4px 0 0; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
.banner { position: fixed; z-index: 25; left: 50%; top: 12px; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px;
  background: #f43f5e; color: #fff; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,.3); }

.pop { position: fixed; z-index: 20; width: 320px; max-height: 80vh; overflow: auto; padding: 14px; background: rgba(17,24,39,.98);
  border: 1px solid rgba(255,255,255,.14); border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,.45); }
.pop h3 { margin: 0 0 10px; font-size: 14px; }
.pop label.f { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; }
.pop .links .lr { display: grid; grid-template-columns: 42px 1fr 24px; gap: 4px; margin: 4px 0; }
.pop .links .lr input:nth-child(3) { grid-column: 1 / 3; }
.pop .links input { width: 100%; max-width: none; }
.pop .acts { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }
.pop code { font: 11px/1.4 ui-monospace, monospace; color: #fda4af; word-break: break-all; }

.toast { position: fixed; z-index: 30; left: 50%; bottom: 28px; transform: translateX(-50%); padding: 9px 16px; border-radius: 10px;
  background: rgba(17,24,39,.96); color: #f9fafb; box-shadow: 0 12px 30px rgba(0,0,0,.35); font-weight: 600; }
.toast.warn { background: #b45309; }
.fab { position: fixed; right: 18px; bottom: 18px; width: 46px; height: 46px; border-radius: 50%; border: 0;
  background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; font-size: 20px;
  box-shadow: 0 10px 26px rgba(22,163,74,.45); display: flex; align-items: center; justify-content: center;
  opacity: .82; transition: transform .15s, opacity .15s; }
.fab:hover { opacity: 1; transform: scale(1.07); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

  /* ------------------------------------------------------------------ */
  /* Hôte Shadow DOM                                                     */
  /* ------------------------------------------------------------------ */

  let host = null;
  let root = null; // .layer

  function ui() {
    if (host && host.isConnected) return root;
    if (!document.body) return null;
    host = document.createElement('pg-ui');
    host.className = 'pg-ui';
    host.setAttribute('aria-live', 'polite');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = UI_CSS;
    root = document.createElement('div');
    root.className = 'layer';
    shadow.append(style, root);
    // les raccourcis clavier de Pronote ne doivent pas voir nos saisies
    for (const t of ['keydown', 'keyup', 'keypress']) {
      root.addEventListener(t, (e) => {
        if (e.target.matches && e.target.matches('input, textarea, select')) e.stopPropagation();
      });
    }
    document.body.appendChild(host);
    return root;
  }

  function el(tag, cls, htmlStr) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (htmlStr !== undefined) e.innerHTML = htmlStr;
    return e;
  }

  /* ------------------------------------------------------------------ */
  /* Notifications                                                       */
  /* ------------------------------------------------------------------ */

  let toastEl = null;
  let toastTimer = null;
  editor.toast = function (msg, kind) {
    const r = ui();
    if (!r) return;
    if (!toastEl || !toastEl.isConnected) {
      toastEl = el('div', 'toast');
      toastEl.setAttribute('role', 'status');
      r.appendChild(toastEl);
    }
    toastEl.className = 'toast' + (kind ? ' ' + kind : '');
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
  };

  /* ------------------------------------------------------------------ */
  /* Calques posés sur les widgets                                       */
  /* ------------------------------------------------------------------ */

  const overlays = new Map(); // clé → { frame, bar, refs }
  let st = null; // état d'agencement mis en cache
  let stAge = 0;
  let raf = 0;

  function refreshState() {
    st = layout.state();
    stAge = 0;
  }

  function overlayFor(it) {
    let o = overlays.get(it.key);
    if (o) return o;
    const frame = el('div', 'frame');
    const bar = el('div', 'bar');
    const isOurs = it.key.startsWith('pg:');
    bar.innerHTML =
      '<button class="h" data-a="drag" title="Glisser pour déplacer · flèches du clavier">⠿</button>' +
      '<span class="t"></span>' +
      '<button data-a="span" title="Largeur (en colonnes)">1×</button>' +
      '<button data-a="collapse" title="Replier / déplier">▾</button>' +
      '<button data-a="hide" title="Masquer / afficher">👁</button>' +
      (isOurs ? '<button data-a="settings" title="Réglages du widget">⚙</button>' : '');
    bar.addEventListener('click', (e) => onBarClick(it.key, e));
    bar.querySelector('[data-a="drag"]').addEventListener('pointerdown', (e) => dragStart(it.key, e));
    bar.querySelector('[data-a="drag"]').addEventListener('keydown', (e) => keyMove(it.key, e));
    root.append(frame, bar);
    o = { frame, bar, t: bar.querySelector('.t'), span: bar.querySelector('[data-a="span"]'), col: bar.querySelector('[data-a="collapse"]'), hide: bar.querySelector('[data-a="hide"]') };
    overlays.set(it.key, o);
    return o;
  }

  function place(node, l, t, w, h) {
    const s = node.style;
    const L = Math.round(l) + 'px';
    const T = Math.round(t) + 'px';
    if (s.left !== L) s.left = L;
    if (s.top !== T) s.top = T;
    if (w !== undefined) {
      const W = Math.round(w) + 'px';
      const H = Math.round(h) + 'px';
      if (s.width !== W) s.width = W;
      if (s.height !== H) s.height = H;
    }
  }

  function syncOverlays() {
    if (!editor.active || !root) return;
    if (!st || ++stAge > 30 || !st.container.isConnected) refreshState();
    const cfg = core.config;
    const seen = new Set();
    // haut de la zone qui défile : rien ne doit déborder sur les bandeaux
    if (st && (!scroller || !scroller.isConnected || stAge === 0)) scroller = scrollParent(st.container);
    const viewTop = scroller && scroller !== document.scrollingElement ? Math.max(0, scroller.getBoundingClientRect().top) : 0;

    if (st) {
      for (const it of st.items) {
        if (!it.el.isConnected) {
          stAge = 99;
          continue;
        }
        const r = it.el.getBoundingClientRect();
        const o = overlayFor(it);
        seen.add(it.key);
        const vis = r.width > 0 && r.height > 0 && r.bottom > viewTop + 36 && r.top < innerHeight;
        o.frame.hidden = o.bar.hidden = !vis;
        if (!vis) continue;
        place(o.frame, r.left - 4, r.top - 4, r.width + 8, r.height + 8);
        const cut = Math.max(0, viewTop - (r.top - 4));
        const clip = cut ? 'inset(' + Math.round(cut) + 'px 0 0 0)' : '';
        if (o.frame.style.clipPath !== clip) o.frame.style.clipPath = clip;
        const bw = o.bar.offsetWidth || 200;
        // à cheval sur le bord haut du widget : le contenu reste lisible
        place(o.bar, Math.min(innerWidth - bw - 8, Math.max(8, r.right - bw - 6)), Math.max(viewTop + 4, r.top - 16));
        const hidden = !!cfg.layout.hidden[it.key];
        o.frame.classList.toggle('hid', hidden);
        o.frame.classList.toggle('drag', !!(drag && drag.key === it.key && drag.started));
        if (o.t.textContent !== it.title) o.t.textContent = it.title;
        const span = (+cfg.layout.span[it.key] || 1) + '×';
        if (o.span.textContent !== span) o.span.textContent = span;
        o.col.textContent = cfg.layout.collapsed[it.key] ? '▸' : '▾';
        o.hide.textContent = hidden ? '🚫' : '👁';
        o.hide.classList.toggle('on', hidden);
      }
    }
    for (const [k, o] of overlays) {
      if (!seen.has(k)) {
        o.frame.remove();
        o.bar.remove();
        overlays.delete(k);
      }
    }
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    syncOverlays();
    if (drag && drag.started) autoScroll();
  }

  function onBarClick(key, e) {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.getAttribute('data-a');
    if (a === 'span') layout.cycleSpan(key);
    else if (a === 'collapse') layout.toggleCollapsed(key);
    else if (a === 'hide') layout.toggleHidden(key);
    else if (a === 'settings') editor.openSettings(key.slice(3), b);
  }

  /* ------------------------------------------------------------------ */
  /* Glisser-déposer                                                     */
  /* ------------------------------------------------------------------ */

  let drag = null;
  let ghost = null;
  let dropLine = null;
  let colHint = null;

  function gap() {
    const v = parseFloat(getComputedStyle(html).getPropertyValue('--pg-gap'));
    return Number.isFinite(v) ? v : 24;
  }

  // Colonnes à l'écran : [{ left, width, ec }] (ec = colonne effective)
  function screenColumns() {
    const rect = st.container.getBoundingClientRect();
    if (html.classList.contains('pg-layout')) {
      const g = gap();
      const w = (rect.width - g * (st.eff - 1)) / st.eff;
      return Array.from({ length: st.eff }, (_, i) => ({ left: rect.left + i * (w + g), width: w, ec: i, top: rect.top }));
    }
    const wraps = [...st.container.querySelectorAll('.wrapper-cols')];
    return wraps.map((w, i) => {
      const r = w.getBoundingClientRect();
      return { left: r.left, width: r.width, ec: i, top: r.top, wrap: w };
    });
  }

  // Colonne (configurée) de chaque widget et sa colonne à l'écran
  function columnOfKey(key) {
    for (let ci = 0; ci < st.cols.length; ci++) if (st.cols[ci].includes(key)) return ci;
    return -1;
  }

  function screenColOf(ci, cols) {
    if (html.classList.contains('pg-layout')) return Math.floor((ci * st.eff) / st.N);
    // disposition native : colonne configurée → colonne native
    return Math.min(cols.length - 1, Math.floor((ci * cols.length) / st.N));
  }

  function hitTest(x, y) {
    const cols = screenColumns();
    if (!cols.length) return null;
    let c = cols.findIndex((k) => x >= k.left - gap() / 2 && x < k.left + k.width + gap() / 2);
    if (c < 0) c = x < cols[0].left ? 0 : cols.length - 1;
    const col = cols[c];

    const members = st.items
      .filter((it) => it.key !== drag.key && it.el.isConnected)
      .map((it) => ({ it, ci: columnOfKey(it.key), r: it.el.getBoundingClientRect() }))
      .filter((m) => m.ci >= 0 && m.r.height > 0 && screenColOf(m.ci, cols) === c)
      .sort((a, b) => a.r.top - b.r.top);

    const before = members.find((m) => y < m.r.top + m.r.height / 2);
    let ci;
    if (before) ci = before.ci;
    else {
      // dernière colonne configurée qui s'affiche dans cette colonne
      ci = -1;
      for (let i = 0; i < st.N; i++) if (screenColOf(i, cols) === c) ci = i;
      if (ci < 0) ci = Math.min(st.N - 1, c);
    }
    const last = members[members.length - 1];
    const lineY = before ? before.r.top - Math.min(12, gap() / 2) : last ? last.r.bottom + Math.min(12, gap() / 2) : col.top + 8;
    return { ci, before: before ? before.it.key : null, col, lineY };
  }

  function dragStart(key, e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    refreshState();
    if (!st) return;
    drag = { key, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, started: false, target: null };
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    e.target.addEventListener('pointermove', dragMove);
    e.target.addEventListener('pointerup', dragEnd, { once: true });
    e.target.addEventListener('pointercancel', dragCancel, { once: true });
  }

  function dragMove(e) {
    if (!drag) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return; // simple clic
      drag.started = true;
      const it = st.byKey[drag.key];
      if (it) it.el.setAttribute('data-pg-dragging', '');
      ghost = el('div', 'ghost');
      ghost.textContent = '⠿ ' + (it ? it.title : drag.key);
      dropLine = el('div', 'drop');
      colHint = el('div', 'colhint');
      root.append(colHint, dropLine, ghost);
    }
    place(ghost, e.clientX, e.clientY);
    const t = hitTest(e.clientX, e.clientY);
    drag.target = t;
    if (t) {
      place(dropLine, t.col.left, t.lineY - 2, t.col.width, 4);
      const rect = st.container.getBoundingClientRect();
      place(colHint, t.col.left - 4, Math.max(0, rect.top) - 4, t.col.width + 8, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top) + 8);
    }
  }

  function cleanupDrag() {
    if (drag && st && st.byKey[drag.key]) st.byKey[drag.key].el.removeAttribute('data-pg-dragging');
    for (const n of [ghost, dropLine, colHint]) if (n) n.remove();
    ghost = dropLine = colHint = null;
    drag = null;
  }

  function dragEnd(e) {
    e.target.removeEventListener('pointermove', dragMove);
    if (drag && drag.started && drag.target) {
      const { key } = drag;
      const { ci, before } = drag.target;
      if (before !== key) {
        layout.move(key, ci, before);
        editor.toast('Agencement enregistré');
      }
    }
    cleanupDrag();
    stAge = 99;
  }

  function dragCancel(e) {
    e.target.removeEventListener('pointermove', dragMove);
    cleanupDrag();
  }

  let scroller = null;
  function scrollParent(node) {
    for (let p = node; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  function autoScroll() {
    if (!st) return;
    scroller = scroller && scroller.isConnected ? scroller : scrollParent(st.container);
    const edge = 70;
    let dy = 0;
    if (drag.y < edge) dy = -Math.ceil((edge - drag.y) / 4);
    else if (drag.y > innerHeight - edge) dy = Math.ceil((drag.y - (innerHeight - edge)) / 4);
    if (dy) scroller.scrollTop += dy;
  }

  // Déplacement au clavier depuis la poignée
  function keyMove(key, e) {
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (!dirs[e.key]) return;
    e.preventDefault();
    e.stopPropagation();
    refreshState();
    if (!st) return;
    const ci = columnOfKey(key);
    if (ci < 0) return;
    const [dx, dy] = dirs[e.key];
    if (dx) {
      const nc = Math.max(0, Math.min(st.N - 1, ci + dx));
      if (nc !== ci) layout.move(key, nc, null);
    } else {
      const list = st.cols[ci];
      const i = list.indexOf(key);
      if (dy < 0 && i > 0) layout.move(key, ci, list[i - 1]);
      if (dy > 0 && i < list.length - 1) layout.move(key, ci, list[i + 2] || null);
    }
    setTimeout(() => {
      const o = overlays.get(key);
      if (o) o.bar.querySelector('.h').focus();
    }, 80);
  }

  /* ------------------------------------------------------------------ */
  /* Barre d'outils                                                      */
  /* ------------------------------------------------------------------ */

  let tb = null;
  let tbPos = null;

  function themeOptions(cur) {
    return PG.THEME_ORDER.map(
      (id) => '<option value="' + id + '"' + (id === cur ? ' selected' : '') + '>' + PG.THEMES[id].emoji + ' ' + esc(PG.THEMES[id].name) + '</option>'
    ).join('');
  }

  async function renderToolbar() {
    if (!tb) return;
    const cfg = core.config;
    const home = core.isHome();
    const s = home ? layout.state() : null;
    let index = [];
    try {
      index = await PG.store.index();
    } catch (e) {
      /* ignore */
    }
    const prof = index
      .map((p) => '<option value="' + esc(p.id) + '"' + (core.profile && p.id === core.profile.id ? ' selected' : '') + '>' + esc(p.name) + '</option>')
      .join('');

    const ours = PG.WIDGET_ORDER.map((id) => {
      const w = PG.WIDGETS[id];
      const on = cfg.widgets[id] && cfg.widgets[id].enabled;
      return '<label class="chk"><input type="checkbox" data-w="' + id + '"' + (on ? ' checked' : '') + '> ' + w.icon + ' ' + esc(w.name) + '</label>';
    }).join('');

    const hiddenNative = s ? s.items.filter((it) => cfg.layout.hidden[it.key]) : [];
    const zaps = cfg.layout.hiddenSelectors || [];

    const body = tb.querySelector('.body');
    body.innerHTML =
      '<h4>Profil & thème</h4>' +
      '<div class="row"><span>Profil</span><select data-k="profile">' + prof + '</select></div>' +
      '<div class="row"><span>Thème</span><select data-k="theme">' + themeOptions(cfg.theme.id) + '</select></div>' +
      '<h4>Agencement</h4>' +
      (home
        ? '<div class="row"><span>Colonnes</span><span class="stepper"><button class="btn" data-k="cols-" aria-label="Moins de colonnes">−</button><b>' +
          (s ? s.N : '?') + '</b><button class="btn" data-k="cols+" aria-label="Plus de colonnes">+</button></span></div>' +
          '<label class="chk"><input type="checkbox" data-k="custom"' + (cfg.layout.enabled ? ' checked' : '') + '> Agencement personnalisé</label>' +
          '<p class="hint">Glisse les widgets par leur poignée ⠿. Les widgets masqués restent visibles en grisé pendant l’édition.</p>' +
          (hiddenNative.length ? '<p class="hint">' + hiddenNative.length + ' widget(s) masqué(s) — clique sur 🚫 pour les réafficher.</p>' : '') +
          '<button class="btn wide" data-k="reset">↺ Réinitialiser l’agencement</button>'
        : '<p class="hint">Ouvre la page d’accueil de Pronote pour déplacer les widgets.</p>') +
      '<h4>Widgets GOAT</h4>' + ours +
      '<h4>Éléments masqués (' + zaps.length + ')</h4>' +
      '<button class="btn wide primary" data-k="zap">🎯 Masquer un élément de la page</button>' +
      (zaps.length
        ? '<ul class="list">' + zaps.map((z, i) => '<li><span title="' + esc(z.sel) + '">' + esc(z.label || z.sel) + '</span><button data-k="unzap" data-i="' + i + '" title="Réafficher">↩</button></li>').join('') + '</ul>'
        : '<p class="hint">Aucun pour l’instant.</p>');
  }

  function buildToolbar() {
    const r = ui();
    tb = el('div', 'tb');
    tb.setAttribute('role', 'dialog');
    tb.setAttribute('aria-label', 'Éditeur Pronote GOAT');
    tb.innerHTML =
      '<div class="head"><span>🐐</span><b>Éditeur visuel</b><span class="status" data-k="status">✓ Enregistré</span>' +
      '<button data-k="min" title="Réduire">—</button><button data-k="close" title="Terminer (Échap)">✕</button></div>' +
      '<div class="body"></div>';
    r.appendChild(tb);
    if (tbPos) {
      tb.style.left = tbPos.x + 'px';
      tb.style.top = tbPos.y + 'px';
      tb.style.right = 'auto';
    }

    tb.addEventListener('click', onToolbarClick);
    tb.addEventListener('change', onToolbarChange);

    // déplacement de la barre par son en-tête
    const head = tb.querySelector('.head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r0 = tb.getBoundingClientRect();
      const ox = e.clientX - r0.left;
      const oy = e.clientY - r0.top;
      head.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const x = Math.max(4, Math.min(innerWidth - 80, ev.clientX - ox));
        const y = Math.max(4, Math.min(innerHeight - 40, ev.clientY - oy));
        tb.style.left = x + 'px';
        tb.style.top = y + 'px';
        tb.style.right = 'auto';
        tbPos = { x, y };
      };
      head.addEventListener('pointermove', mv);
      head.addEventListener('pointerup', () => {
        head.removeEventListener('pointermove', mv);
        chrome.storage.local.set({ pgEditorPos: tbPos }).catch(() => {});
      }, { once: true });
    });
    renderToolbar();
  }

  function onToolbarClick(e) {
    const b = e.target.closest('[data-k]');
    if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const k = b.getAttribute('data-k');
    if (k === 'close') editor.stop();
    else if (k === 'min') tb.classList.toggle('min');
    else if (k === 'cols-' || k === 'cols+') {
      const s = layout.state();
      if (s) layout.setColumns(s.N + (k === 'cols+' ? 1 : -1));
    } else if (k === 'reset') {
      layout.reset();
      editor.toast('Agencement d’origine rétabli');
    } else if (k === 'zap') zapStart();
    else if (k === 'unzap') {
      const z = core.config.layout.hiddenSelectors[+b.getAttribute('data-i')];
      if (z) layout.removeHiddenSelector(z.sel);
    }
  }

  function onToolbarChange(e) {
    const t = e.target;
    const k = t.getAttribute('data-k');
    if (k === 'profile') PG.store.setActive(t.value);
    else if (k === 'theme') core.updateConfig((c) => void (c.theme.id = t.value));
    else if (k === 'custom') core.updateConfig((c) => void (c.layout.enabled = t.checked));
    else if (t.hasAttribute('data-w')) {
      const id = t.getAttribute('data-w');
      core.updateConfig((c) => void (c.widgets[id].enabled = t.checked));
    }
  }

  const rerender = PG.util.debounce(() => renderToolbar(), 120);
  core.on('config', () => {
    stAge = 99;
    if (editor.active) rerender();
  });
  core.on('home', () => editor.active && rerender());
  core.on('saving', () => setStatus('… enregistrement'));
  core.on('saved', (r) => setStatus(r.ok ? '✓ Enregistré' : '⚠ ' + r.error, !r.ok));

  function setStatus(txt, err) {
    const s = tb && tb.querySelector('[data-k="status"]');
    if (!s) return;
    s.textContent = txt.length > 28 ? txt.slice(0, 27) + '…' : txt;
    s.title = txt;
    s.classList.toggle('err', !!err);
  }

  /* ------------------------------------------------------------------ */
  /* Masquage d'éléments à la souris                                     */
  /* ------------------------------------------------------------------ */

  let zapping = false;
  let zapBox = null;
  let zapBanner = null;
  let zapTarget = null;

  const UNSTABLE = /^(pg-|pdl-|ie-ripple|ripple|selected|focus|hover|active|is-|has-|avec-|sans-|item-selected|ie-focus|Gras$|NoWrap$|AvecMain$|SansMain$|clickable$|done$|est-fait$)/i;

  function stableClasses(n) {
    return [...n.classList].filter((c) => !UNSTABLE.test(c) && !/\d{2,}/.test(c) && !/^_/.test(c) && c.length < 40);
  }

  function part(n, withIndex) {
    if (n.id && /^[a-z][\w-]*$/i.test(n.id) && !/\d/.test(n.id)) return '#' + CSS.escape(n.id);
    let s = n.tagName.toLowerCase();
    const cls = stableClasses(n).slice(0, 3);
    if (cls.length) s += '.' + cls.map((c) => CSS.escape(c)).join('.');
    if (withIndex && n.parentElement) {
      const same = [...n.parentElement.children].filter((x) => x.tagName === n.tagName);
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
    }
    return s;
  }

  // Sélecteur CSS stable et aussi court que possible pour « n ».
  // precise = false : sans index, pour viser tous les éléments semblables.
  function selectorFor(n, precise) {
    const parts = [];
    for (let cur = n; cur && cur !== document.body && cur !== html && parts.length < 9; cur = cur.parentElement) {
      parts.unshift(part(cur, precise));
      const sel = parts.join(' > ');
      let m;
      try {
        m = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      const ok = precise ? m.length === 1 && m[0] === n : [...m].includes(n);
      if (ok && (parts.length >= 2 || /[.#]/.test(parts[0]))) {
        // ancrage sur un widget ou un bloc identifiable : plus robuste
        if (!precise && parts.length < 3 && cur.parentElement && cur.parentElement !== document.body) {
          const anchor = cur.closest('section.widget, header, nav, footer, main');
          if (anchor && anchor !== cur) {
            const a = part(anchor, false);
            const full = a + ' ' + sel;
            try {
              if ([...document.querySelectorAll(full)].includes(n)) return full;
            } catch (e) {
              /* ignore */
            }
          }
        }
        return sel;
      }
    }
    return parts.join(' > ');
  }

  function describe(n) {
    const txt = core.textOf(n);
    const name = n.tagName.toLowerCase() + (stableClasses(n)[0] ? '.' + stableClasses(n)[0] : '');
    return txt ? name + ' « ' + (txt.length > 40 ? txt.slice(0, 40) + '…' : txt) + ' »' : name;
  }

  function zapStart() {
    if (zapping) return;
    zapping = true;
    html.classList.add('pg-zapping');
    const r = ui();
    zapBox = el('div', 'zap', '<i></i>');
    zapBanner = el('div', 'banner', '🎯 Clique sur l’élément à masquer · Échap pour annuler');
    r.append(zapBox, zapBanner);
    document.addEventListener('mousemove', zapMove, true);
    document.addEventListener('click', zapClick, true);
    document.addEventListener('keydown', zapKey, true);
  }

  function zapStop() {
    zapping = false;
    html.classList.remove('pg-zapping');
    document.removeEventListener('mousemove', zapMove, true);
    document.removeEventListener('click', zapClick, true);
    document.removeEventListener('keydown', zapKey, true);
    for (const n of [zapBox, zapBanner]) if (n) n.remove();
    zapBox = zapBanner = zapTarget = null;
    closePop();
  }

  function pickAt(x, y) {
    host.style.setProperty('display', 'none', 'important');
    const n = document.elementFromPoint(x, y);
    host.style.removeProperty('display');
    if (!n || n === html || n === document.body || core.isOurs(n)) return null;
    return n;
  }

  function showZap(n) {
    zapTarget = n;
    if (!n) {
      zapBox.hidden = true;
      return;
    }
    const r = n.getBoundingClientRect();
    zapBox.hidden = false;
    place(zapBox, r.left, r.top, r.width, r.height);
    zapBox.querySelector('i').textContent = describe(n);
  }

  function zapMove(e) {
    if (pop) return;
    if (e.composedPath()[0] && host.contains(e.composedPath()[0])) return;
    const n = pickAt(e.clientX, e.clientY);
    if (n !== zapTarget) showZap(n);
  }

  function zapKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      zapStop();
    }
  }

  function zapClick(e) {
    if (e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopPropagation();
    const n = pickAt(e.clientX, e.clientY) || zapTarget;
    if (!n) return;
    showZap(n);
    zapConfirm(n);
  }

  function zapConfirm(n) {
    const p = openPop(zapBox);
    const render = () => {
      const similar = p.querySelector('[data-k="similar"]');
      const sel = selectorFor(zapTarget, !(similar && similar.checked));
      let count = 0;
      try {
        count = document.querySelectorAll(sel).length;
      } catch (e) {
        count = 0;
      }
      p.querySelector('code').textContent = sel;
      p.querySelector('[data-k="count"]').textContent = count + ' élément(s) concerné(s)';
      p.dataset.sel = sel;
    };
    p.innerHTML =
      '<h3>Masquer cet élément ?</h3>' +
      '<p class="muted" data-k="desc"></p>' +
      '<label class="chk"><input type="checkbox" data-k="similar"> Masquer aussi les éléments semblables</label>' +
      '<p class="muted" data-k="count"></p><code></code>' +
      '<div class="acts"><button class="btn" data-k="parent" title="Sélectionner le bloc parent">▲ Bloc parent</button>' +
      '<button class="btn" data-k="cancel">Annuler</button><button class="btn primary" data-k="ok">Masquer</button></div>';
    p.querySelector('[data-k="desc"]').textContent = describe(n);
    render();
    p.querySelector('[data-k="similar"]').addEventListener('change', render);
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      const k = b.getAttribute('data-k');
      if (k === 'cancel') closePop();
      else if (k === 'parent') {
        const up = zapTarget && zapTarget.parentElement;
        if (up && up !== document.body && up !== html) {
          showZap(up);
          p.querySelector('[data-k="desc"]').textContent = describe(up);
          render();
        }
      } else if (k === 'ok') {
        const ok = layout.addHiddenSelector(p.dataset.sel, describe(zapTarget));
        editor.toast(ok ? 'Élément masqué — réversible depuis la barre d’outils' : 'Sélecteur invalide', ok ? '' : 'warn');
        zapStop();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Fenêtre flottante (réglages, confirmation)                          */
  /* ------------------------------------------------------------------ */

  let pop = null;

  function openPop(anchor) {
    closePop();
    const r = ui();
    pop = el('div', 'pop');
    pop.setAttribute('role', 'dialog');
    r.appendChild(pop);
    requestAnimationFrame(() => {
      if (!pop) return;
      const a = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 160, bottom: 120, top: 120 };
      const w = pop.offsetWidth || 320;
      const hgt = pop.offsetHeight || 300;
      let left = Math.max(8, Math.min(innerWidth - w - 8, a.left));
      let top = a.bottom + 8;
      if (top + hgt > innerHeight - 8) top = Math.max(8, a.top - hgt - 8);
      if (top < 8) top = 8;
      place(pop, left, top);
    });
    return pop;
  }

  function closePop() {
    if (pop) pop.remove();
    pop = null;
  }

  // Formulaire de réglages d'un widget de l'extension (même schéma que le popup)
  editor.openSettings = function (id, anchor) {
    const def = PG.WIDGETS[id];
    if (!def || !ui()) return;
    const p = openPop(anchor);
    const cfg = core.config.widgets[id];

    const field = (f) => {
      const v = cfg[f.key];
      const show = !f.showIf || Object.entries(f.showIf).every(([k, val]) => cfg[k] === val);
      if (!show) return '';
      if (f.type === 'checkbox') {
        return '<label class="chk"><input type="checkbox" data-f="' + f.key + '"' + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
      }
      if (f.type === 'select') {
        return '<label class="f">' + esc(f.label) + '<select data-f="' + f.key + '">' +
          f.options.map(([val, lab]) => '<option value="' + esc(val) + '"' + (val === v ? ' selected' : '') + '>' + esc(lab) + '</option>').join('') +
          '</select></label>';
      }
      if (f.type === 'links') {
        const items = Array.isArray(v) ? v : [];
        return '<div class="links"><div class="muted">Cible : <b>menu:Mes notes</b> (page de Pronote) ou <b>https://…</b></div>' +
          items.map((l, i) =>
            '<div class="lr" data-i="' + i + '"><input type="text" data-l="emoji" value="' + esc(l.emoji || '') + '" maxlength="4" aria-label="Emoji">' +
            '<input type="text" data-l="label" value="' + esc(l.label || '') + '" placeholder="Libellé" aria-label="Libellé">' +
            '<button data-del="' + i + '" title="Supprimer">✕</button>' +
            '<input type="text" data-l="target" value="' + esc(l.target || '') + '" placeholder="menu:Emploi du temps" aria-label="Cible"></div>'
          ).join('') +
          '<button class="btn wide" data-add="1">＋ Ajouter un lien</button></div>';
      }
      const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'color' ? 'color' : 'text';
      return '<label class="f">' + esc(f.label) + '<input type="' + type + '" data-f="' + f.key + '" value="' + esc(v == null ? '' : v) + '"' +
        (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') + '></label>';
    };

    p.innerHTML =
      '<h3>' + def.icon + ' ' + esc(def.name) + '</h3><p class="muted">' + esc(def.desc) + '</p>' +
      '<label class="chk"><input type="checkbox" data-f="enabled"' + (cfg.enabled ? ' checked' : '') + '> Afficher ce widget</label>' +
      def.schema.map(field).join('') +
      '<div class="acts"><button class="btn primary" data-close="1">Fermer</button></div>';

    const set = (k, val) => core.updateConfig((c) => void (c.widgets[id][k] = val));

    p.addEventListener('change', (e) => {
      const t = e.target;
      const f = t.getAttribute('data-f');
      if (f) {
        const sch = def.schema.find((s) => s.key === f);
        let val = t.type === 'checkbox' ? t.checked : t.value;
        if (sch && sch.type === 'number') val = Math.max(sch.min || 0, Math.min(sch.max || 999, parseInt(val, 10) || sch.min || 1));
        set(f, val);
        if (sch && def.schema.some((s) => s.showIf && f in s.showIf)) setTimeout(() => editor.openSettings(id, anchor), 30);
      }
      const l = t.getAttribute('data-l');
      if (l) {
        const i = +t.closest('.lr').getAttribute('data-i');
        core.updateConfig((c) => {
          const it = c.widgets[id].items[i];
          if (it) it[l] = t.value.trim();
        });
      }
    });
    p.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closePop();
      const del = e.target.closest('[data-del]');
      if (del) {
        core.updateConfig((c) => void c.widgets[id].items.splice(+del.getAttribute('data-del'), 1));
        setTimeout(() => editor.openSettings(id, anchor), 30);
      }
      if (e.target.closest('[data-add]')) {
        core.updateConfig((c) => void c.widgets[id].items.push({ emoji: '🔗', label: 'Nouveau lien', target: 'https://' }));
        setTimeout(() => editor.openSettings(id, anchor), 30);
      }
    });
  };

  /* ------------------------------------------------------------------ */
  /* Bouton flottant                                                     */
  /* ------------------------------------------------------------------ */

  let fab = null;
  function syncFab() {
    const want = core.enabled() && core.isHome() && !editor.active && core.config && core.config.ui.fab !== false;
    if (want && !fab) {
      const r = ui();
      if (!r) return;
      fab = el('button', 'fab', '✏️');
      fab.title = 'Personnaliser la page (Alt+Maj+E)';
      fab.setAttribute('aria-label', 'Ouvrir l’éditeur visuel Pronote GOAT');
      fab.addEventListener('click', () => editor.start());
      r.appendChild(fab);
    } else if (!want && fab) {
      fab.remove();
      fab = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Marche / arrêt                                                      */
  /* ------------------------------------------------------------------ */

  function onKey(e) {
    if (e.key === 'Escape' && !zapping) {
      if (pop) closePop();
      else editor.stop();
    }
  }

  editor.start = function () {
    if (editor.active || !core.enabled()) return;
    if (!ui()) return;
    editor.active = true;
    html.classList.add('pg-editing');
    syncFab();
    buildToolbar();
    refreshState();
    loop();
    document.addEventListener('keydown', onKey);
    if (!core.isHome()) editor.toast('Astuce : les widgets se déplacent depuis la page d’accueil');
  };

  editor.stop = function () {
    if (!editor.active) return;
    editor.active = false;
    zapStop();
    closePop();
    cancelAnimationFrame(raf);
    cleanupDrag();
    for (const o of overlays.values()) {
      o.frame.remove();
      o.bar.remove();
    }
    overlays.clear();
    if (tb) tb.remove();
    tb = null;
    html.classList.remove('pg-editing');
    document.removeEventListener('keydown', onKey);
    syncFab();
  };

  editor.toggle = () => (editor.active ? editor.stop() : editor.start());

  core.on('editor', (action) => {
    if (action === 'start') editor.start();
    else if (action === 'stop') editor.stop();
    else if (action === 'zap') {
      editor.start();
      zapStart();
    } else editor.toggle();
  });
  core.on('config', syncFab);
  core.on('tools', () => {
    if (!core.enabled()) editor.stop();
    syncFab();
  });
  core.on('home', syncFab);

  chrome.storage.local.get('pgEditorPos').then((v) => {
    if (v && v.pgEditorPos) tbPos = v.pgEditorPos;
  }).catch(() => {});
})();
