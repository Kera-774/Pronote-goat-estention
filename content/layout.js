/* Pronote GOAT — moteur d'agencement de la page d'accueil
 *
 * Principe : on ne déplace JAMAIS les nœuds de Pronote. Les colonnes natives
 * (.wrapper-cols) passent en « display: contents » et chaque widget devient
 * directement un élément de la grille du conteneur. Sa colonne, son ordre et
 * sa largeur sont donnés par des variables CSS (--pg-col, --pg-order,
 * --pg-span) ; sa hauteur en lignes de 4 px (--pg-rows) est mesurée par un
 * ResizeObserver, ce qui donne une disposition en « maçonnerie » sans trous.
 * Pronote peut redessiner ses widgets à volonté : rien ne casse.
 *
 * Le masquage (widgets, éléments choisis à la souris) passe par une feuille
 * de style générée : il s'applique avant même que Pronote n'affiche quoi que
 * ce soit, sans clignotement.
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || !PG.core || PG.layout) return;

  const core = PG.core;
  const U = PG.util;
  const html = document.documentElement;

  const ROW = 4; // hauteur d'une ligne de grille, en px
  // largeur minimale d'une colonne (réglable) : en dessous, elles se replient
  const minCol = () => (core.config && +core.config.layout.minCol) || 260;
  const GENERIC = new Set(['widget', 'collapsible', 'pg-widget', 'ie-ripple']);

  const layout = {};
  PG.layout = layout;

  let ro = null; // ResizeObserver des widgets
  let observed = new WeakSet();
  let roContainer = null; // ResizeObserver du conteneur
  let observedContainer = null;
  let lastEff = 0;
  let gapPx = 24;

  /* ------------------------------------------------------------------ */
  /* Repérage des widgets                                                */
  /* ------------------------------------------------------------------ */

  function baseKey(section) {
    const w = section.getAttribute('data-pg-w');
    if (w) return 'pg:' + w;
    for (const c of section.classList) {
      if (!GENERIC.has(c) && !c.startsWith('pg-')) return c;
    }
    return 'widget';
  }

  layout.titleOf = function (section, key) {
    const t = core.textOf(section.querySelector(':scope > header h2'));
    if (t) return t;
    if (key && key.startsWith('pg:')) {
      const w = PG.WIDGETS[key.slice(3)];
      return w ? w.name : key;
    }
    return PG.PRONOTE_WIDGETS[key] || key;
  };

  // Liste des widgets de la page d'accueil : [{ el, key, title, nativeCol }]
  layout.collect = function (container) {
    container = container || core.homeContainer();
    if (!container) return [];
    const wrappers = [...container.querySelectorAll('.wrapper-cols')];
    const seen = {};
    const out = [];
    for (const el of container.querySelectorAll('section.widget')) {
      if (el.closest('section.widget') !== el) continue; // widget imbriqué : ignoré
      let key = baseKey(el);
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) key += '#' + seen[key];
      const w = el.closest('.wrapper-cols');
      const nativeCol = w ? Math.max(0, wrappers.indexOf(w)) : Math.max(0, wrappers.length - 1);
      out.push({ el, key, title: layout.titleOf(el, key), nativeCol });
    }
    return out;
  };

  layout.nativeCount = function (container) {
    container = container || core.homeContainer();
    if (!container) return 3;
    return Math.max(1, container.querySelectorAll('.wrapper-cols').length);
  };

  /* ------------------------------------------------------------------ */
  /* Modèle : colonnes configurées                                       */
  /* ------------------------------------------------------------------ */

  // Renvoie { N, cols } : N colonnes configurées et, pour chacune, la liste
  // ordonnée des clés de widgets. Les widgets inconnus du modèle sont
  // rangés dans leur colonne d'origine.
  layout.model = function (cfg, items, container) {
    const L = cfg.layout;
    const native = layout.nativeCount(container);
    const N = Math.min(6, Math.max(1, +L.columns || native));
    let cols;

    if (Array.isArray(L.cols) && L.cols.length) {
      cols = L.cols.map((c) => (Array.isArray(c) ? c.filter((k) => typeof k === 'string') : []));
    } else {
      cols = [];
      for (const it of items) {
        const c = Math.min(N - 1, Math.floor((it.nativeCol * N) / native));
        (cols[c] = cols[c] || []).push(it.key);
      }
    }

    while (cols.length < N) cols.push([]);
    if (cols.length > N) {
      const extra = cols.splice(N).flat();
      cols[N - 1] = cols[N - 1].concat(extra);
    }
    for (let i = 0; i < N; i++) cols[i] = cols[i] || [];

    const placed = new Set(cols.flat());
    for (const it of items) {
      if (placed.has(it.key)) continue;
      const c = Math.min(N - 1, Math.floor((it.nativeCol * N) / native));
      cols[c].push(it.key);
      placed.add(it.key);
    }
    return { N, cols };
  };

  function effectiveCols(container, N) {
    const w = container.clientWidth || window.innerWidth;
    return Math.max(1, Math.min(N, Math.floor((w + gapPx) / (minCol() + gapPx))));
  }

  // État courant, utilisé par l'éditeur visuel
  layout.state = function () {
    const container = core.homeContainer();
    if (!container || !core.config) return null;
    const items = layout.collect(container);
    const { N, cols } = layout.model(core.config, items, container);
    const byKey = {};
    for (const it of items) byKey[it.key] = it;
    return { container, items, byKey, N, cols, eff: effectiveCols(container, N) };
  };

  /* ------------------------------------------------------------------ */
  /* Feuille de masquage                                                 */
  /* ------------------------------------------------------------------ */

  function keySelector(key) {
    if (key.startsWith('pg:')) return 'section.pg-widget[data-pg-w="' + CSS.escape(key.slice(3)) + '"]';
    const base = key.split('#')[0];
    return 'section.widget.' + CSS.escape(base) + ':not(.pg-widget)';
  }

  layout.validSelector = function (sel) {
    if (!sel || typeof sel !== 'string' || /[{}]/.test(sel) || sel.length > 400) return false;
    try {
      document.querySelector(sel);
      return CSS.supports('selector(' + sel + ')');
    } catch (e) {
      return false;
    }
  };

  // Feuille générée : masquage, apparence et hauteur de chaque bloc.
  // Le préfixe doublé assure une spécificité supérieure à goat.css.
  const BLOCK = 'html .AffichagePageAccueil.AffichagePageAccueil .widgets-global-container.widgets-global-container ';

  function lookCss(L) {
    const C = PG.color;
    const out = [];
    for (const [key, lk] of Object.entries(L.look || {})) {
      if (!lk || key.includes('#')) continue;
      const sel = BLOCK + keySelector(key);
      if (lk.bg && C.parse(lk.bg)) {
        const a = Math.min(1, Math.max(0, lk.alpha === undefined || lk.alpha === null ? 1 : +lk.alpha));
        out.push(sel + ' { background: ' + C.rgba(lk.bg, a) + ' !important; }');
      }
      if (lk.text && C.parse(lk.text)) {
        // titre et contenu seulement : les boutons « Tout voir » gardent leurs couleurs
        out.push(sel + ' > .content-container, ' + sel + ' > header h2 { --color-text: ' + lk.text + '; color: ' + lk.text + ' !important; }');
      }
      if (lk.noTitle) out.push(sel + ' > header h2 { display: none !important; }');
    }
    for (const [key, hv] of Object.entries(L.height || {})) {
      const h = Math.round(+hv);
      if (!h || key.includes('#')) continue;
      const sel = BLOCK + keySelector(key);
      out.push(
        sel + ' { height: ' + Math.max(80, Math.min(2000, h)) + 'px !important; max-height: none !important; box-sizing: border-box !important; }\n' +
          sel + ' > .content-container { overflow: auto !important; flex: 1 1 auto !important; min-height: 0 !important; }'
      );
    }
    return out;
  }

  function hideCss(cfg) {
    const L = cfg.layout;
    const out = lookCss(L);
    const keys = Object.keys(L.hidden || {}).filter((k) => L.hidden[k] && !k.includes('#'));
    if (keys.length) {
      const sels = keys.map((k) => '.AffichagePageAccueil ' + keySelector(k));
      out.push('html:not(.pg-editing) ' + sels.join(',\nhtml:not(.pg-editing) ') + ' { display: none !important; }');
      out.push(
        'html.pg-editing ' + sels.join(',\nhtml.pg-editing ') +
          ' { opacity: 0.38 !important; filter: grayscale(1); }'
      );
    }
    const zap = (L.hiddenSelectors || []).map((h) => h && h.sel).filter(layout.validSelector);
    if (zap.length) out.push(zap.join(',\n') + ' { display: none !important; }');
    return out.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Application                                                         */
  /* ------------------------------------------------------------------ */

  function setVar(el, name, value) {
    const v = String(value);
    if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v);
  }

  function setAttr(el, name, on) {
    if (el.hasAttribute(name) !== !!on) el.toggleAttribute(name, !!on);
  }

  function measure(el) {
    if (!html.classList.contains('pg-layout')) return;
    const h = el.getBoundingClientRect().height;
    const rows = Math.max(1, Math.ceil((h + gapPx) / ROW));
    if (el._pgRows !== rows) {
      el._pgRows = rows;
      el.style.setProperty('--pg-rows', String(rows));
    }
  }

  function readGap() {
    const v = parseFloat(getComputedStyle(html).getPropertyValue('--pg-gap'));
    gapPx = Number.isFinite(v) ? v : 24;
  }

  function stopObservers() {
    if (ro) ro.disconnect();
    if (roContainer) roContainer.disconnect();
    observedContainer = null;
    observed = new WeakSet();
  }

  layout.apply = function () {
    const cfg = core.config;
    if (!cfg || !core.tools) return;

    const enabled = core.enabled();
    core.style('layout-hide', enabled ? hideCss(cfg) : '');

    const container = core.homeContainer();
    const on = enabled && cfg.layout.enabled && !!container;

    if (!on) {
      if (html.classList.contains('pg-layout')) html.classList.remove('pg-layout');
      stopObservers();
      if (container) {
        const items = layout.collect(container);
        for (const it of items) {
          setAttr(it.el, 'data-pg-collapsed', enabled && cfg.layout.collapsed[it.key]);
        }
        rememberWidgets(items);
      }
      return;
    }

    readGap();
    html.classList.add('pg-layout');
    const items = layout.collect(container);
    const { N, cols } = layout.model(cfg, items, container);
    const eff = effectiveCols(container, N);
    lastEff = eff;
    setVar(container, '--pg-cols', eff);

    const byKey = {};
    for (const it of items) byKey[it.key] = it;

    if (!ro) ro = new ResizeObserver((entries) => entries.forEach((e) => measure(e.target)));
    if (observedContainer !== container) {
      stopObservers();
      observedContainer = container;
      roContainer = roContainer || new ResizeObserver(() => {
        const c = core.homeContainer();
        if (!c || !core.config) return;
        const st = layout.model(core.config, layout.collect(c), c);
        if (effectiveCols(c, st.N) !== lastEff) layout.apply();
      });
      roContainer.observe(container);
    }

    let order = 0;
    cols.forEach((list, ci) => {
      const ec = Math.floor((ci * eff) / N);
      for (const key of list) {
        const it = byKey[key];
        if (!it) continue;
        const span = Math.max(1, Math.min(eff, +cfg.layout.span[key] || 1));
        const start = Math.min(ec, eff - span);
        setVar(it.el, '--pg-col', start + 1);
        setVar(it.el, '--pg-span', span);
        setVar(it.el, '--pg-order', order++);
        setAttr(it.el, 'data-pg-collapsed', cfg.layout.collapsed[key]);
        if (!observed.has(it.el)) {
          observed.add(it.el);
          ro.observe(it.el);
        }
        measure(it.el);
      }
    });

    rememberWidgets(items);
  };

  /* ------------------------------------------------------------------ */
  /* Catalogue des widgets vus (pour le popup)                           */
  /* ------------------------------------------------------------------ */

  let seenSig = '';
  function rememberWidgets(items) {
    const seen = {};
    for (const it of items) if (!it.key.startsWith('pg:')) seen[it.key] = it.title;
    const sig = JSON.stringify(seen);
    if (sig === seenSig) return;
    seenSig = sig;
    try {
      chrome.storage.local.set({ pgSeenWidgets: seen });
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Opérations (éditeur visuel, popup)                                  */
  /* ------------------------------------------------------------------ */

  function edit(fn) {
    core.updateConfig((cfg) => {
      const st = layout.state();
      const items = st ? st.items : [];
      const m = layout.model(cfg, items, st && st.container);
      fn(cfg, m);
    });
  }

  // Déplace un widget dans la colonne « col » (modèle configuré), avant le
  // widget « beforeKey » (ou en fin de colonne).
  layout.move = function (key, col, beforeKey) {
    edit((cfg, m) => {
      const cols = m.cols.map((c) => c.filter((k) => k !== key));
      const target = cols[Math.max(0, Math.min(m.N - 1, col))];
      const i = beforeKey ? target.indexOf(beforeKey) : -1;
      if (i >= 0) target.splice(i, 0, key);
      else target.push(key);
      cfg.layout.enabled = true;
      cfg.layout.columns = m.N;
      cfg.layout.cols = cols;
    });
  };

  layout.setColumns = function (n) {
    n = Math.max(1, Math.min(6, n | 0));
    edit((cfg, m) => {
      let cols = m.cols.slice();
      if (n > cols.length) while (cols.length < n) cols.push([]);
      else if (n < cols.length) {
        const extra = cols.splice(n).flat();
        cols[n - 1] = cols[n - 1].concat(extra);
      }
      cfg.layout.enabled = true;
      cfg.layout.columns = n;
      cfg.layout.cols = cols;
    });
  };

  layout.toggleHidden = function (key) {
    edit((cfg) => {
      if (cfg.layout.hidden[key]) delete cfg.layout.hidden[key];
      else cfg.layout.hidden[key] = true;
    });
  };

  layout.toggleCollapsed = function (key) {
    edit((cfg) => {
      if (cfg.layout.collapsed[key]) delete cfg.layout.collapsed[key];
      else cfg.layout.collapsed[key] = true;
    });
  };

  layout.cycleSpan = function (key) {
    const st = layout.state();
    const max = st ? Math.max(1, st.eff) : 3;
    edit((cfg, m) => {
      const cur = +cfg.layout.span[key] || 1;
      const next = cur >= Math.min(3, max) ? 1 : cur + 1;
      if (next === 1) delete cfg.layout.span[key];
      else cfg.layout.span[key] = next;
      cfg.layout.enabled = true;
      cfg.layout.columns = m.N;
      cfg.layout.cols = m.cols;
    });
  };

  // Apparence d'un bloc : { bg, alpha, text, noTitle } (null = réinitialiser)
  layout.setLook = function (key, patch) {
    edit((cfg) => {
      if (!patch) delete cfg.layout.look[key];
      else {
        const cur = Object.assign({}, cfg.layout.look[key], patch);
        for (const k of Object.keys(cur)) if (cur[k] === '' || cur[k] === null || cur[k] === false) delete cur[k];
        if (Object.keys(cur).length) cfg.layout.look[key] = cur;
        else delete cfg.layout.look[key];
      }
    });
  };

  // Hauteur d'un bloc en px (0 = automatique)
  layout.setHeight = function (key, px) {
    edit((cfg) => {
      const h = Math.round(+px || 0);
      if (h > 0) cfg.layout.height[key] = Math.max(80, Math.min(2000, h));
      else delete cfg.layout.height[key];
    });
  };

  layout.addHiddenSelector = function (sel, label) {
    if (!layout.validSelector(sel)) return false;
    edit((cfg) => {
      if (!cfg.layout.hiddenSelectors.some((h) => h.sel === sel)) {
        cfg.layout.hiddenSelectors.push({ sel, label: String(label || '').slice(0, 80) });
      }
    });
    return true;
  };

  layout.removeHiddenSelector = function (sel) {
    edit((cfg) => {
      cfg.layout.hiddenSelectors = cfg.layout.hiddenSelectors.filter((h) => h.sel !== sel);
    });
  };

  layout.reset = function () {
    edit((cfg) => {
      // positions, largeurs, hauteurs et masquages reviennent à l'origine ;
      // l'apparence des blocs et les éléments masqués à la souris restent
      cfg.layout = Object.assign(U.clone(PG.DEFAULT_CONFIG.layout), {
        hiddenSelectors: cfg.layout.hiddenSelectors,
        look: cfg.layout.look,
        minCol: cfg.layout.minCol
      });
    });
  };

  /* ------------------------------------------------------------------ */
  /* Branchements                                                        */
  /* ------------------------------------------------------------------ */

  core.on('config', layout.apply);
  core.on('tools', layout.apply);
  core.on('home', layout.apply);
  core.onDom(layout.apply, 120);
  core.on('diagnostic', (out) => {
    const st = layout.state();
    out.modules.layout = st
      ? { N: st.N, eff: st.eff, cols: st.cols, widgets: st.items.map((i) => i.key + ' — ' + i.title) }
      : 'pas sur la page d’accueil';
  });
})();
