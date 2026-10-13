/* Pronote GOAT — moyennes par matière, notes et coefficients
 *
 * Le widget « Moyenne » reprend les moyennes par matière telles que Pronote
 * les affiche, sur la page Notes › Détail de mes notes :
 *   - vue « Par matière » : chaque matière est une ligne de regroupement qui
 *     porte la moyenne de l'élève (lue dans la liste, sinon dans le volet de
 *     détail quand la matière est sélectionnée) ;
 *   - vue « Par ordre chronologique » : la liste des notes (matière, devoir,
 *     date, note, barème) et, pour la note sélectionnée, son coefficient.
 * Les notes et coefficients ne servent qu'au calcul de secours, quand
 * l'établissement n'affiche pas les moyennes.
 *
 * « Synchroniser » ouvre la page, passe en vue « Par matière » le temps de
 * lire les moyennes, revient à la vue d'origine puis à l'accueil.
 *
 * Tout reste dans chrome.storage.local ; aucune requête n'est envoyée en
 * dehors de celles que fait l'interface de Pronote elle-même.
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || !PG.core || PG.notes) return;

  const core = PG.core;
  const KEY = 'pgNotes';

  const notes = {
    // { current: 'Trimestre 1', periods: { 'Trimestre 1': {
    //     updatedAt, syncedAt, grades: [...],
    //     subjects: { 'MATHEMATIQUES': 15.25 }, avgAt } } }
    cache: { current: '', periods: {} },
    syncing: null
  };
  PG.notes = notes;

  const plat = (s) => core.deaccent(core.norm(s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  const num = (s) => {
    const v = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  };

  // « Moyenne élève : 14,50 », « Moy. élève 7/10 »… (pas « Moyenne groupe »)
  const RE_AVG = /moy(?:enne|\.)?\s*(?:de\s+l['’]\s*)?[ée]l[èe]ve\s*:?\s*(\d+(?:[.,]\d+)?)\s*(?:\/\s*(\d+(?:[.,]\d+)?))?/i;
  const RE_GRADE = /note\s+(?:de\s+l['’]\s*)?[ée]l[èe]ve/i;
  const RE_OTHER = /classe|groupe|min|max|haute|basse/i;

  // Valeur ramenée sur 20, ou null si elle n'a pas de sens
  function on20(v, b) {
    if (v === null) return null;
    const r = b && b !== 20 ? (v / b) * 20 : v;
    return r >= 0 && r <= 20 ? r : null;
  }

  function avgIn(text) {
    const m = String(text || '').match(RE_AVG);
    return m ? on20(num(m[1]), num(m[2])) : null;
  }

  /* ------------------------------------------------------------------ */
  /* Cache                                                               */
  /* ------------------------------------------------------------------ */

  async function load() {
    try {
      const v = await chrome.storage.local.get(KEY);
      if (v && v[KEY] && v[KEY].periods) notes.cache = v[KEY];
    } catch (e) {
      /* ignore */
    }
    core.emit('notes-local');
  }

  let sig = '';
  function save() {
    const s = JSON.stringify(notes.cache);
    if (s === sig) return;
    sig = s;
    try {
      chrome.storage.local.set({ [KEY]: notes.cache });
    } catch (e) {
      /* ignore */
    }
    core.emit('notes-local');
  }

  function period(name) {
    const p = (notes.cache.periods[name] = notes.cache.periods[name] || { updatedAt: 0, syncedAt: 0, grades: [] });
    if (!p.subjects) p.subjects = {};
    return p;
  }

  // Période affichée en dernier :
  // { period, grades, subjects, avgAt, updatedAt, syncedAt, newGrades }
  // newGrades : notes apparues depuis la lecture des moyennes.
  notes.current = function () {
    const name = notes.cache.current;
    const p = name && notes.cache.periods[name];
    if (!p) return null;
    const out = Object.assign({ period: name, subjects: {} }, p);
    out.newGrades = p.avgAt ? p.grades.filter((g) => g.seen > p.avgAt).length : 0;
    return out;
  };

  notes.clear = function () {
    notes.cache = { current: '', periods: {} };
    save();
  };

  /* ------------------------------------------------------------------ */
  /* Lecture de la page « Détail de mes notes »                          */
  /* ------------------------------------------------------------------ */

  function pageRoot() {
    const r = document.querySelector('.InterfaceDernieresNotes, [class*="InterfaceDernieresNotes"]');
    return r && core.visible(r) ? r : null;
  }

  function periodName() {
    const el =
      document.querySelector('.objetBandeauEntete_thirdmenu [aria-label*="période" i]') ||
      document.querySelector('.objetBandeauEntete_thirdmenu .ocb-libelle');
    return core.textOf(el) || 'Période en cours';
  }

  // Texte visible + libellés d'accessibilité d'un élément et de ses enfants
  function labelsOf(el) {
    let s = core.textOf(el);
    for (const x of [el, ...el.querySelectorAll('[aria-label]')]) s += ' ' + (x.getAttribute('aria-label') || '');
    return s;
  }

  const cellOf = (row) => row.querySelector('[role="treeitem"], .liste_contenu_cellule') || row;

  // Note et barème d'une ligne : « 15,00 » + « /18 », sinon l'aria-label
  function valueOf(row) {
    const n = row.querySelector('.note-devoir');
    if (n) {
      let raw = '';
      for (const c of n.childNodes) if (c.nodeType === 3) raw += c.textContent;
      const v = num(raw);
      const b = num(core.textOf(n.querySelector('span')).replace('/', ''));
      if (v !== null) return { value: v, bareme: b || 20 };
    }
    const z = row.querySelector('[aria-label*="Note"]');
    const m = z && (z.getAttribute('aria-label') || '').match(/:\s*([\d.,]+)\s*(?:\/\s*([\d.,]+))?/);
    if (m && num(m[1]) !== null) return { value: num(m[1]), bareme: num(m[2]) || 20 };
    return null; // Abs, Disp, N.Not… : pas de valeur chiffrée
  }

  const cleanSubject = (s) => core.norm(String(s || '').split(/\s+>\s+/)[0]);

  function idOf(g) {
    return hash(plat(g.subject) + '|' + plat(g.title) + '|' + g.date + '|' + g.value + '/' + g.bareme);
  }

  function rowsOf(root) {
    return [...root.querySelectorAll('.liste_celluleGrid')].filter((r) => core.textOf(r));
  }

  // Ligne de regroupement « matière » de la vue « Par matière »
  function isHeader(row) {
    const lab = labelsOf(row);
    if (RE_GRADE.test(lab)) return false;
    const c = cellOf(row);
    if (c.hasAttribute('aria-expanded') || RE_AVG.test(lab)) return true;
    return c.getAttribute('aria-level') === '1' && !row.querySelector('.note-devoir');
  }

  function headerOf(row) {
    const raw = core.textOf(
      row.querySelector('.titre-principal .ie_ellipsis') || row.querySelector('.titre-principal') || row.querySelector('.ie_ellipsis')
    );
    const subject = cleanSubject(raw);
    if (!subject) return null;
    let avg = avgIn(labelsOf(row));
    if (avg === null) {
      // moyenne affichée seule à droite de la ligne
      const z = row.querySelector('.zone-complementaire');
      const m = z && !RE_OTHER.test(labelsOf(z)) && core.textOf(z).match(/(\d+(?:[.,]\d+)?)\s*(?:\/\s*(\d+(?:[.,]\d+)?))?/);
      if (m) avg = on20(num(m[1]), num(m[2]));
    }
    return { subject, avg, sub: /\s>\s/.test(raw), collapsed: cellOf(row).getAttribute('aria-expanded') === 'false' };
  }

  function gradeOf(row) {
    const parts = [...row.querySelectorAll('.titre-principal .ie_ellipsis')].map(core.textOf).filter(Boolean);
    // « MATIÈRE > SOUS-MATIÈRE » : la note compte dans la matière principale
    const subject = cleanSubject(parts[0] || core.textOf(row.querySelector('.titre-principal')));
    if (!subject) return null;
    const v = valueOf(row);
    if (!v) return null;
    const d = core.parseFrDate(core.textOf(row.querySelector('time, .date-contain')));
    const g = { subject, title: parts[1] || '', date: d ? core.iso(d) : '', value: v.value, bareme: v.bareme, coef: null };
    g.id = idOf(g);
    return g;
  }

  // Volet de détail : une note (coefficient) ou une matière (moyenne)
  function detail() {
    const box = document.querySelector('.Zone-DetailsNotes, .detail-contain');
    if (!box || !core.visible(box)) return null;
    const subject = cleanSubject(core.textOf(box.querySelector('h2')));
    if (!subject) return null;
    let coef = null;
    let avg = null;
    let grade = false;
    for (const dt of box.querySelectorAll('dt')) {
      const k = core.textOf(dt);
      const v = core.textOf(dt.nextElementSibling);
      if (/coef/i.test(k)) coef = num(v);
      else if (RE_GRADE.test(k)) grade = true;
      else if (avg === null) avg = avgIn(k + ' ' + v);
    }
    if (grade || coef !== null) {
      if (coef === null) return null;
      const d = core.parseFrDate(core.textOf(box.querySelector('p.ie-texte')));
      return { kind: 'grade', subject, title: core.textOf(box.querySelector('p.ie-titre')), date: d ? core.iso(d) : '', coef };
    }
    return avg === null ? null : { kind: 'subject', subject, avg };
  }

  function applyDetail(name, det) {
    const p = notes.cache.periods[name];
    if (!p || !det) return false;
    if (det.kind === 'subject') {
      if (p.subjects[det.subject] === det.avg) return false;
      p.subjects[det.subject] = det.avg;
      if (!p.avgAt) p.avgAt = Date.now();
      return true;
    }
    const g = p.grades.find(
      (x) => plat(x.subject) === plat(det.subject) && plat(x.title) === plat(det.title) && (!det.date || !x.date || x.date === det.date)
    );
    if (!g || g.coef === det.coef) return false;
    g.coef = det.coef;
    return true;
  }

  const grouped = (rows) => rows.some(isHeader);

  // Moyennes de la liste ; une matière découpée en sous-matières sans ligne
  // propre prend la moyenne de ses sous-matières.
  function averagesOf(heads) {
    const by = {};
    for (const h of heads) {
      if (h.avg === null) continue;
      const s = (by[h.subject] = by[h.subject] || { avg: null, subs: [] });
      if (h.sub) s.subs.push(h.avg);
      else s.avg = h.avg;
    }
    const out = {};
    for (const [name, s] of Object.entries(by)) {
      out[name] = s.avg !== null ? s.avg : s.subs.reduce((t, v) => t + v, 0) / s.subs.length;
    }
    return out;
  }

  let lastCount = -1;
  function scan() {
    if (!core.enabled()) return;
    const root = pageRoot();
    if (!root) {
      lastCount = -1;
      return;
    }
    const rows = rowsOf(root);
    // liste encore en cours d'affichage : on attend qu'elle soit stable
    const stable = rows.length === lastCount;
    lastCount = rows.length;
    if (!rows.length || !stable) {
      if (rows.length) setTimeout(scan, 400);
      return;
    }

    const name = periodName();
    const p = period(name);
    const before = JSON.stringify([p.grades, p.subjects]);
    const now = Date.now();

    if (grouped(rows)) {
      // vue « Par matière » : seules les moyennes sont lues (les notes des
      // matières repliées n'y sont pas affichées)
      const heads = rows.filter(isHeader).map(headerOf).filter(Boolean);
      const avgs = averagesOf(heads);
      if (heads.length && heads.every((h) => h.avg !== null)) {
        p.subjects = avgs;
        p.avgAt = now;
      } else Object.assign(p.subjects, avgs);
    } else {
      const known = {};
      for (const g of p.grades) known[g.id] = g;
      const first = !p.grades.length;
      const grades = [];
      for (const row of rows) {
        const g = gradeOf(row);
        if (!g) continue;
        const old = known[g.id];
        g.coef = old ? old.coef : null;
        // apparition de la note (0 lors du tout premier relevé de la période)
        g.seen = old ? old.seen || 0 : first ? 0 : now;
        grades.push(g);
      }
      if (grades.length) p.grades = grades;
    }
    notes.cache.current = name;
    applyDetail(name, detail());
    if (JSON.stringify([p.grades, p.subjects]) !== before) p.updatedAt = now;
    save();
  }

  /* ------------------------------------------------------------------ */
  /* Synchronisation                                                     */
  /* ------------------------------------------------------------------ */

  // Attend une liste affichée et stable (et qui vérifie test, s'il est donné)
  async function waitList(test, tries = 40) {
    let prev = -1;
    for (let t = 0; t < tries; t++) {
      await sleep(250);
      const root = pageRoot();
      const rows = root ? rowsOf(root) : [];
      if (root && rows.length && rows.length === prev && (!test || test(rows))) return root;
      prev = rows.length;
    }
    return null;
  }

  // Puces « Par ordre chronologique » / « Par matière »
  function chip(re) {
    const all = [...document.querySelectorAll('[role="radiogroup"] label, label.as-chips')].filter(core.visible);
    return re ? all.find((l) => re.test(plat(core.textOf(l)))) : all.find(chipChecked);
  }
  const chipChecked = (l) =>
    l.classList.contains('is-checked') || l.getAttribute('aria-checked') === 'true' || !!l.querySelector('input:checked');

  // Passe en vue « Par matière » ou chronologique ; renvoie la liste affichée
  async function view(bySubject) {
    const root = pageRoot();
    if (root && grouped(rowsOf(root)) === bySubject) return root;
    const c = chip(bySubject ? /par mati/i : /chrono/i);
    if (!c) return null;
    core.clickLike(c);
    return waitList((rows) => grouped(rows) === bySubject, 24);
  }

  // Lit la moyenne de chaque matière ; renvoie le nombre de matières lues
  async function readAverages(name) {
    const root = await view(true);
    if (!root) return 0;
    lastCount = -1;
    scan();
    scan();
    const p = period(name);
    const read = new Set();
    const main = new Set();
    for (const row of rowsOf(root).filter(isHeader)) {
      const h = headerOf(row);
      if (!h) continue;
      if (h.avg !== null) read.add(h.subject);
      if (!h.sub) main.add(h.subject);
    }
    // moyennes absentes de la liste : sélection de chaque matière (ou de ses
    // sous-matières, quand elle n'a pas de ligne propre)
    const found = [];
    for (let i = 0; ; i++) {
      const r = pageRoot();
      const heads = r ? rowsOf(r).filter(isHeader) : [];
      if (i >= heads.length) break;
      const h = headerOf(heads[i]);
      if (!h || read.has(h.subject) || (h.sub && main.has(h.subject))) continue;
      core.clickLike(cellOf(heads[i]));
      for (let t = 0; t < 10; t++) {
        await sleep(80);
        const det = detail();
        if (det && det.kind === 'subject' && plat(det.subject) === plat(h.subject)) {
          found.push(Object.assign(h, { avg: det.avg }));
          break;
        }
      }
    }
    const avgs = averagesOf(found);
    Object.assign(p.subjects, avgs);
    for (const k of Object.keys(avgs)) read.add(k);
    if (read.size) p.avgAt = Date.now();
    return read.size;
  }

  // Calcul de secours : sélectionne chaque note pour lire son coefficient
  async function readAllCoefs(name) {
    const root = await view(false);
    if (!root) return 0;
    let read = 0;
    for (const row of rowsOf(root)) {
      const g = gradeOf(row);
      if (!g) continue;
      core.clickLike(row.querySelector('.liste_contenu_cellule') || row);
      // le volet de détail se met à jour : on attend la bonne note
      for (let t = 0; t < 10; t++) {
        await sleep(80);
        const det = detail();
        if (det && det.kind === 'grade' && plat(det.subject) === plat(g.subject) && plat(det.title) === plat(g.title)) {
          const target = period(name).grades.find((x) => x.id === g.id);
          if (target) target.coef = det.coef;
          read++;
          break;
        }
      }
    }
    return read;
  }

  notes.sync = async function () {
    if (notes.syncing) return false;
    const fromHome = core.isHome();
    if (!pageRoot()) {
      const ok = core.navigate('Mes notes') || core.navigate('Détail de mes notes') || core.navigate('Notes');
      if (!ok) {
        core.emit('notes-synced', { ok: false, error: 'Entrée de menu « Mes notes » introuvable.' });
        return false;
      }
    }
    notes.syncing = { started: Date.now() };
    let initial = null;
    try {
      if (!(await waitList())) throw new Error('La page des notes ne s’est pas affichée.');
      initial = chip();
      const name = periodName();
      // 1. vue chronologique : liste complète des notes
      if (await view(false)) {
        lastCount = -1;
        scan();
        scan();
      }
      // 2. vue « Par matière » : moyennes affichées par Pronote
      const subjects = await readAverages(name);
      // 3. établissement qui n'affiche pas les moyennes : coefficients
      const coefs = subjects ? 0 : await readAllCoefs(name);
      const p = period(name);
      p.syncedAt = Date.now();
      notes.cache.current = name;
      sig = '';
      save();
      core.emit('notes-synced', { ok: true, count: p.grades.length, subjects, coefs });
      // la vue choisie par l'élève est rétablie
      if (initial && !chipChecked(initial)) core.clickLike(initial);
      const back = !core.tools || !core.tools.infos || core.tools.infos.autoReturn !== false;
      if (fromHome && back) setTimeout(core.goHome, 400);
      return true;
    } catch (e) {
      core.emit('notes-synced', { ok: false, error: e.message || String(e) });
      return false;
    } finally {
      notes.syncing = null;
    }
  };

  notes.open = function () {
    return core.navigate('Mes notes') || core.navigate('Détail de mes notes');
  };

  core.on('started', load);
  core.onDom(() => {
    if (!notes.syncing) scan();
  }, 500);

  core.on('diagnostic', (out) => {
    const c = notes.current();
    const root = pageRoot();
    const rows = root ? rowsOf(root) : [];
    const head = rows.find(isHeader);
    out.modules.notes = {
      periode: c ? c.period : null,
      notes: c ? c.grades.length : 0,
      moyennesMatieres: c ? c.subjects : null,
      coefsConnus: c ? c.grades.filter((g) => g.coef !== null).length : 0,
      pageOuverte: !!root,
      vueParMatiere: !!head,
      exempleLigne: rows[0] ? rows[0].outerHTML.slice(0, 600) : null,
      exempleMatiere: head ? head.outerHTML.slice(0, 800) : null,
      detail: detail()
    };
  });
})();
