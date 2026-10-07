/* Pronote GOAT — gestionnaire de profils et de réglages
 *
 * Organisation du stockage :
 *   chrome.storage.local  pgMeta            { activeId, area }  (propre à l'appareil)
 *   <zone>                pgIndex           [{ id, name, updatedAt }]
 *   <zone>                pgProfile:<id>    { id, name, createdAt, updatedAt, config }
 *   chrome.storage.local  pgAsset:<id>      images importées (data URL, jamais synchronisées)
 *   chrome.storage.sync   pgTools           réglages des outils (téléchargement, devoirs)
 *
 * <zone> vaut « local » (par défaut, sans limite pratique) ou « sync » (profils
 * partagés entre les navigateurs Chrome connectés au même compte ; 8 Ko max
 * par profil). Le passage de l'une à l'autre migre tous les profils.
 */
(function (root) {
  'use strict';

  const PG = (root.PG = root.PG || {});
  const U = PG.util;

  const META = 'pgMeta';
  const INDEX = 'pgIndex';
  const PREFIX = 'pgProfile:';
  const ASSET = 'pgAsset:';
  const TOOLS = 'pgTools';
  const DEFAULT_ID = 'default';

  const api = (area) => chrome.storage[area === 'sync' ? 'sync' : 'local'];

  async function get(area, keys) {
    try {
      return (await api(area).get(keys)) || {};
    } catch (e) {
      return {};
    }
  }

  // Laisse remonter les erreurs (quota dépassé notamment) : l'interface les
  // affiche à l'utilisateur.
  function set(area, obj) {
    return api(area).set(obj);
  }

  async function del(area, keys) {
    try {
      await api(area).remove(keys);
    } catch (e) {
      /* ignore */
    }
  }

  // Les écritures d'un même contexte sont sérialisées : deux sauvegardes
  // rapprochées ne peuvent pas s'écraser l'index l'une l'autre.
  let chain = Promise.resolve();
  function locked(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  }

  function newProfile(name, config, id) {
    const now = Date.now();
    return {
      id: id || U.uid('p'),
      name: String(name || 'Profil').trim().slice(0, 40) || 'Profil',
      createdAt: now,
      updatedAt: now,
      config: U.normalizeConfig(config ? U.clone(config) : null)
    };
  }

  async function readIndex(area) {
    const v = await get(area, INDEX);
    return Array.isArray(v[INDEX]) ? v[INDEX] : [];
  }

  async function writeProfile(area, p) {
    const index = await readIndex(area);
    const entry = { id: p.id, name: p.name, updatedAt: p.updatedAt || Date.now() };
    const next = index.slice();
    const i = next.findIndex((e) => e.id === p.id);
    if (i >= 0) next[i] = entry;
    else next.push(entry);
    await set(area, { [PREFIX + p.id]: p, [INDEX]: next });
  }

  const store = {
    KEYS: { META, INDEX, PREFIX, ASSET, TOOLS },

    /* -------------------------------------------------------------- */
    /* Méta-données                                                    */
    /* -------------------------------------------------------------- */

    async meta() {
      const v = await get('local', META);
      return Object.assign({ activeId: DEFAULT_ID, area: 'local' }, v[META] || {});
    },

    async setMeta(patch) {
      const m = Object.assign(await store.meta(), patch);
      await set('local', { [META]: m });
      return m;
    },

    async index() {
      return readIndex((await store.meta()).area);
    },

    // Garantit qu'au moins un profil existe et que le profil actif est valide.
    ensure() {
      return locked(async () => {
        const meta = await store.meta();
        let index = await readIndex(meta.area);
        if (!index.length) {
          await writeProfile(meta.area, newProfile('Par défaut', null, DEFAULT_ID));
          index = await readIndex(meta.area);
        }
        if (!index.some((e) => e.id === meta.activeId)) {
          meta.activeId = index[0].id;
          await set('local', { [META]: meta });
        }
        return { meta, index };
      });
    },

    /* -------------------------------------------------------------- */
    /* Profils                                                         */
    /* -------------------------------------------------------------- */

    async getProfile(id, area) {
      area = area || (await store.meta()).area;
      const v = await get(area, PREFIX + id);
      const p = v[PREFIX + id];
      if (!p || typeof p !== 'object') return null;
      p.config = U.normalizeConfig(p.config);
      return p;
    },

    async getActive() {
      const { meta, index } = await store.ensure();
      let p = await store.getProfile(meta.activeId, meta.area);
      if (!p && index[0]) p = await store.getProfile(index[0].id, meta.area);
      return p || newProfile('Par défaut', null, DEFAULT_ID);
    },

    save(profile) {
      return locked(async () => {
        const meta = await store.meta();
        profile.updatedAt = Date.now();
        profile.config = U.normalizeConfig(profile.config);
        await writeProfile(meta.area, profile);
        return profile;
      });
    },

    // Lecture-modification-écriture du profil actif. « mutator » reçoit la
    // configuration et la modifie en place (ou en renvoie une nouvelle).
    async updateActive(mutator) {
      const p = await store.getActive();
      const r = mutator(p.config, p);
      if (r && typeof r === 'object') p.config = r;
      return store.save(p);
    },

    async setActive(id) {
      await store.setMeta({ activeId: id });
    },

    create(name, config) {
      return locked(async () => {
        const meta = await store.meta();
        const p = newProfile(name || 'Nouveau profil', config);
        await writeProfile(meta.area, p);
        return p;
      });
    },

    async duplicate(id) {
      const src = await store.getProfile(id);
      if (!src) return null;
      return store.create(src.name.slice(0, 32) + ' (copie)', src.config);
    },

    async rename(id, name) {
      const p = await store.getProfile(id);
      if (!p) return null;
      p.name = String(name || '').trim().slice(0, 40) || p.name;
      return store.save(p);
    },

    remove(id) {
      return locked(async () => {
        const meta = await store.meta();
        const index = await readIndex(meta.area);
        if (index.length <= 1) throw new Error('Impossible de supprimer le dernier profil.');
        const rest = index.filter((e) => e.id !== id);
        await set(meta.area, { [INDEX]: rest });
        await del(meta.area, PREFIX + id);
        if (meta.activeId === id) {
          meta.activeId = rest[0].id;
          await set('local', { [META]: meta });
        }
      });
    },

    // Remet un profil aux valeurs d'usine (nom et identifiant conservés).
    async reset(id) {
      const p = await store.getProfile(id);
      if (!p) return null;
      p.config = U.clone(PG.DEFAULT_CONFIG);
      return store.save(p);
    },

    /* -------------------------------------------------------------- */
    /* Zone de stockage (local / sync)                                 */
    /* -------------------------------------------------------------- */

    setArea(area) {
      area = area === 'sync' ? 'sync' : 'local';
      return locked(async () => {
        const meta = await store.meta();
        if (area === meta.area) return meta;
        const index = await readIndex(meta.area);
        const payload = { [INDEX]: index };
        for (const e of index) {
          const v = await get(meta.area, PREFIX + e.id);
          if (v[PREFIX + e.id]) payload[PREFIX + e.id] = v[PREFIX + e.id];
        }
        // On écrit d'abord dans la nouvelle zone : si le quota de la synchro
        // est dépassé, l'erreur remonte et rien n'est perdu.
        await set(area, payload);
        await del(meta.area, Object.keys(payload));
        meta.area = area;
        await set('local', { [META]: meta });
        return meta;
      });
    },

    async usage(area) {
      try {
        return await api(area).getBytesInUse(null);
      } catch (e) {
        return 0;
      }
    },

    /* -------------------------------------------------------------- */
    /* Import / export                                                 */
    /* -------------------------------------------------------------- */

    async exportData(ids) {
      const index = await store.index();
      const out = {
        format: 'pronote-goat',
        version: 1,
        exportedAt: new Date().toISOString(),
        profiles: [],
        assets: {}
      };
      for (const e of index) {
        if (ids && !ids.includes(e.id)) continue;
        const p = await store.getProfile(e.id);
        if (!p) continue;
        out.profiles.push({ name: p.name, config: p.config });
        const aid = p.config.style.background.assetId;
        if (aid && !out.assets[aid]) {
          const data = await store.getAsset(aid);
          if (data) out.assets[aid] = data;
        }
      }
      return out;
    },

    // Renvoie le nombre de profils importés. Les profils arrivent toujours en
    // plus des existants (jamais d'écrasement).
    async importData(data) {
      if (!data || data.format !== 'pronote-goat' || !Array.isArray(data.profiles)) {
        throw new Error("Ce fichier n'est pas un export Pronote GOAT.");
      }
      const remap = {};
      for (const [oldId, url] of Object.entries(data.assets || {})) {
        if (typeof url === 'string' && url.startsWith('data:image/')) {
          remap[oldId] = await store.saveAsset(url);
        }
      }
      let n = 0;
      for (const item of data.profiles.slice(0, 50)) {
        if (!item || typeof item !== 'object') continue;
        const cfg = U.normalizeConfig(item.config);
        const aid = cfg.style.background.assetId;
        cfg.style.background.assetId = aid && remap[aid] ? remap[aid] : '';
        await store.create(item.name || 'Profil importé', cfg);
        n++;
      }
      return n;
    },

    /* -------------------------------------------------------------- */
    /* Outils et images                                                */
    /* -------------------------------------------------------------- */

    async tools() {
      const v = await get('sync', TOOLS);
      return U.merge(PG.TOOLS_DEFAULTS, v[TOOLS] || {});
    },

    async setTools(patch) {
      const next = U.merge(await store.tools(), patch);
      await set('sync', { [TOOLS]: next });
      return next;
    },

    async saveAsset(dataUrl) {
      const id = U.uid('a');
      await set('local', { [ASSET + id]: dataUrl });
      return id;
    },

    async getAsset(id) {
      if (!id) return '';
      const v = await get('local', ASSET + id);
      return v[ASSET + id] || '';
    },

    async removeAsset(id) {
      if (id) await del('local', ASSET + id);
    },

    /* -------------------------------------------------------------- */
    /* Notifications                                                   */
    /* -------------------------------------------------------------- */

    onChange(cb) {
      chrome.storage.onChanged.addListener((changes, area) => {
        const keys = Object.keys(changes);
        cb({
          area,
          keys,
          changes,
          meta: keys.includes(META),
          index: keys.includes(INDEX),
          profiles: keys.filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length)),
          tools: keys.includes(TOOLS),
          assets: keys.some((k) => k.startsWith(ASSET))
        });
      });
    }
  };

  PG.store = store;
})(typeof globalThis !== 'undefined' ? globalThis : self);
