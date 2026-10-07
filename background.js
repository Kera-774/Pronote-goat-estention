/* Pronote GOAT — service worker (Manifest V3)
 *
 *   - téléchargements via l'API chrome.downloads (module « téléchargement
 *     groupé ») avec suivi de fin et repli si Chrome refuse le nom de fichier ;
 *   - initialisation du stockage (profil par défaut, réglages des outils) ;
 *   - raccourci clavier Alt+Maj+E → ouvre / ferme l'éditeur visuel ;
 *   - ouverture du tableau de bord à l'installation.
 */
importScripts('lib/defaults.js', 'lib/storage.js');

/* ------------------------------------------------------------------ */
/* Téléchargements                                                     */
/* ------------------------------------------------------------------ */

const pending = new Map(); // downloadId -> resolve

chrome.downloads.onChanged.addListener((delta) => {
  const resolve = pending.get(delta.id);
  if (!resolve || !delta.state) return;
  if (delta.state.current === 'complete') {
    pending.delete(delta.id);
    resolve({ ok: true, id: delta.id });
  } else if (delta.state.current === 'interrupted') {
    pending.delete(delta.id);
    resolve({ ok: false, id: delta.id, error: (delta.error && delta.error.current) || 'INTERROMPU' });
  }
});

function track(id, resolve) {
  pending.set(id, resolve);
  // Filet de sécurité : un très gros fichier ne bloque pas la file d'attente.
  setTimeout(() => {
    if (pending.has(id)) {
      pending.delete(id);
      resolve({ ok: true, id, pending: true });
    }
  }, 20000);
}

function startDownload({ url, filename, saveAs }) {
  return new Promise((resolve) => {
    if (!/^https?:\/\//i.test(String(url || ''))) {
      resolve({ ok: false, error: 'URL refusée' });
      return;
    }
    const opts = { url, conflictAction: 'uniquify', saveAs: !!saveAs };
    if (filename) opts.filename = filename;

    chrome.downloads.download(opts, (id) => {
      if (!chrome.runtime.lastError && id !== undefined) {
        track(id, resolve);
        return;
      }
      const msg = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'échec inconnu';
      // Nom de fichier refusé par Chrome ? On retente sans chemin imposé.
      if (filename && /filename|invalid/i.test(msg)) {
        chrome.downloads.download({ url, conflictAction: 'uniquify', saveAs: !!saveAs }, (id2) => {
          if (chrome.runtime.lastError || id2 === undefined) {
            resolve({ ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : msg });
          } else {
            track(id2, resolve);
          }
        });
        return;
      }
      resolve({ ok: false, error: msg });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // Seuls nos propres scripts peuvent demander un téléchargement.
  if (sender.id !== chrome.runtime.id) return;

  if (msg.type === 'pdl-download') {
    startDownload(msg).then(sendResponse);
    return true; // réponse asynchrone
  }

  if (msg.type === 'pdl-ping' || msg.type === 'pg-bg-ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }

  if (msg.type === 'pg-open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
});

/* ------------------------------------------------------------------ */
/* Raccourci clavier                                                   */
/* ------------------------------------------------------------------ */

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-editor') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return;
  chrome.tabs.sendMessage(tab.id, { type: 'pg-editor', action: 'toggle' }).catch(() => {
    /* pas un onglet Pronote : rien à faire */
  });
});

/* ------------------------------------------------------------------ */
/* Installation                                                        */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await PG.store.ensure();
    // complète les réglages des outils avec les éventuelles nouvelles clés
    const tools = await PG.store.tools();
    await PG.store.setTools(tools);
  } catch (e) {
    console.warn('[Pronote GOAT] initialisation', e);
  }
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
