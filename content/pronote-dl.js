/* Pronote GOAT — module « Téléchargement groupé & export JSON »
 * (repris de l'extension pronote-dl et optimisé)
 *
 * Calé sur la structure réelle de Pronote 2026 (conteneur-titre-liste /
 * conteneur-item / chips-pj / conteneur-ressourcePeda) avec des replis
 * génériques pour les autres versions.
 *
 * Tout s'applique automatiquement : les outils apparaissent à droite des
 * titres « Contenus » et « Ressources pédagogiques ».
 *
 * Optimisations par rapport à la version d'origine :
 *   - plus d'observateur propre : on s'abonne à l'observateur partagé du
 *     noyau (PG.core.onDom), qui ignore nos propres insertions ;
 *   - l'analyse ne tourne que sur la bonne page (test immédiat) : les autres
 *     pages de Pronote ne paient plus le balayage générique du DOM ;
 *   - visibilité testée avec checkVisibility() au lieu de remonter 40
 *     ancêtres avec getComputedStyle pour chaque élément ;
 *   - réglages lus dans le stockage commun de l'extension (pgTools).
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || !PG.core || window.__pdlLoaded) return;
  window.__pdlLoaded = true;
  const core = PG.core;

  /* ------------------------------------------------------------------ */
  /* Réglages                                                            */
  /* ------------------------------------------------------------------ */

  const DEFAULTS = PG.TOOLS_DEFAULTS.downloads;

  let OPT = Object.assign({}, DEFAULTS); // jsonScope : 'contenus' | 'both'

  const state = {
    sections: [], // {kind, titleEl, container, docs[], items[]}
    selected: new Set(), // clés de documents cochés
    busy: false
  };

  /* ------------------------------------------------------------------ */
  /* Sélecteurs Pronote                                                  */
  /* ------------------------------------------------------------------ */

  const P = {
    titre: '[class*="conteneur-titre-liste"]',
    titreTexte: '[class*="ie-titre"]',
    item: '[class*="conteneur-item"]',
    descriptif: '[class*="descriptif"]',
    date: '[class*="titre-date"]',
    chip: '[class*="chips-pj"]',
    lien: 'a[href]',
    groupeMatiere: '[class*="titre-matiere"]',
    matiereSelection:
      '[class*="liste_celluleGrid"].selected [class*="titre-principal"]',
    listeGauche: '[class*="liste_celluleGrid"]'
  };

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  const FILE_RE =
    /\.(pdf|docx?|odt|ott|rtf|pptx?|odp|xlsx?|xls|ods|csv|txt|md|zip|rar|7z|tar|gz|png|jpe?g|gif|bmp|webp|svg|heic|mp3|wav|m4a|ogg|mp4|avi|mkv|mov|webm|epub|ggb|py|ipynb|json|xml)(\?[^\s]*)?$/i;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const textOf = (el) => (el ? norm(el.textContent || '') : '');

  const deaccent = (s) =>
    (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('.pdl-tools, .pdl-pop, .pdl-cb-wrap, [aria-hidden="true"]')) return false;
    return core.visible(el);
  }

  function sanitize(name) {
    return (
      norm(String(name || ''))
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .replace(/\.+$/, '')
        .slice(0, 120) || 'document'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Dates                                                               */
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

  function scholarYear(month) {
    const now = new Date();
    const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    return month >= 7 ? start : start + 1;
  }

  function mkDate(y, m, d) {
    const dt = new Date(y, m, d, 12, 0, 0, 0);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function moisDe(mot) {
    const key = deaccent(mot).replace(/\.$/, '');
    if (MOIS[key] !== undefined) return MOIS[key];
    const hit = Object.keys(MOIS).find((k) => key.startsWith(k) && k.length >= 3);
    return hit !== undefined ? MOIS[hit] : undefined;
  }

  function parseFrDate(txt) {
    if (!txt) return null;
    const t = deaccent(txt);

    const m1 = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (m1) {
      let y = parseInt(m1[3], 10);
      if (y < 100) y += 2000;
      return mkDate(y, parseInt(m1[2], 10) - 1, parseInt(m1[1], 10));
    }

    // « jeu. 17 sept. », « 3 mars 2026 » — on teste toutes les occurrences,
    // un nom de fichier peut contenir « Feuille 2 calculs » qui n'est pas une date.
    const re = /\b(\d{1,2})\s*(?:er)?\s+([a-zé]{3,10})\.?(?:\s+(\d{4}))?/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const mo = moisDe(m[2]);
      if (mo === undefined) continue;
      const y = m[3] ? parseInt(m[3], 10) : scholarYear(mo);
      const d = mkDate(y, mo, parseInt(m[1], 10));
      if (d) return d;
    }
    return null;
  }

  function iso(d) {
    if (!d) return null;
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  function inRange(d) {
    if (!OPT.from && !OPT.to) return true;
    if (!d) return true;
    const s = iso(d);
    if (OPT.from && s < OPT.from) return false;
    if (OPT.to && s > OPT.to) return false;
    return true;
  }

  function dateDe(el, stopAt) {
    // 1) un libellé de date propre à ce bloc, ou juste à côté
    let cur = el;
    for (let up = 0; up < 8 && cur && cur !== document.body; up++, cur = cur.parentElement) {
      let hits = [];
      try {
        hits = [...cur.querySelectorAll(P.date)].filter(
          (h) => textOf(h).length < 60
        );
      } catch (e) {
        /* ignore */
      }
      if (hits.length === 1) {
        const d = parseFrDate(textOf(hits[0]));
        if (d) return d;
      } else if (hits.length > 1) {
        break; // on a dépassé le bloc : plusieurs dates en vue
      }
      if (stopAt && cur === stopAt) break;
    }

    // 2) repli : un texte court ressemblant à une date, avant le bloc
    cur = el;
    for (let up = 0; up < 6 && cur && cur !== document.body; up++, cur = cur.parentElement) {
      let sib = cur.previousElementSibling;
      let guard = 0;
      while (sib && guard++ < 20) {
        const t = textOf(sib);
        if (t && t.length < 120) {
          const d = parseFrDate(t);
          if (d) return d;
        }
        sib = sib.previousElementSibling;
      }
      if (stopAt && cur === stopAt) break;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Contexte Pronote                                                    */
  /* ------------------------------------------------------------------ */

  function pronoteCtx() {
    let ctx = {};
    try {
      const raw = document.documentElement.getAttribute('data-pdl-ctx');
      if (raw) ctx = JSON.parse(raw) || {};
    } catch (e) {
      /* ignore */
    }
    if (!ctx.session) {
      try {
        const a = document.querySelector('a[href*="Session="]');
        if (a) {
          const m = a.href.match(/[?&]Session=(\d+)/i);
          if (m) ctx.session = m[1];
        }
      } catch (e) {
        /* ignore */
      }
    }
    if (!ctx.racine) {
      const m = location.pathname.match(/^(.*\/pronote)\//i);
      ctx.racine = m ? location.origin + m[1] : location.origin;
    }
    return ctx;
  }

  function matiereSelectionnee() {
    const el = document.querySelector(P.matiereSelection);
    const t = textOf(el);
    if (!t || /toutes les matieres/i.test(deaccent(t))) return '';
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Sections                                                            */
  /* ------------------------------------------------------------------ */

  function kindOfTitle(t) {
    const s = deaccent(t);
    if (/ressource/.test(s)) return 'ressources';
    if (/contenu/.test(s)) return 'contenus';
    return null;
  }

  function titreElements() {
    const out = [];
    let cands = [];
    try {
      cands = [...document.querySelectorAll(P.titre)];
    } catch (e) {
      /* ignore */
    }

    for (const el of cands) {
      const lbl = el.querySelector(P.titreTexte);
      const t = textOf(lbl || el);
      const kind = kindOfTitle(t);
      if (kind && isVisible(el)) out.push({ el, kind, label: t });
    }

    if (out.length) return out;

    // Repli : n'importe quel petit élément dont le texte est exactement
    // « Contenus » ou « Ressources pédagogiques ». Ce balayage coûte cher :
    // uniquement quand l'onglet affiché parle de contenus ou de ressources.
    if (!/contenu|ressource/.test(deaccent(textOf(document.querySelector('[class*="titre-onglet"]'))))) {
      return out;
    }
    document.querySelectorAll('h1, h2, h3, div, span, p').forEach((el) => {
      if (el.children.length > 3) return;
      const t = textOf(el);
      if (t.length > 40) return;
      const s = deaccent(t);
      if (/^contenus?$/.test(s) || /^ressources? pedagogiques?$/.test(s)) {
        if (isVisible(el)) out.push({ el, kind: kindOfTitle(t), label: t });
      }
    });
    return out;
  }

  function conteneurDeSection(titleEl, tousLesTitres) {
    // Le plus grand ancêtre qui ne déborde pas sur une autre section
    // ni sur le volet de gauche.
    let best = titleEl.parentElement || titleEl;
    let cur = titleEl.parentElement;

    for (let i = 0; i < 8 && cur && cur !== document.body; i++, cur = cur.parentElement) {
      const autre = tousLesTitres.some((t) => t !== titleEl && cur.contains(t));
      if (autre) break;
      if (cur.querySelector(P.listeGauche)) break;
      if (cur.tagName === 'MAIN' || cur.tagName === 'NAV') break;
      best = cur;
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* Documents                                                           */
  /* ------------------------------------------------------------------ */

  const DOC_FALLBACK = [
    'a[href*="FichiersExternes" i]',
    'a[download]',
    '[class*="pieceJointe" i]',
    '[class*="piece-jointe" i]',
    '[class*="as-pj" i]',
    '[onclick*="PieceJointe" i]',
    '[data-nom-fichier]'
  ];

  function chipsDe(container) {
    let chips = [];
    try {
      chips = [...container.querySelectorAll(P.chip)];
    } catch (e) {
      /* ignore */
    }
    if (chips.length) return chips.filter(isVisible);

    // Repli générique pour les autres versions de Pronote
    const set = new Set();
    for (const sel of DOC_FALLBACK) {
      try {
        container.querySelectorAll(sel).forEach((e) => set.add(e));
      } catch (e) {
        /* ignore */
      }
    }
    container.querySelectorAll('a, span, div, li, td, button').forEach((el) => {
      if (el.children.length > 4) return;
      const t = textOf(el);
      if (t && t.length < 180 && FILE_RE.test(t)) set.add(el);
    });
    const arr = [...set].filter(isVisible);
    return arr.filter((el) => !arr.some((o) => o !== el && el.contains(o)));
  }

  function urlDe(el) {
    const a =
      (el.matches && el.matches('a[href]') && el) ||
      el.querySelector('a[href]') ||
      el.closest('a[href]');
    if (a) {
      const h = a.getAttribute('href') || '';
      if (h && !/^javascript:/i.test(h) && !/^#/.test(h)) {
        try {
          const u = new URL(h, location.href).href;
          if (u !== location.href) return u;
        } catch (e) {
          /* ignore */
        }
      }
    }
    const nodes = [el, el.firstElementChild, el.parentElement].filter(Boolean);
    for (const n of nodes) {
      if (!n.attributes) continue;
      for (const at of n.attributes) {
        const v = at.value || '';
        if (/^https?:\/\//i.test(v) || /FichiersExternes/i.test(v)) {
          try {
            return new URL(v, location.href).href;
          } catch (e) {
            /* ignore */
          }
        }
      }
      const oc = n.getAttribute && n.getAttribute('onclick');
      if (oc) {
        const m =
          oc.match(/["']([^"']*FichiersExternes[^"']*)["']/i) ||
          oc.match(/["'](https?:\/\/[^"']+)["']/i);
        if (m) {
          try {
            return new URL(m[1], location.href).href;
          } catch (e) {
            /* ignore */
          }
        }
      }
    }
    return null;
  }

  function nomDe(el, url) {
    const attr = el.getAttribute('data-nom-fichier') || el.getAttribute('title');
    if (attr && FILE_RE.test(attr)) return norm(attr);

    const t = textOf(el);
    if (t && t.length < 200 && FILE_RE.test(t)) return t;

    if (url) {
      try {
        const base = decodeURIComponent(
          new URL(url).pathname.split('/').filter(Boolean).pop() || ''
        );
        if (base) return base;
      } catch (e) {
        /* ignore */
      }
    }
    return t || 'document';
  }

  function ancrage(el) {
    // Où poser la case à cocher : juste avant la puce du fichier.
    return el.closest(P.chip) || el.closest('[class*="chips"]') || el;
  }

  function matiereDe(el, container, defaut) {
    // Un intertitre de matière au-dessus du document (section Ressources)
    let cur = el;
    for (let up = 0; up < 8 && cur && cur !== document.body; up++, cur = cur.parentElement) {
      let sib = cur.previousElementSibling;
      let guard = 0;
      while (sib && guard++ < 10) {
        if (sib.matches && sib.matches(P.groupeMatiere)) {
          const t = textOf(sib).replace(/\s*\(\d+\)\s*$/, '');
          if (t && t.length < 80 && !/autres documents/i.test(deaccent(t))) return t;
        }
        sib = sib.previousElementSibling;
      }
      if (cur === container) break;
    }
    return defaut || '';
  }

  /* ------------------------------------------------------------------ */
  /* Analyse                                                             */
  /* ------------------------------------------------------------------ */

  function scan() {
    if (!actif()) {
      state.sections = [];
      return;
    }
    const titres = titreElements();
    const els = titres.map((t) => t.el);
    const matiereCourante = matiereSelectionnee();
    const sections = [];

    for (const t of titres) {
      const container = conteneurDeSection(t.el, els);
      const docs = [];

      for (const chip of chipsDe(container)) {
        const url = urlDe(chip);
        const nom = nomDe(chip, url);
        if (!nom) continue;
        if (!FILE_RE.test(nom) && !(url && FILE_RE.test(url))) continue; // un lien web n'est pas un fichier
        const d = {
          el: chip,
          ancre: ancrage(chip),
          nom,
          url,
          section: t.kind,
          matiere: matiereDe(chip, container, matiereCourante),
          date: dateDe(chip, container)
        };
        d.cle = (url || '') + '|' + d.nom + '|' + t.kind;
        docs.push(d);
      }

      const items = t.kind === 'contenus' ? coursDe(container, matiereCourante, docs) : [];

      sections.push({
        kind: t.kind,
        label: t.label,
        titleEl: t.el,
        container,
        docs,
        items
      });
    }

    state.sections = sections;
    state.matiereCourante = matiereCourante;
  }

  function coursDe(container, matiereCourante, docs) {
    let blocs = [];
    try {
      blocs = [...container.querySelectorAll(P.item)].filter(isVisible);
    } catch (e) {
      /* ignore */
    }
    blocs = blocs.filter((b) => !blocs.some((o) => o !== b && o.contains(b)));

    return blocs.map((b) => {
      const dEl = b.querySelector(P.date);
      const date = dEl ? parseFrDate(textOf(dEl)) : dateDe(b, container);
      const desc = b.querySelector(P.descriptif);
      let contenu = '';
      if (desc) {
        contenu = norm(desc.innerText || desc.textContent || '')
          .replace(/ /g, ' ')
          .trim();
        // on retrouve les retours à la ligne d'origine
        const lignes = [...desc.children]
          .map((c) => norm(c.innerText || c.textContent || ''))
          .filter((x) => x);
        if (lignes.length > 1) contenu = lignes.join('\n');
      }
      const res = docs
        .filter((d) => b.contains(d.el))
        .map((d) => ({ nom: d.nom, url: d.url }));

      let brut = norm(b.innerText || b.textContent || '');
      if (brut.length > 4000) brut = brut.slice(0, 4000) + '…';

      return {
        date: iso(date),
        jour: date ? JOURS[date.getDay()] : null,
        // un intertitre de matière prime sur la sélection de gauche
        // (cas « Toutes les matières »)
        matiere: matiereDe(b, container, matiereCourante) || null,
        contenu: contenu || null,
        ressources: res,
        texte_brut: brut,
        _date: date,
        _el: b
      };
    });
  }

  const docsVisibles = (s) => s.docs.filter((d) => inRange(d.date));
  const coursVisibles = (s) => s.items.filter((c) => inRange(c._date));

  /* ------------------------------------------------------------------ */
  /* Icônes                                                              */
  /* ------------------------------------------------------------------ */

  const ICO = {
    dl:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M7.25 1h1.5v6.19l2.22-2.22 1.06 1.06L8 10.06 3.97 6.03l1.06-1.06 2.22 2.22V1z"/><path d="M2 12.5h12V14H2z"/></svg>',
    cal:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 1v1h6V1h1.5v1H14a1 1 0 011 1v10a1 1 0 01-1 1H2a1 1 0 01-1-1V3a1 1 0 011-1h1.5V1H5zm8.5 5h-11v7h11V6z"/><path d="M4 7.5h2.5V10H4zM6.75 7.5h2.5V10h-2.5zM9.5 7.5H12V10H9.5z"/></svg>',
    json:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 1.5v1.2h-.6c-.6 0-.9.3-.9.9v1.7c0 .7-.3 1.2-.9 1.5v.4c.6.3.9.8.9 1.5v1.7c0 .6.3.9.9.9H6V13h-.9c-1.2 0-1.9-.7-1.9-1.9V9.6c0-.5-.3-.8-.8-.8H2V7.2h.4c.5 0 .8-.3.8-.8V4.4c0-1.2.7-2.1 1.9-2.1H6zM10 1.5v1.2h.6c.6 0 .9.3.9.9v1.7c0 .7.3 1.2.9 1.5v.4c-.6.3-.9.8-.9 1.5v1.7c0 .6-.3.9-.9.9H10V13h.9c1.2 0 1.9-.7 1.9-1.9V9.6c0-.5.3-.8.8-.8h.4V7.2h-.4c-.5 0-.8-.3-.8-.8V4.4c0-1.2-.7-2.1-1.9-2.1H10z"/></svg>'
  };

  /* ------------------------------------------------------------------ */
  /* Outils injectés à droite des titres                                 */
  /* ------------------------------------------------------------------ */

  let injecting = false;
  let lastInject = 0;

  function outilsDe(section) {
    let tools = section.titleEl.querySelector(':scope > .pdl-tools');
    if (tools) return tools;

    tools = document.createElement('span');
    tools.className = 'pdl-tools';
    tools.dataset.pdlKind = section.kind;

    const btn = (cls, html, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pdl-b ' + cls;
      b.innerHTML = html;
      b.title = title;
      b.setAttribute('aria-label', title);
      return b;
    };

    const all = document.createElement('label');
    all.className = 'pdl-b pdl-all';
    all.title = 'Tout sélectionner dans cette section';
    all.innerHTML = '<input type="checkbox">';

    const dl = btn('pdl-dl', ICO.dl + '<span class="pdl-n"></span>', 'Télécharger');
    const cal = btn('pdl-cal', ICO.cal, 'Choisir la période');

    tools.appendChild(all);
    tools.appendChild(dl);

    if (section.kind === 'contenus') {
      tools.appendChild(
        btn(
          'pdl-json',
          ICO.json + '<span class="pdl-lbl">JSON</span>',
          'Exporter les cours en JSON'
        )
      );
    }
    tools.appendChild(cal);

    const st = document.createElement('span');
    st.className = 'pdl-st';
    tools.appendChild(st);

    section.titleEl.appendChild(tools);

    // Câblage
    all.querySelector('input').addEventListener('change', (e) => {
      e.stopPropagation();
      const sec = sectionDe(tools);
      if (!sec) return;
      for (const d of docsVisibles(sec)) {
        if (e.target.checked) state.selected.add(d.cle);
        else state.selected.delete(d.cle);
      }
      sync();
    });
    all.addEventListener('click', (e) => e.stopPropagation());

    dl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sec = sectionDe(tools);
      if (sec) lancerTelechargement(sec);
    });

    const jsonBtn = tools.querySelector('.pdl-json');
    if (jsonBtn) {
      jsonBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        menuJson(jsonBtn);
      });
    }

    cal.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      popoverPeriode(cal);
    });

    tools.addEventListener('click', (e) => e.stopPropagation());
    return tools;
  }

  function sectionDe(toolsEl) {
    const kind = toolsEl.dataset.pdlKind;
    return state.sections.find((s) => s.kind === kind) || null;
  }

  function majOutils(section) {
    const tools = outilsDe(section);
    const docs = docsVisibles(section);
    const sel = docs.filter((d) => state.selected.has(d.cle));

    const n = tools.querySelector('.pdl-n');
    if (n) n.textContent = sel.length ? String(sel.length) : String(docs.length);

    const dl = tools.querySelector('.pdl-dl');
    dl.disabled = state.busy || docs.length === 0;
    dl.title = sel.length
      ? 'Télécharger les ' + sel.length + ' document(s) cochés'
      : 'Télécharger les ' + docs.length + ' document(s) affichés';
    dl.classList.toggle('pdl-on', sel.length > 0);

    const cb = tools.querySelector('.pdl-all input');
    cb.checked = docs.length > 0 && sel.length === docs.length;
    cb.indeterminate = sel.length > 0 && sel.length < docs.length;

    const cal = tools.querySelector('.pdl-cal');
    const actif = !!(OPT.from || OPT.to);
    cal.classList.toggle('pdl-on', actif);
    cal.title = actif ? 'Période : ' + libellePeriode() : 'Toute la période — cliquer pour restreindre';

    const jsonBtn = tools.querySelector('.pdl-json');
    if (jsonBtn) {
      const nc = coursVisibles(section).length;
      jsonBtn.disabled = state.busy || nc === 0;
      jsonBtn.title = 'Exporter ' + nc + ' cours en JSON';
    }
  }

  function libellePeriode() {
    if (!OPT.from && !OPT.to) return 'tout';
    const f = (s) => (s ? s.split('-').reverse().join('/') : '…');
    return f(OPT.from) + ' → ' + f(OPT.to);
  }

  function statut(section, msg, kind) {
    const tools = section.titleEl.querySelector(':scope > .pdl-tools');
    const st = tools && tools.querySelector('.pdl-st');
    if (!st) return;
    st.textContent = msg || '';
    st.className = 'pdl-st' + (kind ? ' pdl-' + kind : '');
  }

  /* ------------------------------------------------------------------ */
  /* Cases à cocher                                                      */
  /* ------------------------------------------------------------------ */

  function actif() {
    return !!(core.tools && core.tools.downloads && core.tools.downloads.enabled !== false);
  }

  function sync() {
    injecting = true;
    try {
      if (!actif()) {
        document.querySelectorAll('.pdl-tools[data-pdl-kind], .pdl-cb-wrap').forEach((n) => n.remove());
        return;
      }
      const vivants = new Set();

      for (const section of state.sections) {
        majOutils(section);
        for (const d of docsVisibles(section)) {
          vivants.add(d.ancre);
          poserCase(d);
        }
      }

      document.querySelectorAll('.pdl-cb-wrap').forEach((w) => {
        const cible = w.dataset.pdlIn === '1' ? w.parentElement : w.nextElementSibling;
        if (!cible || !vivants.has(cible)) w.remove();
      });
    } finally {
      injecting = false;
      lastInject = Date.now();
    }
  }

  function dedans(ancre) {
    // On pose la case À L'INTÉRIEUR de la puce quand c'est sans risque : la
    // puce est un conteneur flex, la case se range donc à gauche du fichier.
    // Dans un lien ou un bouton, on la pose juste avant pour ne pas déclencher
    // l'ouverture du document au clic.
    if (/^(a|button|label)$/i.test(ancre.tagName)) return false;
    if (ancre.hasAttribute('onclick')) return false;
    return true;
  }

  function poserCase(d) {
    const ancre = d.ancre;
    if (!ancre || !ancre.parentNode) return;

    const interne = dedans(ancre);
    let wrap = interne ? ancre.firstElementChild : ancre.previousElementSibling;
    const ok = wrap && wrap.classList && wrap.classList.contains('pdl-cb-wrap');

    if (!ok) {
      wrap = document.createElement('span');
      wrap.className = 'pdl-cb-wrap';
      wrap.dataset.pdlIn = interne ? '1' : '0';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'pdl-cb';
      const mark = document.createElement('span');
      mark.className = 'pdl-mark';
      wrap.appendChild(cb);
      wrap.appendChild(mark);
      try {
        if (interne) ancre.insertBefore(wrap, ancre.firstChild);
        else ancre.parentNode.insertBefore(wrap, ancre);
      } catch (e) {
        return;
      }
      cb.addEventListener('change', (ev) => {
        ev.stopPropagation();
        const cle = wrap.dataset.pdlKey;
        if (cb.checked) state.selected.add(cle);
        else state.selected.delete(cle);
        state.sections.forEach(majOutils);
      });
      cb.addEventListener('click', (ev) => ev.stopPropagation());
    }

    wrap.dataset.pdlKey = d.cle;
    wrap.title = d.nom;
    const cb = wrap.querySelector('.pdl-cb');
    if (cb) cb.checked = state.selected.has(d.cle);
  }

  function marque(d, symbole, titre) {
    if (!d.ancre) return;
    const wrap = dedans(d.ancre)
      ? d.ancre.firstElementChild
      : d.ancre.previousElementSibling;
    if (wrap && wrap.classList && wrap.classList.contains('pdl-cb-wrap')) {
      const m = wrap.querySelector('.pdl-mark');
      if (m) {
        m.textContent = symbole || '';
        m.title = titre || '';
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Popovers                                                            */
  /* ------------------------------------------------------------------ */

  let pop = null;
  let popAncre = null;

  function fermerPop() {
    if (pop && pop.isConnected) pop.remove();
    pop = null;
    popAncre = null;
  }

  function placerPop() {
    if (!pop || !popAncre || !popAncre.isConnected) return;
    const r = popAncre.getBoundingClientRect();
    const w = pop.offsetWidth || 240;
    const h = pop.offsetHeight || 240;
    let left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  function ouvrirPop(ancre, html) {
    fermerPop();
    pop = document.createElement('div');
    pop.className = 'pdl-pop';
    pop.innerHTML = html;
    document.body.appendChild(pop);

    popAncre = ancre;
    placerPop();
    pop.addEventListener('click', (e) => e.stopPropagation());
    return pop;
  }

  document.addEventListener(
    'click',
    (e) => {
      // un clic DANS le popover ne doit pas le refermer
      if (pop && pop.isConnected && !pop.contains(e.target)) fermerPop();
    },
    true
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fermerPop();
  });
  document.addEventListener('scroll', () => placerPop(), true);
  window.addEventListener('resize', () => placerPop());

  function popoverPeriode(ancre) {
    const p = ouvrirPop(
      ancre,
      [
        '<div class="pdl-pop-t">Période prise en compte</div>',
        '<label>Du <input type="date" class="pdl-from"></label>',
        '<label>Au <input type="date" class="pdl-to"></label>',
        '<div class="pdl-presets">',
        '<button type="button" data-p="7">7 jours</button>',
        '<button type="button" data-p="30">30 jours</button>',
        '<button type="button" data-p="week">Cette semaine</button>',
        '<button type="button" data-p="all">Tout</button>',
        '</div>',
        '<div class="pdl-pop-a"><button type="button" class="pdl-apply">Appliquer</button></div>'
      ].join('')
    );

    p.querySelector('.pdl-from').value = OPT.from || '';
    p.querySelector('.pdl-to').value = OPT.to || '';

    p.querySelectorAll('.pdl-presets button').forEach((b) => {
      b.addEventListener('click', () => {
        const now = new Date();
        const f = p.querySelector('.pdl-from');
        const t = p.querySelector('.pdl-to');
        if (b.dataset.p === 'all') {
          f.value = '';
          t.value = '';
        } else if (b.dataset.p === 'week') {
          const jour = (now.getDay() + 6) % 7;
          const lundi = new Date(now);
          lundi.setDate(now.getDate() - jour);
          f.value = iso(lundi);
          t.value = iso(now);
        } else {
          const n = parseInt(b.dataset.p, 10);
          const from = new Date(now);
          from.setDate(now.getDate() - n);
          f.value = iso(from);
          t.value = iso(now);
        }
      });
    });

    p.querySelector('.pdl-apply').addEventListener('click', () => {
      OPT.from = p.querySelector('.pdl-from').value || '';
      OPT.to = p.querySelector('.pdl-to').value || '';
      save({ from: OPT.from, to: OPT.to });
      fermerPop();
      sync();
    });
  }

  function menuJson(ancre) {
    const p = ouvrirPop(
      ancre,
      [
        '<div class="pdl-pop-t">Exporter les cours affichés</div>',
        '<button type="button" class="pdl-mi" data-s="contenus">Contenus seuls</button>',
        '<button type="button" class="pdl-mi" data-s="both">Contenus + ressources</button>',
        '<div class="pdl-note">Période : ' + libellePeriode() + '</div>'
      ].join('')
    );
    p.querySelectorAll('.pdl-mi').forEach((b) => {
      b.addEventListener('click', () => {
        OPT.jsonScope = b.dataset.s;
        save({ jsonScope: OPT.jsonScope });
        fermerPop();
        exporterJson();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Téléchargement                                                      */
  /* ------------------------------------------------------------------ */

  function chemin(d) {
    const base = sanitize(d.nom);
    if (!OPT.useSubfolders) return base;
    const parts = [];
    if (OPT.folder) parts.push(sanitize(OPT.folder));
    if (d.matiere) parts.push(sanitize(d.matiere));
    const prefix = d.date && d.section === 'contenus' ? iso(d.date) + ' - ' : '';
    parts.push(sanitize(prefix + base));
    return parts.join('/');
  }

  function bg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(r || { ok: false, error: 'pas de réponse' });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 15000);
  }

  async function fetchFichier(url) {
    try {
      const res = await fetch(url, { credentials: 'include', redirect: 'follow' });
      if (!res.ok) return null;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const blob = await res.blob();
      if (/text\/html/.test(ct) && blob.size < 200000) return null;
      if (blob.size === 0) return null;
      return blob;
    } catch (e) {
      return null;
    }
  }

  async function telechargerUn(d) {
    const path = chemin(d);

    if (d.url) {
      if (OPT.useSubfolders) {
        const r = await bg({
          type: 'pdl-download',
          url: d.url,
          filename: path,
          saveAs: OPT.askEachFile
        });
        if (r && r.ok) return { ok: true };
      }
      const blob = await fetchFichier(d.url);
      if (blob) {
        saveBlob(blob, sanitize(d.nom));
        return { ok: true };
      }
      const r2 = await bg({
        type: 'pdl-download',
        url: d.url,
        filename: OPT.useSubfolders ? path : sanitize(d.nom),
        saveAs: OPT.askEachFile
      });
      if (r2 && r2.ok) return { ok: true };
    }

    if (OPT.clickFallback) {
      try {
        const cible = d.el.querySelector('a, button') || d.el;
        const o = { bubbles: true, cancelable: true, view: window };
        cible.dispatchEvent(new MouseEvent('mousedown', o));
        cible.dispatchEvent(new MouseEvent('mouseup', o));
        cible.dispatchEvent(new MouseEvent('click', o));
        return { ok: true, via: 'clic' };
      } catch (e) {
        /* ignore */
      }
    }
    return { ok: false, error: 'aucune URL exploitable' };
  }

  async function lancerTelechargement(section) {
    if (state.busy) return;
    const docs = docsVisibles(section);
    const sel = docs.filter((d) => state.selected.has(d.cle));
    let liste = sel.length ? sel : docs;

    // un même fichier peut figurer dans les deux sections
    const vus = new Set();
    liste = liste.filter((d) => {
      const k = d.url || d.nom;
      if (vus.has(k)) return false;
      vus.add(k);
      return true;
    });

    if (!liste.length) {
      statut(section, 'rien à télécharger', 'warn');
      return;
    }

    state.busy = true;
    state.sections.forEach(majOutils);

    let ok = 0;
    let ko = 0;
    for (let i = 0; i < liste.length; i++) {
      const d = liste[i];
      statut(section, i + 1 + '/' + liste.length);
      marque(d, '⏳', 'en cours');
      const r = await telechargerUn(d);
      if (r.ok) {
        ok++;
        marque(d, '✅', r.via === 'clic' ? 'ouvert (pas d\'URL directe)' : 'téléchargé');
      } else {
        ko++;
        marque(d, '⚠️', r.error || 'échec');
      }
      if (i < liste.length - 1) await sleep(Math.max(150, OPT.delay | 0));
    }

    state.busy = false;
    statut(section, ok + ' ✓' + (ko ? ' · ' + ko + ' ✗' : ''), ko ? 'warn' : 'ok');
    state.sections.forEach(majOutils);
    setTimeout(() => statut(section, ''), 6000);
  }

  /* ------------------------------------------------------------------ */
  /* Export JSON                                                         */
  /* ------------------------------------------------------------------ */

  function exporterJson() {
    const secC = state.sections.find((s) => s.kind === 'contenus');
    const secR = state.sections.find((s) => s.kind === 'ressources');
    const cours = secC ? coursVisibles(secC) : [];

    const payload = {
      genere_le: new Date().toISOString(),
      source: location.href,
      portee: OPT.jsonScope === 'both' ? 'contenus + ressources' : 'contenus',
      periode: { du: OPT.from || null, au: OPT.to || null },
      matiere_affichee: state.matiereCourante || 'toutes les matières',
      nb_cours: cours.length,
      cours: cours.map((c) => ({
        date: c.date,
        jour: c.jour,
        matiere: c.matiere,
        contenu: c.contenu,
        ressources: c.ressources,
        texte_brut: c.texte_brut
      }))
    };

    if (OPT.jsonScope === 'both' && secR) {
      const docs = docsVisibles(secR);
      payload.nb_ressources = docs.length;
      payload.ressources_pedagogiques = docs.map((d) => ({
        nom: d.nom,
        url: d.url,
        matiere: d.matiere || null,
        date: iso(d.date)
      }));
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const mat = state.matiereCourante
      ? '-' + sanitize(state.matiereCourante).toLowerCase().replace(/\s+/g, '-')
      : '';
    saveBlob(blob, 'pronote' + mat + '-' + iso(new Date()) + '.json');
    if (secC) {
      statut(secC, cours.length + ' cours exportés', 'ok');
      setTimeout(() => statut(secC, ''), 6000);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Diagnostic (Alt + clic sur l'icône période)                         */
  /* ------------------------------------------------------------------ */

  function diagnostic() {
    const ctx = pronoteCtx();
    const ex = (el) => {
      let h = (el && el.outerHTML) || '';
      return h.length > 800 ? h.slice(0, 800) + '…' : h;
    };
    const lignes = ['# Diagnostic Pronote DL', 'URL : ' + location.href,
      'Session : ' + (ctx.session || '?'),
      'Matière sélectionnée : ' + (state.matiereCourante || '(toutes)'),
      'Sections : ' + state.sections.map((s) => s.kind + '(' + s.docs.length + ' docs, ' + s.items.length + ' cours)').join(', ')];
    for (const s of state.sections) {
      lignes.push('', '## ' + s.kind, 'conteneur : ' + (s.container.className || s.container.id));
      if (s.docs[0]) lignes.push('doc 1 : ' + s.docs[0].nom + ' | url ' + (s.docs[0].url || 'aucune') + ' | ' + iso(s.docs[0].date), ex(s.docs[0].el));
      if (s.items[0]) lignes.push('cours 1 : ' + JSON.stringify({ date: s.items[0].date, contenu: (s.items[0].contenu || '').slice(0, 80) }));
    }
    const txt = lignes.join('\n');
    navigator.clipboard.writeText(txt).catch(() => console.log(txt));
    const sec = state.sections[0];
    if (sec) {
      statut(sec, 'diagnostic copié', 'ok');
      setTimeout(() => statut(sec, ''), 5000);
    }
  }

  document.addEventListener(
    'click',
    (e) => {
      const b = e.target.closest && e.target.closest('.pdl-cal');
      if (b && e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        fermerPop();
        diagnostic();
      }
    },
    true
  );

  /* ------------------------------------------------------------------ */
  /* Réglages persistants                                                */
  /* ------------------------------------------------------------------ */

  function save(patch) {
    core.setTools({ downloads: patch });
  }

  // Réglages communs (popup ⇄ page) : toute modification arrive par le noyau
  core.on('tools', (tools) => {
    OPT = Object.assign({}, DEFAULTS, (tools && tools.downloads) || {});
    if (!document.body) return;
    scan();
    sync();
  });

  /* ------------------------------------------------------------------ */
  /* Boucle                                                              */
  /* ------------------------------------------------------------------ */

  let timer = null;
  function planifier(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (state.busy) return planifier(900);
      scan();
      sync();
    }, ms || 400);
  }

  // Observateur partagé du noyau : nos propres insertions sont déjà filtrées.
  core.onDom(() => {
    if (injecting || state.busy) return;
    if (Date.now() - lastInject < 200) return planifier(250);
    planifier(10);
  }, 400);

  core.on('diagnostic', (out) => {
    out.modules.telechargement = {
      actif: actif(),
      sections: state.sections.map((s) => s.kind + ' : ' + s.docs.length + ' docs, ' + s.items.length + ' cours')
    };
  });
})();
