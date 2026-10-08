/* Pronote GOAT — widgets de la page d'accueil
 *
 * Chaque widget est une <section class="widget pg-widget"> construite comme
 * celles de Pronote (header > h2, .content-container) : il hérite donc de son
 * apparence et de tous les thèmes. Les widgets sont insérés dans les colonnes
 * natives ; le moteur d'agencement se charge ensuite de leur position.
 *
 * Rendu économe : chaque widget produit une chaîne HTML et le DOM n'est
 * touché que si elle a changé. Les données viennent du DOM de Pronote
 * (emploi du temps, notes, agenda) ou du cache des informations.
 */
(function () {
  'use strict';

  const PG = globalThis.PG;
  if (!PG || !PG.core || PG.widgets) return;

  const core = PG.core;
  const esc = core.esc;
  const h = core.h;

  const widgets = { mounted: new Map() };
  PG.widgets = widgets;

  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const p2 = (n) => String(n).padStart(2, '0');
  const today = () => core.iso(new Date());
  const longDate = (d) => JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()];
  const fr = (n, dec) => n.toFixed(dec === undefined ? 1 : dec).replace('.', ',');

  function relative(ts) {
    if (!ts) return 'jamais';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
    return 'il y a ' + Math.round(s / 86400) + ' j';
  }

  function dayDiff(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  }

  function whenLabel(it) {
    const n = dayDiff(it.date);
    if (n === 0) return "aujourd'hui";
    if (n === -1) return 'hier';
    if (n !== null && n < 0 && n > -7) return 'il y a ' + -n + ' j';
    if (it.date) {
      const m = it.date.split('-');
      return 'le ' + +m[2] + ' ' + MOIS[+m[1] - 1].slice(0, 4).replace(/\.?$/, '.');
    }
    return it.dateText || '';
  }

  function btn(act, label, title, extra) {
    return (
      '<button type="button" class="small-bt themeBoutonNeutre bg-white ieBouton pg-btn" data-act="' + act + '"' +
      (title ? ' title="' + esc(title) + '"' : '') + (extra || '') + '>' + label + '</button>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Sources : données lues dans les widgets de Pronote                  */
  /* ------------------------------------------------------------------ */

  const src = {};

  const toMin = (t) => {
    const m = String(t || '').match(/(\d{1,2})\s*h\s*(\d{2})?/i);
    return m ? +m[1] * 60 + (+m[2] || 0) : null;
  };

  // Cours du jour, depuis le widget « Emploi du temps » quand il affiche
  // aujourd'hui ; sinon depuis le dernier relevé du jour même.
  let edtCache = null;
  src.cours = function () {
    const sec = document.querySelector('section.widget.edt:not(.pg-widget)');
    const lbl = sec && core.deaccent(core.textOf(sec.querySelector('.ocb-libelle')));
    if (sec && (!lbl || /aujourd/.test(lbl))) {
      const list = [];
      for (const li of sec.querySelectorAll('ul.liste-cours > li')) {
        const hours = [...li.querySelectorAll('.container-heures > div')].map(core.textOf);
        const start = toMin(hours[0]);
        const end = toMin(hours[1]);
        if (start === null || end === null) continue;
        const subject = core.textOf(li.querySelector('.libelle-cours'));
        if (!subject || /pas de cours/i.test(subject)) continue;
        const infos = [...li.querySelectorAll('.container-cours > li:not(.libelle-cours):not(.container-etiquette)')].map(core.textOf).filter(Boolean);
        const tag = core.textOf(li.querySelector('.container-etiquette, .tag-style'));
        const trait = li.querySelector('.trait-matiere');
        const color = trait ? (trait.getAttribute('style') || '').match(/#[0-9a-f]{3,8}/i) : null;
        list.push({
          start,
          end,
          subject,
          room: infos[infos.length - 1] || '',
          teacher: infos[0] || '',
          tag,
          color: color ? color[0] : '',
          cancelled: li.classList.contains('cours-annule') || /annul|absent/i.test(tag)
        });
      }
      if (list.length || sec.querySelector('ul.liste-cours')) {
        const val = { date: today(), list };
        if (JSON.stringify(val) !== JSON.stringify(edtCache)) {
          edtCache = val;
          chrome.storage.local.set({ pgEdtToday: val }).catch(() => {});
        }
      }
    }
    return edtCache && edtCache.date === today() ? edtCache.list : null;
  };

  // Prochaines vacances, depuis le widget « Agenda »
  let agendaCache = null;
  src.vacances = function () {
    const sec = document.querySelector('section.widget.agenda:not(.pg-widget)');
    if (sec) {
      const out = [];
      for (const li of sec.querySelectorAll('li')) {
        const title = core.textOf(li.querySelector('h3'));
        if (!/vacances|cong[eé]s|pont|f[eé]ri[eé]/i.test(title)) continue;
        const txt = core.textOf(li.querySelector('.infos-agenda-conteneur span')) || core.textOf(li);
        const parts = txt.split(/\bau\b/i);
        const d1 = core.parseFrDate(parts[0]);
        const d2 = parts[1] ? core.parseFrDate(parts[1]) : d1;
        if (d1) out.push({ label: title, start: core.iso(d1), end: core.iso(d2 || d1) });
      }
      if (out.length && JSON.stringify(out) !== JSON.stringify(agendaCache)) {
        agendaCache = out;
        chrome.storage.local.set({ pgAgenda: out }).catch(() => {});
      }
    }
    return agendaCache || [];
  };

  // Dernières notes, depuis le widget « Dernières notes »
  src.notes = function () {
    const sec = document.querySelector('section.widget.notes:not(.pg-widget)');
    if (!sec) return null;
    const out = [];
    for (const li of sec.querySelectorAll('ul > li')) {
      const info = li.querySelector('.as-info');
      if (!info) continue;
      const raw = core.norm([...info.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
      const v = parseFloat(raw.replace(',', '.'));
      if (!Number.isFinite(v)) continue; // Abs, Disp, N.Not…
      const bar = core.textOf(info.querySelector('.bareme')).replace(/[^\d.,]/g, '').replace(',', '.');
      const b = parseFloat(bar) || 20;
      out.push({ subject: core.textOf(li.querySelector('h3')), value: v, bareme: b, sur20: Math.min(20, (v / b) * 20) });
    }
    return out;
  };

  /* ------------------------------------------------------------------ */
  /* Rendus                                                              */
  /* ------------------------------------------------------------------ */

  const R = {};

  function infoList(kind, cfg) {
    const all = (PG.infos ? PG.infos.cache.items : []).filter((i) => i.kind === kind);
    let list = all;
    if (kind === 'info' && cfg.onlyUnread) list = list.filter((i) => i.unread);
    if (kind === 'sondage' && cfg.onlyPending) list = list.filter((i) => i.answered !== true);
    const max = Math.max(1, Math.min(30, +cfg.max || 6));
    const synced = PG.infos ? PG.infos.cache.syncedAt : 0;
    const label = kind === 'info' ? 'information' : 'sondage';

    let body;
    if (!list.length) {
      body =
        '<div class="pg-empty"><div class="pg-empty-ico">' + (kind === 'info' ? '📭' : '🗳️') + '</div>' +
        '<p>' + (all.length ? 'Rien à afficher avec ce filtre.' : 'Aucun ' + label + ' en mémoire pour l’instant.') + '</p>' +
        (all.length ? '' : '<p class="pg-muted">Clique sur ↻ pour relever la liste depuis Pronote.</p>') +
        '</div>';
    } else {
      body =
        '<ul class="pg-list">' +
        list.slice(0, max).map((it) => {
          let badge = '';
          if (kind === 'sondage') {
            if (it.answered === true) badge = '<span class="pg-badge pg-ok">Répondu</span>';
            else if (it.answered === false) badge = '<span class="pg-badge pg-warn">À répondre</span>';
          }
          const meta = [whenLabel(it), it.author].filter(Boolean).map(esc).join(' · ');
          const ex = kind === 'info' && cfg.excerpt && it.excerpt ? '<div class="pg-item-ex">' + esc(it.excerpt) + '</div>' : '';
          return (
            '<li class="pg-item' + (it.unread ? ' pg-unread' : '') + '" data-act="open" tabindex="0" role="link">' +
            '<div class="pg-item-t">' + (it.unread ? '<i class="pg-dot" title="Non lu"></i>' : '') + esc(it.title) + badge + '</div>' +
            (meta ? '<div class="pg-item-m">' + meta + '</div>' : '') +
            ex +
            '</li>'
          );
        }).join('') +
        '</ul>' +
        (list.length > max ? '<div class="pg-more">+ ' + (list.length - max) + ' autre(s)</div>' : '');
    }
    const foot = '<div class="pg-foot">Relevé ' + esc(relative(synced || (PG.infos && PG.infos.cache.updatedAt))) + '</div>';
    const unread = all.filter((i) => (kind === 'info' ? i.unread : i.answered === false)).length;
    return { body: body + foot, count: unread };
  }

  R.infos = (cfg) => infoList('info', cfg);
  R.sondages = (cfg) => infoList('sondage', cfg);

  R.clock = function (cfg) {
    const now = new Date();
    const time = p2(now.getHours()) + ':' + p2(now.getMinutes()) + (cfg.seconds ? '<small>:' + p2(now.getSeconds()) + '</small>' : '');
    let out = '<div class="pg-clock"><div class="pg-big">' + time + '</div><div class="pg-muted pg-cap">' + esc(longDate(now)) + '</div></div>';

    if (cfg.next) {
      const cours = src.cours();
      const mins = now.getHours() * 60 + now.getMinutes();
      const fmt = (m) => Math.floor(m / 60) + 'h' + p2(m % 60);
      const dur = (m) => (m >= 60 ? Math.floor(m / 60) + ' h ' + p2(m % 60) : m + ' min');
      if (!cours) {
        out += '<p class="pg-muted pg-center">Emploi du temps du jour non disponible.</p>';
      } else {
        const actifs = cours.filter((c) => !c.cancelled);
        const cur = actifs.find((c) => c.start <= mins && mins < c.end);
        const next = actifs.find((c) => c.start >= mins && c !== cur);
        if (cur) {
          const pct = Math.round(((mins - cur.start) / (cur.end - cur.start)) * 100);
          out +=
            '<div class="pg-course" style="--c:' + esc(cur.color || 'var(--theme-moyen1)') + '">' +
            '<div class="pg-cap">En cours · fin dans ' + dur(cur.end - mins) + '</div>' +
            '<div class="pg-course-t">' + esc(cur.subject) + '</div>' +
            '<div class="pg-muted">' + esc([cur.room, cur.teacher].filter(Boolean).join(' · ')) + '</div>' +
            '<div class="pg-progress"><span style="width:' + pct + '%"></span></div></div>';
        }
        if (next) {
          out +=
            '<div class="pg-course pg-next" style="--c:' + esc(next.color || 'var(--theme-moyen1)') + '">' +
            '<div class="pg-cap">Ensuite à ' + fmt(next.start) + ' · dans ' + dur(next.start - mins) + '</div>' +
            '<div class="pg-course-t">' + esc(next.subject) + '</div>' +
            '<div class="pg-muted">' + esc([next.room, next.teacher].filter(Boolean).join(' · ')) + '</div></div>';
        }
        if (!cur && !next) {
          out += '<p class="pg-center">' + (actifs.length ? 'Plus de cours aujourd’hui 🎉' : 'Pas de cours aujourd’hui 😎') + '</p>';
        }
        const annules = cours.filter((c) => c.cancelled && c.end > mins);
        if (annules.length) {
          out += '<div class="pg-muted pg-center">' + annules.map((c) => '✗ ' + esc(c.subject) + ' (' + esc(c.tag || 'annulé') + ')').join('<br>') + '</div>';
        }
      }
    }
    return { body: out };
  };

  R.countdown = function (cfg) {
    let label = '';
    let start = '';
    let end = '';
    if (cfg.mode === 'custom') {
      label = cfg.label || 'Mon événement';
      start = end = cfg.date || '';
    } else {
      const t = today();
      const v = src.vacances().find((x) => x.end >= t);
      if (v) {
        label = v.label;
        start = v.start;
        end = v.end;
      }
    }
    if (!start) {
      return {
        body:
          '<div class="pg-empty"><div class="pg-empty-ico">⏳</div><p>' +
          (cfg.mode === 'custom' ? 'Choisis une date dans les réglages du widget.' : 'Aucunes vacances trouvées dans l’agenda.') +
          '</p></div>'
      };
    }
    const n = dayDiff(start);
    const fin = dayDiff(end);
    let big;
    let sub;
    if (n > 0) {
      big = 'J-' + n;
      sub = 'avant <b>' + esc(label) + '</b>';
    } else if (n === 0) {
      big = '🎉';
      sub = "<b>" + esc(label) + "</b>, c'est aujourd'hui !";
    } else if (fin !== null && fin >= 0) {
      big = '🏖️';
      sub = '<b>' + esc(label) + '</b> : encore ' + (fin + 1) + ' jour' + (fin ? 's' : '') + ' !';
    } else {
      big = '✓';
      sub = '<b>' + esc(label) + '</b> est passé.';
    }
    const m = start.split('-');
    const d = new Date(+m[0], +m[1] - 1, +m[2]);
    const weeks = n > 6 ? '<div class="pg-muted">soit ' + Math.floor(n / 7) + ' sem. et ' + (n % 7) + ' j</div>' : '';
    return {
      body:
        '<div class="pg-count"><div class="pg-big">' + big + '</div><div>' + sub + '</div>' +
        '<div class="pg-muted pg-cap">' + esc(longDate(d)) + '</div>' + weeks + '</div>'
    };
  };

  // Moyenne indicative :
  //   - moyenne de chaque matière = notes ramenées sur 20, pondérées par
  //     leur coefficient (coef. 0 = note non comptée, coef. inconnu = 1) ;
  //   - moyenne générale = moyenne des matières, qui comptent toutes autant.
  // Source : toutes les notes relevées sur « Détail de mes notes » (avec les
  // coefficients), sinon les dernières notes de l'accueil.
  R.average = function (cfg) {
    const page = PG.notes && PG.notes.current();
    let grades;
    let fromPage = false;
    if (page && page.grades.length) {
      grades = page.grades;
      fromPage = true;
    } else {
      grades = (src.notes() || []).map((n) => ({ subject: n.subject, value: n.value, bareme: n.bareme, coef: null }));
    }
    const syncBtn = '<button type="button" class="link pg-inline-sync" data-act="sync">↻ relever toutes mes notes et leurs coefficients</button>';
    if (!grades.length) {
      return {
        body: '<div class="pg-empty"><div class="pg-empty-ico">📈</div><p>Aucune note chiffrée pour l’instant.</p><p>' + syncBtn + '</p></div>'
      };
    }

    const by = {};
    let unknown = 0;
    for (const g of grades) {
      const coef = g.coef === null || g.coef === undefined ? 1 : +g.coef;
      if (g.coef === null || g.coef === undefined) unknown++;
      const s = (by[g.subject] = by[g.subject] || { w: 0, sum: 0, n: 0 });
      s.n++;
      if (!(coef > 0) || !(g.bareme > 0)) continue; // coef. 0 : non comptée
      s.w += coef;
      s.sum += coef * (g.value / g.bareme) * 20;
    }
    const subjects = Object.entries(by)
      .map(([name, s]) => ({ name, n: s.n, avg: s.w > 0 ? Math.min(20, s.sum / s.w) : null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const counted = subjects.filter((x) => x.avg !== null);
    if (!counted.length) {
      return { body: '<div class="pg-empty"><div class="pg-empty-ico">📈</div><p>Toutes les notes ont un coefficient 0.</p></div>' };
    }
    const avg = counted.reduce((t, x) => t + x.avg, 0) / counted.length;
    const tone = (v) => (v >= 14 ? 'pg-good' : v >= 10 ? 'pg-mid' : 'pg-low');

    const meta = [counted.length + ' matière' + (counted.length > 1 ? 's' : '')];
    if (fromPage) meta.push(page.period, grades.length + ' notes', 'relevé ' + relative(page.syncedAt || page.updatedAt));
    else meta.push('dernières notes de l’accueil');

    let out =
      '<div class="pg-avg"><div class="pg-big ' + tone(avg) + '">' + fr(avg, 2) + '<small> /20</small></div>' +
      '<div class="pg-muted">' + meta.map(esc).join(' · ') + '</div></div>';

    if (cfg.bySubject) {
      out +=
        '<ul class="pg-bars">' +
        subjects
          .map((x) =>
            '<li><span class="pg-bar-l" title="' + esc(x.name + ' — ' + x.n + ' note(s)') + '">' + esc(x.name) + '</span>' +
            '<span class="pg-bar"><span class="' + (x.avg === null ? '' : tone(x.avg)) + '" style="width:' + (x.avg === null ? 0 : Math.round((x.avg / 20) * 100)) + '%"></span></span>' +
            '<b>' + (x.avg === null ? '—' : fr(x.avg, 2)) + '</b></li>'
          )
          .join('') +
        '</ul>';
    }

    let foot = 'Chaque matière compte autant ; dans une matière, les notes sont pondérées par leur coefficient.';
    if (!fromPage) foot += '<br>Coefficients inconnus (comptés 1). ' + syncBtn;
    else if (unknown) foot += '<br>' + unknown + ' note(s) sans coefficient relevé, comptée(s) 1. ' + syncBtn;
    out += '<div class="pg-foot">' + foot + '</div>';
    return { body: out };
  };

  R.links = function (cfg) {
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    if (!items.length) return { body: '<div class="pg-empty"><p>Ajoute des liens dans les réglages du widget.</p></div>' };
    return {
      body:
        '<div class="pg-links">' +
        items
          .slice(0, 24)
          .map((l, i) => {
            const ext = /^https?:\/\//i.test(l.target || '');
            return (
              '<button type="button" class="pg-link" data-act="link" data-i="' + i + '" title="' +
              esc(ext ? l.target : 'Ouvrir « ' + String(l.target || '').replace(/^menu:/, '') + ' »') + '">' +
              '<span class="pg-link-e">' + esc(l.emoji || (ext ? '🌐' : '📄')) + '</span>' +
              '<span>' + esc(l.label || l.target) + '</span>' + (ext ? '<span class="pg-ext">↗</span>' : '') +
              '</button>'
            );
          })
          .join('') +
        '</div>'
    };
  };

  /* ------------------------------------------------------------------ */
  /* Post-it : rendu particulier (zone de saisie conservée)              */
  /* ------------------------------------------------------------------ */

  function renderPostit(entry, cfg) {
    let ta = entry.body.querySelector('textarea');
    if (!ta) {
      entry.body.innerHTML = '';
      ta = h('textarea', { class: 'pg-postit', placeholder: 'Écris ici… (enregistré automatiquement)', spellcheck: 'true' });
      let t = null;
      ta.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          core.updateConfig((c) => {
            c.widgets.postit.text = ta.value.slice(0, 5000);
          });
        }, 500);
      });
      // ne pas déclencher les raccourcis clavier de Pronote en tapant
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      entry.body.appendChild(ta);
    }
    ta.style.setProperty('--pg-postit', cfg.color || '#fde68a');
    if (document.activeElement !== ta && ta.value !== (cfg.text || '')) ta.value = cfg.text || '';
  }

  /* ------------------------------------------------------------------ */
  /* Montage                                                             */
  /* ------------------------------------------------------------------ */

  function header(id) {
    if (id === 'infos' || id === 'sondages') {
      return btn('sync', '↻', 'Synchroniser avec Pronote') + btn('all', 'Tout voir', 'Ouvrir Informations & sondages');
    }
    if (id === 'average') {
      return btn('sync', '↻', 'Relever toutes les notes et leurs coefficients') + btn('all', 'Tout voir', 'Ouvrir Détail de mes notes');
    }
    return '';
  }

  function build(id) {
    const def = PG.WIDGETS[id];
    const titleSpan = h('span', { class: 'pg-wtitle', text: def.name });
    const count = h('span', { class: 'pg-count-badge', hidden: true });
    const cta = h('div', { class: 'cta-conteneur pg-cta', html: header(id) });
    const gear = h('button', {
      type: 'button',
      class: 'pg-gear',
      title: 'Réglages du widget',
      'aria-label': 'Réglages du widget',
      'data-act': 'settings',
      text: '⚙'
    });
    cta.appendChild(gear);
    const body = h('div', { class: 'content-container pg-wbody' });
    const sec = h('section', { class: 'widget pg-widget pg-w-' + id, 'data-pg-w': id }, [
      h('header', null, [h('h2', null, [h('span', { class: 'pg-wicon', text: def.icon + ' ' }), titleSpan, count]), cta]),
      body
    ]);
    sec.addEventListener('click', (e) => onClick(id, e));
    sec.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act="open"]')) {
        e.preventDefault();
        onClick(id, e);
      }
    });
    return { id, section: sec, body, count, html: null };
  }

  function onClick(id, e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    e.stopPropagation();
    const act = el.getAttribute('data-act');
    if (act === 'settings') {
      if (PG.editor) PG.editor.openSettings(id, el);
    } else if (act === 'sync') {
      el.disabled = true;
      el.classList.add('pg-spin');
      if (id === 'average') {
        if (PG.editor) PG.editor.toast('Relevé des notes en cours… (quelques secondes)');
        PG.notes && PG.notes.sync();
      } else if (PG.infos) PG.infos.sync();
    } else if (act === 'all' || act === 'open') {
      if (id === 'average') PG.notes && PG.notes.open();
      else if (PG.infos) PG.infos.open();
    } else if (act === 'link') {
      const l = (core.config.widgets.links.items || [])[+el.getAttribute('data-i')];
      if (!l) return;
      if (/^https?:\/\//i.test(l.target)) window.open(l.target, '_blank', 'noopener');
      else if (!core.navigate(String(l.target || '').replace(/^menu:/, ''))) {
        el.classList.add('pg-shake');
        setTimeout(() => el.classList.remove('pg-shake'), 500);
      }
    }
  }

  function wrappers(container) {
    const w = [...container.querySelectorAll('.wrapper-cols')];
    return w.length ? w : [container];
  }

  function slotFor(id, container) {
    const w = wrappers(container);
    const col = PG.WIDGETS[id].column;
    if (col === 'first') return w[0];
    if (col === 'middle') return w[Math.floor((w.length - 1) / 2)];
    return w[w.length - 1];
  }

  function renderOne(entry) {
    const cfg = core.config.widgets[entry.id] || {};
    if (entry.id === 'postit') {
      renderPostit(entry, cfg);
      return;
    }
    const out = R[entry.id](cfg);
    if (out.body !== entry.html) {
      entry.html = out.body;
      entry.body.innerHTML = out.body;
    }
    const n = out.count || 0;
    entry.count.hidden = !n;
    if (n && entry.count.textContent !== String(n)) entry.count.textContent = String(n);
  }

  widgets.render = function (only) {
    for (const entry of widgets.mounted.values()) {
      if (only && !only.includes(entry.id)) continue;
      try {
        renderOne(entry);
      } catch (e) {
        console.warn('[Pronote GOAT] widget', entry.id, e);
      }
    }
  };

  widgets.mount = function () {
    const cfg = core.config;
    const container = core.homeContainer();
    const active = !!(cfg && container && core.enabled());

    let changed = false;
    for (const id of PG.WIDGET_ORDER) {
      const want = active && cfg.widgets[id] && cfg.widgets[id].enabled;
      let entry = widgets.mounted.get(id);
      if (!want) {
        if (entry) {
          entry.section.remove();
          widgets.mounted.delete(id);
          changed = true;
        }
        continue;
      }
      if (!entry) {
        entry = build(id);
        widgets.mounted.set(id, entry);
      }
      if (!container.contains(entry.section)) {
        slotFor(id, container).appendChild(entry.section);
        entry.html = null;
        changed = true;
      }
    }
    widgets.render();
    tick();
    // nos insertions sont ignorées par l'observateur partagé : on prévient
    // nous-mêmes le moteur d'agencement
    if (changed && PG.layout) PG.layout.apply();
  };

  /* ------------------------------------------------------------------ */
  /* Horloge                                                             */
  /* ------------------------------------------------------------------ */

  let timer = null;
  function tick() {
    clearTimeout(timer);
    if (!widgets.mounted.has('clock') && !widgets.mounted.has('countdown')) return;
    const sec = core.config.widgets.clock.seconds && widgets.mounted.has('clock');
    const now = new Date();
    const delay = sec ? 1000 - now.getMilliseconds() : (60 - now.getSeconds()) * 1000;
    timer = setTimeout(() => {
      if (!document.hidden) widgets.render(['clock', 'countdown']);
      tick();
    }, Math.max(200, delay));
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) widgets.render(['clock', 'countdown']);
  });

  /* ------------------------------------------------------------------ */
  /* Branchements                                                        */
  /* ------------------------------------------------------------------ */

  async function loadCaches() {
    try {
      const v = await chrome.storage.local.get(['pgEdtToday', 'pgAgenda']);
      if (v.pgEdtToday) edtCache = v.pgEdtToday;
      if (Array.isArray(v.pgAgenda)) agendaCache = v.pgAgenda;
    } catch (e) {
      /* ignore */
    }
  }

  core.on('started', () => loadCaches().then(widgets.mount));
  core.on('config', widgets.mount);
  core.on('tools', widgets.mount);
  core.on('home', widgets.mount);
  core.onDom(widgets.mount, 250);
  core.on('infos-local', () => widgets.render(['infos', 'sondages']));
  core.on('notes-local', () => widgets.render(['average']));
  core.on('notes-synced', (r) => {
    const e = widgets.mounted.get('average');
    e && e.section.querySelectorAll('[data-act="sync"]').forEach((b) => {
      b.disabled = false;
      b.classList.remove('pg-spin');
    });
    if (!PG.editor) return;
    if (r && r.ok) PG.editor.toast(r.count + ' notes relevées, ' + r.coefs + ' coefficient(s) lu(s)');
    else PG.editor.toast((r && r.error) || 'Relevé des notes impossible', 'warn');
  });
  core.on('infos-synced', (r) => {
    for (const id of ['infos', 'sondages']) {
      const e = widgets.mounted.get(id);
      const b = e && e.section.querySelector('[data-act="sync"]');
      if (b) {
        b.disabled = false;
        b.classList.remove('pg-spin');
      }
    }
    if (r && !r.ok && PG.editor) PG.editor.toast(r.error || 'Synchronisation impossible', 'warn');
  });
})();
