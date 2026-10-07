/* Pronote GOAT — constantes partagées
 * Chargé par les scripts de contenu, le popup / tableau de bord et le service
 * worker (importScripts). Tout est rangé sous l'espace de noms global « PG ».
 *
 * Contenu :
 *   PG.THEMES            thèmes prédéfinis (jetons de couleurs, police, forme)
 *   PG.FONTS             polices proposées
 *   PG.WIDGETS           catalogue des widgets ajoutés par l'extension
 *   PG.PRONOTE_WIDGETS   noms lisibles des widgets natifs de Pronote
 *   PG.DEFAULT_CONFIG    configuration d'un profil neuf
 *   PG.TOOLS_DEFAULTS    réglages des outils (téléchargement, devoirs)
 *   PG.util              petites fonctions utilitaires (clone, fusion…)
 */
(function (root) {
  'use strict';

  const PG = (root.PG = root.PG || {});

  PG.VERSION = '2.0.0';

  /* ------------------------------------------------------------------ */
  /* Thèmes                                                              */
  /* ------------------------------------------------------------------ */

  // Jetons communs à tous les thèmes :
  //   accent   couleur principale (titres, boutons, sélection)
  //   bg       fond de la page
  //   surface  fond des widgets et panneaux
  //   surface2 fond secondaire (bandeaux, survols)
  //   text     texte principal
  //   muted    texte secondaire
  //   border   bordures des widgets
  PG.THEMES = {
    pronote: {
      name: 'Pronote',
      emoji: '🟢',
      desc: "L'apparence d'origine, sans retouche.",
      dark: false,
      tokens: null,
      preview: { bg: '#f2f4f5', surface: '#ffffff', accent: '#008673', text: '#1d1d1d' }
    },
    dev: {
      name: 'Dev',
      emoji: '💻',
      desc: 'Façon VS Code : sombre, monospace, couleurs de coloration syntaxique.',
      dark: true,
      tokens: {
        accent: '#007acc',
        bg: '#1e1e1e',
        surface: '#252526',
        surface2: '#2d2d30',
        text: '#d4d4d4',
        muted: '#8b8b8b',
        border: '#3c3c3c'
      },
      font: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
      radius: 4,
      gap: 16,
      shadows: false,
      background: 'linear-gradient(#1e1e1e, #1e1e1e)',
      effects: { statusbar: true },
      preview: { bg: '#1e1e1e', surface: '#252526', accent: '#007acc', text: '#d4d4d4', extra: ['#c586c0', '#4ec9b0', '#ce9178'] }
    },
    hacker: {
      name: 'Hacker',
      emoji: '🟩',
      desc: 'Terminal noir et vert néon, lignes de balayage, curseur clignotant.',
      dark: true,
      tokens: {
        accent: '#00ff41',
        bg: '#000000',
        surface: '#020b05',
        surface2: '#04170b',
        text: '#39ff6a',
        muted: '#16a34a',
        border: '#00ff41'
      },
      font: "'Fira Code', 'Cascadia Code', 'Courier New', Courier, monospace",
      radius: 0,
      gap: 18,
      shadows: true,
      background:
        'radial-gradient(ellipse at center, #031a0a 0%, #000 70%)',
      effects: { scanlines: true, glow: true, matrix: false },
      preview: { bg: '#000000', surface: '#03140a', accent: '#00ff41', text: '#39ff6a' }
    },
    glass: {
      name: 'Verre dépoli',
      emoji: '🫧',
      desc: 'Glassmorphism : widgets translucides et flous sur un fond aux couleurs vives.',
      dark: false,
      tokens: {
        accent: '#7c3aed',
        bg: '#c4b5fd',
        surface: '#ffffff',
        surface2: '#f5f3ff',
        text: '#1e1b4b',
        muted: '#57538f',
        border: '#ffffff'
      },
      font: "'Nunito', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif",
      radius: 18,
      gap: 22,
      shadows: true,
      widgetOpacity: 0.55,
      blur: 16,
      background:
        'radial-gradient(at 10% 15%, #f0abfc 0, transparent 45%),' +
        'radial-gradient(at 88% 10%, #93c5fd 0, transparent 45%),' +
        'radial-gradient(at 75% 85%, #a5b4fc 0, transparent 50%),' +
        'radial-gradient(at 15% 90%, #5eead4 0, transparent 45%),' +
        'linear-gradient(135deg, #c4b5fd 0%, #fbcfe8 100%)',
      preview: { bg: 'linear-gradient(135deg,#a5b4fc,#f0abfc 60%,#5eead4)', surface: 'rgba(255,255,255,.55)', accent: '#7c3aed', text: '#1e1b4b' }
    },
    minimal: {
      name: 'Minimaliste',
      emoji: '◽',
      desc: 'Épuré : beaucoup de blanc, une seule couleur, aucun décor superflu.',
      dark: false,
      tokens: {
        accent: '#2563eb',
        bg: '#f6f6f7',
        surface: '#ffffff',
        surface2: '#fafafa',
        text: '#111827',
        muted: '#6b7280',
        border: '#e8e8ec'
      },
      font: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      radius: 12,
      gap: 20,
      shadows: false,
      background: 'linear-gradient(#f6f6f7, #f6f6f7)',
      preview: { bg: '#f6f6f7', surface: '#ffffff', accent: '#2563eb', text: '#111827' }
    },
    papier: {
      name: 'Carnet',
      emoji: '📒',
      desc: 'Papier ligné, marge rouge, ruban adhésif et encre bleue.',
      dark: false,
      tokens: {
        accent: '#c0392b',
        bg: '#d8c7a3',
        surface: '#fffdf4',
        surface2: '#f8f1dc',
        text: '#1f2f5c',
        muted: '#6b6150',
        border: '#e4d8b9'
      },
      font: "Georgia, 'Times New Roman', serif",
      titleFont: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Comic Neue', cursive",
      radius: 3,
      gap: 24,
      shadows: true,
      background:
        'radial-gradient(circle at 20% 20%, rgba(255,255,255,.18) 0, transparent 40%),' +
        'repeating-linear-gradient(45deg, rgba(120,90,40,.05) 0 2px, transparent 2px 6px),' +
        'linear-gradient(#d8c7a3, #cdb98f)',
      preview: { bg: '#d8c7a3', surface: '#fffdf4', accent: '#c0392b', text: '#1f2f5c', lines: true }
    }
  };

  PG.THEME_ORDER = ['pronote', 'dev', 'hacker', 'glass', 'minimal', 'papier'];

  // Couleurs d'origine de Pronote : base utilisée quand on ne retouche que
  // quelques couleurs du thème « Pronote ».
  PG.PRONOTE_TOKENS = {
    accent: '#008673',
    bg: '#ffffff',
    surface: '#ffffff',
    surface2: '#f6f6f6',
    text: '#000000',
    muted: '#6b6e77',
    border: '#e2e2e2'
  };

  /* ------------------------------------------------------------------ */
  /* Polices                                                             */
  /* ------------------------------------------------------------------ */

  // Aucune police n'est téléchargée : on s'appuie sur celles du système,
  // avec des replis sûrs (la CSP de Pronote bloquerait de toute façon
  // les polices distantes).
  PG.FONTS = [
    { id: '', label: 'Selon le thème' },
    { id: 'pronote', label: 'Montserrat (Pronote)', css: 'Montserrat, Arial, Verdana, sans-serif' },
    { id: 'system', label: 'Système', css: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Arial, sans-serif" },
    { id: 'round', label: 'Arrondie', css: "'Nunito', 'Varela Round', 'Trebuchet MS', system-ui, sans-serif" },
    { id: 'serif', label: 'Serif', css: "Georgia, 'Times New Roman', serif" },
    { id: 'mono', label: 'Monospace', css: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace" },
    { id: 'hand', label: 'Manuscrite', css: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Comic Neue', cursive" },
    { id: 'readable', label: 'Lisibilité renforcée', css: "'OpenDyslexic', 'Lexend', Verdana, Tahoma, sans-serif" },
    { id: 'custom', label: 'Personnalisée…' }
  ];

  /* ------------------------------------------------------------------ */
  /* Widgets de l'extension                                              */
  /* ------------------------------------------------------------------ */

  // schema : champs de réglage, rendus à l'identique dans le popup et dans
  // l'éditeur visuel. Types : number, checkbox, text, date, color, select,
  // links. « showIf » masque un champ selon la valeur d'un autre.
  PG.WIDGETS = {
    infos: {
      name: 'Informations',
      icon: '📢',
      desc: 'Toutes les informations publiées par l\'établissement, même déjà lues.',
      column: 'last',
      defaults: { enabled: true, max: 6, onlyUnread: false, excerpt: true },
      schema: [
        { key: 'max', type: 'number', label: 'Nombre affiché', min: 1, max: 30 },
        { key: 'onlyUnread', type: 'checkbox', label: 'Seulement les non lues' },
        { key: 'excerpt', type: 'checkbox', label: 'Afficher un extrait du texte' }
      ]
    },
    sondages: {
      name: 'Sondages',
      icon: '📊',
      desc: 'Les sondages en cours, avec ceux qui attendent encore ta réponse.',
      column: 'last',
      defaults: { enabled: true, max: 6, onlyPending: false },
      schema: [
        { key: 'max', type: 'number', label: 'Nombre affiché', min: 1, max: 30 },
        { key: 'onlyPending', type: 'checkbox', label: 'Seulement ceux sans réponse' }
      ]
    },
    clock: {
      name: 'Horloge & prochain cours',
      icon: '🕒',
      desc: "L'heure, le cours en cours avec sa progression et le temps avant le suivant.",
      column: 'first',
      defaults: { enabled: false, seconds: false, next: true },
      schema: [
        { key: 'seconds', type: 'checkbox', label: 'Afficher les secondes' },
        { key: 'next', type: 'checkbox', label: 'Afficher le cours en cours / suivant' }
      ]
    },
    countdown: {
      name: 'Compte à rebours',
      icon: '⏳',
      desc: 'Jours restants avant les prochaines vacances ou une date choisie.',
      column: 'first',
      defaults: { enabled: false, mode: 'auto', label: 'Bac de français', date: '' },
      schema: [
        {
          key: 'mode',
          type: 'select',
          label: 'Cible',
          options: [
            ['auto', 'Prochaines vacances (agenda)'],
            ['custom', 'Date personnalisée']
          ]
        },
        { key: 'label', type: 'text', label: 'Événement', showIf: { mode: 'custom' } },
        { key: 'date', type: 'date', label: 'Date', showIf: { mode: 'custom' } }
      ]
    },
    average: {
      name: 'Moyenne indicative',
      icon: '📈',
      desc: 'Moyenne des dernières notes ramenées sur 20 (sans coefficients).',
      column: 'middle',
      defaults: { enabled: false, bySubject: true },
      schema: [{ key: 'bySubject', type: 'checkbox', label: 'Détail par matière' }]
    },
    links: {
      name: 'Liens rapides',
      icon: '🔗',
      desc: 'Raccourcis vers une page de Pronote ou un site externe.',
      column: 'first',
      defaults: {
        enabled: false,
        items: [
          { emoji: '📝', label: 'Mes notes', target: 'menu:Mes notes' },
          { emoji: '🗓️', label: 'Emploi du temps', target: 'menu:Emploi du temps' },
          { emoji: '📚', label: 'Travail à faire', target: 'menu:Travail à faire' },
          { emoji: '📂', label: 'Contenus et ressources', target: 'menu:Contenus et ressources' }
        ]
      },
      schema: [{ key: 'items', type: 'links', label: 'Liens' }]
    },
    postit: {
      name: 'Post-it',
      icon: '🗒️',
      desc: 'Une note libre, enregistrée dans ton navigateur.',
      column: 'middle',
      defaults: { enabled: false, text: '', color: '#fde68a' },
      schema: [{ key: 'color', type: 'color', label: 'Couleur du papier' }]
    }
  };

  PG.WIDGET_ORDER = ['infos', 'sondages', 'clock', 'countdown', 'average', 'links', 'postit'];

  // Noms lisibles des widgets natifs, pour les listes du popup (la clé est la
  // seconde classe de la <section class="widget xxx">).
  PG.PRONOTE_WIDGETS = {
    edt: 'Emploi du temps',
    pensebete: 'Pense-bête',
    travailafaire: 'Travail à faire',
    ressourcepedagogique: 'Ressources pédagogiques',
    viescolaire: 'Carnet de correspondance',
    notes: 'Dernières notes',
    competences: 'Compétences',
    partenairecdi: 'CDI',
    partenaireard: 'Restauration (ARD)',
    agenda: 'Agenda',
    actualites: 'Informations & Sondages (Pronote)',
    discussions: 'Discussions',
    menudelacantine: 'Menu de la cantine',
    absences: 'Absences',
    vieScolaire: 'Vie scolaire'
  };

  /* ------------------------------------------------------------------ */
  /* Configuration d'un profil                                           */
  /* ------------------------------------------------------------------ */

  const widgetDefaults = {};
  for (const id of Object.keys(PG.WIDGETS)) {
    widgetDefaults[id] = JSON.parse(JSON.stringify(PG.WIDGETS[id].defaults));
  }

  PG.DEFAULT_CONFIG = {
    theme: {
      id: 'pronote',
      // couleurs choisies par l'utilisateur ; une clé absente = valeur du thème
      overrides: {},
      effects: {}
    },
    style: {
      font: '', // id de PG.FONTS
      customFont: '',
      fontScale: 1,
      radius: null, // null = selon le thème
      gap: null,
      widgetOpacity: null,
      blur: null,
      shadows: null,
      animations: true,
      background: {
        type: 'theme', // theme | color | gradient | image
        color: '#1f2937',
        from: '#6366f1',
        to: '#ec4899',
        angle: 135,
        image: '', // URL https://…
        assetId: '', // image importée (stockée en local)
        dim: 0 // voile sombre 0 → 0.8
      },
      compactHeader: false,
      hideFooter: false,
      hideLastLogin: false,
      hideWidgetIcons: false,
      maxWidth: 0 // 0 = pleine largeur, sinon largeur max en px
    },
    layout: {
      enabled: false, // false = disposition native de Pronote
      columns: 0, // 0 = autant que Pronote
      cols: null, // [[clé, …], …] — null = ordre natif
      hidden: {},
      span: {},
      collapsed: {},
      hiddenSelectors: [] // [{ sel, label }]
    },
    widgets: widgetDefaults,
    ui: { fab: true }
  };

  PG.TOOLS_DEFAULTS = {
    // interrupteur général de la personnalisation (thèmes, agencement, widgets)
    goat: { enabled: true },
    downloads: {
      enabled: true,
      jsonScope: 'both',
      from: '',
      to: '',
      delay: 700,
      folder: 'Pronote',
      useSubfolders: true,
      clickFallback: true,
      askEachFile: false
    },
    devoirs: { enabled: true },
    infos: { autoReturn: true }
  };

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  PG.util = {
    isObj,

    clone(v) {
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    },

    // Fusion profonde : les objets sont fusionnés, les tableaux et valeurs
    // simples de « patch » remplacent ceux de « base ». Ne modifie rien.
    merge(base, patch) {
      if (!isObj(base)) return PG.util.clone(patch === undefined ? base : patch);
      const out = PG.util.clone(base);
      if (!isObj(patch)) return out;
      for (const k of Object.keys(patch)) {
        const pv = patch[k];
        if (pv === undefined) continue;
        out[k] = isObj(pv) && isObj(out[k]) ? PG.util.merge(out[k], pv) : PG.util.clone(pv);
      }
      return out;
    },

    // Complète une configuration (ancienne, importée…) avec les valeurs par
    // défaut, pour que tout le code puisse compter sur chaque champ.
    normalizeConfig(cfg) {
      const out = PG.util.merge(PG.DEFAULT_CONFIG, isObj(cfg) ? cfg : {});
      if (!PG.THEMES[out.theme.id]) out.theme.id = 'pronote';
      if (!isObj(out.theme.overrides)) out.theme.overrides = {};
      if (!Array.isArray(out.layout.hiddenSelectors)) out.layout.hiddenSelectors = [];
      if (out.layout.cols && !Array.isArray(out.layout.cols)) out.layout.cols = null;
      const fs = Number(out.style.fontScale);
      out.style.fontScale = Number.isFinite(fs) ? Math.min(1.4, Math.max(0.75, fs)) : 1;
      return out;
    },

    uid(prefix) {
      return (prefix || 'p') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },

    escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
      );
    },

    debounce(fn, ms) {
      let t = null;
      const d = function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
      };
      d.flush = (...args) => {
        clearTimeout(t);
        fn(...args);
      };
      d.cancel = () => clearTimeout(t);
      return d;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
