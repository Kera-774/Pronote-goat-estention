/* Pronote GOAT — bandeaux, barre de navigation et lisibilité
 *
 *   - parties de l'interface affichées ou masquées par case à cocher
 *     (catalogue PG.UI_PARTS : bandeau du haut et ses éléments, barre de
 *     navigation, bandeau « Page d'accueil », pied de page…) ;
 *   - bandeau du haut 100 % personnalisable : hauteur, couleurs, alignement,
 *     textes de remplacement avec variables ({prenom}, {classe}…), mode
 *     discret qui floute nom et photo ;
 *   - barre de navigation : onglets et sous-entrées masquables, onglets
 *     réordonnables, raccourcis personnels ajoutés dans la barre ;
 *   - « cases » de lecture derrière les contenus des autres pages, pour que
 *     le texte reste lisible sur une image de fond.
 *
 * Tout passe par une feuille de style générée (rien n'est supprimé du DOM de
 * Pronote) et quelques attributs data-pg-* posés sur ses éléments. Chargé dès
 * document_start : les éléments masqués n'apparaissent jamais, même une
 * fraction de seconde.
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || !PG.core || PG.ui) return;

  const core = PG.core;
  const C = PG.color;
  const ON = 'html[data-pg-on]';
  const MENU = '.objetbandeauentete_global .objetBandeauEntete_menu:not(.ongletLudique)';

  const ui = {};
  PG.ui = ui;

  /* ------------------------------------------------------------------ */
  /* Variables des textes personnalisés                                  */
  /* ------------------------------------------------------------------ */

  let vars = { prenom: '', nom: '', classe: '', etab: '', espace: '' };

  const isUpperWord = (w) => w === w.toUpperCase() && /[A-ZÀ-Ý]/.test(w);

  // « Espace Élèves - CHAMPION HAJJI Mathis (1GB) » → espace, nom, prénom, classe
  function readVars() {
    const u = core.textOf(document.querySelector('.ObjetBandeauEspace .ibe_util_texte'));
    const e = core.textOf(document.querySelector('.ObjetBandeauEspace .ibe_etab'));
    const out = { prenom: '', nom: '', classe: '', etab: e, espace: '' };
    if (!u) return out;
    const m = u.match(/^(.*?)\s+-\s+(.*?)(?:\s*\(([^)]*)\))?\s*$/);
    const full = m ? m[2] : u;
    out.espace = m ? m[1] : '';
    out.classe = m && m[3] ? m[3] : '';
    const words = full.split(/\s+/).filter(Boolean);
    out.nom = words.filter(isUpperWord).join(' ');
    out.prenom = words.filter((w) => !isUpperWord(w)).join(' ');
    return out;
  }

  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function salut() {
    const h = new Date().getHours();
    return h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour';
  }

  ui.fill = function (tpl) {
    const d = new Date();
    const map = Object.assign({}, vars, {
      date: JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()],
      salut: salut()
    });
    return String(tpl || '').replace(/\{(\w+)\}/g, (all, k) => (k in map ? map[k] : all));
  };

  // chaîne CSS sûre pour « content: … »
  function cssString(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]+/g, ' ').slice(0, 200) + '"';
  }

  function colorOk(c) {
    return c && C.parse(c) ? c : '';
  }

  // préfixe chaque sélecteur d'une liste « a, b »
  function scoped(sel) {
    return sel
      .split(',')
      .map((x) => ON + ' ' + x.trim())
      .join(',\n');
  }

  /* ------------------------------------------------------------------ */
  /* Lisibilité : « cases » derrière les contenus                        */
  /* ------------------------------------------------------------------ */

  function readabilityActive(cfg) {
    const R = cfg.ui.readability;
    if (R.mode === 'off') return false;
    if (R.mode === 'cards' || R.mode === 'panel') return true;
    // auto : dès qu'un fond décoratif passe derrière les pages
    return cfg.style.background.type !== 'theme' || ['glass', 'papier'].includes(cfg.theme.id);
  }

  function readabilityCss(cfg) {
    const R = cfg.ui.readability;
    const r = PG.theme ? PG.theme.resolve(cfg) : null;
    const base = colorOk(R.color) || (r ? r.tokens.surface : '#ffffff');
    const a = Math.min(1, Math.max(0.2, Number(R.opacity) || 0.9));
    const fill = C.rgba(base, a);
    const pad = Math.min(40, Math.max(0, Number(R.pad) || 0));
    const rad = Math.min(40, Math.max(0, Number(R.radius) || 0));
    const blur = Math.min(30, Math.max(0, Number(R.blur) || 0));
    const shadow = R.shadow ? ', 0 8px 26px rgba(0, 0, 0, 0.28)' : '';
    const text = r ? r.tokens.text : '#000000';
    return (
      ON + ' [data-pg-card] {\n' +
      '  background: ' + fill + ' !important;\n' +
      '  border-radius: ' + rad + 'px !important;\n' +
      // l'anneau d'ombre de la couleur du fond fait office de marge
      // intérieure sans modifier les dimensions calculées par Pronote
      '  box-shadow: 0 0 0 ' + pad + 'px ' + fill + shadow + ' !important;\n' +
      '  color: ' + text + ';\n' +
      (blur ? '  -webkit-backdrop-filter: blur(' + blur + 'px); backdrop-filter: blur(' + blur + 'px);\n' : '') +
      '}\n' +
      ON + ' [data-pg-cardroot] { padding: ' + pad + 'px !important; box-sizing: border-box; }'
    );
  }

  let cardTimer = null;
  function tagCards() {
    const cfg = core.config;
    const active = cfg && core.enabled() && readabilityActive(cfg) && !core.isHome();
    const want = new Set();
    let rootEl = null;

    if (active) {
      const main = document.querySelector('main.interface_affV_client');
      const root = main && [...main.children].find((c) => !c.classList.contains('AffichagePageAccueil') && core.visible(c));
      if (root) {
        rootEl = root;
        const good = (el) =>
          core.visible(el) && !el.classList.contains('sr-only') && !core.isOurs(el) && el.getBoundingClientRect().height > 24;
        let targets = [root];
        if (cfg.ui.readability.mode !== 'panel') {
          const kids = [...root.children].filter(good);
          if (kids.length >= 1 && kids.length <= 6) targets = kids;
          // un seul bloc qui englobe tout : on descend d'un niveau
          if (targets.length === 1 && targets[0] !== root) {
            const g = [...targets[0].children].filter(good);
            if (g.length >= 2 && g.length <= 6) targets = g;
          }
        }
        targets.forEach((t) => want.add(t));
      }
    }

    document.querySelectorAll('[data-pg-card]').forEach((el) => {
      if (!want.has(el)) el.removeAttribute('data-pg-card');
    });
    want.forEach((el) => {
      if (!el.hasAttribute('data-pg-card')) el.setAttribute('data-pg-card', '');
    });
    document.querySelectorAll('[data-pg-cardroot]').forEach((el) => {
      if (el !== rootEl) el.removeAttribute('data-pg-cardroot');
    });
    if (rootEl && !rootEl.hasAttribute('data-pg-cardroot')) rootEl.setAttribute('data-pg-cardroot', '');
  }

  /* ------------------------------------------------------------------ */
  /* Barre de navigation : repérage des entrées                          */
  /* ------------------------------------------------------------------ */

  const slug = (s) =>
    core
      .deaccent(s)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  // libellé d'un onglet : « Cahier<br>de textes » → « Cahier de textes »
  function labelOf(el) {
    if (!el) return '';
    let t = '';
    for (const n of el.childNodes) t += n.nodeType === 1 && n.tagName === 'BR' ? ' ' : n.textContent;
    return core.norm(t);
  }

  let navSig = '';
  function tagNav() {
    const out = [];
    const items = document.querySelectorAll('.objetBandeauEntete_menu .onglets-wrapper li.item-menu_niveau0');
    for (const li of items) {
      const label = labelOf(li.querySelector(':scope > .label-menu_niveau0'));
      if (!label) continue;
      const key = slug(label);
      if (li.getAttribute('data-pg-nav') !== key) li.setAttribute('data-pg-nav', key);
      const entry = { key, label, subs: [] };
      for (const sub of li.querySelectorAll('li.item-menu_niveau1, li.item-menu_niveau2')) {
        const sl = core.textOf(sub.querySelector(':scope > .label-menu-container .label-submenu'));
        if (!sl) continue;
        const sk = key + '/' + slug(sl);
        if (sub.getAttribute('data-pg-nav') !== sk) sub.setAttribute('data-pg-nav', sk);
        entry.subs.push({ key: sk, label: sl, page: !sub.classList.contains('has-submenu') });
      }
      out.push(entry);
    }
    if (!out.length) return;
    const sig = JSON.stringify(out);
    if (sig !== navSig) {
      navSig = sig;
      ui.nav = out;
      chrome.storage.local.set({ pgSeenNav: out }).catch(() => {});
    }
  }

  /* ------------------------------------------------------------------ */
  /* Raccourcis dans la barre de navigation                              */
  /* ------------------------------------------------------------------ */

  let scSig = '';
  function mountShortcuts() {
    const cfg = core.config;
    const list = cfg && core.enabled() ? cfg.ui.nav.shortcuts.filter((s) => s && s.target) : [];
    const menu = document.querySelector(MENU);
    let box = document.querySelector('.pg-nav-shortcuts');

    if (!list.length || !menu) {
      if (box) box.remove();
      scSig = '';
      return;
    }
    const sig = JSON.stringify(list);
    if (box && box.isConnected && box.parentElement === menu && sig === scSig) return;
    scSig = sig;

    if (!box) {
      box = core.h('div', { class: 'pg-nav-shortcuts', role: 'toolbar', 'aria-label': 'Raccourcis Pronote GOAT' });
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        const s = (core.config.ui.nav.shortcuts || [])[+b.getAttribute('data-i')];
        if (!s) return;
        if (/^https?:\/\//i.test(s.target)) window.open(s.target, '_blank', 'noopener');
        else if (!core.navigate(String(s.target).replace(/^menu:/, ''))) {
          b.classList.add('pg-shake');
          setTimeout(() => b.classList.remove('pg-shake'), 500);
        }
      });
    }
    box.textContent = '';
    list.slice(0, 12).forEach((s) => {
      const i = cfg.ui.nav.shortcuts.indexOf(s);
      box.appendChild(
        core.h('button', { type: 'button', class: 'pg-nav-sc', 'data-i': i, title: String(s.target).replace(/^menu:/, '') }, [
          s.emoji ? core.h('span', { class: 'pg-nav-sc-e', text: s.emoji }) : null,
          core.h('span', { text: s.label || String(s.target).replace(/^menu:/, '') })
        ])
      );
    });
    const after = menu.querySelector(':scope > .menu-container');
    if (box.parentElement !== menu) {
      if (after && after.nextSibling) menu.insertBefore(box, after.nextSibling);
      else menu.appendChild(box);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Feuille de style                                                    */
  /* ------------------------------------------------------------------ */

  function buildCss(cfg) {
    const U = cfg.ui;
    const out = [];

    // ---- parties masquées
    for (const p of PG.UI_PARTS) {
      if (U.parts[p.key] === false) out.push(scoped(p.sel) + ' { display: none !important; }');
    }

    // ---- bandeau du haut
    const B = U.banner;
    const BAN = ON + ' .ObjetBandeauEspace';
    const h = Math.min(160, Math.max(0, Number(B.height) || 0));
    if (h) {
      const ph = Math.max(20, h - 6);
      out.push(
        BAN + ' { height: ' + h + 'px !important; min-height: 0 !important; }\n' +
          BAN + ' .ibe_util_photo { width: ' + ph + 'px !important; height: ' + ph + 'px !important; }\n' +
          BAN + ' .ibe_image_etab img, ' + BAN + ' .ibe_logo > a { max-height: ' + ph + 'px !important; }\n' +
          BAN + ' .ibe_centre { padding-top: 0 !important; padding-bottom: 0 !important; }'
      );
    }
    if (colorOk(B.bg)) out.push(BAN + ' { background: ' + B.bg + ' !important; }');
    if (B.bg === 'transparent') out.push(BAN + ' { background: transparent !important; }');
    if (colorOk(B.fg)) {
      out.push(BAN + ', ' + BAN + ' .ibe_etab, ' + BAN + ' .ibe_util_texte, ' + BAN + ' .colorFoncee, ' + BAN + ' i { color: ' + B.fg + ' !important; }');
    }
    const k = Math.min(1.8, Math.max(0.6, Number(B.textScale) || 1));
    if (k !== 1) out.push(BAN + ' { --font-size-header: calc(1.6rem * ' + k + ') !important; }');
    if (B.align === 'left' || B.align === 'right') {
      const logo = U.parts['banner.logo'] !== false;
      const pronote = U.parts['banner.pronote'] !== false;
      out.push(
        BAN + ' { justify-content: ' + (B.align === 'left' ? 'flex-start' : 'flex-end') + ' !important; ' +
          (B.align === 'left' ? 'padding-left: ' + (logo ? '27rem' : '1.2rem') : 'padding-right: ' + (pronote ? '17rem' : '1.2rem')) + ' !important; }\n' +
          BAN + ' .ibe_etab_util { align-items: ' + (B.align === 'left' ? 'flex-start' : 'flex-end') + ' !important; text-align: ' + B.align + ' !important; }\n' +
          BAN + ' .ibe_util { justify-content: ' + (B.align === 'left' ? 'flex-start' : 'flex-end') + ' !important; }'
      );
    }
    if (B.title) {
      out.push(
        BAN + ' .ibe_etab > span { font-size: 0 !important; }\n' +
          BAN + ' .ibe_etab > span::after { content: ' + cssString(ui.fill(B.title)) + '; font-size: calc(var(--font-size-header) + 0.4rem); }'
      );
    }
    if (B.subtitle) {
      out.push(
        BAN + ' .ibe_util_texte { font-size: 0 !important; }\n' +
          BAN + ' .ibe_util_texte::after { content: ' + cssString(ui.fill(B.subtitle)) + '; font-size: var(--font-size-header); }'
      );
    }
    if (B.privacy) {
      out.push(
        BAN + ' .ibe_util_photo img { filter: blur(7px) !important; }\n' +
          (B.subtitle ? '' : BAN + ' .ibe_util_texte { filter: blur(5px); }\n') +
          BAN + ' .ibe_util_texte:hover, ' + BAN + ' .ibe_util_photo:hover img { filter: none !important; }'
      );
    }

    // ---- barre de navigation
    const N = U.nav;
    for (const key of Object.keys(N.hidden || {})) {
      if (N.hidden[key]) out.push(ON + ' [data-pg-nav="' + CSS.escape(key) + '"] { display: none !important; }');
    }
    (N.order || []).forEach((key, i) => {
      out.push(ON + ' li[data-pg-nav="' + CSS.escape(key) + '"] { order: ' + (i - 1000) + ' !important; }');
    });
    if (colorOk(N.bg)) out.push(ON + ' ' + MENU + ' { background: ' + N.bg + ' !important; }');
    if (colorOk(N.fg)) {
      out.push(
        ON + ' ' + MENU + ' .item-menu_niveau0 > .label-menu_niveau0, ' + ON + ' ' + MENU + ' .label-home, ' +
          ON + ' ' + MENU + ' .objetBandeauEntete_boutons li i, ' + ON + ' .pg-nav-sc { color: ' + N.fg + ' !important; }'
      );
    }
    const nh = Math.min(90, Math.max(0, Number(N.height) || 0));
    if (nh) out.push(ON + ' ' + MENU + ' { height: ' + nh + 'px !important; min-height: 0 !important; }');

    // ---- bandeau « Page d'accueil »
    const S2 = U.second;
    if (colorOk(S2.bg)) out.push(ON + ' .objetbandeauentete_global .objetBandeauEntete_secondmenu { background: ' + S2.bg + ' !important; --stroke-color: ' + S2.bg + '; }');
    if (colorOk(S2.fg)) {
      out.push(ON + ' .objetBandeauEntete_secondmenu .titre-onglet, ' + ON + ' .objetBandeauEntete_secondmenu .precedenteConnexion, ' + ON + ' .objetBandeauEntete_secondmenu .precedenteConnexion * { color: ' + S2.fg + ' !important; }');
    }

    // ---- cases de lecture
    if (readabilityActive(cfg)) out.push(readabilityCss(cfg));

    return out.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Application                                                         */
  /* ------------------------------------------------------------------ */

  ui.apply = function () {
    const cfg = core.config;
    if (!cfg || !core.tools) return;
    if (!core.enabled()) {
      core.style('ui', '');
      document.querySelectorAll('[data-pg-card]').forEach((el) => el.removeAttribute('data-pg-card'));
      document.querySelectorAll('[data-pg-cardroot]').forEach((el) => el.removeAttribute('data-pg-cardroot'));
      mountShortcuts();
      return;
    }
    if (document.body) {
      const v = readVars();
      if (v.nom || v.etab) vars = v;
    }
    core.style('ui', buildCss(cfg));
    if (document.body) {
      tagNav();
      mountShortcuts();
      clearTimeout(cardTimer);
      cardTimer = setTimeout(tagCards, 30);
    }
  };

  ui.vars = () => Object.assign({}, vars);

  core.on('config', ui.apply);
  core.on('tools', ui.apply);
  document.addEventListener('DOMContentLoaded', () => ui.apply(), { once: true });
  core.onDom(ui.apply, 300);

  core.on('diagnostic', (out) => {
    out.modules.interface = {
      variables: vars,
      onglets: (ui.nav || []).map((n) => n.key + ' (' + n.subs.length + ')'),
      cases: document.querySelectorAll('[data-pg-card]').length
    };
  });
})();
