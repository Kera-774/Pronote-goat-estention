/* Pronote GOAT — noyau des scripts de contenu
 *
 * Chargé dès « document_start » (avant que Pronote ne construise son
 * interface) pour que le thème s'applique sans flash. Fournit aux autres
 * modules :
 *   - la configuration du profil actif et des outils, tenue à jour ;
 *   - un bus d'événements (config, tools, dom, home, infos, editor) ;
 *   - UN SEUL MutationObserver partagé, filtré et temporisé, au lieu d'un
 *     observateur par module (c'est ce qui ralentissait Pronote) ;
 *   - la gestion des feuilles de style injectées ;
 *   - quelques utilitaires DOM et la navigation dans les menus de Pronote.
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || PG.core) return;

  const U = PG.util;

  const core = {
    config: null, // configuration du profil actif (normalisée)
    profile: null, // { id, name }
    tools: null, // réglages des outils (pgTools)
    ready: false
  };
  PG.core = core;

  /* ------------------------------------------------------------------ */
  /* Utilitaires texte / DOM                                             */
  /* ------------------------------------------------------------------ */

  core.norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  core.textOf = (el) => (el ? core.norm(el.textContent || '') : '');
  core.deaccent = (s) =>
    (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  core.esc = U.escapeHtml;

  // checkVisibility() (Chrome 105+) tient compte des ancêtres masqués sans
  // forcer de calcul de style élément par élément.
  core.visible = function (el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };

  // Petit constructeur d'éléments : h('div', { class: 'x', onclick: fn }, [enfants])
  core.h = function (tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  };

  // Un nœud créé par l'extension (préfixes pg- / pdl-, éléments <pg-…>).
  core.isOurs = function (n) {
    if (!n || n.nodeType !== 1) return n && n.nodeType === 3 && core.isOurs(n.parentElement);
    if (n.tagName.startsWith('PG-')) return true;
    const c = typeof n.className === 'string' ? n.className : '';
    if (c.startsWith('pg-') || c.startsWith('pdl-') || c.includes(' pg-widget') || c.includes('pdl-perso')) {
      return true;
    }
    return (
      n.hasAttribute('data-pg-w') ||
      n.hasAttribute('data-pdl-devoir') ||
      n.hasAttribute('data-pdl-groupe') ||
      (n.id && n.id.startsWith('pg-'))
    );
  };

  const OUR_ZONES =
    '.pg-widget, .pg-ui, .pdl-tools, .pdl-pop, .pdl-cb-wrap, .pdl-perso, [data-pdl-devoir], [data-pdl-groupe]';

  function mutationIsOurs(m) {
    const t = m.target;
    if (t && t.nodeType === 1 && (core.isOurs(t) || (t.closest && t.closest(OUR_ZONES)))) return true;
    for (const n of m.addedNodes) if (!core.isOurs(n)) return false;
    for (const n of m.removedNodes) if (!core.isOurs(n)) return false;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Dates en français                                                   */
  /* ------------------------------------------------------------------ */

  const MOIS = {
    janv: 0, janvier: 0, jan: 0,
    fev: 1, fevr: 1, fevrier: 1,
    mars: 2, mar: 2,
    avr: 3, avril: 3,
    mai: 4,
    juin: 5,
    juil: 6, juillet: 6,
    aout: 7,
    sept: 8, septembre: 8, sep: 8,
    oct: 9, octobre: 9,
    nov: 10, novembre: 10,
    dec: 11, decembre: 11
  };

  // L'année scolaire commence en août : « 3 mars » sans année = l'an prochain
  // si l'on est en automne.
  function scholarYear(month) {
    const now = new Date();
    const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    return month >= 7 ? start : start + 1;
  }

  core.monthOf = function (word) {
    const key = core.deaccent(word).replace(/\.$/, '');
    if (MOIS[key] !== undefined) return MOIS[key];
    const hit = Object.keys(MOIS).find((k) => k.length >= 3 && key.startsWith(k));
    return hit !== undefined ? MOIS[hit] : undefined;
  };

  // « 03/10/2026 », « jeu. 17 sept. », « le 2 oct. », « aujourd'hui »… → Date
  core.parseFrDate = function (txt) {
    if (!txt) return null;
    const t = core.deaccent(txt);
    const mk = (y, m, d) => {
      const dt = new Date(y, m, d, 12, 0, 0, 0);
      return isNaN(dt.getTime()) ? null : dt;
    };
    if (/aujourd'?hui/.test(t)) return mk(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    if (/\bhier\b/.test(t)) {
      const d = new Date();
      return mk(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    }
    if (/\bdemain\b/.test(t)) {
      const d = new Date();
      return mk(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    const m1 = t.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/);
    if (m1) {
      let y = m1[3] ? parseInt(m1[3], 10) : scholarYear(parseInt(m1[2], 10) - 1);
      if (y < 100) y += 2000;
      return mk(y, parseInt(m1[2], 10) - 1, parseInt(m1[1], 10));
    }
    const re = /\b(\d{1,2})\s*(?:er)?\s+([a-z]{3,10})\.?(?:\s+(\d{4}))?/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const mo = core.monthOf(m[2]);
      if (mo === undefined) continue;
      const d = mk(m[3] ? parseInt(m[3], 10) : scholarYear(mo), mo, parseInt(m[1], 10));
      if (d) return d;
    }
    return null;
  };

  core.iso = function (d) {
    if (!d) return '';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  /* ------------------------------------------------------------------ */
  /* Détection des pages                                                 */
  /* ------------------------------------------------------------------ */

  core.homeContainer = () =>
    document.querySelector('.AffichagePageAccueil .widgets-global-container');
  core.isHome = () => !!core.homeContainer();
  // vrai dans le cadre qui contient réellement l'application Pronote
  core.isApp = () =>
    !!(document.body && (document.body.classList.contains('EspaceIndex') || document.getElementById('id_body')));

  /* ------------------------------------------------------------------ */
  /* Bus d'événements                                                    */
  /* ------------------------------------------------------------------ */

  const listeners = {};
  const last = {}; // dernière valeur des événements « rejouables »
  const REPLAY = new Set(['config', 'tools', 'started']);

  core.on = function (evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    if (REPLAY.has(evt) && evt in last) {
      try {
        fn(last[evt]);
      } catch (e) {
        console.warn('[Pronote GOAT]', evt, e);
      }
    }
  };

  core.emit = function (evt, data) {
    if (REPLAY.has(evt)) last[evt] = data;
    for (const fn of listeners[evt] || []) {
      try {
        fn(data);
      } catch (e) {
        console.warn('[Pronote GOAT]', evt, e);
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Feuilles de style                                                   */
  /* ------------------------------------------------------------------ */

  const styles = new Map();

  // Crée / met à jour <style id="pg-style-<id>">. N'écrit rien si le texte
  // est identique : pas de recalcul de style inutile.
  core.style = function (id, css) {
    let el = styles.get(id);
    if (!css) {
      if (el) el.remove();
      styles.delete(id);
      return;
    }
    if (!el || !el.isConnected) {
      el = document.createElement('style');
      el.id = 'pg-style-' + id;
      el.className = 'pg-style';
      styles.set(id, el);
    }
    if (el.textContent !== css) el.textContent = css;
    const parent = document.head || document.documentElement;
    // toujours en fin de document : nos règles passent après celles de Pronote
    if (el.parentNode !== parent || el.nextElementSibling && !el.nextElementSibling.classList.contains('pg-style')) {
      parent.appendChild(el);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Observateur partagé                                                 */
  /* ------------------------------------------------------------------ */

  const domHandlers = []; // { fn, delay, timer }
  let observer = null;
  let homePresent = false;

  // Enregistre une fonction appelée après des changements du DOM de Pronote
  // (jamais pour nos propres insertions), au plus une fois par « delay » ms.
  core.onDom = function (fn, delay) {
    domHandlers.push({ fn, delay: delay || 200, timer: null });
  };

  function fire(h) {
    clearTimeout(h.timer);
    h.timer = setTimeout(() => {
      h.timer = null;
      try {
        h.fn();
      } catch (e) {
        console.warn('[Pronote GOAT] dom', e);
      }
    }, h.delay);
  }

  core.touch = function () {
    const home = core.isHome();
    if (home !== homePresent) {
      homePresent = home;
      core.emit('home', home);
    }
    domHandlers.forEach(fire);
  };

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      // on s'arrête au premier changement qui ne vient pas de nous
      if (muts.every(mutationIsOurs)) return;
      core.touch();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // un clic de l'utilisateur change souvent d'affichage sans grosse mutation
    document.addEventListener('click', () => setTimeout(core.touch, 60), true);
  }

  /* ------------------------------------------------------------------ */
  /* Configuration                                                       */
  /* ------------------------------------------------------------------ */

  let pendingSave = null; // config en attente d'écriture (éditeur)

  async function loadConfig() {
    try {
      const p = await PG.store.getActive();
      core.profile = { id: p.id, name: p.name };
      core.config = p.config;
    } catch (e) {
      core.profile = { id: 'default', name: 'Par défaut' };
      core.config = U.normalizeConfig(null);
    }
    core.emit('config', core.config);
  }

  async function loadTools() {
    try {
      core.tools = await PG.store.tools();
    } catch (e) {
      core.tools = U.clone(PG.TOOLS_DEFAULTS);
    }
    core.emit('tools', core.tools);
  }

  core.enabled = () => !!(core.tools && core.tools.goat && core.tools.goat.enabled);

  // Modifie la configuration active : effet immédiat sur la page, écriture
  // groupée en arrière-plan (sauvegarde automatique de l'éditeur).
  const flush = U.debounce(async () => {
    const cfg = pendingSave;
    if (!cfg) return;
    try {
      await PG.store.updateActive(() => U.clone(cfg));
      core.emit('saved', { ok: true });
    } catch (e) {
      core.emit('saved', { ok: false, error: String(e && e.message ? e.message : e) });
    } finally {
      if (pendingSave === cfg) pendingSave = null;
    }
  }, 350);

  core.updateConfig = function (mutator) {
    const cfg = U.clone(core.config);
    const r = mutator(cfg);
    core.config = U.normalizeConfig(r && typeof r === 'object' ? r : cfg);
    pendingSave = core.config;
    core.emit('config', core.config);
    core.emit('saving');
    flush();
  };

  core.setTools = async function (patch) {
    core.tools = U.merge(core.tools, patch);
    core.emit('tools', core.tools);
    try {
      await PG.store.setTools(patch);
    } catch (e) {
      /* ignore */
    }
  };

  PG.store.onChange(async (info) => {
    if (info.tools) await loadTools();
    if (info.meta || info.index) {
      // changement de profil actif ou de zone de stockage
      const m = await PG.store.meta();
      if (info.meta || !core.profile || m.activeId !== core.profile.id) {
        if (!pendingSave) await loadConfig();
      }
    }
    if (core.profile && info.profiles.includes(core.profile.id)) {
      if (pendingSave) return; // notre propre sauvegarde est en cours
      const nv = info.changes[PG.store.KEYS.PREFIX + core.profile.id].newValue;
      if (!nv) return;
      const cfg = U.normalizeConfig(nv.config);
      if (JSON.stringify(cfg) === JSON.stringify(core.config)) return; // simple écho
      core.config = cfg;
      core.profile.name = nv.name;
      core.emit('config', core.config);
    }
    if (info.keys.includes('pgInfosCache')) core.emit('infos');
    if (info.assets) core.emit('assets');
  });

  /* ------------------------------------------------------------------ */
  /* Navigation dans Pronote                                             */
  /* ------------------------------------------------------------------ */

  core.clickLike = function (el) {
    if (!el) return false;
    const o = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new PointerEvent('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent('click', o));
      return true;
    } catch (e) {
      return false;
    }
  };

  // Ouvre une page de Pronote d'après le libellé de son entrée de menu
  // (« Mes notes », « Informations & sondages »…).
  core.navigate = function (label) {
    const want = core.deaccent(core.norm(label));
    const cands = document.querySelectorAll(
      '.label-submenu, .label-menu_niveau0, .label-home, [role="menuitem"] > div'
    );
    let best = null;
    for (const el of cands) {
      const t = core.deaccent(core.textOf(el));
      if (!t) continue;
      if (t === want) {
        best = el;
        break;
      }
      if (!best && t.startsWith(want)) best = el;
    }
    if (!best) return false;
    const item = best.closest('[role="menuitem"]') || best;
    return core.clickLike(item);
  };

  core.goHome = function () {
    const home = document.querySelector('.label-home');
    if (home) return core.clickLike(home.closest('[role="menuitem"]') || home);
    return core.navigate("Page d'accueil");
  };

  /* ------------------------------------------------------------------ */
  /* Messages (popup, service worker)                                    */
  /* ------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('pg-')) return;
    // seule la frame qui contient Pronote répond
    if (!core.isApp()) return;

    if (msg.type === 'pg-ping') {
      sendResponse({ ok: true, home: core.isHome(), title: document.title });
      return;
    }
    if (msg.type === 'pg-editor') {
      core.emit('editor', msg.action || 'toggle');
      sendResponse({ ok: true, home: core.isHome() });
      return;
    }
    if (msg.type === 'pg-navigate') {
      sendResponse({ ok: core.navigate(msg.label) });
      return;
    }
    if (msg.type === 'pg-infos-sync') {
      core.emit('infos-sync');
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'pg-diagnostic') {
      const out = { url: location.href, home: core.isHome(), modules: {} };
      core.emit('diagnostic', out);
      sendResponse(out);
    }
  });

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  core.start = async function () {
    await Promise.all([loadTools(), loadConfig()]);
    core.ready = true;
    startObserver();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', core.touch, { once: true });
    } else {
      core.touch();
    }
    // Pronote construit son interface après le chargement : quelques
    // passages de rattrapage ne coûtent rien.
    [800, 2000, 4500].forEach((ms) => setTimeout(core.touch, ms));
    core.emit('started');
  };

  core.start();
})();
