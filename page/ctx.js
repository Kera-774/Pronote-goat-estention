/* Exécuté dans le contexte de la page (monde MAIN).
 * Récupère le numéro de session Pronote et la racine de l'espace, puis les
 * dépose dans un attribut du <html> que le script de contenu peut lire.
 * Tout est dans des try/catch : si Pronote change, on ne casse rien.
 */
(function () {
  'use strict';

  function grab() {
    const out = {};
    try {
      const g = window;
      const cands = [
        () => g.GParametres && g.GParametres.numeroSession,
        () => g.Etat && g.Etat.numeroSession,
        () => g.parametres && g.parametres.numeroSession,
        () => g.GInterface && g.GInterface.numeroSession,
        () =>
          g.GInterface &&
          g.GInterface.Instances &&
          g.GInterface.Instances[0] &&
          g.GInterface.Instances[0].numeroSession
      ];
      for (const fn of cands) {
        try {
          const v = fn();
          if (v !== undefined && v !== null && String(v).length) {
            out.session = String(v);
            break;
          }
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      /* ignore */
    }

    try {
      const m = location.pathname.match(/^(.*\/pronote)\//i);
      out.racine = m ? location.origin + m[1] : location.origin;
    } catch (e) {
      out.racine = location.origin;
    }

    return out;
  }

  function publish() {
    try {
      const ctx = grab();
      document.documentElement.setAttribute(
        'data-pdl-ctx',
        JSON.stringify(ctx)
      );
    } catch (e) {
      /* ignore */
    }
  }

  publish();
  setTimeout(publish, 1500);
  setTimeout(publish, 5000);
})();
