/* Pronote GOAT — relevé des notes et de leurs coefficients
 *
 * Le widget « Dernières notes » de l'accueil ne montre que quelques notes et
 * aucun coefficient. Ce module lit la page Notes › Détail de mes notes :
 *   - la liste complète de la période affichée (matière, devoir, date, note,
 *     barème) dès que la page est ouverte ;
 *   - le coefficient de la note sélectionnée, affiché dans le volet de détail.
 * « Synchroniser » ouvre la page, sélectionne chaque note l'une après l'autre
 * pour lire tous les coefficients, puis revient à l'accueil.
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
    // { current: 'Trimestre 1', periods: { 'Trimestre 1': { updatedAt, syncedAt, grades: [...] } } }
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

  // Période affichée en dernier, avec ses notes : { period, grades, updatedAt, syncedAt }
  notes.current = function () {
    const name = notes.cache.current;
    const p = name && notes.cache.periods[name];
    return p ? Object.assign({ period: name }, p) : null;
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
    return [...root.querySelectorAll('.liste_celluleGrid')].filter((r) => r.querySelector('.titre-principal'));
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

  // Volet de détail : matière, devoir, date et coefficient de la note choisie
  function detail() {
    const box = document.querySelector('.Zone-DetailsNotes, .detail-contain');
    if (!box || !core.visible(box)) return null;
    const subject = cleanSubject(core.textOf(box.querySelector('h2')));
    const title = core.textOf(box.querySelector('p.ie-titre'));
    const d = core.parseFrDate(core.textOf(box.querySelector('p.ie-texte')));
    let coef = null;
    for (const dt of box.querySelectorAll('dt')) {
      if (/coef/i.test(core.textOf(dt))) coef = num(core.textOf(dt.nextElementSibling));
    }
    if (!subject || coef === null) return null;
    return { subject, title, date: d ? core.iso(d) : '', coef };
  }

  function applyDetail(period, det) {
    const p = notes.cache.periods[period];
    if (!p || !det) return false;
    const g = p.grades.find(
      (x) => plat(x.subject) === plat(det.subject) && plat(x.title) === plat(det.title) && (!det.date || !x.date || x.date === det.date)
    );
    if (!g || g.coef === det.coef) return false;
    g.coef = det.coef;
    return true;
  }

  let lastCount = -1;
  function scan() {
    if (!core.enabled()) return;
    const root = pageRoot();
    if (!root) {
      lastCount = -1;
      return;
    }
    const period = periodName();
    const old = notes.cache.periods[period];
    const known = {};
    if (old) for (const g of old.grades) known[g.id] = g.coef;

    const grades = [];
    for (const row of rowsOf(root)) {
      const g = gradeOf(row);
      if (!g) continue;
      if (g.id in known) g.coef = known[g.id];
      grades.push(g);
    }
    // liste encore en cours d'affichage : on attend qu'elle soit stable
    const stable = grades.length === lastCount;
    lastCount = grades.length;
    if (!grades.length || !stable) {
      if (grades.length) setTimeout(scan, 400);
      return;
    }
    notes.cache.periods[period] = { updatedAt: Date.now(), syncedAt: old ? old.syncedAt || 0 : 0, grades };
    notes.cache.current = period;
    applyDetail(period, detail());
    save();
  }

  /* ------------------------------------------------------------------ */
  /* Synchronisation : chaque note est sélectionnée pour lire son coef.  */
  /* ------------------------------------------------------------------ */

  async function readAllCoefs(root, period) {
    const rows = rowsOf(root);
    let read = 0;
    for (const row of rows) {
      const g = gradeOf(row);
      if (!g) continue;
      core.clickLike(row.querySelector('.liste_contenu_cellule') || row);
      // le volet de détail se met à jour : on attend la bonne note
      for (let t = 0; t < 10; t++) {
        await sleep(80);
        const det = detail();
        if (det && plat(det.subject) === plat(g.subject) && plat(det.title) === plat(g.title)) {
          const p = notes.cache.periods[period];
          const target = p && p.grades.find((x) => x.id === g.id);
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
    try {
      // attendre que la liste soit affichée et stable
      let root = null;
      let prev = -1;
      for (let t = 0; t < 40; t++) {
        await sleep(250);
        root = pageRoot();
        const n = root ? rowsOf(root).length : -1;
        if (root && n > 0 && n === prev) break;
        prev = n;
      }
      if (!root) throw new Error('La page des notes ne s’est pas affichée.');
      lastCount = -1;
      scan();
      scan();
      const period = periodName();
      const read = await readAllCoefs(root, period);
      const p = notes.cache.periods[period];
      if (p) p.syncedAt = Date.now();
      notes.cache.current = period;
      sig = '';
      save();
      core.emit('notes-synced', { ok: true, count: p ? p.grades.length : 0, coefs: read });
      const back = !core.tools || !core.tools.infos || core.tools.infos.autoReturn !== false;
      if (fromHome && back) setTimeout(core.goHome, 300);
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
    out.modules.notes = {
      periode: c ? c.period : null,
      notes: c ? c.grades.length : 0,
      coefsConnus: c ? c.grades.filter((g) => g.coef !== null).length : 0,
      pageOuverte: !!root,
      exempleLigne: root && rowsOf(root)[0] ? rowsOf(root)[0].outerHTML.slice(0, 600) : null,
      detail: detail()
    };
  });
})();
