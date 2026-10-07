/* Pronote GOAT — popup et tableau de bord
 *
 * Une seule interface, deux mises en page : le popup (420 px) et le tableau
 * de bord (page d'options, body.full). Tout est rendu en JS depuis l'état
 * chargé du stockage ; chaque réglage est écrit dans le profil actif et
 * s'applique immédiatement aux onglets Pronote ouverts.
 *
 * Liaison des champs :
 *   data-cfg="style.fontScale"   → chemin dans la configuration du profil
 *   data-tool="downloads.delay"  → chemin dans les réglages des outils
 *   data-auto="style.radius"     → case « auto » : coche = null (selon le thème)
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  const U = PG.util;
  const esc = U.escapeHtml;
  const FULL = document.body.classList.contains('full');
  const app = document.getElementById('app');

  const S = {
    meta: null,
    index: [],
    profile: null,
    tools: null,
    seen: {},
    seenNav: [],
    infos: null,
    devoirs: 0,
    asset: '',
    tab: 'themes',
    ptab: null, // onglet Pronote joignable
    phome: false,
    usage: { local: 0, sync: 0 }
  };

  const TABS = [
    ['themes', '🎨', 'Thèmes'],
    ['style', '🖌️', 'Style'],
    ['bars', '🧭', 'Barres'],
    ['home', '🧩', 'Accueil'],
    ['tools', '🛠️', 'Outils'],
    ['profiles', '👤', 'Profils']
  ];

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

  function setPath(o, p, v) {
    const ks = p.split('.');
    let cur = o;
    for (let i = 0; i < ks.length - 1; i++) {
      if (cur[ks[i]] == null || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {};
      cur = cur[ks[i]];
    }
    cur[ks[ks.length - 1]] = v;
  }

  let flashTimer = null;
  function flash(msg, err) {
    const el = document.querySelector('.status');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('err', !!err);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (el.textContent = ''), err ? 5000 : 1600);
  }

  const cfg = () => S.profile.config;

  /* ------------------------------------------------------------------ */
  /* Données                                                             */
  /* ------------------------------------------------------------------ */

  async function loadAll() {
    const { meta, index } = await PG.store.ensure();
    S.meta = meta;
    S.index = index;
    S.profile = await PG.store.getActive();
    S.tools = await PG.store.tools();
    const loc = await chrome.storage.local.get(['pgSeenWidgets', 'pgSeenNav', 'pgInfosCache', 'pdlDevoirs']);
    S.seen = loc.pgSeenWidgets || {};
    S.seenNav = Array.isArray(loc.pgSeenNav) ? loc.pgSeenNav : [];
    S.infos = loc.pgInfosCache || null;
    S.devoirs = Array.isArray(loc.pdlDevoirs) ? loc.pdlDevoirs.length : 0;
    const aid = S.profile.config.style.background.assetId;
    S.asset = aid ? await PG.store.getAsset(aid) : '';
    S.usage.local = await PG.store.usage('local');
    S.usage.sync = await PG.store.usage('sync');
  }

  // Onglet Pronote à piloter : l'onglet actif (popup) ou le dernier onglet
  // Pronote ouvert (tableau de bord).
  async function findPronoteTab() {
    S.ptab = null;
    S.phome = false;
    let tabs = [];
    try {
      if (FULL) {
        tabs = await chrome.tabs.query({ url: ['*://*/pronote/*', '*://*.index-education.net/*'] });
        tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      } else {
        tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      }
    } catch (e) {
      return;
    }
    for (const t of tabs) {
      if (!t || !t.url || !/\/pronote\/|index-education\.net/i.test(t.url)) continue;
      try {
        const r = await chrome.tabs.sendMessage(t.id, { type: 'pg-ping' });
        if (r && r.ok) {
          S.ptab = t.id;
          S.phome = !!r.home;
          return;
        }
      } catch (e) {
        /* onglet pas encore prêt */
      }
    }
  }

  async function toTab(msg, focus) {
    if (!S.ptab) return null;
    try {
      if (focus && FULL) await chrome.tabs.update(S.ptab, { active: true });
      return await chrome.tabs.sendMessage(S.ptab, msg);
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Écritures                                                           */
  /* ------------------------------------------------------------------ */

  let pendingCfg = null;

  const flushCfg = U.debounce(async () => {
    const c = pendingCfg;
    if (!c) return;
    try {
      S.profile.config = c;
      await PG.store.save(S.profile);
      flash('Enregistré ✓');
    } catch (e) {
      flash('⚠ ' + (e && e.message ? e.message : e), true);
    } finally {
      if (pendingCfg === c) pendingCfg = null;
    }
  }, 280);

  // mut(config) ; render=false pour les curseurs et champs texte (on ne
  // reconstruit pas l'interface pendant que l'utilisateur la manipule)
  function updateCfg(mut, render) {
    const c = U.clone(pendingCfg || S.profile.config);
    mut(c);
    pendingCfg = U.normalizeConfig(c);
    S.profile.config = pendingCfg;
    flushCfg();
    if (render !== false) renderContent();
  }

  const flushTools = U.debounce(async () => {
    try {
      S.tools = await PG.store.setTools(U.clone(S.tools));
      flash('Enregistré ✓');
    } catch (e) {
      flash('⚠ ' + e.message, true);
    }
  }, 250);

  function updateTool(path, val, render) {
    setPath(S.tools, path, val);
    flushTools();
    if (render) renderContent();
  }

  /* ------------------------------------------------------------------ */
  /* Composants                                                          */
  /* ------------------------------------------------------------------ */

  function sw(label, attrs, checked, hint) {
    return (
      '<label class="sw"><input type="checkbox" ' + attrs + (checked ? ' checked' : '') + '><span class="sw-ui"></span>' +
      '<span class="lbl">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>'
    );
  }

  function row(label, control, hint) {
    return '<div class="row"><span>' + label + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</span>' + control + '</div>';
  }

  function select(attrs, options, value) {
    return (
      '<select ' + attrs + '>' +
      options.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') +
      '</select>'
    );
  }

  // Curseur avec case « auto » optionnelle (valeur null = selon le thème)
  function slider(path, label, min, max, step, fallback, fmt, auto) {
    const raw = getPath(cfg(), path);
    const isAuto = auto && (raw === null || raw === undefined);
    const v = isAuto ? fallback : raw;
    const show = fmt ? fmt(v) : v;
    return (
      '<div class="row"><span>' + label + '</span><span class="inline">' +
      (auto ? '<label class="inline hint" title="Selon le thème"><input type="checkbox" data-auto="' + path + '" data-fallback="' + fallback + '"' + (isAuto ? ' checked' : '') + '> auto</label>' : '') +
      '<input type="range" data-cfg="' + path + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '"' + (isAuto ? ' disabled' : '') + ' data-fmt="' + (fmt ? fmt.name : '') + '">' +
      '<span class="val">' + show + '</span></span></div>'
    );
  }

  // Couleur facultative : case « auto » cochée = valeur vide (selon le thème)
  function colorAuto(path, label, fallback, hint) {
    const v = getPath(cfg(), path) || '';
    const ok = /^#[0-9a-f]{6}$/i.test(v);
    return row(
      label,
      '<span class="inline"><label class="inline hint"><input type="checkbox" data-auto-color="' + path + '" data-fallback="' + esc(fallback) + '"' + (ok ? '' : ' checked') + '> auto</label>' +
        '<input type="color" data-cfg="' + path + '" value="' + esc(ok ? v : fallback) + '"' + (ok ? '' : ' disabled') + '></span>',
      hint
    );
  }

  // Curseur en px dont la valeur 0 signifie « taille d'origine »
  function numAuto(path, label, min, max, step, fallback) {
    const v = +getPath(cfg(), path) || 0;
    return (
      '<div class="row"><span>' + label + '</span><span class="inline">' +
      '<label class="inline hint"><input type="checkbox" data-auto-num="' + path + '" data-fallback="' + fallback + '"' + (v ? '' : ' checked') + '> origine</label>' +
      '<input type="range" data-cfg="' + path + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + (v || fallback) + '" data-fmt="px"' + (v ? '' : ' disabled') + '>' +
      '<span class="val">' + (v ? v + ' px' : 'auto') + '</span></span></div>'
    );
  }

  // Curseur sur une valeur quelconque de la config (sans case auto)
  function range(path, label, min, max, step, fmt) {
    const v = getPath(cfg(), path);
    return (
      '<div class="row"><span>' + label + '</span><span class="inline">' +
      '<input type="range" data-cfg="' + path + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '" data-fmt="' + (fmt ? fmt.name : '') + '">' +
      '<span class="val">' + (fmt ? fmt(v) : v) + '</span></span></div>'
    );
  }

  // le nom de la fonction (pct, px) est repris dans data-fmt
  const FMT = {
    pct: (v) => Math.round(v * 100) + ' %',
    px: (v) => v + ' px',
    raw: (v) => v
  };

  function formatFor(input) {
    const n = input.getAttribute('data-fmt');
    return FMT[n] || FMT.raw;
  }

  /* ------------------------------------------------------------------ */
  /* Onglet Thèmes                                                       */
  /* ------------------------------------------------------------------ */

  function themeCard(id) {
    const T = PG.THEMES[id];
    const p = T.preview || {};
    const on = cfg().theme.id === id;
    const vars =
      '--bg-p:' + p.bg + ';--sf:' + p.surface + ';--ac:' + p.accent + ';--tx:' + p.text + ';--r:' + Math.min(10, T.radius === undefined ? 5 : T.radius) + 'px';
    return (
      '<button type="button" class="theme-card" data-theme="' + id + '" aria-pressed="' + on + '">' +
      '<div class="tp' + (p.lines ? ' lines' : '') + '" style="' + esc(vars) + '"><div class="tp-nav"></div><div class="tp-grid">' +
      '<div class="tp-w"><i></i><b></b><b></b></div>'.repeat(3) +
      '</div></div><div class="tc-name">' + T.emoji + ' ' + esc(T.name) + '</div><div class="tc-desc">' + esc(T.desc) + '</div></button>'
    );
  }

  const EFFECTS = {
    dev: [['statusbar', 'Barre d’état bleue en bas de l’écran']],
    hacker: [
      ['scanlines', 'Lignes de balayage (vieux moniteur)'],
      ['glow', 'Lueur néon du texte'],
      ['matrix', 'Pluie « Matrix » en fond', 'Animation légère (~14 images/s), suspendue quand l’onglet est caché.']
    ]
  };

  function tabThemes() {
    const id = cfg().theme.id;
    const T = PG.THEMES[id];
    const fx = Object.assign({}, T.effects || {}, (cfg().theme.effects || {})[id] || {});
    let html =
      '<div class="card"><h3>Thème</h3><div class="themes">' + PG.THEME_ORDER.map(themeCard).join('') + '</div>' +
      '<p class="hint">Les couleurs, la police et le fond se règlent ensuite dans l’onglet <b>Style</b>.</p></div>';
    if (EFFECTS[id]) {
      html +=
        '<div class="card"><h3>Effets du thème ' + esc(T.name) + '</h3>' +
        EFFECTS[id].map(([k, l, hint]) => sw(l, 'data-fx="' + k + '"', !!fx[k], hint)).join('') +
        '</div>';
    }
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* Onglet Style                                                        */
  /* ------------------------------------------------------------------ */

  const COLORS = [
    ['accent', 'Couleur principale'],
    ['bg', 'Fond de page'],
    ['surface', 'Fond des widgets'],
    ['surface2', 'Fond secondaire'],
    ['text', 'Texte'],
    ['muted', 'Texte secondaire'],
    ['border', 'Bordures']
  ];

  function tabStyle() {
    const c = cfg();
    const T = PG.THEMES[c.theme.id];
    const base = T.tokens || PG.PRONOTE_TOKENS;
    const ov = c.theme.overrides || {};
    const st = c.style;
    const bg = st.background;

    let html = '<div class="card"><h3>Couleurs</h3><div class="colors">';
    for (const [k, l] of COLORS) {
      const v = ov[k] || base[k];
      html +=
        '<label class="color"><input type="color" data-color="' + k + '" value="' + esc(v) + '"><span>' + l + '</span>' +
        '<button type="button" class="reset" data-uncolor="' + k + '" title="Revenir à la couleur du thème"' + (ov[k] ? '' : ' hidden') + '>↺</button></label>';
    }
    html +=
      '</div><div class="btns"><button type="button" class="btn" data-act="reset-colors">↺ Couleurs du thème</button></div></div>';

    // Fond
    html += '<div class="card"><h3>Arrière-plan</h3>';
    html += row(
      'Type',
      select('data-cfg="style.background.type" data-render="1"', [
        ['theme', 'Selon le thème'],
        ['color', 'Couleur unie'],
        ['gradient', 'Dégradé'],
        ['image', 'Image']
      ], bg.type)
    );
    if (bg.type === 'color') html += row('Couleur', '<input type="color" data-cfg="style.background.color" value="' + esc(bg.color) + '">');
    if (bg.type === 'gradient') {
      html += row('Couleurs', '<span class="inline"><input type="color" data-cfg="style.background.from" value="' + esc(bg.from) + '"><input type="color" data-cfg="style.background.to" value="' + esc(bg.to) + '"></span>');
      html += slider('style.background.angle', 'Angle', 0, 360, 5, 135, null);
    }
    if (bg.type === 'image') {
      html += row('Adresse (https)', '<input type="url" data-cfg="style.background.image" placeholder="https://…" value="' + esc(bg.image) + '">');
      if (S.asset) html += '<div class="thumb" style="background-image:url(&quot;' + esc(S.asset) + '&quot;)"></div>';
      html +=
        '<div class="btns">' +
        (FULL
          ? '<label class="btn">🖼️ Importer une image…<input type="file" accept="image/*" data-act="upload" hidden></label>'
          : '<button type="button" class="btn" data-act="open-full" data-hash="style">🖼️ Importer une image (tableau de bord)</button>') +
        (bg.assetId ? '<button type="button" class="btn danger" data-act="remove-asset">Retirer l’image importée</button>' : '') +
        '</div><p class="hint">Une image importée reste dans ton navigateur (réduite à 1920 px). Si une image en ligne ne s’affiche pas, Pronote la bloque : importe-la plutôt.</p>';
    }
    if (bg.type !== 'color') html += slider('style.background.dim', 'Assombrir', 0, 0.8, 0.05, 0, FMT.pct);
    html += '</div>';

    // Typographie
    html += '<div class="card"><h3>Typographie</h3>';
    html += row('Police', select('data-cfg="style.font" data-render="1"', PG.FONTS.map((f) => [f.id, f.label]), st.font));
    if (st.font === 'custom') {
      html += row('Nom de la police', '<input type="text" data-cfg="style.customFont" placeholder="Comic Sans MS" value="' + esc(st.customFont) + '">', 'Doit être installée sur l’ordinateur.');
    }
    html += slider('style.fontScale', 'Taille du texte', 0.8, 1.3, 0.05, 1, FMT.pct);
    html += '</div>';

    // Blocs de l'accueil
    const tk = Object.assign({}, base, ov);
    html += '<div class="card"><h3>Blocs de l’accueil (widgets)</h3>';
    html += colorAuto('style.blockColor', 'Fond des blocs', tk.surface);
    html += slider('style.widgetOpacity', 'Opacité du fond', 0.15, 1, 0.05, T.widgetOpacity === undefined ? 1 : T.widgetOpacity, FMT.pct, true);
    html += colorAuto('style.blockText', 'Texte des blocs', tk.text);
    html += colorAuto('style.blockBorder', 'Bordure', tk.border);
    html += slider('style.radius', 'Arrondi', 0, 28, 1, T.radius === undefined ? 7 : T.radius, FMT.px, true);
    html += slider('style.blur', 'Flou derrière les blocs', 0, 24, 1, T.blur === undefined ? 0 : T.blur, FMT.px, true);
    html += slider('style.gap', 'Espacement', 4, 48, 2, T.gap === undefined ? 24 : T.gap, FMT.px, true);
    html += row(
      'Ombres',
      select('data-cfg="style.shadows" data-kind="tri"', [
        ['auto', 'Selon le thème'],
        ['on', 'Oui'],
        ['off', 'Non']
      ], st.shadows === null || st.shadows === undefined ? 'auto' : st.shadows ? 'on' : 'off')
    );
    html += row(
      'Largeur de l’accueil',
      select('data-cfg="style.maxWidth" data-kind="num"', [
        [0, 'Pleine largeur'],
        [1100, '1100 px'],
        [1300, '1300 px'],
        [1500, '1500 px'],
        [1800, '1800 px']
      ], st.maxWidth)
    );
    html += '<p class="hint">Chaque bloc peut aussi avoir son propre fond : onglet 🧩 Accueil › Apparence, ou 🎨 dans l’éditeur.</p>';
    html += sw('Animations', 'data-cfg="style.animations"', st.animations !== false, 'Désactive aussi celles de Pronote si décoché.');
    html += '</div>';

    // Lisibilité des autres pages
    const R = c.ui.readability;
    html += '<div class="card"><h3>Lisibilité des autres pages</h3>';
    html += '<p class="hint">Des « cases » derrière les textes (notes, cahier de textes…) pour qu’ils restent lisibles sur une image de fond.</p>';
    html += row(
      'Cases derrière le texte',
      select('data-cfg="ui.readability.mode" data-render="1"', [
        ['auto', 'Auto (dès qu’il y a un fond)'],
        ['cards', 'Toujours : une case par bloc'],
        ['panel', 'Toujours : un grand panneau'],
        ['off', 'Jamais']
      ], R.mode)
    );
    if (R.mode !== 'off') {
      html += colorAuto('ui.readability.color', 'Couleur des cases', tk.surface);
      html += range('ui.readability.opacity', 'Opacité', 0.2, 1, 0.05, FMT.pct);
      html += range('ui.readability.radius', 'Arrondi', 0, 32, 1, FMT.px);
      html += range('ui.readability.pad', 'Marge intérieure', 0, 30, 1, FMT.px);
      html += range('ui.readability.blur', 'Flou du fond', 0, 20, 1, FMT.px);
      html += sw('Ombre portée', 'data-cfg="ui.readability.shadow"', R.shadow);
    }
    html += '</div>';
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* Onglet Barres : bandeau du haut, navigation, bandeau de page        */
  /* ------------------------------------------------------------------ */

  function partSwitches(group) {
    const P = cfg().ui.parts;
    return PG.UI_PARTS.filter((p) => p.group === group)
      .map((p) => sw(esc(p.label), 'data-part="' + p.key + '"', P[p.key] !== false, p.warn ? esc(p.warn) : ''))
      .join('');
  }

  const BANNER_EXAMPLES = ['{salut} {prenom} 👋', '{prenom} · {classe}', 'Bon courage pour le bac ! 💪', '{date}'];

  function tabBars() {
    const c = cfg();
    const B = c.ui.banner;
    const N = c.ui.nav;
    let html = '';

    // ---- bandeau du haut
    html += '<div class="card"><h3>Bandeau du haut</h3>' + partSwitches('banner') + '<hr class="sep">';
    html += row('Titre', '<input type="text" data-cfg="ui.banner.title" placeholder="Nom de l’établissement" value="' + esc(B.title) + '">', 'Remplace le nom de l’établissement.');
    html += row('Sous-titre', '<input type="text" data-cfg="ui.banner.subtitle" placeholder="Espace Élèves - NOM Prénom" value="' + esc(B.subtitle) + '">', 'Remplace « Espace Élèves - NOM Prénom (classe) ».');
    html +=
      '<p class="hint">Variables : <code>{prenom}</code> <code>{nom}</code> <code>{classe}</code> <code>{etab}</code> <code>{date}</code> <code>{salut}</code> — exemples : ' +
      BANNER_EXAMPLES.map((x) => '<button type="button" class="link" data-act="banner-ex" data-v="' + esc(x) + '">' + esc(x) + '</button>').join(' · ') +
      '</p>';
    html += numAuto('ui.banner.height', 'Hauteur', 28, 120, 2, 40);
    html += range('ui.banner.textScale', 'Taille du texte', 0.6, 1.8, 0.05, FMT.pct);
    html += row('Alignement', select('data-cfg="ui.banner.align"', [['center', 'Centré'], ['left', 'À gauche'], ['right', 'À droite']], B.align));
    html += colorAuto('ui.banner.bg', 'Fond', '#ffffff');
    html += colorAuto('ui.banner.fg', 'Texte', '#1d1d1d');
    html += sw('Mode discret', 'data-cfg="ui.banner.privacy"', B.privacy, 'Floute le nom et la photo (partage d’écran, captures). Survol = net.');
    html += '</div>';

    // ---- barre de navigation
    html += '<div class="card"><h3>Barre de navigation</h3>' + partSwitches('nav') + '<hr class="sep">';
    if (!S.seenNav.length) {
      html += '<p class="hint">Ouvre Pronote une fois pour lister ses onglets ici (affichage, ordre, sous-menus).</p>';
    } else {
      const order = N.order && N.order.length ? N.order : [];
      const list = S.seenNav.slice().sort((a, b) => {
        const ia = order.indexOf(a.key);
        const ib = order.indexOf(b.key);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
      html += '<p class="hint">Coche les onglets à afficher, réordonne-les avec ↑ ↓, déplie pour choisir leurs sous-entrées.</p><ul class="list">';
      list.forEach((n, i) => {
        html +=
          '<li style="flex-wrap:wrap"><label class="sw" style="flex:1"><input type="checkbox" data-navhide="' + esc(n.key) + '"' + (N.hidden[n.key] ? '' : ' checked') + '><span class="sw-ui"></span><span class="lbl">' + esc(n.label) + '</span></label>' +
          '<button type="button" class="btn icon" data-act="nav-move" data-k="' + esc(n.key) + '" data-dir="-1" title="Monter"' + (i ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" class="btn icon" data-act="nav-move" data-k="' + esc(n.key) + '" data-dir="1" title="Descendre"' + (i < list.length - 1 ? '' : ' disabled') + '>↓</button>' +
          (n.subs.length
            ? '<details data-open="nav-' + esc(n.key) + '" style="flex-basis:100%"' + (openDetails.has('nav-' + n.key) ? ' open' : '') + '><summary class="hint">' + n.subs.length + ' sous-entrée(s)</summary>' +
              n.subs.map((sb) => '<label class="inline hint" style="display:flex;margin:3px 0 3px 12px"><input type="checkbox" data-navhide="' + esc(sb.key) + '"' + (N.hidden[sb.key] ? '' : ' checked') + '> ' + esc(sb.label) + '</label>').join('') +
              '</details>'
            : '') +
          '</li>';
      });
      html += '</ul><div class="btns"><button type="button" class="btn" data-act="nav-reset">↺ Onglets d’origine</button></div>';
    }
    html += '<hr class="sep"><b>Raccourcis dans la barre</b><p class="hint">Des boutons directs vers tes pages préférées, à côté des onglets.</p><div class="links-ed">';
    (N.shortcuts || []).forEach((l, i) => {
      html +=
        '<div class="lr"><input type="text" data-sc="' + i + '.emoji" value="' + esc(l.emoji || '') + '" maxlength="4" aria-label="Emoji">' +
        '<input type="text" data-sc="' + i + '.label" value="' + esc(l.label || '') + '" placeholder="Libellé" aria-label="Libellé">' +
        '<button type="button" class="btn icon" data-act="sc-del" data-i="' + i + '" title="Supprimer">✕</button>' +
        '<input type="text" class="tg" data-sc="' + i + '.target" value="' + esc(l.target || '') + '" placeholder="menu:Mes notes ou https://…" aria-label="Cible"></div>';
    });
    const pages = [];
    for (const n of S.seenNav) for (const sb of n.subs) if (sb.page) pages.push(sb.label);
    html +=
      '</div><div class="btns"><select data-sc-add aria-label="Page à ajouter"><option value="">＋ Ajouter une page de Pronote…</option>' +
      [...new Set(pages)].map((pg) => '<option value="' + esc(pg) + '">' + esc(pg) + '</option>').join('') +
      '</select><button type="button" class="btn" data-act="sc-add-url">＋ Lien externe</button></div>';
    html += '<hr class="sep">';
    html += colorAuto('ui.nav.bg', 'Fond de la barre', '#4b4b4b');
    html += colorAuto('ui.nav.fg', 'Texte de la barre', '#f6f6f6');
    html += numAuto('ui.nav.height', 'Hauteur', 30, 80, 1, 38);
    html += '</div>';

    // ---- bandeau « Page d'accueil »
    html += '<div class="card"><h3>Bandeau « Page d’accueil »</h3><p class="hint">La barre grise sous le menu : titre de la page, précédente connexion, boutons PDF.</p>' + partSwitches('second');
    html += colorAuto('ui.second.bg', 'Fond', '#d9dbdc');
    html += colorAuto('ui.second.fg', 'Texte', '#004037');
    html += '</div>';

    // ---- autres éléments
    html += '<div class="card"><h3>Autres éléments</h3>' + partSwitches('page');
    html += sw('Bouton ✏️ flottant sur l’accueil', 'data-cfg="ui.fab"', c.ui.fab !== false, 'L’éditeur reste accessible avec Alt+Maj+E ou depuis ce popup.');
    html += '</div>';
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* Onglet Accueil                                                      */
  /* ------------------------------------------------------------------ */

  function widgetForm(id) {
    const def = PG.WIDGETS[id];
    const w = cfg().widgets[id];
    return def.schema
      .map((f) => {
        if (f.showIf && !Object.entries(f.showIf).every(([k, v]) => w[k] === v)) return '';
        const path = 'widgets.' + id + '.' + f.key;
        if (f.type === 'checkbox') return sw(esc(f.label), 'data-cfg="' + path + '"', !!w[f.key]);
        if (f.type === 'select') return row(esc(f.label), select('data-cfg="' + path + '" data-render="1"', f.options, w[f.key]));
        if (f.type === 'number') {
          return row(esc(f.label), '<input type="number" data-cfg="' + path + '" data-kind="num" min="' + f.min + '" max="' + f.max + '" value="' + esc(w[f.key]) + '">');
        }
        if (f.type === 'links') {
          const items = Array.isArray(w.items) ? w.items : [];
          return (
            '<div class="links-ed"><p class="hint">Cible : <b>menu:Mes notes</b> pour une page de Pronote, ou une adresse <b>https://…</b></p>' +
            items
              .map(
                (l, i) =>
                  '<div class="lr"><input type="text" data-link="' + i + '.emoji" value="' + esc(l.emoji || '') + '" maxlength="4" aria-label="Emoji">' +
                  '<input type="text" data-link="' + i + '.label" value="' + esc(l.label || '') + '" placeholder="Libellé" aria-label="Libellé">' +
                  '<button type="button" class="btn icon" data-act="link-del" data-i="' + i + '" title="Supprimer">✕</button>' +
                  '<input type="text" class="tg" data-link="' + i + '.target" value="' + esc(l.target || '') + '" placeholder="menu:Emploi du temps" aria-label="Cible"></div>'
              )
              .join('') +
            '<button type="button" class="btn" data-act="link-add">＋ Ajouter un lien</button></div>'
          );
        }
        const type = f.type === 'date' ? 'date' : f.type === 'color' ? 'color' : 'text';
        return row(esc(f.label), '<input type="' + type + '" data-cfg="' + path + '" value="' + esc(w[f.key] || '') + '">');
      })
      .join('');
  }

  // Apparence d'un bloc : fond, opacité, texte, titre, hauteur
  function lookForm(key) {
    const L = cfg().layout;
    const lk = L.look[key] || {};
    const h = +L.height[key] || 0;
    const a = lk.alpha === undefined ? 1 : +lk.alpha;
    const k = esc(key);
    return (
      '<div class="wform">' +
      row('Fond du bloc', '<span class="inline"><label class="inline hint"><input type="checkbox" data-look-auto="' + k + '.bg"' + (lk.bg ? '' : ' checked') + '> auto</label><input type="color" data-look="' + k + '.bg" value="' + esc(lk.bg || '#ffffff') + '"' + (lk.bg ? '' : ' disabled') + '></span>') +
      '<div class="row"><span>Opacité du fond</span><span class="inline"><input type="range" data-look="' + k + '.alpha" min="0" max="1" step="0.05" value="' + a + '"' + (lk.bg ? '' : ' disabled') + '><span class="val">' + Math.round(a * 100) + ' %</span></span></div>' +
      row('Texte', '<span class="inline"><label class="inline hint"><input type="checkbox" data-look-auto="' + k + '.text"' + (lk.text ? '' : ' checked') + '> auto</label><input type="color" data-look="' + k + '.text" value="' + esc(lk.text || '#111111') + '"' + (lk.text ? '' : ' disabled') + '></span>') +
      sw('Masquer le titre', 'data-look="' + k + '.noTitle"', !!lk.noTitle) +
      '<div class="row"><span>Hauteur</span><span class="inline"><label class="inline hint"><input type="checkbox" data-height-auto="' + k + '"' + (h ? '' : ' checked') + '> auto</label>' +
      '<input type="range" data-height="' + k + '" min="80" max="1200" step="10" value="' + (h || 320) + '"' + (h ? '' : ' disabled') + '><span class="val">' + (h ? h + ' px' : 'auto') + '</span></span></div>' +
      '</div>'
    );
  }

  function tabHome() {
    const c = cfg();
    const L = c.layout;
    let html = '';

    html += '<div class="card"><h3>Éditeur visuel</h3>';
    if (S.ptab) {
      html += '<button type="button" class="btn primary big" data-act="editor">✏️ Ouvrir l’éditeur sur Pronote</button>';
      html += '<p class="hint">Glisse-dépose les widgets, masque ce que tu veux, règle la largeur de chaque bloc. Raccourci : <kbd>Alt</kbd>+<kbd>Maj</kbd>+<kbd>E</kbd>. Tout est enregistré automatiquement.</p>';
      if (!S.phome) html += '<p class="hint">💡 Les widgets se déplacent depuis la <b>page d’accueil</b> de Pronote.</p>';
    } else {
      html += '<div class="notice">Ouvre Pronote dans cet onglet pour utiliser l’éditeur visuel (glisser-déposer, masquage d’éléments).</div>';
    }
    html += sw('Bouton ✏️ flottant sur l’accueil', 'data-cfg="ui.fab"', c.ui.fab !== false);
    html += '</div>';

    html += '<div class="card"><h3>Agencement</h3>';
    html += sw('Agencement personnalisé', 'data-cfg="layout.enabled"', L.enabled, 'Grille libre en colonnes. Désactivé : disposition d’origine de Pronote.');
    html += row('Colonnes', select('data-cfg="layout.columns" data-kind="num"', [[0, 'Comme Pronote'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], L.columns));
    html += range('layout.minCol', 'Largeur mini d’une colonne', 180, 600, 10, FMT.px);
    html += '<p class="hint">Fenêtre trop étroite pour toutes les colonnes ? Elles se replient automatiquement, l’ordre est gardé.</p>';
    html += '<div class="btns"><button type="button" class="btn" data-act="reset-layout">↺ Réinitialiser l’agencement</button></div></div>';

    html += '<div class="card"><h3>Widgets GOAT</h3>';
    for (const id of PG.WIDGET_ORDER) {
      const def = PG.WIDGETS[id];
      const w = c.widgets[id];
      html +=
        '<div class="wcard"><div class="head"><span class="ico">' + def.icon + '</span><span class="grow"><b>' + esc(def.name) + '</b><small>' + esc(def.desc) + '</small></span>' +
        '<label class="sw"><input type="checkbox" data-cfg="widgets.' + id + '.enabled"' + (w.enabled ? ' checked' : '') + ' aria-label="Afficher ' + esc(def.name) + '"><span class="sw-ui"></span></label></div>' +
        '<details data-open="' + id + '"' + (openDetails.has(id) ? ' open' : '') + '><summary>Réglages & apparence</summary><div class="wform">' + widgetForm(id) + '<hr class="sep">' + lookForm('pg:' + id) + '</div></details>' +
        '</div>';
    }
    html += '</div>';

    const seen = Object.entries(S.seen || {});
    html += '<div class="card"><h3>Widgets de Pronote</h3>';
    if (!seen.length) {
      html += '<p class="hint">Ouvre une fois la page d’accueil de Pronote pour lister ses widgets ici.</p>';
    } else {
      html += '<ul class="list wl">';
      for (const [key, title] of seen) {
        const hidden = !!L.hidden[key];
        html +=
          '<li><span class="grow" title="' + esc(key) + '">' + esc(title || PG.PRONOTE_WIDGETS[key] || key) + '</span>' +
          '<label class="inline hint"><input type="checkbox" data-collapse="' + esc(key) + '"' + (L.collapsed[key] ? ' checked' : '') + '> replié</label>' +
          '<label class="sw" title="Visible"><input type="checkbox" data-visible="' + esc(key) + '"' + (hidden ? '' : ' checked') + ' aria-label="Afficher ' + esc(title) + '"><span class="sw-ui"></span></label>' +
          '<details data-open="look-' + esc(key) + '" style="flex-basis:100%"' + (openDetails.has('look-' + key) ? ' open' : '') + '><summary class="hint">Apparence</summary>' + lookForm(key) + '</details></li>';
      }
      html += '</ul>';
    }
    html += '</div>';

    const zaps = L.hiddenSelectors || [];
    html += '<div class="card"><h3>Éléments masqués (' + zaps.length + ')</h3>';
    if (!zaps.length) {
      html += '<p class="hint">Avec l’éditeur, « 🎯 Masquer un élément » cache n’importe quel bloc de Pronote (bandeau, bouton, texte…).</p>';
    } else {
      html +=
        '<ul class="list">' +
        zaps
          .map((z, i) => '<li><span class="grow" title="' + esc(z.sel) + '">' + esc(z.label || z.sel) + '</span><button type="button" class="btn icon" data-act="unzap" data-i="' + i + '" title="Réafficher">↩</button></li>')
          .join('') +
        '</ul><div class="btns"><button type="button" class="btn" data-act="unzap-all">Tout réafficher</button></div>';
    }
    html += '</div>';
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* Onglet Outils                                                       */
  /* ------------------------------------------------------------------ */

  function tabTools() {
    const t = S.tools;
    const d = t.downloads;
    const items = (S.infos && S.infos.items) || [];
    const nInfos = items.filter((i) => i.kind === 'info').length;
    const nSond = items.filter((i) => i.kind === 'sondage').length;
    const when = S.infos && (S.infos.syncedAt || S.infos.updatedAt);

    let html = '<div class="card"><h3>Général</h3>';
    html += sw('Personnalisation active', 'data-tool="goat.enabled"', t.goat.enabled, 'Thèmes, agencement et widgets. Décoché : Pronote d’origine.');
    html += '</div>';

    html += '<div class="card"><h3>📥 Téléchargement groupé & export JSON</h3>';
    html += sw('Activer', 'data-tool="downloads.enabled"', d.enabled, 'Boutons à droite de « Contenus » et « Ressources pédagogiques ».');
    html += row('Export JSON', select('data-tool="downloads.jsonScope"', [['both', 'Contenus + ressources'], ['contenus', 'Contenus seuls']], d.jsonScope));
    html += row('Période — du', '<input type="date" data-tool="downloads.from" value="' + esc(d.from) + '">');
    html += row('au', '<input type="date" data-tool="downloads.to" value="' + esc(d.to) + '">');
    html += '<button type="button" class="link" data-act="clear-dates">Vider la période (tout prendre)</button><hr class="sep">';
    html += row('Dossier de destination', '<input type="text" data-tool="downloads.folder" placeholder="Pronote" value="' + esc(d.folder) + '">');
    html += sw('Ranger par matière et dater les fichiers', 'data-tool="downloads.useSubfolders"', d.useSubfolders);
    html += sw('Sans URL directe : ouvrir le document par un clic', 'data-tool="downloads.clickFallback"', d.clickFallback);
    html += sw('Demander où enregistrer chaque fichier', 'data-tool="downloads.askEachFile"', d.askEachFile);
    html += row('Pause entre deux fichiers', '<span class="inline"><input type="number" data-tool="downloads.delay" data-kind="num" min="150" max="5000" step="50" value="' + esc(d.delay) + '"><span class="hint">ms</span></span>');
    html += '</div>';

    html += '<div class="card"><h3>📝 Devoirs personnels</h3>';
    html += sw('Activer', 'data-tool="devoirs.enabled"', t.devoirs.enabled, 'Bouton « ＋ Devoir » dans le travail à faire.');
    html += row('Devoirs enregistrés', '<b>' + S.devoirs + '</b>');
    if (S.devoirs) html += '<button type="button" class="link" data-act="clear-devoirs">Tout effacer</button>';
    html += '</div>';

    html += '<div class="card"><h3>📢 Informations & sondages</h3>';
    html += row('En mémoire', '<span>' + nInfos + ' info(s) · ' + nSond + ' sondage(s)</span>');
    html += row('Dernier relevé', '<span class="hint">' + (when ? new Date(when).toLocaleString('fr-FR') : 'jamais') + '</span>');
    html += sw('Revenir à l’accueil après une synchronisation', 'data-tool="infos.autoReturn"', t.infos.autoReturn !== false);
    html +=
      '<div class="btns"><button type="button" class="btn" data-act="sync-infos"' + (S.ptab ? '' : ' disabled title="Ouvre Pronote d’abord"') + '>↻ Synchroniser maintenant</button>' +
      '<button type="button" class="btn danger" data-act="clear-infos">Vider</button></div>';
    html += '</div>';

    html += '<div class="card"><h3>🩺 Diagnostic</h3><p class="hint">Si Pronote change sa structure et qu’un module ne trouve plus rien, copie ce rapport (aucune donnée personnelle n’est envoyée nulle part).</p>';
    html += '<button type="button" class="btn" data-act="diag"' + (S.ptab ? '' : ' disabled') + '>📋 Copier le diagnostic</button></div>';
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* Onglet Profils                                                      */
  /* ------------------------------------------------------------------ */

  function tabProfiles() {
    let html = '<div class="card"><h3>Mes profils</h3><ul class="list">';
    for (const p of S.index) {
      const on = p.id === S.profile.id;
      html +=
        '<li><input type="radio" class="radio" name="active" data-activate="' + esc(p.id) + '"' + (on ? ' checked' : '') + ' aria-label="Activer ' + esc(p.name) + '">' +
        '<input type="text" class="prof-name" data-rename="' + esc(p.id) + '" value="' + esc(p.name) + '" maxlength="40" aria-label="Nom du profil">' +
        '<button type="button" class="btn icon" data-act="dup" data-id="' + esc(p.id) + '" title="Dupliquer">⧉</button>' +
        '<button type="button" class="btn icon" data-act="export-one" data-id="' + esc(p.id) + '" title="Exporter">⬇</button>' +
        '<button type="button" class="btn icon danger" data-act="del" data-id="' + esc(p.id) + '" title="Supprimer"' + (S.index.length < 2 ? ' disabled' : '') + '>🗑</button></li>';
    }
    html += '</ul><div class="btns">' +
      '<button type="button" class="btn" data-act="new">＋ Nouveau profil</button>' +
      '<button type="button" class="btn" data-act="new-copy">＋ Copie du profil actif</button>' +
      '<button type="button" class="btn danger" data-act="reset-profile">↺ Réinitialiser le profil actif</button></div>' +
      '<p class="hint">Change de profil à tout moment avec le menu déroulant en haut du popup. Ex. : « Cours » (sobre) et « Week-end » (Hacker).</p></div>';

    html += '<div class="card"><h3>Sauvegarde</h3><div class="btns">' +
      '<button type="button" class="btn" data-act="export-all">⬇ Exporter tous les profils</button>' +
      (FULL
        ? '<label class="btn">⬆ Importer…<input type="file" accept=".json,application/json" data-act="import" hidden></label>'
        : '<button type="button" class="btn" data-act="open-full" data-hash="profiles">⬆ Importer (tableau de bord)</button>') +
      '</div><p class="hint">Fichier JSON : à garder en lieu sûr ou à partager avec tes amis.</p></div>';

    const area = S.meta.area;
    html += '<div class="card"><h3>Stockage des profils</h3>' +
      '<label class="sw"><input type="radio" class="radio" name="area" data-area="local"' + (area === 'local' ? ' checked' : '') + '><span class="lbl">Sur cet ordinateur <small>chrome.storage.local — aucune limite pratique.</small></span></label>' +
      '<label class="sw"><input type="radio" class="radio" name="area" data-area="sync"' + (area === 'sync' ? ' checked' : '') + '><span class="lbl">Synchronisé avec ton compte Chrome <small>chrome.storage.sync — retrouvé sur tes autres ordinateurs ; 8 Ko max par profil, images importées non incluses.</small></span></label>' +
      '<p class="hint">Utilisé : ' + Math.round(S.usage.local / 1024) + ' Ko en local · ' + Math.round(S.usage.sync / 1024) + ' / 100 Ko synchronisés.</p></div>';
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  const openDetails = new Set();

  function profileOptions() {
    return S.index.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === S.profile.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  }

  function renderShell() {
    const v = chrome.runtime.getManifest().version;
    app.innerHTML =
      '<header class="top"><img src="logo.png" alt=""><div class="brand"><b>Pronote GOAT</b><span>v' + esc(v) + ' · thèmes, widgets & outils</span></div>' +
      '<span class="status" role="status" aria-live="polite"></span>' +
      '<label class="sw" title="Personnalisation active"><input type="checkbox" data-tool="goat.enabled" data-render="1"' + (S.tools.goat.enabled ? ' checked' : '') + ' aria-label="Personnalisation active"><span class="sw-ui"></span></label></header>' +
      '<div class="profile-bar"><span>👤</span><select data-profile-switch aria-label="Profil actif">' + profileOptions() + '</select>' +
      '<button type="button" class="btn icon" data-act="new-copy" title="Nouveau profil (copie)">＋</button></div>' +
      '<nav class="tabs" role="tablist">' +
      TABS.map(([id, ico, l]) => '<button type="button" class="tab" role="tab" data-tab="' + id + '" aria-selected="' + (S.tab === id) + '">' + ico + ' ' + l + '</button>').join('') +
      '</nav><main class="content" role="tabpanel"></main>' +
      '<footer class="foot"><button type="button" class="btn" data-act="open-full">🖥️ Tableau de bord</button>' +
      (S.ptab ? '<button type="button" class="btn primary" data-act="editor">✏️ Éditer la page</button>' : '') +
      '</footer>';
    renderContent();
  }

  function renderContent() {
    const main = app.querySelector('.content');
    if (!main) return;
    const scroller = FULL ? document.scrollingElement : main;
    const y = scroller.scrollTop;
    const fn = { themes: tabThemes, style: tabStyle, bars: tabBars, home: tabHome, tools: tabTools, profiles: tabProfiles }[S.tab] || tabThemes;
    if (!S.tools.goat.enabled && ['themes', 'style', 'bars', 'home'].includes(S.tab)) {
      main.innerHTML =
        '<div class="notice warn">La personnalisation est désactivée : Pronote s’affiche d’origine. Réactive-la avec l’interrupteur en haut à droite.</div>' + fn();
    } else {
      main.innerHTML = fn();
    }
    scroller.scrollTop = y;
    for (const t of app.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.getAttribute('data-tab') === S.tab));
    const sel = app.querySelector('[data-profile-switch]');
    if (sel) sel.innerHTML = profileOptions();
  }

  /* ------------------------------------------------------------------ */
  /* Événements                                                          */
  /* ------------------------------------------------------------------ */

  function valueOf(input) {
    const kind = input.getAttribute('data-kind');
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'range') return parseFloat(input.value);
    if (kind === 'num' || input.type === 'number') return Number(input.value) || 0;
    if (kind === 'tri') return input.value === 'auto' ? null : input.value === 'on';
    return input.value;
  }

  // Apparence d'un bloc : écrit un champ et nettoie les valeurs vides
  function setLookField(c, key, field, val) {
    const lk = Object.assign({}, c.layout.look[key]);
    if (val === '' || val === null || val === false || val === undefined) delete lk[field];
    else lk[field] = val;
    if (!lk.bg) delete lk.alpha;
    if (Object.keys(lk).length) c.layout.look[key] = lk;
    else delete c.layout.look[key];
  }

  function splitKey(attr) {
    const i = attr.lastIndexOf('.');
    return [attr.slice(0, i), attr.slice(i + 1)];
  }

  app.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-look]') && t.type !== 'checkbox') {
      const [key, field] = splitKey(t.getAttribute('data-look'));
      const v = t.type === 'range' ? +t.value : t.value;
      if (t.type === 'range') t.parentElement.querySelector('.val').textContent = Math.round(v * 100) + ' %';
      updateCfg((c) => setLookField(c, key, field, v), false);
      return;
    }
    if (t.matches('[data-height]')) {
      const key = t.getAttribute('data-height');
      t.parentElement.querySelector('.val').textContent = t.value + ' px';
      updateCfg((c) => (c.layout.height[key] = +t.value), false);
      return;
    }
    if (t.matches('input[type="range"][data-cfg]')) {
      const v = valueOf(t);
      const out = t.parentElement.querySelector('.val');
      if (out) out.textContent = formatFor(t)(v);
      updateCfg((c) => setPath(c, t.getAttribute('data-cfg'), v), false);
    } else if (t.matches('input[data-color]')) {
      const k = t.getAttribute('data-color');
      updateCfg((c) => (c.theme.overrides[k] = t.value), false);
      const r = t.parentElement.querySelector('.reset');
      if (r) r.hidden = false;
    } else if (t.matches('input[type="color"][data-cfg]')) {
      updateCfg((c) => setPath(c, t.getAttribute('data-cfg'), t.value), false);
    }
  });

  app.addEventListener('change', async (e) => {
    const t = e.target;

    if (t.matches('[data-profile-switch]')) {
      await PG.store.setActive(t.value);
      await reload();
      flash('Profil activé ✓');
      return;
    }
    if (t.matches('[data-activate]')) {
      await PG.store.setActive(t.getAttribute('data-activate'));
      await reload();
      flash('Profil activé ✓');
      return;
    }
    if (t.matches('[data-rename]')) {
      await PG.store.rename(t.getAttribute('data-rename'), t.value);
      await reload();
      flash('Renommé ✓');
      return;
    }
    if (t.matches('[data-area]')) {
      try {
        await PG.store.setArea(t.getAttribute('data-area'));
        flash('Profils déplacés ✓');
      } catch (err) {
        flash('⚠ ' + err.message, true);
      }
      await reload();
      return;
    }
    if (t.matches('[data-act="upload"]')) return upload(t.files && t.files[0]);
    if (t.matches('[data-act="import"]')) return importFile(t.files && t.files[0]);

    if (t.matches('[data-look-auto]')) {
      const [key, field] = splitKey(t.getAttribute('data-look-auto'));
      const input = t.closest('.row').querySelector('input[type="color"]');
      updateCfg((c) => {
        setLookField(c, key, field, t.checked ? '' : input.value);
        if (field === 'bg' && !t.checked) c.layout.look[key].alpha = 1;
      });
      return;
    }
    if (t.matches('[data-look]') && t.type === 'checkbox') {
      const [key, field] = splitKey(t.getAttribute('data-look'));
      updateCfg((c) => setLookField(c, key, field, t.checked), false);
      return;
    }
    if (t.matches('[data-height-auto]')) {
      const key = t.getAttribute('data-height-auto');
      const input = t.closest('.row').querySelector('[data-height]');
      updateCfg((c) => {
        if (t.checked) delete c.layout.height[key];
        else c.layout.height[key] = +input.value;
      });
      return;
    }
    if (t.matches('[data-auto-color]')) {
      const path = t.getAttribute('data-auto-color');
      const input = t.closest('.row').querySelector('input[type="color"]');
      updateCfg((c) => setPath(c, path, t.checked ? '' : input.value || t.getAttribute('data-fallback')));
      return;
    }
    if (t.matches('[data-auto-num]')) {
      const path = t.getAttribute('data-auto-num');
      updateCfg((c) => setPath(c, path, t.checked ? 0 : +t.getAttribute('data-fallback')));
      return;
    }
    if (t.matches('[data-part]')) {
      const k = t.getAttribute('data-part');
      updateCfg((c) => {
        if (t.checked) delete c.ui.parts[k];
        else c.ui.parts[k] = false;
      }, false);
      return;
    }
    if (t.matches('[data-navhide]')) {
      const k = t.getAttribute('data-navhide');
      updateCfg((c) => {
        if (t.checked) delete c.ui.nav.hidden[k];
        else c.ui.nav.hidden[k] = true;
      }, false);
      return;
    }
    if (t.matches('[data-sc]')) {
      const [i, k] = t.getAttribute('data-sc').split('.');
      updateCfg((c) => {
        const it = c.ui.nav.shortcuts[+i];
        if (it) it[k] = t.value.trim();
      }, false);
      return;
    }
    if (t.matches('[data-sc-add]')) {
      if (!t.value) return;
      const label = t.value;
      updateCfg((c) => c.ui.nav.shortcuts.push({ emoji: '⭐', label, target: 'menu:' + label }));
      return;
    }
    if (t.matches('[data-auto]')) {
      const path = t.getAttribute('data-auto');
      const fb = parseFloat(t.getAttribute('data-fallback'));
      updateCfg((c) => setPath(c, path, t.checked ? null : fb));
      return;
    }
    if (t.matches('[data-fx]')) {
      const id = cfg().theme.id;
      const k = t.getAttribute('data-fx');
      updateCfg((c) => {
        c.theme.effects = c.theme.effects || {};
        c.theme.effects[id] = Object.assign({}, c.theme.effects[id], { [k]: t.checked });
      }, false);
      return;
    }
    if (t.matches('[data-visible]')) {
      const k = t.getAttribute('data-visible');
      updateCfg((c) => {
        if (t.checked) delete c.layout.hidden[k];
        else c.layout.hidden[k] = true;
      }, false);
      return;
    }
    if (t.matches('[data-collapse]')) {
      const k = t.getAttribute('data-collapse');
      updateCfg((c) => {
        if (t.checked) c.layout.collapsed[k] = true;
        else delete c.layout.collapsed[k];
      }, false);
      return;
    }
    if (t.matches('[data-link]')) {
      const [i, k] = t.getAttribute('data-link').split('.');
      updateCfg((c) => {
        const it = c.widgets.links.items[+i];
        if (it) it[k] = t.value.trim();
      }, false);
      return;
    }
    if (t.matches('[data-cfg]') && t.type !== 'range') {
      const path = t.getAttribute('data-cfg');
      let v = valueOf(t);
      if (path === 'style.background.image' && v && !/^https:\/\//i.test(v)) {
        flash('⚠ Adresse https:// requise', true);
        return;
      }
      if (/\.max$/.test(path)) v = Math.max(1, Math.min(30, v | 0));
      updateCfg((c) => setPath(c, path, v), t.hasAttribute('data-render') || t.tagName === 'SELECT');
      return;
    }
    if (t.matches('[data-tool]')) {
      const path = t.getAttribute('data-tool');
      let v = valueOf(t);
      if (path === 'downloads.delay') v = Math.min(5000, Math.max(150, v | 0));
      if (path === 'downloads.folder') v = String(v || '').replace(/[\\/:*?"<>|]/g, '').trim();
      updateTool(path, v, t.hasAttribute('data-render'));
    }
  });

  app.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches && d.matches('details[data-open]')) {
      const id = d.getAttribute('data-open');
      if (d.open) openDetails.add(id);
      else openDetails.delete(id);
    }
  }, true);

  app.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      S.tab = tab.getAttribute('data-tab');
      try {
        localStorage.setItem('pgTab', S.tab);
      } catch (err) {
        /* ignore */
      }
      if (FULL) history.replaceState(null, '', '#' + S.tab);
      renderContent();
      return;
    }

    const card = e.target.closest('[data-theme]');
    if (card) {
      updateCfg((c) => (c.theme.id = card.getAttribute('data-theme')));
      return;
    }

    const un = e.target.closest('[data-uncolor]');
    if (un) {
      updateCfg((c) => delete c.theme.overrides[un.getAttribute('data-uncolor')]);
      return;
    }

    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT') return;
    const act = b.getAttribute('data-act');
    const id = b.getAttribute('data-id');

    switch (act) {
      case 'editor': {
        const r = await toTab({ type: 'pg-editor', action: 'start' }, true);
        if (!r) flash('⚠ Onglet Pronote injoignable — recharge-le', true);
        else if (!FULL) window.close();
        break;
      }
      case 'open-full': {
        const hash = b.getAttribute('data-hash');
        chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html' + (hash ? '#' + hash : '')) });
        if (!FULL) window.close();
        break;
      }
      case 'reset-colors':
        updateCfg((c) => (c.theme.overrides = {}));
        break;
      case 'remove-asset': {
        const aid = cfg().style.background.assetId;
        updateCfg((c) => (c.style.background.assetId = ''));
        await PG.store.removeAsset(aid);
        S.asset = '';
        renderContent();
        break;
      }
      case 'reset-layout':
        if (confirm('Revenir à la disposition d’origine des widgets ?')) {
          updateCfg((c) => {
            const keep = c.layout.hiddenSelectors;
            c.layout = U.clone(PG.DEFAULT_CONFIG.layout);
            c.layout.hiddenSelectors = keep;
          });
        }
        break;
      case 'unzap':
        updateCfg((c) => c.layout.hiddenSelectors.splice(+b.getAttribute('data-i'), 1));
        break;
      case 'unzap-all':
        updateCfg((c) => (c.layout.hiddenSelectors = []));
        break;
      case 'banner-ex': {
        const v = b.getAttribute('data-v');
        updateCfg((c) => (c.ui.banner.subtitle = v));
        break;
      }
      case 'nav-move': {
        const k = b.getAttribute('data-k');
        const dir = +b.getAttribute('data-dir');
        updateCfg((c) => {
          const keys = S.seenNav.map((n) => n.key);
          const order = (c.ui.nav.order || []).filter((x) => keys.includes(x));
          for (const x of keys) if (!order.includes(x)) order.push(x);
          const i = order.indexOf(k);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= order.length) return;
          [order[i], order[j]] = [order[j], order[i]];
          c.ui.nav.order = order;
        });
        break;
      }
      case 'nav-reset':
        updateCfg((c) => {
          c.ui.nav.order = [];
          c.ui.nav.hidden = {};
        });
        break;
      case 'sc-del':
        updateCfg((c) => c.ui.nav.shortcuts.splice(+b.getAttribute('data-i'), 1));
        break;
      case 'sc-add-url':
        updateCfg((c) => c.ui.nav.shortcuts.push({ emoji: '🔗', label: 'Lien', target: 'https://' }));
        break;
      case 'link-add':
        updateCfg((c) => c.widgets.links.items.push({ emoji: '🔗', label: 'Nouveau lien', target: 'https://' }));
        break;
      case 'link-del':
        updateCfg((c) => c.widgets.links.items.splice(+b.getAttribute('data-i'), 1));
        break;
      case 'clear-dates':
        S.tools.downloads.to = '';
        updateTool('downloads.from', '', true);
        break;
      case 'clear-devoirs':
        if (confirm('Supprimer les ' + S.devoirs + ' devoir(s) personnel(s) ? Cette action est définitive.')) {
          await chrome.storage.local.set({ pdlDevoirs: [] });
          S.devoirs = 0;
          renderContent();
          flash('Devoirs effacés ✓');
        }
        break;
      case 'sync-infos': {
        const r = await toTab({ type: 'pg-infos-sync' }, true);
        flash(r ? 'Synchronisation lancée dans Pronote…' : '⚠ Onglet Pronote injoignable', !r);
        break;
      }
      case 'clear-infos':
        await chrome.storage.local.set({ pgInfosCache: { updatedAt: Date.now(), syncedAt: 0, items: [] } });
        S.infos = null;
        renderContent();
        flash('Cache vidé ✓');
        break;
      case 'diag': {
        const r = await toTab({ type: 'pg-diagnostic' });
        if (!r) {
          flash('⚠ Onglet Pronote injoignable', true);
          break;
        }
        r.extension = chrome.runtime.getManifest().version;
        r.navigateur = navigator.userAgent;
        try {
          await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
          flash('Diagnostic copié ✓');
        } catch (err) {
          flash('⚠ Copie impossible', true);
        }
        break;
      }
      case 'new': {
        const name = prompt('Nom du nouveau profil :', 'Nouveau profil');
        if (name === null) break;
        const p = await PG.store.create(name, null);
        await PG.store.setActive(p.id);
        await reload();
        flash('Profil créé ✓');
        break;
      }
      case 'new-copy': {
        const name = prompt('Nom du nouveau profil :', S.profile.name + ' (copie)');
        if (name === null) break;
        await flushCfg.flush();
        const p = await PG.store.create(name, S.profile.config);
        await PG.store.setActive(p.id);
        await reload();
        flash('Profil créé ✓');
        break;
      }
      case 'dup':
        await PG.store.duplicate(id);
        await reload();
        flash('Profil dupliqué ✓');
        break;
      case 'del': {
        const p = S.index.find((x) => x.id === id);
        if (!p || !confirm('Supprimer le profil « ' + p.name + ' » ?')) break;
        try {
          await PG.store.remove(id);
          await reload();
          flash('Profil supprimé ✓');
        } catch (err) {
          flash('⚠ ' + err.message, true);
        }
        break;
      }
      case 'reset-profile':
        if (confirm('Remettre le profil « ' + S.profile.name + ' » à zéro (thème, style, agencement, widgets) ?')) {
          pendingCfg = null;
          await PG.store.reset(S.profile.id);
          await reload();
          flash('Profil réinitialisé ✓');
        }
        break;
      case 'export-one':
      case 'export-all': {
        const data = await PG.store.exportData(act === 'export-one' ? [id] : null);
        const name = act === 'export-one' ? (S.index.find((x) => x.id === id) || {}).name || 'profil' : 'profils';
        download(data, 'pronote-goat-' + name.replace(/[^\w-]+/g, '_').toLowerCase() + '.json');
        break;
      }
    }
  });

  function download(obj, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    chrome.downloads.download({ url, filename, saveAs: true }, () => {
      if (chrome.runtime.lastError) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const n = await PG.store.importData(data);
      await reload();
      flash(n + ' profil(s) importé(s) ✓');
    } catch (err) {
      flash('⚠ ' + (err.message || 'Fichier illisible'), true);
    }
  }

  // Image de fond : réduite à 1920 px de large et compressée (JPEG) pour
  // rester légère dans chrome.storage.local.
  async function upload(file) {
    if (!file || !/^image\//.test(file.type)) return;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1920 / bmp.width);
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * scale);
      cv.height = Math.round(bmp.height * scale);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const dataUrl = cv.toDataURL('image/jpeg', 0.85);
      const old = cfg().style.background.assetId;
      const id = await PG.store.saveAsset(dataUrl);
      S.asset = dataUrl;
      updateCfg((c) => {
        c.style.background.type = 'image';
        c.style.background.assetId = id;
      });
      if (old) PG.store.removeAsset(old);
      flash('Image importée ✓');
    } catch (err) {
      flash('⚠ Image illisible', true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Synchronisation avec les autres vues                                */
  /* ------------------------------------------------------------------ */

  async function reload() {
    await loadAll();
    renderShell();
  }

  const softReload = U.debounce(async () => {
    if (pendingCfg) return;
    const a = document.activeElement;
    // ne pas reconstruire sous les doigts de l'utilisateur
    if (a && app.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio') return;
    await loadAll();
    renderContent();
    const tg = app.querySelector('.top input[data-tool="goat.enabled"]');
    if (tg) tg.checked = !!S.tools.goat.enabled;
  }, 300);

  PG.store.onChange((info) => {
    const mine = S.profile && info.profiles.includes(S.profile.id);
    if (mine || info.meta || info.index || info.tools || info.keys.some((k) => /^pg(SeenWidgets|InfosCache)$|^pdlDevoirs$/.test(k))) {
      if (mine && pendingCfg) return;
      softReload();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  // liens profonds du tableau de bord : options.html#profiles…
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (TABS.some((t) => t[0] === h) && h !== S.tab && S.profile) {
      S.tab = h;
      renderContent();
    }
  });

  (async function init() {
    try {
      const h = (location.hash || '').slice(1);
      const saved = localStorage.getItem('pgTab');
      S.tab = TABS.some((t) => t[0] === h) ? h : TABS.some((t) => t[0] === saved) ? saved : 'themes';
    } catch (err) {
      /* ignore */
    }
    await loadAll();
    renderShell();
    await findPronoteTab();
    renderShell();
  })();
})();
