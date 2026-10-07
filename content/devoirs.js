/* Pronote GOAT — module « Devoirs personnels »
 * (repris de l'extension pronote-dl et branché sur le noyau commun)
 *
 * Ajoute des devoirs « maison » dans la page Travail à faire et dans le widget
 * de la page d'accueil, avec le rendu natif de Pronote.
 *
 * Méthode : on CLONE un devoir existant de la page et on réécrit son contenu.
 * Le design suit donc Pronote automatiquement, même après une mise à jour.
 *
 * Rendu incrémental : un devoir déjà affiché n'est jamais reconstruit, on ne
 * touche que ce qui change. Pas de reflow, pas de saut de page, réaction
 * immédiate.
 *
 * Les devoirs sont stockés dans chrome.storage.local : rien n'est envoyé à
 * Pronote, ils n'existent que dans le navigateur.
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || !PG.core || window.__pdlDevoirsLoaded) return;
  window.__pdlDevoirsLoaded = true;
  const core = PG.core;

  // module activable depuis le popup (Outils › Devoirs personnels)
  const actif = () => !!(core.tools && core.tools.devoirs && core.tools.devoirs.enabled !== false);

  const KEY = 'pdlDevoirs';
  const KEY_MAT = 'pdlMatieres';

  let devoirs = [];
  let matieres = {};
  let signature = ''; // pour ignorer l'écho de nos propres écritures

  // Matières toujours proposées, même si aucun devoir de cette matière n'est
  // affiché. Les couleurs relevées sur Pronote priment sur celles-ci.
  const MATIERES_BASE = {
    MATHEMATIQUES: '#06F931',
    'PHYSIQUE-CHIMIE': '#1E9BE8'
  };

  // « mode:id » → { li, item, groupe, date }
  const noeuds = new Map();

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const textOf = (el) => (el ? norm(el.textContent || '') : '');
  const p2 = (n) => String(n).padStart(2, '0');

  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const JOURS_C = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const MOIS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MOIS_C = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.',
    'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  function dDe(isoStr) {
    if (!isoStr) return null;
    const m = String(isoStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  const isoDe = (d) =>
    d ? d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) : '';

  const auj = () => isoDe(new Date());

  const longue = (d) => JOURS[d.getDay()] + ' ' + p2(d.getDate()) + ' ' + MOIS_L[d.getMonth()];
  const courte = (d) => JOURS_C[d.getDay()] + ' ' + p2(d.getDate()) + ' ' + MOIS_C[d.getMonth()];
  // en-têtes du widget d'accueil : jour en entier, mois abrégé
  const moyenne = (d) => JOURS[d.getDay()] + ' ' + p2(d.getDate()) + ' ' + MOIS_C[d.getMonth()];

  const idDate = (d) => p2(d.getDate()) + p2(d.getMonth() + 1) + d.getFullYear();

  const uid = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const visible = core.visible;

  // n'écrit que si la valeur change : une écriture inutile réveille les
  // observateurs de Pronote comme les nôtres
  function setTxt(node, v) {
    if (node && node.textContent !== v) node.textContent = v;
  }

  function setCls(node, cls, on) {
    if (node && node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
  }

  function setAttr(node, nom, v) {
    if (node && node.getAttribute(nom) !== v) node.setAttribute(nom, v);
  }

  /* ------------------------------------------------------------------ */
  /* Stockage                                                            */
  /* ------------------------------------------------------------------ */

  function charger() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [KEY]: [], [KEY_MAT]: {} }, (v) => {
          if (!chrome.runtime.lastError && v) {
            devoirs = Array.isArray(v[KEY]) ? v[KEY] : [];
            matieres = v[KEY_MAT] || {};
            signature = JSON.stringify(devoirs);
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  function enregistrer() {
    signature = JSON.stringify(devoirs);
    try {
      chrome.storage.local.set({ [KEY]: devoirs });
    } catch (e) {
      /* ignore */
    }
  }

  function enregistrerMatieres() {
    try {
      chrome.storage.local.set({ [KEY_MAT]: matieres });
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Catalogue des matières                                              */
  /* ------------------------------------------------------------------ */

  function couleurDans(style, prop) {
    if (!style) return null;
    const m = style.match(new RegExp(prop + '\\s*:\\s*(#[0-9a-fA-F]{3,8})'));
    return m ? m[1] : null;
  }

  let dernierGlanage = 0;

  function glanerMatieres(force) {
    if (!force && Date.now() - dernierGlanage < 5000) return;
    dernierGlanage = Date.now();
    const avant = JSON.stringify(matieres);

    for (const [nom, col] of Object.entries(MATIERES_BASE)) {
      if (!matieres[nom]) matieres[nom] = col;
    }

    document.querySelectorAll('[class*="titre-matiere"]').forEach((t) => {
      if (t.closest('.pdl-perso')) return;
      const nom = textOf(t).replace(/\s*\(\d+\)\s*$/, '');
      if (!nom || nom.length > 60) return;
      let col = null;
      const wc = t.closest('[style*="--couleur-matiere"]');
      if (wc) col = couleurDans(wc.getAttribute('style'), '--couleur-matiere');
      if (!col) {
        const box = t.closest('[class*="flex-contain"]') || t.parentElement;
        const past = box && box.querySelector('[style*="background-color"]');
        if (past) col = couleurDans(past.getAttribute('style'), 'background-color');
      }
      if (col) matieres[nom] = col;
      else if (!(nom in matieres)) matieres[nom] = null;
    });

    document.querySelectorAll('[class*="trait-matiere"][style*="background-color"]').forEach((tm) => {
      const box = tm.parentElement;
      const lib = box && box.querySelector('[class*="libelle-cours"]');
      const nom = textOf(lib);
      if (!nom || nom.length > 60 || /pas de cours/i.test(nom)) return;
      const col = couleurDans(tm.getAttribute('style'), 'background-color');
      if (col) matieres[nom] = col;
    });

    document.querySelectorAll('[class*="liste_contenu_ligne"]').forEach((row) => {
      const lib = row.querySelector('[class*="titre-principal"]');
      const nom = textOf(lib);
      const plat = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (!nom || nom.length > 60 || /toutes les matieres/.test(plat)) return;
      const line = row.querySelector('[style*="--color-line"]');
      const col = line ? couleurDans(line.getAttribute('style'), '--color-line') : null;
      if (col) matieres[nom] = col;
      else if (!(nom in matieres)) matieres[nom] = null;
    });

    if (JSON.stringify(matieres) !== avant) enregistrerMatieres();
  }

  /* ------------------------------------------------------------------ */
  /* Repérage des zones                                                  */
  /* ------------------------------------------------------------------ */

  function zoneTAF() {
    const ul = document.querySelector('ul[class*="liste-date"]');
    if (!ul || !visible(ul)) return null;
    if (!ul.querySelector('[data-iddate], h2')) return null;
    const t = textOf(document.querySelector('[class*="titre-onglet"]')).toLowerCase();
    if (t && !/travail/.test(t)) return null;
    return ul;
  }

  function zoneWidget() {
    const sec = document.querySelector('section[class*="travailafaire"]');
    if (!sec || !visible(sec)) return null;
    return sec.querySelector('ul[class*="liste-imbriquee"]') || null;
  }

  /* ------------------------------------------------------------------ */
  /* Gabarits                                                            */
  /* ------------------------------------------------------------------ */

  const GABARIT_TAF = `
<div class="conteneur-item">
  <div class="entete-element">
    <div class="flex-contain">
      <div style="background-color:#888;margin-right:0.8rem;padding:0.2rem;border-radius:0.4rem;"></div>
      <div>
        <h3 class="titre-matiere"></h3>
        <p class="ie-sous-titre"></p>
      </div>
    </div>
    <div><div class="tag-style ie-chips"><span class="text ie_ellipsis"></span></div></div>
  </div>
  <div class="entete-element"><div class="clear"></div></div>
  <div class="conteneur-descriptif">
    <div class="description tiny-view"><div></div></div>
    <div class="no-fixed fluid-bloc"></div>
  </div>
</div>`;

  const GABARIT_WIDGET = `
<div class="wrap conteneur-item">
  <div class="as-header">
    <div class="with-color" style="--couleur-matiere:#888;margin-left:.8rem;">
      <span class="titre-matiere"></span>
    </div>
    <div class="tag-style fix-bloc ie-chips"><span class="text ie_ellipsis"></span></div>
  </div>
  <div class="m-left">
    <div class="as-content"><div class="description widgetTAF tiny-view"><div></div></div></div>
  </div>
</div>`;

  function gabarit(zone, mode) {
    const modele = zone.querySelector('[class*="conteneur-item"]:not(.pdl-perso)');
    if (modele) {
      const c = modele.cloneNode(true);
      c.querySelectorAll(
        '[class*="btnCours"], [class*="piece-jointe"], [class*="taf-a-rendre"],' +
          ' [class*="chips-pj"], .pdl-cb-wrap, .pdl-actions, [class*="conteneur-cb"]'
      ).forEach((n) => n.remove());
      return c;
    }
    const d = document.createElement('div');
    d.innerHTML = (mode === 'widget' ? GABARIT_WIDGET : GABARIT_TAF).trim();
    return d.firstElementChild;
  }

  function gabaritCb(zone) {
    const modele = zone.querySelector('[class*="conteneur-cb"]:not(.pdl-perso [class*="conteneur-cb"])');
    if (!modele || modele.closest('.pdl-perso')) {
      const autre = [...zone.querySelectorAll('[class*="conteneur-cb"]')].find(
        (n) => !n.closest('.pdl-perso')
      );
      return autre ? autre.cloneNode(true) : null;
    }
    return modele.cloneNode(true);
  }

  /* ------------------------------------------------------------------ */
  /* Mise à jour d'un devoir déjà affiché                                */
  /* ------------------------------------------------------------------ */

  function majItem(item, dev) {
    const col = dev.couleur || matieres[dev.matiere] || '#9aa7b4';

    const wc = item.querySelector('[style*="--couleur-matiere"]');
    if (wc) {
      setAttr(wc, 'style', '--couleur-matiere:' + col + ';margin-left:.8rem;');
    } else {
      const pastille = item.querySelector('[style*="background-color"]');
      if (pastille) {
        setAttr(
          pastille,
          'style',
          'background-color:' + col + ';margin-right:0.8rem;padding:0.2rem;border-radius:0.4rem;'
        );
      }
    }

    const h = item.querySelector('[class*="titre-matiere"]');
    setTxt(h, dev.matiere || 'DEVOIR');
    setCls(h, 'est-fait', dev.fait);

    const sous = item.querySelector('[class*="ie-sous-titre"]');
    if (sous) {
      const dd = dDe(dev.donneLe);
      const dr = dDe(dev.date);
      let txt = '';
      if (dd) {
        txt = 'Donné le ' + courte(dd);
        if (dr) {
          const n = Math.max(0, Math.round((dr - dd) / 86400000));
          txt += ' [' + n + (n > 1 ? ' Jours' : ' Jour') + ']';
        }
      }
      setTxt(sous, txt);
      const d = txt ? '' : 'none';
      if (sous.style.display !== d) sous.style.display = d;
    }

    const tag = item.querySelector('[class*="tag-style"]');
    if (tag) {
      setCls(tag, 'color-theme', dev.fait);
      setTxt(tag.querySelector('span'), dev.fait ? 'Fait' : 'Non Fait');
    }

    const desc = item.querySelector('[class*="description"]');
    if (desc) {
      setCls(desc, 'est-fait', dev.fait);
      const lignes = String(dev.texte || '').split(/\n/);
      const actuelles = [...desc.children].map((c) => c.textContent);
      if (actuelles.length !== lignes.length || actuelles.some((t, i) => t !== lignes[i])) {
        desc.textContent = '';
        for (const l of lignes) {
          const d = document.createElement('div');
          d.textContent = l;
          desc.appendChild(d);
        }
      }
      const parent = desc.parentElement;
      if (parent && parent.classList) setCls(parent, 'done', dev.fait);
    }

    const lab = item.querySelector('[class*="conteneur-cb"] label');
    setCls(lab, 'is-checked', dev.fait);
    const input = item.querySelector('[class*="conteneur-cb"] input');
    if (input && input.checked !== !!dev.fait) input.checked = !!dev.fait;
  }

  /* ------------------------------------------------------------------ */
  /* Construction d'un devoir                                            */
  /* ------------------------------------------------------------------ */

  function construire(dev, zone, mode) {
    const item = gabarit(zone, mode);
    if (!item) return null;

    item.classList.add('pdl-perso');
    item.setAttribute('data-pdl-devoir', dev.id);
    item.removeAttribute('id');
    item.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));

    const head = item.querySelector('[class*="as-header"]');
    if (head) {
      head.removeAttribute('role');
      head.removeAttribute('tabindex');
      head.removeAttribute('aria-haspopup');
    }
    const desc = item.querySelector('[class*="description"]');
    if (desc) desc.removeAttribute('aria-labelledby');

    // case « J'ai terminé », clonée depuis un devoir natif
    const cb = gabaritCb(zone);
    if (cb) {
      const lab = cb.querySelector('label');
      const input = cb.querySelector('input');
      const fid = 'pdl-cb-' + dev.id;
      if (lab) lab.setAttribute('for', fid);
      if (input) {
        input.id = fid;
        input.addEventListener('change', (e) => {
          e.stopPropagation();
          basculer(dev.id, input.checked);
        });
      }
      (item.querySelector('[class*="conteneur-descriptif"]') || item).appendChild(cb);
    }

    // boutons perso, ancrés à gauche de l'étiquette
    const actions = document.createElement('span');
    actions.className = 'pdl-actions';
    actions.innerHTML =
      '<button type="button" class="pdl-a pdl-edit" title="Modifier ce devoir">✎</button>' +
      '<button type="button" class="pdl-a pdl-del" title="Supprimer ce devoir">✕</button>';
    actions.querySelector('.pdl-edit').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      formulaire(e.currentTarget, dev.id);
    });
    actions.querySelector('.pdl-del').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      supprimer(dev.id);
    });

    const tag = item.querySelector('[class*="tag-style"]');
    if (tag && tag.parentElement) {
      tag.parentElement.classList.add('pdl-ancre');
      tag.parentElement.insertBefore(actions, tag);
    } else {
      actions.classList.add('pdl-actions-coin');
      item.appendChild(actions);
    }

    item.addEventListener('click', (e) => e.stopPropagation());

    majItem(item, dev);
    return item;
  }

  /* ------------------------------------------------------------------ */
  /* Groupes de dates                                                    */
  /* ------------------------------------------------------------------ */

  function groupes(zone, mode) {
    const out = [];
    for (const li of zone.children) {
      if (li.tagName !== 'LI') continue;
      let d = null;
      if (mode === 'widget') {
        const h = li.querySelector('h3');
        const m = h && h.id && h.id.match(/(\d{4})_(\d{1,2})_(\d{1,2})$/);
        if (m) d = new Date(+m[1], +m[2], +m[3], 12);
        if (!d && li.hasAttribute('data-pdl-groupe')) {
          const v = li.getAttribute('data-pdl-groupe').match(/^(\d{2})(\d{2})(\d{4})$/);
          if (v) d = new Date(+v[3], +v[2] - 1, +v[1], 12);
        }
      } else {
        const marq = li.querySelector('[data-iddate]');
        const v = marq && (marq.getAttribute('data-iddate') || '').match(/^(\d{2})(\d{2})(\d{4})$/);
        if (v) d = new Date(+v[3], +v[2] - 1, +v[1], 12);
      }
      out.push({ li, date: d, liste: li.querySelector('ul') });
    }
    return out;
  }

  function creerGroupe(zone, date, mode) {
    const modele = [...zone.children].find(
      (li) => li.tagName === 'LI' && !li.hasAttribute('data-pdl-groupe')
    );
    let li;

    if (modele) {
      li = modele.cloneNode(true);
      const liste = li.querySelector('ul');
      if (liste) liste.textContent = '';
      li.querySelectorAll('[data-pdl-devoir], .pdl-actions').forEach((n) => n.remove());
    } else {
      li = document.createElement('li');
      li.innerHTML =
        mode === 'widget'
          ? '<h3></h3><ul class="sub-liste cols"></ul>'
          : '<div><h2 class="ie-titre-gros souligne"><span>Pour </span></h2></div><ul class="liste-element"></ul>';
    }

    li.setAttribute('data-pdl-groupe', idDate(date));

    const marq = li.querySelector('[data-iddate]');
    if (marq) {
      marq.setAttribute('data-iddate', idDate(date));
      marq.setAttribute('id', 'pdl-' + idDate(date));
    }

    const h = li.querySelector('h2, h3');
    if (h) {
      const sp = h.querySelector('span');
      const libelle = mode === 'widget' ? moyenne(date) : longue(date);
      if (sp) {
        const avecEspace = /\s$/.test(sp.textContent || '');
        sp.textContent = avecEspace ? 'Pour ' : 'Pour';
        while (sp.nextSibling) sp.parentNode.removeChild(sp.nextSibling);
        h.appendChild(document.createTextNode(avecEspace ? libelle : ' ' + libelle));
      } else {
        h.textContent = 'Pour ' + libelle;
      }
      h.removeAttribute('id');
    }
    return li;
  }

  function groupePour(zone, mode, date) {
    const gs = groupes(zone, mode);
    const trouve = gs.find((g) => g.date && isoDe(g.date) === isoDe(date));
    if (trouve && trouve.liste) return trouve;

    const li = creerGroupe(zone, date, mode);
    const suivant = gs.find((g) => g.date && g.date > date);
    if (suivant) zone.insertBefore(li, suivant.li);
    else zone.appendChild(li);
    return { li, date, liste: li.querySelector('ul') };
  }

  /* ------------------------------------------------------------------ */
  /* Rendu incrémental                                                   */
  /* ------------------------------------------------------------------ */

  function retirer(cle) {
    const ent = noeuds.get(cle);
    noeuds.delete(cle);
    if (!ent) return;
    const groupe = ent.groupe;
    if (ent.li && ent.li.parentNode) ent.li.remove();
    if (
      groupe &&
      groupe.hasAttribute('data-pdl-groupe') &&
      !groupe.querySelector('[data-pdl-devoir]')
    ) {
      groupe.remove();
    }
  }

  function rendre(zone, mode) {
    if (zone.dataset.pdlMode !== mode) zone.dataset.pdlMode = mode;

    const voulus = devoirs
      .filter((d) => d && d.date)
      .filter((d) => mode !== 'widget' || d.date >= auj())
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const vus = new Set();

    for (const dev of voulus) {
      const cle = mode + ':' + dev.id;
      vus.add(cle);

      let ent = noeuds.get(cle);
      if (ent && (!ent.li.isConnected || !zone.contains(ent.li))) {
        noeuds.delete(cle);
        ent = null;
      }

      // déjà en place au bon jour : simple mise à jour, aucun mouvement
      if (ent && ent.date === dev.date) {
        majItem(ent.item, dev);
        continue;
      }
      if (ent) retirer(cle); // la date a changé, il faut le replacer

      const date = dDe(dev.date);
      if (!date) continue;

      const item = construire(dev, zone, mode);
      if (!item) continue;

      const g = groupePour(zone, mode, date);
      if (!g.liste) continue;

      const li = document.createElement('li');
      li.setAttribute('data-pdl-devoir', dev.id);
      li.appendChild(item);
      if (g.liste.children.length && mode !== 'widget') item.classList.add('ligne-separation');
      g.liste.appendChild(li);

      noeuds.set(cle, { li, item, groupe: g.li, date: dev.date });
    }

    for (const cle of [...noeuds.keys()]) {
      if (cle.slice(0, mode.length + 1) === mode + ':' && !vus.has(cle)) retirer(cle);
    }
  }

  let rendering = false;
  let encore = false;

  function rendreTout() {
    if (rendering) {
      encore = true;
      return;
    }
    if (!actif()) {
      toutRetirer();
      return;
    }
    rendering = true;
    try {
      const taf = zoneTAF();
      if (taf) rendre(taf, 'taf');
      else purger('taf');

      const wid = zoneWidget();
      if (wid) rendre(wid, 'widget');
      else purger('widget');

      placerBoutons();
    } catch (e) {
      console.warn('[pdl] rendu devoirs', e);
    } finally {
      rendering = false;
      if (encore) {
        encore = false;
        rendreTout();
      }
    }
  }

  // Module désactivé : on retire tout ce qui a été ajouté à la page
  function toutRetirer() {
    for (const cle of [...noeuds.keys()]) retirer(cle);
    document.querySelectorAll('[data-pdl-devoir], [data-pdl-groupe]').forEach((n) => n.remove());
    document.querySelectorAll('.pdl-add').forEach((b) => {
      const w = b.closest('.pdl-tools');
      (w || b).remove();
    });
  }

  function purger(mode) {
    for (const cle of [...noeuds.keys()]) {
      if (cle.slice(0, mode.length + 1) === mode + ':') {
        const ent = noeuds.get(cle);
        if (!ent || !ent.li.isConnected) noeuds.delete(cle);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  function basculer(id, fait) {
    const d = devoirs.find((x) => x.id === id);
    if (!d || d.fait === !!fait) return;
    d.fait = !!fait;
    enregistrer();
    // mise à jour directe des noeuds concernés : instantané, sans reflow
    for (const [cle, ent] of noeuds) {
      if (cle.endsWith(':' + id) && ent.item.isConnected) majItem(ent.item, d);
    }
  }

  function supprimer(id) {
    devoirs = devoirs.filter((x) => x.id !== id);
    enregistrer();
    for (const cle of [...noeuds.keys()]) {
      if (cle.endsWith(':' + id)) retirer(cle);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Bouton « ajouter »                                                  */
  /* ------------------------------------------------------------------ */

  const ICO_PLUS =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25V2z"/></svg>';

  function bouton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pdl-b pdl-add';
    b.innerHTML = ICO_PLUS + '<span class="pdl-lbl">Devoir</span>';
    b.title = 'Ajouter un devoir personnel';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      formulaire(b, null);
    });
    return b;
  }

  function placerBoutons() {
    if (zoneTAF()) {
      const titre = document.querySelector('[class*="titre-onglet"]');
      if (titre && !titre.querySelector('.pdl-add')) {
        const w = document.createElement('span');
        w.className = 'pdl-tools';
        w.appendChild(bouton());
        titre.appendChild(w);
      }
    }
    const sec = document.querySelector('section[class*="travailafaire"]');
    if (sec && visible(sec)) {
      const cta = sec.querySelector('header [class*="cta-conteneur"]') || sec.querySelector('header');
      if (cta && !cta.querySelector('.pdl-add')) {
        const w = document.createElement('span');
        w.className = 'pdl-tools';
        w.appendChild(bouton());
        cta.insertBefore(w, cta.firstChild);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Formulaire                                                          */
  /* ------------------------------------------------------------------ */

  let pop = null;
  let popAncre = null;

  function fermer() {
    if (pop && pop.isConnected) pop.remove();
    pop = null;
    popAncre = null;
  }

  document.addEventListener(
    'click',
    (e) => {
      if (pop && pop.isConnected && !pop.contains(e.target)) fermer();
    },
    true
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fermer();
  });
  // la zone de contenu de Pronote défile indépendamment de la fenêtre :
  // le formulaire suit son bouton au lieu de rester planté
  document.addEventListener(
    'scroll',
    () => {
      if (pop && popAncre && popAncre.isConnected) placerPop(popAncre);
    },
    true
  );
  window.addEventListener('resize', () => {
    if (pop && popAncre && popAncre.isConnected) placerPop(popAncre);
  });

  function echap(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }

  function placerPop(ancre) {
    const r = ancre.getBoundingClientRect();
    const w = pop.offsetWidth || 300;
    const h = pop.offsetHeight || 380;
    let left = Math.min(r.right - w, window.innerWidth - w - 8);
    left = Math.max(8, left);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function formulaire(ancre, id) {
    fermer();
    glanerMatieres(true);

    const dev = id ? devoirs.find((x) => x.id === id) : null;
    const noms = Object.keys(matieres).sort();
    const choisie = dev ? dev.matiere : noms[0] || '';

    const options = noms
      .map(
        (n) =>
          '<option value="' + echap(n) + '"' + (n === choisie ? ' selected' : '') + '>' + echap(n) + '</option>'
      )
      .join('');

    pop = document.createElement('div');
    pop.className = 'pdl-pop pdl-form';
    pop.innerHTML = [
      '<div class="pdl-pop-t">' + (dev ? 'Modifier le devoir' : 'Nouveau devoir') + '</div>',
      '<label class="pdl-f">Matière',
      '<select class="pdl-matiere">' + options + '<option value="__autre">Autre…</option></select>',
      '</label>',
      '<label class="pdl-f pdl-autre" style="display:none">Nom',
      '<input type="text" class="pdl-matiere-libre" placeholder="PHILOSOPHIE">',
      '</label>',
      '<label class="pdl-f">Couleur<input type="color" class="pdl-couleur"></label>',
      '<label class="pdl-f">À rendre le<input type="date" class="pdl-date"></label>',
      '<label class="pdl-f">Donné le<input type="date" class="pdl-donne"></label>',
      '<label class="pdl-f pdl-col">Travail à faire',
      '<textarea class="pdl-texte" rows="4" placeholder="Exercices 12 à 18 p. 45"></textarea>',
      '</label>',
      '<label class="pdl-f pdl-check"><input type="checkbox" class="pdl-fait"> Déjà fait</label>',
      '<div class="pdl-pop-a">',
      dev ? '<button type="button" class="pdl-suppr">Supprimer</button>' : '',
      '<button type="button" class="pdl-apply">' + (dev ? 'Enregistrer' : 'Ajouter') + '</button>',
      '</div>'
    ].join('');

    document.body.appendChild(pop);
    popAncre = ancre;
    placerPop(ancre);
    pop.addEventListener('click', (e) => e.stopPropagation());

    const sel = pop.querySelector('.pdl-matiere');
    const libre = pop.querySelector('.pdl-matiere-libre');
    const blocLibre = pop.querySelector('.pdl-autre');
    const coul = pop.querySelector('.pdl-couleur');
    const dat = pop.querySelector('.pdl-date');
    const don = pop.querySelector('.pdl-donne');
    const txt = pop.querySelector('.pdl-texte');
    const fait = pop.querySelector('.pdl-fait');

    function majCouleur() {
      const n = sel.value === '__autre' ? norm(libre.value) : sel.value;
      coul.value = matieres[n] || '#7f8c9a';
    }

    sel.addEventListener('change', () => {
      blocLibre.style.display = sel.value === '__autre' ? '' : 'none';
      majCouleur();
    });

    if (dev) {
      if (!noms.includes(dev.matiere)) {
        sel.value = '__autre';
        blocLibre.style.display = '';
        libre.value = dev.matiere || '';
      }
      coul.value = dev.couleur || matieres[dev.matiere] || '#7f8c9a';
      dat.value = dev.date || '';
      don.value = dev.donneLe || '';
      txt.value = dev.texte || '';
      fait.checked = !!dev.fait;
    } else {
      majCouleur();
      dat.value = auj();
      don.value = auj();
    }

    // focus sans déplacer la page
    setTimeout(() => {
      try {
        txt.focus({ preventScroll: true });
      } catch (e) {
        /* ignore */
      }
    }, 20);

    const suppr = pop.querySelector('.pdl-suppr');
    if (suppr) {
      suppr.addEventListener('click', () => {
        fermer();
        supprimer(dev.id);
      });
    }

    function valider() {
      const nom = sel.value === '__autre' ? norm(libre.value) : sel.value;
      if (!nom) {
        libre.focus({ preventScroll: true });
        return;
      }
      if (!dat.value) {
        dat.focus({ preventScroll: true });
        return;
      }
      const data = {
        id: dev ? dev.id : uid(),
        matiere: nom,
        couleur: coul.value,
        date: dat.value,
        donneLe: don.value || '',
        texte: txt.value || '',
        fait: fait.checked
      };
      if (dev) devoirs = devoirs.map((x) => (x.id === dev.id ? data : x));
      else devoirs.push(data);

      if (matieres[nom] !== coul.value && !(nom in matieres)) {
        matieres[nom] = coul.value;
        enregistrerMatieres();
      }
      enregistrer();
      fermer();
      rendreTout(); // immédiat, sans attendre l'observateur
    }

    pop.querySelector('.pdl-apply').addEventListener('click', valider);
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) valider();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Boucle                                                              */
  /* ------------------------------------------------------------------ */

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[KEY]) {
        const nv = changes[KEY].newValue || [];
        // écho de notre propre écriture : rien à refaire
        if (JSON.stringify(nv) === signature) return;
        devoirs = nv;
        signature = JSON.stringify(devoirs);
        rendreTout();
      }
      if (changes[KEY_MAT]) matieres = changes[KEY_MAT].newValue || {};
    });
  } catch (e) {
    /* ignore */
  }

  let t = null;
  function planifier(ms) {
    clearTimeout(t);
    t = setTimeout(() => {
      glanerMatieres();
      rendreTout();
    }, ms || 150);
  }

  async function init() {
    await charger();
    if (!document.body) return;
    if (actif()) glanerMatieres(true);
    rendreTout();
    // observateur partagé du noyau (nos propres insertions sont ignorées)
    core.onDom(() => {
      if (!rendering && actif()) planifier(10);
    }, 150);
    core.on('tools', () => rendreTout());
  }

  init();
})();
