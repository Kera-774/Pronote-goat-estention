/* Pronote GOAT — collecte des Informations et des Sondages
 *
 * Pronote n'affiche sur l'accueil que les informations NON LUES, mélangées aux
 * sondages, dans un widget replié. Ce module relève ce qui passe sous ses
 * yeux et le garde en mémoire (chrome.storage.local) :
 *   - le widget « Informations & Sondages » de l'accueil ;
 *   - la page Communication › Informations & sondages, liste ET détail de
 *     l'élément ouvert (texte complet, auteur, date).
 * Les widgets « Informations » et « Sondages » de l'extension affichent
 * ensuite ce cache, lues comme non lues.
 *
 * « Synchroniser » ouvre la page Informations & sondages, relève la liste puis
 * revient tout seul à l'accueil. Aucune requête n'est envoyée à Pronote en
 * dehors de celles que fait sa propre interface.
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || !PG.core || PG.infos) return;

  const core = PG.core;
  const KEY = 'pgInfosCache';
  const MAX = 80;

  const infos = {
    cache: { updatedAt: 0, syncedAt: 0, items: [] },
    syncing: null
  };
  PG.infos = infos;

  /* ------------------------------------------------------------------ */
  /* Cache                                                               */
  /* ------------------------------------------------------------------ */

  async function load() {
    try {
      const v = await chrome.storage.local.get(KEY);
      if (v && v[KEY] && Array.isArray(v[KEY].items)) infos.cache = v[KEY];
    } catch (e) {
      /* ignore */
    }
    core.emit('infos-local');
  }

  let saveSig = '';
  function save() {
    const sig = JSON.stringify(infos.cache.items);
    if (sig === saveSig) return;
    saveSig = sig;
    infos.cache.updatedAt = Date.now();
    try {
      chrome.storage.local.set({ [KEY]: infos.cache });
    } catch (e) {
      /* ignore */
    }
    core.emit('infos-local');
  }

  // le cache peut être vidé depuis le popup, ou rempli dans un autre onglet
  core.on('infos', load);

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  const plat = (s) => core.deaccent(core.norm(s));

  function merge(found, opts) {
    if (!found.length && !(opts && opts.authoritative)) return;
    const byId = new Map(infos.cache.items.map((it) => [it.id, it]));
    const now = Date.now();

    for (const f of found) {
      const old = byId.get(f.id) || infos.cache.items.find((it) => it.kind === f.kind && plat(it.title) === plat(f.title));
      if (old) {
        // on ne remplace jamais une info riche par une info plus pauvre
        for (const k of ['author', 'dateText', 'date', 'excerpt', 'content']) {
          if (f[k] && (!old[k] || String(f[k]).length >= String(old[k]).length)) old[k] = f[k];
        }
        if (typeof f.unread === 'boolean') old.unread = f.unread;
        if (typeof f.answered === 'boolean') old.answered = f.answered;
        old.seenAt = now;
      } else {
        f.seenAt = now;
        infos.cache.items.push(f);
        byId.set(f.id, f);
      }
    }

    // Sur la page dédiée, la liste fait foi : ce qui n'y figure plus a été
    // retiré par l'établissement.
    if (opts && opts.authoritative) {
      const keep = new Set(found.map((f) => f.id));
      const titles = new Set(found.map((f) => f.kind + '|' + plat(f.title)));
      infos.cache.items = infos.cache.items.filter((it) => keep.has(it.id) || titles.has(it.kind + '|' + plat(it.title)));
      infos.cache.syncedAt = now;
    }

    infos.cache.items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.seenAt - a.seenAt);
    infos.cache.items = infos.cache.items.slice(0, MAX);
    save();
  }

  /* ------------------------------------------------------------------ */
  /* Analyse d'une ligne                                                 */
  /* ------------------------------------------------------------------ */

  // Indices propres aux sondages (les icônes « info_sondage » servent aux deux
  // types et ne sont donc pas retenues).
  const SONDAGE_SEL =
    '[class*="icon_sondage"], [class*="EtatSondage"], [class*="InfoSond_Question"], [class*="Actu_Question"], [class*="question-sondage"]';

  function isSondage(el, label) {
    if (/sondage/i.test(label || '')) return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(^|[\s_-])sondage([\s_-]|$)/i.test(cls)) return true;
    if (el.querySelector(SONDAGE_SEL)) return true;
    // une étiquette « Sondage » affichée dans la ligne
    return [...el.querySelectorAll('span, div, i')].some(
      (n) => n.children.length === 0 && /^sondage$/i.test(core.textOf(n))
    );
  }

  function isUnread(el, label) {
    if (/non lu/i.test(label || '')) return true;
    const re = /(^|\s|-|_)(non-?lu|nonlu|unread|gras|nouveau)(\s|$|-|_)/i;
    if (re.test(el.className || '')) return true;
    return !!el.querySelector('.Gras, [class*="non-lu" i], [class*="nonLu"], [class*="unread" i]');
  }

  function answeredOf(el) {
    const t = core.deaccent(core.textOf(el));
    if (el.querySelector('[class*="EtatSondageVoirReponse"]') || /voir (ma|les) reponse|repondu/.test(t)) return true;
    if (el.querySelector('[class*="EtatSondageRepondre"]') || /\ba repondre\b|\brepondre\b/.test(t)) return false;
    return undefined;
  }

  const DATE_RE = /(\b(?:le|du|publi[ée]e? le)\s+)?\b\d{1,2}(?:\s*(?:er)?\s+[a-zéû]{3,10}\.?(?:\s+\d{4})?|[/.]\d{1,2}(?:[/.]\d{2,4})?)/i;

  function lineFrom(row, labelAttr) {
    const label = labelAttr || '';
    const titleEl = row.querySelector(
      '[class*="titre-principal"], .titre-info-sondage, .zoneTitre-info-sondage, h2, h3, h4, [class*="titre"]:not([class*="sous"])'
    );
    let title = core.textOf(titleEl);

    const subs = [...row.querySelectorAll('[class*="sous-titre"], [class*="infos-supp"], [class*="date"], [class*="publication"], [class*="auteur"]')]
      .filter((e) => e !== titleEl && !e.contains(titleEl))
      .map(core.textOf)
      .filter(Boolean);
    const all = core.textOf(row);
    if (!title) title = (all.split(/\s{2,}|\n/)[0] || all).slice(0, 140);
    if (!title || title.length < 2) return null;

    const meta = [...new Set(subs)].join(' · ');
    const dm = (meta + ' ' + label + ' ' + all).match(DATE_RE);
    const dateText = dm ? core.norm(dm[0]) : '';
    const d = core.parseFrDate(dateText);
    const kind = isSondage(row, label) ? 'sondage' : 'info';

    const excerptEl = row.querySelector('.description, [class*="descriptif" i], [class*="Descriptif"], .info-sondage-content, p');
    let excerpt = excerptEl && !excerptEl.contains(titleEl) ? core.textOf(excerptEl) : '';
    if (excerpt === title) excerpt = '';

    return {
      id: hash(kind + '|' + plat(title) + '|' + (d ? core.iso(d) : plat(dateText))),
      kind,
      title: title.slice(0, 200),
      author: meta.replace(dateText, '').replace(/^[\s·,-]+|[\s·,-]+$/g, '').slice(0, 120),
      dateText,
      date: d ? core.iso(d) : '',
      excerpt: excerpt.slice(0, 400),
      unread: isUnread(row, label),
      answered: kind === 'sondage' ? answeredOf(row) : undefined
    };
  }

  // Lignes « feuilles » : on écarte les conteneurs qui contiennent d'autres lignes
  function leaves(list) {
    const arr = [...new Set(list)].filter((el) => !el.closest('.pg-widget'));
    return arr.filter((el) => !arr.some((o) => o !== el && el.contains(o)));
  }

  /* ------------------------------------------------------------------ */
  /* Sources                                                             */
  /* ------------------------------------------------------------------ */

  function fromWidget() {
    const sec = document.querySelector('section.widget.actualites');
    if (!sec) return [];
    const box = sec.querySelector('.content-container') || sec;
    if (box.querySelector('.no-events') && !box.querySelector('li')) return [];
    const out = [];
    for (const li of leaves(box.querySelectorAll('li'))) {
      const lab = li.querySelector('[aria-label]');
      const it = lineFrom(li, lab ? lab.getAttribute('aria-label') : '');
      if (it) {
        it.unread = true; // ce widget ne liste que les éléments non lus
        out.push(it);
      }
    }
    return out;
  }

  function pageRoot() {
    return document.querySelector('.InterfacePageInfoSondage');
  }

  function fromPage() {
    const root = pageRoot();
    if (!root || !core.visible(root)) return null;
    const nav = root.querySelector('.nav, .ecrans') || root;
    let rows = nav.querySelectorAll(
      '[class*="liste_contenu_ligne"], [role="row"], [role="option"], [role="treeitem"], [role="listitem"]'
    );
    if (!rows.length) rows = nav.querySelectorAll('li');
    const out = [];
    for (const row of leaves(rows)) {
      if (!core.visible(row)) continue;
      const lab = row.getAttribute('aria-label') || (row.querySelector('[aria-label]') || { getAttribute: () => '' }).getAttribute('aria-label');
      const it = lineFrom(row, lab);
      if (it) out.push(it);
    }
    return out;
  }

  // Élément ouvert dans le volet de lecture : texte complet
  function detail() {
    const root = pageRoot();
    if (!root) return null;
    const tEl = root.querySelector('.titre-info-sondage, .zoneTitre-info-sondage, .zoneTitreIntegral-info-sondage');
    const title = core.textOf(tEl);
    if (!title) return null;
    const box = tEl.closest('.aside, .ecran-visu, .section, [class*="Consult"]') || root;
    const content = core.textOf(box.querySelector('.info-sondage-content, .zoneDescriptif, .Actu_Descriptif, [class*="descriptif" i]'));
    const pub = core.textOf(box.querySelector('.publication-info-sondage, .public-info-sondage, .zoneDate'));
    return { title, content, pub, sondage: isSondage(box, '') };
  }

  /* ------------------------------------------------------------------ */
  /* Boucle                                                              */
  /* ------------------------------------------------------------------ */

  let lastPageCount = -1;

  function scan() {
    if (!core.enabled()) return;

    const w = fromWidget();
    if (w.length) merge(w);

    const p = fromPage();
    if (p) {
      if (p.length) merge(p, { authoritative: p.length === lastPageCount });
      lastPageCount = p.length;

      const d = detail();
      if (d) {
        const it = infos.cache.items.find((x) => plat(x.title) === plat(d.title) || plat(d.title).startsWith(plat(x.title)));
        if (it && (d.content || d.pub)) {
          if (d.content && d.content.length > (it.content || '').length) it.content = d.content.slice(0, 3000);
          if (d.content && !it.excerpt) it.excerpt = d.content.slice(0, 400);
          if (d.pub && !it.author) it.author = d.pub.slice(0, 120);
          if (!it.date) {
            const dd = core.parseFrDate(d.pub);
            if (dd) it.date = core.iso(dd);
          }
          it.unread = false;
          saveSig = '';
          save();
        }
      }

      // retour automatique à l'accueil après une synchronisation
      if (infos.syncing && p.length && p.length === infos.syncing.count) {
        const back = infos.syncing.returnHome;
        infos.syncing = null;
        infos.cache.syncedAt = Date.now();
        saveSig = '';
        save();
        core.emit('infos-synced', { ok: true, count: p.length });
        if (back) setTimeout(core.goHome, 250);
      } else if (infos.syncing) {
        infos.syncing.count = p.length; // on attend que la liste soit stable
        setTimeout(scan, 500);
      }
    } else {
      lastPageCount = -1;
    }
  }

  infos.sync = function () {
    const ok =
      core.navigate('Informations & sondages') ||
      core.navigate('Informations et sondages') ||
      core.navigate('Actualités');
    if (!ok) {
      core.emit('infos-synced', { ok: false, error: 'Entrée de menu « Informations & sondages » introuvable.' });
      return false;
    }
    const autoReturn = !core.tools || !core.tools.infos || core.tools.infos.autoReturn !== false;
    infos.syncing = { returnHome: autoReturn && core.isHome(), count: -1, started: Date.now() };
    setTimeout(() => {
      if (infos.syncing && Date.now() - infos.syncing.started > 9000) {
        infos.syncing = null;
        core.emit('infos-synced', { ok: false, error: 'La liste ne s’est pas affichée à temps.' });
      }
    }, 9500);
    return true;
  };

  infos.open = function () {
    return core.navigate('Informations & sondages') || core.navigate('Informations et sondages');
  };

  infos.clear = function () {
    infos.cache = { updatedAt: Date.now(), syncedAt: 0, items: [] };
    saveSig = '';
    save();
  };

  core.on('infos-sync', infos.sync);
  core.onDom(scan, 450);
  core.on('started', load);

  core.on('diagnostic', (out) => {
    const root = pageRoot();
    const sec = document.querySelector('section.widget.actualites');
    const cut = (el) => (el ? el.outerHTML.slice(0, 700) : null);
    out.modules.infos = {
      enCache: infos.cache.items.length,
      pageOuverte: !!root,
      lignesPage: root ? (fromPage() || []).length : null,
      exempleLigne: root ? cut(root.querySelector('[class*="liste_contenu_ligne"], [role="row"], li')) : null,
      widget: sec ? cut(sec.querySelector('.content-container')) : null
    };
  });
})();
