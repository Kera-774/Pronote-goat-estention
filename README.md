# 🐐 Pronote GOAT — thèmes, widgets & outils pour Pronote

Extension Google Chrome (Manifest V3) qui rend Pronote **personnalisable de A à Z**,
sans jamais casser son fonctionnement :

- **6 thèmes** : Pronote (origine), **Dev** (VS Code), **Hacker** (terminal néon),
  **Verre dépoli** (glassmorphism), **Minimaliste**, **Carnet** (papier ligné) ;
- **Personnalisation fine** : couleurs, arrière-plan (couleur, dégradé, image),
  police, taille du texte, arrondis, espacements, opacité, flou, ombres ;
- **Éditeur visuel no-code** : glisser-déposer des widgets (colonne et hauteur),
  poignée pour redimensionner (hauteur + largeur en colonnes), fond / texte / titre
  de chaque bloc (🎨), repli, masquage, et « 🎯 Masquer un élément » pour cacher
  n'importe quel bloc de Pronote d'un clic — **sauvegarde automatique** ;
- **Bandeaux et navigation** : chaque partie se coche / décoche (bandeau du haut,
  logo en haut à gauche, photo, nom, boutons, bandeau « Page d'accueil », pied de
  page…), textes du bandeau remplaçables (`{salut} {prenom} 👋`), couleurs,
  hauteur, alignement, mode discret ; onglets masquables, réordonnables, sous-menus
  masquables et **raccourcis** ajoutés dans la barre ;
- **Lisibilité** : quand une image de fond est active, un panneau translucide
  couvre toute la zone de contenu des autres pages (ou, au choix, une case par
  bloc) — couleur, opacité, arrondi et ombre réglables ;
- **Nouveaux widgets** : 📢 Informations, 📊 Sondages, 🕒 Horloge & prochain
  cours, ⏳ Compte à rebours, 📈 Moyenne indicative, 🔗 Liens rapides, 🗒️ Post-it ;
- **Profils** : plusieurs configurations nommées, bascule en un clic, réinitialisation,
  import / export JSON, stockage local ou synchronisé avec le compte Chrome ;
- **Outils repris de pronote-dl** (optimisés) : téléchargement groupé des documents,
  export JSON des cours, filtre de période, devoirs personnels au rendu natif.

Rien n'est envoyé nulle part : tout reste dans le navigateur.

---

## Installation (mode développeur)

