/* Pronote GOAT — moteur de thèmes
 *
 * Pronote dessine presque tout à partir de variables CSS (--theme-*,
 * --theme-neutre-*, --color-*). Plutôt que de réécrire ses styles, on
 * recalcule ces variables à partir de quelques couleurs (les « jetons » du
 * thème + les choix de l'utilisateur) et on les déclare avec une spécificité
 * supérieure. Les décors propres à chaque thème (scanlines, papier ligné…)
 * vivent dans content/themes.css, sous html[data-pg-theme="…"].
 *
 * Ce module est chargé dès document_start pour éviter le flash du thème
 * d'origine.
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || !PG.core || PG.theme) return;

  const core = PG.core;
  const C = PG.color;
  const html = document.documentElement;

  const theme = {};
  PG.theme = theme;

  const PRONOTE_TOKENS = PG.PRONOTE_TOKENS;

  // Proportion de texte mélangée au fond pour chaque nuance neutre de Pronote
  // (calée sur les valeurs d'origine : #f8f8f8, #f6f6f6, #ededed…).
  const NEUTRES = {
    light: 0.03,
    legere: 0.035,
    legere2: 0.07,
    claire: 0.115,
    moyen1: 0.145,
    moyen2: 0.23,
    moyen3: 0.42,
    foncee: 0.58,
    sombre: 0.705
  };

  // Barre de menu principale, par thème (sinon : couleurs neutres de Pronote)
  const NAV = {
    dev: { bg: '#333333', fg: '#cccccc' },
    hacker: { bg: '#000000', fg: '#39ff6a' },
    glass: { bg: 'rgba(255, 255, 255, 0.38)', fg: '#1e1b4b' },
    minimal: { bg: '#ffffff', fg: '#111827' },
    papier: { bg: '#2b3a67', fg: '#fffdf4' }
  };

  let assetUrl = ''; // image de fond importée (data URL)
  let assetId = '';
  let lastKey = '';

  /* ------------------------------------------------------------------ */
  /* Résolution des réglages                                             */
  /* ------------------------------------------------------------------ */

  function resolve(cfg) {
    const T = PG.THEMES[cfg.theme.id] || PG.THEMES.pronote;
    const ov = cfg.theme.overrides || {};
    const hasOv = Object.keys(ov).some((k) => ov[k]);
    const colors = !!(T.tokens || hasOv);
    const tokens = Object.assign({}, T.tokens || PRONOTE_TOKENS);
    for (const [k, v] of Object.entries(ov)) if (v && C.parse(v)) tokens[k] = v;

    const st = cfg.style;
    const pick = (v, d) => (v === null || v === undefined || v === '' ? d : v);
    const effects = Object.assign({}, T.effects || {}, (cfg.theme.effects || {})[cfg.theme.id] || {});

    let font = '';
    if (st.font === 'custom') font = sanitizeFont(st.customFont);
    else if (st.font) font = (PG.FONTS.find((f) => f.id === st.font) || {}).css || '';
    if (!font) font = T.font || '';

    return {
      id: cfg.theme.id,
      T,
      colors,
      tokens,
      dark: colors ? C.isDark(tokens.surface) : false,
      font,
      titleFont: st.font ? '' : T.titleFont || '',
      fontScale: st.fontScale || 1,
      radius: pick(st.radius, T.radius),
      gap: pick(st.gap, T.gap),
      opacity: pick(st.widgetOpacity, T.widgetOpacity),
      blur: pick(st.blur, T.blur),
      shadows: pick(st.shadows, T.shadows),
      animations: st.animations !== false,
      effects,
      st
    };
  }

  function sanitizeFont(s) {
    return String(s || '')
      .replace(/[;{}<>\\]/g, '')
      .slice(0, 120)
      .trim();
  }

  function cssUrl(u) {
    return 'url("' + String(u).replace(/["\\\n\r]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ') + '")';
  }

  function backgroundOf(r) {
    const b = r.st.background || {};
    const dim = Math.min(0.85, Math.max(0, Number(b.dim) || 0));
    const voile = dim ? 'linear-gradient(rgba(0,0,0,' + dim + '), rgba(0,0,0,' + dim + ')), ' : '';
    switch (b.type) {
      case 'color':
        return C.parse(b.color) ? b.color : '';
      case 'gradient': {
        const a = Number.isFinite(+b.angle) ? +b.angle : 135;
        if (!C.parse(b.from) || !C.parse(b.to)) return '';
        return voile + 'linear-gradient(' + a + 'deg, ' + b.from + ', ' + b.to + ')';
      }
      case 'image': {
        const src = b.assetId ? assetUrl : /^https:\/\//i.test(b.image || '') ? b.image : '';
        if (!src) return r.T.background || '';
        return voile + cssUrl(src) + ' center / cover no-repeat';
      }
      default:
        return r.T.background ? voile + r.T.background : dim && r.colors ? voile + r.tokens.bg : '';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Génération des variables                                            */
  /* ------------------------------------------------------------------ */

  function decl(obj) {
    return Object.entries(obj)
      .map(([k, v]) => '  --' + k + ': ' + v + ';')
      .join('\n');
  }

  function palette(r) {
    const t = r.tokens;
    const dark = r.dark;
    const v = {};

    // nuances neutres : du fond (light) vers le texte (sombre)
    for (const [n, ratio] of Object.entries(NEUTRES)) {
      const c = C.mix(t.surface, t.text, ratio);
      Object.assign(v, C.scales('theme-neutre-' + n, c));
      Object.assign(v, C.scales('theme-' + n, c));
    }

    // couleur d'accent : Pronote attend 4 nuances (sombre, foncée, moyenne, claire)
    const acc = {
      sombre: dark ? C.mix(t.accent, '#ffffff', 0.7) : C.mix(t.accent, '#000000', 0.5),
      foncee: dark ? C.mix(t.accent, '#ffffff', 0.55) : C.mix(t.accent, '#000000', 0.3),
      moyen1: t.accent,
      claire: dark ? C.mix(t.accent, t.surface, 0.72) : C.mix(t.accent, t.surface, 0.82)
    };
    for (const [n, c] of Object.entries(acc)) Object.assign(v, C.scales('theme-' + n, c));

    Object.assign(
      v,
      {
        'color-background': t.surface,
        'color-background-rgb': C.triplet(t.surface),
        'color-background-secondary': t.surface2,
        'color-background-light': t.surface2,
        'color-background-scaleMoins30': C.mix(t.surface, dark ? '#ffffff' : '#000000', 0.3),
        'color-text': t.text,
        'color-text-rgb': C.triplet(t.text),
        'color-text-scalePlus20': C.mix(t.text, t.surface, 0.2),
        'color-text-scalePlus40': C.mix(t.text, t.surface, 0.4),
        'color-white': dark ? '#000000' : '#ffffff',
        'color-black': dark ? '#ffffff' : '#000000',
        'color-shadow': dark ? '#00000083' : '#00000029',
        'color-trait-separateur': C.mix(t.surface, t.text, 0.15),
        'couleur-selection': t.accent,
        'couleur-surlignage-texte': t.accent
      }
    );
    return v;
  }

  function buildCss(r) {
    const t = r.tokens;
    const parts = [];
    const ON = 'html[data-pg-theme][data-pg-on]';

    if (r.colors) {
      const vars = decl(palette(r));
      // :root body.dark-mode (0,2,1) et body .ThemeXxx .disable-dark-mode
      // (0,2,1) sont battus par les sélecteurs ci-dessous (0,2,2) / (0,3,2).
      parts.push(
        ON + ', ' + ON + ' body, ' + ON + ' body [class*="Theme"], ' + ON + ' body .disable-dark-mode {\n' + vars + '\n}'
      );
      parts.push(ON + ' { color-scheme: ' + (r.dark ? 'dark' : 'light') + '; }');
    }

    // ---- jetons propres à l'extension (utilisés aussi par themes.css)
    const op = r.opacity === null || r.opacity === undefined ? 1 : Math.min(1, Math.max(0.15, +r.opacity));
    const st = r.st;
    const blockBg = C.parse(st.blockColor) ? st.blockColor : t.surface;
    const pg = {
      'pg-accent': t.accent,
      'pg-accent-rgb': C.triplet(t.accent),
      'pg-on-accent': C.readableOn(t.accent),
      'pg-bg': t.bg,
      'pg-surface': t.surface,
      'pg-surface2': t.surface2,
      'pg-text': t.text,
      'pg-muted': t.muted,
      'pg-border': t.border,
      'pg-widget-bg': op < 1 ? C.rgba(blockBg, op) : blockBg,
      'pg-gap': (r.gap === null || r.gap === undefined ? 24 : +r.gap) + 'px'
    };
    if (r.radius !== null && r.radius !== undefined) pg['pg-radius'] = +r.radius + 'px';
    if (r.font) pg['pg-font'] = r.font;
    if (r.titleFont) pg['pg-title-font'] = r.titleFont;
    const nav = NAV[r.id];
    if (nav) {
      pg['pg-nav-bg'] = nav.bg;
      pg['pg-nav-fg'] = nav.fg;
    }
    parts.push(ON + ' {\n' + decl(pg) + '\n}');

    // ---- structure : seulement ce que le thème / l'utilisateur change
    const styled = r.id !== 'pronote' || r.colors;

    if (r.fontScale && r.fontScale !== 1) {
      parts.push('html[data-pg-on] { font-size: calc(62.5% * ' + r.fontScale + ') !important; }');
    }

    if (r.font) {
      parts.push(
        ON + ' { --main-font: var(--pg-font); }\n' +
          ON + ' body, ' + ON + ' .Texte, ' + ON + ' .Titre, ' + ON + ' input, ' + ON + ' textarea, ' + ON + ' select, ' + ON + ' button { font-family: var(--pg-font) !important; }\n' +
          // tout hérite de la police… sauf les icônes (police Educ-Font)
          ON + ' body *:not(i):not([class*="icon"]):not([class*="Icon"]):not(.pg-ui):not(.pg-ui *) { font-family: inherit; }'
      );
    }
    if (r.titleFont) {
      parts.push(
        ON + ' .widget header h2, ' + ON + ' .titre-onglet, ' + ON + ' .ie-titre-gros, ' + ON + ' .pg-widget .pg-big { font-family: var(--pg-title-font) !important; }'
      );
    }

    const bg = backgroundOf(r);
    if (bg) {
      parts.push(
        ON + ' body { background: ' + bg + ' !important; background-attachment: fixed !important; }\n' +
          ON + ' body > .ThemePronote, ' + ON + ' .interface_affV, ' + ON + ' .interface_affV_client, ' + ON + ' .AffichagePageAccueil { background: transparent !important; background-color: transparent !important; }'
      );
    }

    const blockBorder = C.parse(st.blockBorder) ? st.blockBorder : r.colors ? t.border : '';
    if (styled || op < 1 || r.radius !== null || st.blockColor || blockBorder) {
      const shadow = r.shadows === false
        ? 'none'
        : r.dark
          ? '0 2px 12px rgba(0, 0, 0, 0.45)'
          : '0 1px 2px rgba(15, 23, 42, 0.06), 0 6px 18px rgba(15, 23, 42, 0.08)';
      parts.push(
        ON + ' .widget {\n' +
          '  background: var(--pg-widget-bg) !important;\n' +
          (blockBorder ? '  border: 1px solid ' + (op < 1 && !st.blockBorder ? C.rgba(blockBorder, 0.55) : blockBorder) + ' !important;\n' : '') +
          (r.radius !== null && r.radius !== undefined ? '  border-radius: var(--pg-radius) !important;\n' : '') +
          '  box-shadow: ' + shadow + ' !important;\n' +
          '}'
      );
    }

    // texte des blocs : on redéfinit la variable de Pronote dans leur sous-arbre
    if (C.parse(st.blockText)) {
      parts.push(
        ON + ' .AffichagePageAccueil .widget { --color-text: ' + st.blockText + '; color: ' + st.blockText + ' !important; }'
      );
    }

    const blur = +r.blur || 0;
    if (blur > 0) {
      parts.push(
        ON + ' .widget { -webkit-backdrop-filter: blur(' + blur + 'px) saturate(150%); backdrop-filter: blur(' + blur + 'px) saturate(150%); }'
      );
    }

    if (r.gap !== null && r.gap !== undefined) {
      parts.push(
        'html[data-pg-on]:not(.pg-layout) .AffichagePageAccueil .widgets-global-container { column-gap: var(--pg-gap) !important; }\n' +
          'html[data-pg-on]:not(.pg-layout) .AffichagePageAccueil .widget { margin-bottom: var(--pg-gap) !important; }'
      );
    }

    if (nav) {
      parts.push(
        ON + ' .objetbandeauentete_global .objetBandeauEntete_menu:not(.ongletLudique) { background: var(--pg-nav-bg) !important; }\n' +
          ON + ' .objetbandeauentete_global .objetBandeauEntete_menu:not(.ongletLudique) .item-menu_niveau0 > .label-menu_niveau0,\n' +
          ON + ' .objetbandeauentete_global .objetBandeauEntete_menu:not(.ongletLudique) .label-home,\n' +
          ON + ' .objetbandeauentete_global .objetBandeauEntete_menu:not(.ongletLudique) .objetBandeauEntete_boutons li i { color: var(--pg-nav-fg) !important; }'
      );
    }

    // (bandeaux, barre de navigation, parties masquées : content/interface.js)
    if (+st.maxWidth > 0) {
      parts.push(
        'html[data-pg-on] .AffichagePageAccueil .widgets-global-container { max-width: ' + +st.maxWidth + 'px !important; margin-left: auto !important; margin-right: auto !important; }'
      );
    }

    return parts.join('\n\n');
  }

  /* ------------------------------------------------------------------ */
  /* Mode sombre natif de Pronote                                        */
  /* ------------------------------------------------------------------ */

  // Les thèmes sombres activent la classe « dark-mode » de Pronote : toutes
  // ses règles sombres (couleurs codées en dur comprises) s'appliquent, nos
  // variables passant par-dessus. L'état d'origine est restauré ensuite.
  let wantDark = null; // true / false / null (= ne pas toucher)
  let bodyObs = null;

  function syncDark() {
    const b = document.body;
    if (!b) return;
    if (!b.hasAttribute('data-pg-dm-orig')) {
      b.setAttribute('data-pg-dm-orig', b.classList.contains('dark-mode') ? '1' : '0');
    }
    const target = wantDark === null ? b.getAttribute('data-pg-dm-orig') === '1' : wantDark;
    if (b.classList.contains('dark-mode') !== target) b.classList.toggle('dark-mode', target);

    if (!bodyObs) {
      bodyObs = new MutationObserver(() => {
        const want = wantDark === null ? b.getAttribute('data-pg-dm-orig') === '1' : wantDark;
        if (b.classList.contains('dark-mode') !== want) b.classList.toggle('dark-mode', want);
      });
      bodyObs.observe(b, { attributes: true, attributeFilter: ['class'] });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Effet « pluie Matrix » (thème Hacker, optionnel)                    */
  /* ------------------------------------------------------------------ */

  const matrix = {
    canvas: null,
    timer: null,
    drops: [],
    start() {
      if (this.canvas || !document.body) return;
      const cv = document.createElement('canvas');
      cv.className = 'pg-matrix';
      cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv);
      this.canvas = cv;
      const ctx = cv.getContext('2d');
      const chars = 'アカサタナハマヤラワ0123456789ABCDEF<>/{}[]#$%*+=';
      const size = 16;
      const resize = () => {
        cv.width = window.innerWidth;
        cv.height = window.innerHeight;
        this.drops = Array.from({ length: Math.ceil(cv.width / size) }, () => Math.random() * -50);
      };
      resize();
      this.onResize = resize;
      window.addEventListener('resize', resize);
      const tick = () => {
        this.timer = setTimeout(tick, 70); // ~14 i/s : discret pour le processeur
        if (document.hidden) return;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#00ff41';
        ctx.font = size + 'px monospace';
        for (let i = 0; i < this.drops.length; i++) {
          const y = this.drops[i] * size;
          if (y > 0) ctx.fillText(chars[(Math.random() * chars.length) | 0], i * size, y);
          if (y > cv.height && Math.random() > 0.975) this.drops[i] = 0;
          this.drops[i]++;
        }
      };
      tick();
    },
    stop() {
      clearTimeout(this.timer);
      if (this.onResize) window.removeEventListener('resize', this.onResize);
      if (this.canvas) this.canvas.remove();
      this.canvas = null;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Application                                                         */
  /* ------------------------------------------------------------------ */

  function clear() {
    for (const a of ['data-pg-on', 'data-pg-theme', 'data-pg-dark', 'data-pg-fx', 'data-pg-anim']) {
      html.removeAttribute(a);
    }
    core.style('theme', '');
    wantDark = null;
    syncDark();
    matrix.stop();
    lastKey = '';
  }

  theme.apply = function () {
    const cfg = core.config;
    if (!cfg || !core.tools) return;
    if (!core.enabled()) {
      clear();
      return;
    }

    // image de fond importée : chargée depuis le stockage local au besoin
    const bgAsset = cfg.style.background.type === 'image' ? cfg.style.background.assetId : '';
    if (bgAsset && bgAsset !== assetId) {
      assetId = bgAsset;
      assetUrl = '';
      PG.store.getAsset(bgAsset).then((url) => {
        assetUrl = url || '';
        lastKey = '';
        theme.apply();
      });
    }

    const r = resolve(cfg);
    const fx = Object.keys(r.effects).filter((k) => r.effects[k]);

    html.setAttribute('data-pg-on', '');
    html.setAttribute('data-pg-theme', r.id);
    html.setAttribute('data-pg-dark', r.dark ? '1' : '0');
    if (fx.length) html.setAttribute('data-pg-fx', fx.join(' '));
    else html.removeAttribute('data-pg-fx');
    if (r.animations) html.removeAttribute('data-pg-anim');
    else html.setAttribute('data-pg-anim', 'off');

    const key = JSON.stringify([cfg.theme, cfg.style, assetUrl.length]);
    if (key !== lastKey) {
      lastKey = key;
      core.style('theme', buildCss(r));
    } else {
      core.style('theme', buildCss(r)); // replace la feuille en fin de <head>
    }

    wantDark = r.colors ? r.dark : null;
    syncDark();

    if (r.id === 'hacker' && r.effects.matrix && r.animations) matrix.start();
    else matrix.stop();
  };

  // Pour l'aperçu du popup : palette résolue d'un thème
  theme.resolve = resolve;

  core.on('config', theme.apply);
  core.on('tools', theme.apply);
  core.on('assets', () => {
    assetId = '';
    theme.apply();
  });

  // <head> et <body> n'existent pas encore à document_start
  document.addEventListener('DOMContentLoaded', () => theme.apply(), { once: true });

  // Barre d'état du thème Dev : titre de la page affichée
  core.onDom(() => {
    if (html.getAttribute('data-pg-theme') !== 'dev' || !document.body) return;
    const t = core.textOf(document.querySelector('.titre-onglet')) || 'Pronote';
    const s = 'Pronote GOAT  ›  ' + t;
    if (document.body.getAttribute('data-pg-status') !== s) document.body.setAttribute('data-pg-status', s);
  }, 400);
})();