1. Récupère le dossier de l'extension (ce dépôt) sur ton ordinateur.
2. Ouvre `chrome://extensions` (ou `edge://extensions`, `brave://extensions`).
3. Active le **Mode développeur** (interrupteur en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier qui
   contient `manifest.json`.
5. Le **tableau de bord** s'ouvre tout seul. Épingle l'icône 🐐 dans la barre de
   Chrome (menu puzzle 🧩 → punaise).
6. Ouvre (ou recharge) ton Pronote : le thème et les widgets s'appliquent.

> Pronote hébergé sur une adresse inhabituelle (sans `/pronote/` dans l'URL) ?
> Ajoute ton domaine dans `manifest.json`, dans `host_permissions` et dans les
> trois `matches` des `content_scripts` (ex. `"*://pronote.mon-lycee.fr/*"`),
> puis recharge l'extension (bouton ⟳ sur `chrome://extensions`).

## Tester pas à pas

| Étape | Où | Ce qu'il faut voir |
|---|---|---|
| 1. Thèmes | Popup › 🎨 Thèmes | Clic sur **Dev** : Pronote passe immédiatement en sombre monospace, onglets d'éditeur et barre d'état bleue. Essaie **Hacker** (puis l'effet « pluie Matrix »), **Verre dépoli**, **Minimaliste**, **Carnet**. |
| 2. Style | Popup › 🖌️ Style | Change la couleur principale, le fond (dégradé, image), la police, la taille du texte : tout s'applique en direct. **↺ Couleurs du thème** annule. |
| 3. Widgets | Popup › 🧩 Accueil | Active **Horloge**, **Compte à rebours**, **Liens rapides**… Ils apparaissent sur la page d'accueil de Pronote. |
| 4. Éditeur | Bouton ✏️ en bas à droite de l'accueil, ou <kbd>Alt</kbd>+<kbd>Maj</kbd>+<kbd>E</kbd> | Glisse un widget par sa poignée ⠿ (autre colonne, plus haut, plus bas). La poignée ◢ en bas à droite règle sa hauteur et sa largeur (double-clic = hauteur auto). 🎨 change son fond, son texte, masque son titre. ▾ le replie, 👁 le masque (grisé pendant l'édition). « ✓ Enregistré » confirme la sauvegarde. |
| 4 bis. Bandeaux | Popup › 🧭 Barres | Décoche « Logo de l'établissement » : l'image en haut à gauche disparaît. Sous-titre `{salut} {prenom} 👋`, couleurs, hauteur. Décoche des onglets, réordonne-les ↑ ↓, ajoute un raccourci « Mes notes ». Décoche « Bandeau « Page d'accueil » en entier ». |
| 4 ter. Lisibilité | Style › Arrière-plan › Image, puis ouvre « Mes notes » | Un panneau translucide couvre toute la page : le texte reste lisible. Style › Lisibilité des autres pages : couleur, opacité, ou mode « une case par bloc ». |
| 5. Masquer un élément | Éditeur › 🎯 Masquer un élément | Survole un bloc (cadre rouge), clique, confirme. « ▲ Bloc parent » élargit la sélection. Il se réaffiche depuis la liste « Éléments masqués ». |
| 6. Informations / Sondages | Widgets 📢 et 📊 › bouton ↻ | L'extension ouvre « Informations & sondages », relève la liste puis revient seule à l'accueil. Les widgets affichent tout (lu / non lu, « À répondre »). |
| 7. Profils | Popup › 👤 Profils | **＋ Copie du profil actif**, nomme-le « Week-end », passe-le en Hacker ; bascule avec le menu déroulant en haut du popup. **↺ Réinitialiser le profil actif** remet tout à zéro. |
| 8. Outils | Popup › 🛠️ Outils | Cahier de textes › Contenus et ressources : boutons ☐ ⬇ JSON 📅 à droite des titres. Travail à faire : bouton « ＋ Devoir ». |
| 9. Tout couper | Interrupteur en haut du popup | Pronote revient instantanément à son apparence d'origine. |

En cas de souci : Popup › 🛠️ Outils › **📋 Copier le diagnostic** (structure
détectée, sans données personnelles).

## Structure des fichiers

```
manifest.json            déclaration MV3 (permissions minimales : storage, downloads)
background.js            service worker : téléchargements, raccourci clavier, installation
lib/
  defaults.js            thèmes, polices, catalogue des widgets, configuration par défaut
  color.js               calculs de couleurs (mélanges, luminance, nuances Pronote)
  storage.js             gestionnaire de profils (local / sync), import-export, images
page/
  ctx.js                 monde MAIN : lit le numéro de session Pronote (téléchargements)
content/                 scripts de contenu (monde isolé)
  core.js                noyau : config, bus d'événements, observateur DOM partagé, navigation
  theme.js               moteur de thèmes (variables CSS de Pronote recalculées)
  themes.css             décors des 5 thèmes
  interface.js           bandeaux, barre de navigation, raccourcis, cases de lecture
  layout.js              agencement en grille « maçonnerie », masquage
  widgets.js             widgets de l'accueil
  infos.js               relevé des Informations et Sondages
  notes.js               relevé des notes et de leurs coefficients (Détail de mes notes)
  editor.js              éditeur visuel (Shadow DOM)
  goat.css               grille, widgets, états de l'éditeur
  pronote-dl.js/.css     téléchargement groupé & export JSON (repris de pronote-dl)
  devoirs.js             devoirs personnels (repris de pronote-dl)
ui/
  popup.html             popup (420 px)
  options.html           tableau de bord (page complète)
  panel.js / panel.css   interface commune aux deux
icons/                   icônes 16 → 128 px
```

## Comment c'est construit

**Injection propre, aucun conflit avec Pronote**

- Tous les scripts tournent dans le **monde isolé** de Chrome : les variables de
  Pronote et les nôtres ne se voient pas. Seul `page/ctx.js` lit, en monde MAIN,
  le numéro de session — en lecture seule et sous `try/catch`.
- Les thèmes ne réécrivent pas les styles de Pronote : ils **recalculent ses
  variables CSS** (`--theme-*`, `--theme-neutre-*`, `--color-*`, avec leurs nuances
  `scaleMoins/Plus`) depuis 7 couleurs, avec une spécificité supérieure. Les thèmes
  sombres activent en plus le mode sombre natif de Pronote (`body.dark-mode`), dont
  l'état d'origine est restauré ensuite.
- Tout ce qui est ajouté est préfixé (`pg-`, `pdl-`, `data-pg-*`) ; l'interface de
  l'éditeur vit dans un **Shadow DOM** : ni ses styles ne fuient, ni ceux de Pronote
  ne l'atteignent.
- Le thème et les parties masquées sont chargés dès `document_start` : pas de
  flash de l'apparence d'origine ni d'élément masqué qui apparaît une seconde.
- Les textes du bandeau sont remplacés en CSS (`::after`), sans toucher au DOM ;
  les onglets reçoivent un simple attribut `data-pg-nav` pour être masqués ou
  réordonnés (`order` CSS sur la barre flex de Pronote).
- Le panneau de lecture est un simple fond posé sur la zone de contenu
  (`main.interface_affV_client:not(:has(> .AffichagePageAccueil))`) : aucune
  section ne peut être oubliée et les dimensions calculées par Pronote ne
  bougent pas.

**Agencement sans déplacer un seul nœud de Pronote**

Les colonnes natives passent en `display: contents` ; chaque widget devient un
élément de la grille du conteneur, positionné par des variables CSS
(`--pg-col`, `--pg-order`, `--pg-span`). Un `ResizeObserver` mesure la hauteur de
chaque widget en lignes de 4 px (`--pg-rows`) : disposition « maçonnerie » sans
trou, qui se replie toute seule en moins de colonnes sur petit écran. Pronote peut
redessiner ses widgets : leurs écouteurs d'événements et leurs identifiants restent
intacts.

**Performances**

- **Un seul `MutationObserver`** pour toute l'extension (au lieu d'un par module,
  avec observation des attributs `style`/`class` dans la version d'origine) ;
  il ignore nos propres insertions et chaque module est temporisé.
- Le balayage générique du module de téléchargement ne tourne plus que sur la page
  « Contenus et ressources » ; la visibilité est testée avec `checkVisibility()`
  au lieu de remonter 40 ancêtres avec `getComputedStyle`.
- Les widgets ne touchent le DOM que si leur rendu a changé ; l'horloge se met à jour
  à la minute (à la seconde seulement si demandé) et s'arrête quand l'onglet est caché.
- Les feuilles de style générées ne sont réécrites que si leur contenu change.

**Informations & Sondages**

Pronote n'affiche sur l'accueil que les éléments *non lus*, mélangés, dans un
widget replié. Le module `infos.js` relève ce qui passe sous ses yeux — ce widget,
la liste de la page Communication › Informations & sondages et le détail de
l'élément ouvert — et le garde en cache (`chrome.storage.local`). Le bouton ↻
automatise le relevé (ouverture de la page, lecture, retour à l'accueil). Aucune
requête n'est faite en dehors de celles de l'interface de Pronote elle-même.

## Stockage

| Clé | Zone | Contenu |
|---|---|---|
| `pgMeta` | local | profil actif, zone de stockage choisie |
| `pgIndex`, `pgProfile:<id>` | local **ou** sync | liste et contenu des profils |
| `pgAsset:<id>` | local | images de fond importées (jamais synchronisées) |
| `pgTools` | sync | réglages des outils (téléchargement, devoirs, infos) |
| `pgInfosCache`, `pgEdtToday`, `pgAgenda`, `pgSeenWidgets`, `pgSeenNav` | local | caches de lecture |
| `pdlDevoirs`, `pdlMatieres` | local | devoirs personnels et couleurs des matières |

Le passage local ⇄ synchronisé (onglet Profils) migre tous les profils ; en cas de
dépassement du quota de synchronisation (8 Ko par profil), rien n'est perdu.

## Limites connues

- Les images de fond **en ligne** peuvent être bloquées par la politique de sécurité
  (CSP) de certains Pronote : importer l'image depuis l'ordinateur fonctionne toujours.
- Aucune police n'est téléchargée : celles proposées doivent exister sur l'appareil
  (des replis sûrs sont prévus).
- La moyenne est **indicative** : notes ramenées sur 20 et pondérées par leur
  coefficient dans chaque matière, puis moyenne des matières (toutes au même
  poids). Sans relevé (↻ du widget), elle se base sur les dernières notes de
  l'accueil, coefficient 1.
- Si Pronote modifie sa structure, le relevé des informations peut devoir être
  ajusté : le diagnostic intégré aide à le faire.
